require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

const db = require('./lib/db');
const youtube = require('./lib/youtube');
const aiDj = require('./lib/ai-dj');
const qrService = require('./lib/qr');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Estado de reproducción en memoria
let currentlyPlaying = null;
let currentPlaylistIndex = 0;
let micModeActive = false;

// Variables de estado para Modo Crossover, Secuencial y Género Específico
let crossoverCurrentListIdx = 0;
let crossoverSongCountInCurrentList = 0;
let sequentialListIdx = 0;
let sequentialSongIdx = 0;
let genreFocusIndex = 0;

// Evaluador automático de horarios musicales (cada 60 segundos)
function checkSchedule() {
  const settings = db.getSettings();
  if (!settings.scheduleEnabled || !settings.schedule || settings.schedule.length === 0) return;

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;

  for (const block of settings.schedule) {
    let match = false;
    if (block.start <= block.end) {
      match = (currentTime >= block.start && currentTime < block.end);
    } else {
      // Bloque que cruza la medianoche (ej: 23:30 a 04:00)
      match = (currentTime >= block.start || currentTime < block.end);
    }

    if (match && block.playlistId && settings.activePlaylistId !== block.playlistId) {
      console.log(`🕒 Cambio de horario automático: Activando lista "${block.name}" (${block.playlistId})`);
      db.updateSettings({ activePlaylistId: block.playlistId });
      io.emit('state-changed', {
        currentlyPlaying,
        queue: db.getQueue(),
        settings: db.getSettings()
      });
      break;
    }
  }
}

setInterval(checkSchedule, 60000);

/**
 * Obtiene la siguiente canción de la lista base (El Norte)
 * Soporta 3 modos:
 * 1. 'single': Una sola lista base activa.
 * 2. 'crossover': Mezcla automática de tandas (ej: 3 de salsa -> 3 de reggaetón -> 3 de rock).
 * 3. 'sequential': Consecutivo (termina toda la Lista A, luego toda la Lista B, etc).
 */
function getNextBaseSong() {
  const settings = db.getSettings();
  const allPlaylists = db.getPlaylists();
  if (!allPlaylists || allPlaylists.length === 0) return null;

  const mode = settings.basePlaybackMode || 'single';

  // ----------------------------------------------------
  // MODO 2: CROSSOVER MULTILISTAS (TANDAS INTERCALADAS)
  // ----------------------------------------------------
  if (mode === 'crossover') {
    const selectedIds = Array.isArray(settings.crossoverPlaylists) && settings.crossoverPlaylists.length > 0
      ? settings.crossoverPlaylists
      : allPlaylists.map(p => p.id);

    const eligiblePlaylists = selectedIds
      .map(id => db.getPlaylist(id))
      .filter(p => p && p.tracks && p.tracks.length > 0);

    if (eligiblePlaylists.length > 0) {
      const batchSize = Math.max(1, settings.crossoverBatchSize || 3);
      let selectedTrack = null;
      let activeList = null;
      let listsChecked = 0;

      // Buscar una canción fresca. Si una lista agotó sus canciones sin repetir, pasar a la siguiente sin repetir
      while (listsChecked < eligiblePlaylists.length) {
        if (crossoverCurrentListIdx >= eligiblePlaylists.length) {
          crossoverCurrentListIdx = 0;
        }

        activeList = eligiblePlaylists[crossoverCurrentListIdx];
        const numTracks = activeList.tracks.length;
        let freshTrack = null;
        const startIdx = (activeList._crossoverIndex || 0) % numTracks;

        for (let i = 0; i < numTracks; i++) {
          const cIdx = (startIdx + i) % numTracks;
          const candidate = activeList.tracks[cIdx];
          const windowSize = Math.max(5, Math.min(25, numTracks * 2));
          const isRecent = db.isRecentlyPlayed(candidate.videoId, candidate.title, candidate.artist, windowSize);

          if (!isRecent || (numTracks === 1 && crossoverSongCountInCurrentList === 0 && !db.isRecentlyPlayed(candidate.videoId, candidate.title, candidate.artist, 2))) {
            freshTrack = candidate;
            activeList._crossoverIndex = cIdx + 1;
            break;
          }
        }

        if (freshTrack) {
          selectedTrack = freshTrack;
          crossoverSongCountInCurrentList++;
          // Si completó la tanda o agotó las canciones disponibles de esta lista, rotar para la próxima
          if (crossoverSongCountInCurrentList >= batchSize || crossoverSongCountInCurrentList >= numTracks) {
            crossoverCurrentListIdx = (crossoverCurrentListIdx + 1) % eligiblePlaylists.length;
            crossoverSongCountInCurrentList = 0;
          }
          break;
        } else {
          // No hay más de este género / lista que no se hayan repetido: pasar inmediatamente a la siguiente
          crossoverCurrentListIdx = (crossoverCurrentListIdx + 1) % eligiblePlaylists.length;
          crossoverSongCountInCurrentList = 0;
          listsChecked++;
        }
      }

      // Si todo el repertorio ya sonó recientemente, tomar la siguiente en ciclo
      if (!selectedTrack) {
        activeList = eligiblePlaylists[crossoverCurrentListIdx];
        const trackIndex = (activeList._crossoverIndex || 0) % activeList.tracks.length;
        activeList._crossoverIndex = trackIndex + 1;
        selectedTrack = activeList.tracks[trackIndex];
        crossoverCurrentListIdx = (crossoverCurrentListIdx + 1) % eligiblePlaylists.length;
        crossoverSongCountInCurrentList = 0;
      }

      const songGenre = selectedTrack.genre && selectedTrack.genre !== 'Crossover'
        ? selectedTrack.genre
        : aiDj.classifyGenreFast(selectedTrack.title, selectedTrack.artist, activeList.name);

      return {
        id: `base_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        videoId: selectedTrack.videoId,
        title: selectedTrack.title,
        artist: selectedTrack.artist,
        genre: songGenre || 'Crossover',
        duration: selectedTrack.duration || '3:30',
        thumbnail: selectedTrack.thumbnail || `https://i.ytimg.com/vi/${selectedTrack.videoId}/hqdefault.jpg`,
        requestedBy: { table: null, name: `DJ Crossover (${activeList.name})` },
        isBaseTrack: true,
        addedAt: Date.now()
      };
    }
  }

  // ----------------------------------------------------
  // MODO 3: SECUENCIAL / CONSECUTIVO EN CADENA
  // Suena toda una lista completa y al terminar pasa a la siguiente
  // ----------------------------------------------------
  if (mode === 'sequential') {
    let orderedIds = [];
    if (settings.sequentialOrderType === 'custom' && Array.isArray(settings.sequentialPlaylistOrder) && settings.sequentialPlaylistOrder.length > 0) {
      // Usar orden personalizado del usuario
      orderedIds = settings.sequentialPlaylistOrder;
    } else {
      // Orden natural (de la primera a la última según listas seleccionadas)
      orderedIds = Array.isArray(settings.crossoverPlaylists) && settings.crossoverPlaylists.length > 0
        ? settings.crossoverPlaylists
        : allPlaylists.map(p => p.id);
    }

    const eligiblePlaylists = orderedIds
      .map(id => db.getPlaylist(id))
      .filter(p => p && p.tracks && p.tracks.length > 0);

    if (eligiblePlaylists.length > 0) {
      if (sequentialListIdx >= eligiblePlaylists.length) {
        sequentialListIdx = 0;
        sequentialSongIdx = 0;
      }

      let currentList = eligiblePlaylists[sequentialListIdx];
      if (sequentialSongIdx >= currentList.tracks.length) {
        // Terminó esta lista completa, avanzar a la siguiente lista de la cadena
        sequentialListIdx = (sequentialListIdx + 1) % eligiblePlaylists.length;
        sequentialSongIdx = 0;
        currentList = eligiblePlaylists[sequentialListIdx];
      }

      const track = currentList.tracks[sequentialSongIdx];
      sequentialSongIdx++;

      const songGenre = track.genre && track.genre !== 'Crossover'
        ? track.genre
        : aiDj.classifyGenreFast(track.title, track.artist, currentList.name);

      return {
        id: `base_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        videoId: track.videoId,
        title: track.title,
        artist: track.artist,
        genre: songGenre || 'Crossover',
        duration: track.duration || '3:30',
        thumbnail: track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`,
        requestedBy: { table: null, name: `Cadena DJ (${currentList.name})` },
        isBaseTrack: true,
        addedAt: Date.now()
      };
    }
  }

  // ----------------------------------------------------
  // MODO 4: GÉNERO ESPECÍFICO MULTILISTAS ('genre_focus')
  // Suenan canciones de un solo género tomadas de cualquier lista
  // ----------------------------------------------------
  if (mode === 'genre_focus') {
    const focusGenre = settings.focusGenre || 'Salsa';
    const focusStyle = settings.genrePlaybackStyle || 'shuffle';

    // Recopilar todas las canciones de este género de todas las listas disponibles
    const matchedTracks = [];
    for (const pl of allPlaylists) {
      if (Array.isArray(pl.tracks)) {
        for (const t of pl.tracks) {
          const g = (t.genre && t.genre !== 'Crossover')
            ? t.genre
            : aiDj.classifyGenreFast(t.title, t.artist, pl.name);

          if (g.toLowerCase() === focusGenre.toLowerCase()) {
            matchedTracks.push({
              track: t,
              playlistName: pl.name,
              genre: g
            });
          }
        }
      }
    }

    if (matchedTracks.length > 0) {
      let chosenItem = null;

      if (focusStyle === 'shuffle') {
        // Buscar un tema de este género que NO haya sonado recientemente
        const freshCandidates = matchedTracks.filter(item => 
          !db.isRecentlyPlayed(item.track.videoId, item.track.title, item.track.artist, Math.min(25, matchedTracks.length - 1))
        );

        if (freshCandidates.length > 0) {
          const randIdx = Math.floor(Math.random() * freshCandidates.length);
          chosenItem = freshCandidates[randIdx];
        } else {
          // Si todos ya sonaron recientemente, elegir uno al azar
          const randIdx = Math.floor(Math.random() * matchedTracks.length);
          chosenItem = matchedTracks[randIdx];
        }
      } else {
        // Modo orden secuencial agrupado
        const currentIdx = (genreFocusIndex || 0) % matchedTracks.length;
        genreFocusIndex = currentIdx + 1;
        chosenItem = matchedTracks[currentIdx];
      }

      if (chosenItem) {
        return {
          id: `base_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          videoId: chosenItem.track.videoId,
          title: chosenItem.track.title,
          artist: chosenItem.track.artist,
          genre: chosenItem.genre,
          duration: chosenItem.track.duration || '3:30',
          thumbnail: chosenItem.track.thumbnail || `https://i.ytimg.com/vi/${chosenItem.track.videoId}/hqdefault.jpg`,
          requestedBy: { table: null, name: `DJ 100% ${focusGenre} (${chosenItem.playlistName})` },
          isBaseTrack: true,
          addedAt: Date.now()
        };
      }
    }
  }

  // ----------------------------------------------------
  // MODO 1: LISTA ÚNICA (PREDETERMINADO)
  // ----------------------------------------------------
  const playlist = db.getPlaylist(settings.activePlaylistId) || allPlaylists[0];
  if (!playlist || !playlist.tracks || playlist.tracks.length === 0) {
    return null;
  }

  const track = playlist.tracks[currentPlaylistIndex % playlist.tracks.length];
  currentPlaylistIndex++;

  return {
    id: `base_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    videoId: track.videoId,
    title: track.title,
    artist: track.artist,
    genre: track.genre || 'Crossover',
    duration: track.duration || '3:30',
    thumbnail: track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`,
    requestedBy: { table: null, name: 'DJ Residente (Lista Base)' },
    isBaseTrack: true,
    addedAt: Date.now()
  };
}

/**
 * Avanza a la siguiente canción
 */
function advanceToNextSong() {
  const queue = db.getQueue();

  if (currentlyPlaying) {
    db.addToHistory(currentlyPlaying);
  }

  if (queue.length > 0) {
    // Hay canciones pedidas por los clientes en cola
    const nextSong = queue.shift();
    db.setQueue(queue);
    currentlyPlaying = {
      ...nextSong,
      startedAt: Date.now()
    };
  } else {
    // Si no hay pedidos de clientes, tomar de la lista base
    const baseSong = getNextBaseSong();
    if (baseSong) {
      currentlyPlaying = {
        ...baseSong,
        startedAt: Date.now()
      };
    } else {
      currentlyPlaying = null;
    }
  }

  // Notificar a todos los clientes conectados
  io.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });

  return currentlyPlaying;
}

// Inicializar la primera canción si no hay nada sonando
function ensurePlaying() {
  if (!currentlyPlaying) {
    advanceToNextSong();
  }
}

// ==========================================
// RUTAS DE LA API
// ==========================================

// Estado general del sistema
app.get('/api/status', (req, res) => {
  ensurePlaying();
  res.json({
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings(),
    micModeActive,
    bannedTables: db.getBannedTables()
  });
});

// Búsqueda en YouTube para clientes y admin
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });

  const results = await youtube.search(query, 8);
  res.json({ results });
});

// Pedir canción (Cliente desde la mesa)
app.post('/api/request', async (req, res) => {
  try {
    const { videoId, title, artist, duration, thumbnail, table, customerName, dedication } = req.body;
    const tableClean = table ? String(table).trim() : 'Mesa';

    if (!videoId || !title) {
      return res.status(400).json({ error: 'Faltan datos de la canción' });
    }

    // 1. Validar reglas de la mesa (anti-spam / límites / baneos)
    const check = db.canTableRequest(tableClean);
    if (!check.allowed) {
      return res.status(429).json({ error: check.reason });
    }

    // 2. Filtro Anti-Trolls y Lista Negra
    const blSong = db.isBlacklisted(title, artist);
    const blDed = dedication ? db.isBlacklisted(dedication, '') : { blacklisted: false };
    if (blSong.blacklisted || blDed.blacklisted) {
      return res.status(400).json({
        error: 'Esta canción o mensaje contiene términos o audios no permitidos en el bar.'
      });
    }

    // 3. Validar modo de solicitud (abierto vs. solo listas)
    const settings = db.getSettings();
    if (settings.requestMode === 'playlist') {
      const allPlaylists = db.getPlaylists();
      const isInPlaylist = allPlaylists.some(pl =>
        pl.tracks && pl.tracks.some(t => t.videoId === videoId)
      );
      if (!isInPlaylist) {
        return res.status(403).json({
          error: 'El bar solo acepta pedidos de canciones que están en las listas disponibles. ¡Elige una de ellas!'
        });
      }
    }

    // 4. Clasificar género con el DJ Inteligente
    const genre = await aiDj.classifyGenre(title, artist);

    const song = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      videoId,
      title,
      artist: artist || 'Artista',
      genre,
      duration: duration || '3:30',
      thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      requestedBy: {
        table: tableClean,
        name: customerName ? customerName.trim() : `Mesa ${tableClean}`,
        dedication: (dedication || '').trim().slice(0, 120)
      },
      isBaseTrack: false,
      addedAt: Date.now()
    };

    const currentQueue = db.getQueue();

    // 3. Si no hay nada sonando o lo que suena es música de fondo de la lista base (isBaseTrack),
    // darle paso inmediato al pedido del cliente para que suene de una vez
    if (!currentlyPlaying || currentlyPlaying.isBaseTrack) {
      if (currentlyPlaying) {
        db.addToHistory(currentlyPlaying);
      }
      currentlyPlaying = { ...song, startedAt: Date.now() };
      db.recordTableRequest(tableClean);
      io.emit('state-changed', {
        currentlyPlaying,
        queue: db.getQueue(),
        settings
      });
      io.emit('new-request-alert', {
        song,
        position: 1
      });
      return res.json({
        success: true,
        message: '¡Tu canción empezará a sonar de inmediato!',
        position: 1,
        song
      });
    }

    // 4. Inserción Inteligente por Bloques de Género (Smart Slotting)
    let slotIndex = currentQueue.length;
    if (settings.autoDJEnabled) {
      slotIndex = aiDj.calculateSmartSlot(currentQueue, genre, currentlyPlaying);
      db.insertInQueueAt(slotIndex, song);
    } else {
      db.addToQueue(song);
    }

    // Registrar pedido de la mesa
    db.recordTableRequest(tableClean);

    // Calcular posición aproximada para el usuario (1-indexed)
    const displayPosition = slotIndex + 1;

    // Avisar en tiempo real a la pantalla del bar y a los demás usuarios
    io.emit('state-changed', {
      currentlyPlaying,
      queue: db.getQueue(),
      settings
    });

    io.emit('new-request-alert', {
      song,
      position: displayPosition
    });

    res.json({
      success: true,
      message: `¡Canción agregada con éxito! Está en el turno #${displayPosition} dentro de la tanda de ${genre}.`,
      position: displayPosition,
      genre,
      song
    });
  } catch (err) {
    console.error('Error al procesar pedido:', err);
    res.status(500).json({ error: 'Ocurrió un error al procesar el pedido' });
  }
});

// Obtener todas las listas
app.get('/api/playlists', (req, res) => {
  res.json({ playlists: db.getPlaylists() });
});

// Guardar / Crear lista
app.post('/api/playlists', (req, res) => {
  const { name, description, tracks, id: customId } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });

  const cleanSlug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 25);

  const id = customId || `${cleanSlug || 'lista'}-${Date.now().toString(36)}`;
  const processedTracks = (Array.isArray(tracks) ? tracks : []).map(t => {
    const detectedGenre = (t.genre && t.genre !== 'Crossover')
      ? t.genre
      : aiDj.classifyGenreFast(t.title, t.artist, name);
    return {
      ...t,
      genre: detectedGenre || 'Crossover'
    };
  });

  const newPlaylist = {
    id,
    name,
    description: description || '',
    tracks: processedTracks
  };

  db.addPlaylist(newPlaylist);
  res.json({ success: true, playlist: newPlaylist });
});

// Restaurar listas desde copia de seguridad
app.post('/api/playlists/restore', (req, res) => {
  const { playlists } = req.body;
  if (!Array.isArray(playlists)) return res.status(400).json({ error: 'Formato no válido' });
  const updated = db.restorePlaylists(playlists);
  res.json({ success: true, total: updated.length, playlists: updated });
});

// Importar lista completa pegando enlace de YouTube
app.post('/api/playlists/import-youtube', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Falta el enlace de la lista de YouTube' });

  const imported = await youtube.importPlaylist(url);
  if (!imported || !imported.tracks || imported.tracks.length === 0) {
    return res.status(400).json({ error: 'No se pudo leer la lista de YouTube. Asegúrate de que el enlace sea de una lista pública o no listada.' });
  }

  db.addPlaylist(imported);
  res.json({ success: true, playlist: imported });
});

// Importación masiva de múltiples playlists (varios links a la vez)
app.post('/api/playlists/import-multiple', async (req, res) => {
  const { urls } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Debes ingresar al menos un enlace de lista.' });
  }

  const imported = [];
  const errors = [];

  for (const rawUrl of urls) {
    const cleanUrl = (rawUrl || '').trim();
    if (!cleanUrl) continue;

    try {
      const pl = await youtube.importPlaylist(cleanUrl);
      if (pl && pl.tracks && pl.tracks.length > 0) {
        db.addPlaylist(pl);
        imported.push(pl);
      } else {
        errors.push(cleanUrl);
      }
    } catch (err) {
      errors.push(cleanUrl);
    }
  }

  res.json({
    success: true,
    totalImported: imported.length,
    playlists: imported,
    errors
  });
});

// Buscar playlists en YouTube por nombre de canal o tema
app.get('/api/playlists/search-youtube', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ playlists: [] });

  try {
    const ytSearch = require('yt-search');
    const r = await ytSearch(`${query.trim()} playlist`);
    const playlists = (r && r.playlists) ? r.playlists.slice(0, 10).map(p => ({
      listId: p.listId,
      url: p.url,
      title: p.title,
      videoCount: p.videoCount,
      author: p.author?.name || 'YouTube',
      thumbnail: p.thumbnail || ''
    })) : [];

    res.json({ playlists });
  } catch (err) {
    console.error('Error buscando playlists en YouTube:', err);
    res.json({ playlists: [] });
  }
});

// Activar lista base activa
app.post('/api/playlists/:id/activate', (req, res) => {
  const playlist = db.getPlaylist(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Lista no encontrada' });

  // 1. Guardar como lista activa
  let settings = db.getSettings();
  let crossoverList = Array.isArray(settings.crossoverPlaylists) ? [...settings.crossoverPlaylists] : [];

  // Si la rotación está activa y no estaba incluida, incluirla automáticamente
  if (crossoverList.length > 0 && !crossoverList.includes(req.params.id)) {
    crossoverList.push(req.params.id);
  }

  db.updateSettings({
    activePlaylistId: req.params.id,
    crossoverPlaylists: crossoverList
  });

  currentPlaylistIndex = 0;

  // 2. Alinear índices de rotación Crossover y Secuencial al inicio de esta lista
  const allPlaylists = db.getPlaylists();
  const selectedIds = crossoverList.length > 0 ? crossoverList : allPlaylists.map(p => p.id);
  const eligiblePlaylists = selectedIds
    .map(id => db.getPlaylist(id))
    .filter(p => p && p.tracks && p.tracks.length > 0);

  const foundIdx = eligiblePlaylists.findIndex(p => p.id === req.params.id);
  if (foundIdx !== -1) {
    crossoverCurrentListIdx = foundIdx;
    crossoverSongCountInCurrentList = 0;
    sequentialListIdx = foundIdx;
    sequentialSongIdx = 0;
    if (playlist._crossoverIndex !== undefined) {
      playlist._crossoverIndex = 0;
    }
  }

  // 3. Si actualmente suena música de fondo base (sin pedidos de clientes en cola),
  // avanzar de inmediato para que empiece a sonar la lista recién activada sin demoras
  const queue = db.getQueue();
  if (queue.length === 0 && (!currentlyPlaying || currentlyPlaying.isBaseTrack)) {
    advanceToNextSong();
  } else {
    io.emit('state-changed', {
      currentlyPlaying,
      queue: db.getQueue(),
      settings: db.getSettings()
    });
  }

  res.json({ success: true, activePlaylist: playlist });
});

// Actualizar información o temas de una lista
app.put('/api/playlists/:id', (req, res) => {
  const { name, description, tracks } = req.body;
  const updated = db.updatePlaylist(req.params.id, {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(tracks !== undefined ? { tracks } : {})
  });

  if (!updated) return res.status(404).json({ error: 'Lista no encontrada' });
  res.json({ success: true, playlist: updated });
});

// Eliminar lista
app.delete('/api/playlists/:id', (req, res) => {
  const playlist = db.getPlaylist(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Lista no encontrada' });

  db.deletePlaylist(req.params.id);
  res.json({ success: true });
});

// Agregar canción a una lista existente
app.post('/api/playlists/:id/tracks', (req, res) => {
  const playlist = db.getPlaylist(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Lista no encontrada' });

  const { videoId, title, artist, genre, duration, thumbnail } = req.body;
  if (!videoId || !title) {
    return res.status(400).json({ error: 'Faltan datos de la canción' });
  }

  const detectedGenre = (genre && genre !== 'Crossover')
    ? genre
    : aiDj.classifyGenreFast(title, artist, playlist.name);

  const newTrack = {
    videoId,
    title,
    artist: artist || 'Artista',
    genre: detectedGenre || 'Crossover',
    duration: duration || '3:30',
    thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  };

  if (!playlist.tracks) playlist.tracks = [];
  playlist.tracks.push(newTrack);
  db.updatePlaylist(req.params.id, { tracks: playlist.tracks });

  res.json({ success: true, playlist, track: newTrack });
});

// Quitar canción de una lista por su índice
app.delete('/api/playlists/:id/tracks/:index', (req, res) => {
  const playlist = db.getPlaylist(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Lista no encontrada' });

  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= (playlist.tracks || []).length) {
    return res.status(400).json({ error: 'Índice de canción no válido' });
  }

  const removed = playlist.tracks.splice(index, 1);
  db.updatePlaylist(req.params.id, { tracks: playlist.tracks });

  res.json({ success: true, playlist, removedTrack: removed[0] });
});

// Modificar género de una canción específica en una lista
app.put('/api/playlists/:id/tracks/:index/genre', (req, res) => {
  const { genre } = req.body;
  const index = parseInt(req.params.index, 10);
  const updated = db.updateTrackGenre(req.params.id, index, genre);
  if (!updated) return res.status(404).json({ error: 'No se pudo actualizar el género' });
  res.json({ success: true, track: updated });
});

// Auto-clasificar géneros de todas las canciones de una lista específica
app.post('/api/playlists/:id/auto-classify', (req, res) => {
  const playlist = db.getPlaylist(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Lista no encontrada' });

  let updatedCount = 0;
  if (Array.isArray(playlist.tracks)) {
    for (const t of playlist.tracks) {
      const detected = aiDj.classifyGenreFast(t.title, t.artist, playlist.name);
      if (detected && detected !== 'Crossover') {
        t.genre = detected;
        updatedCount++;
      }
    }
  }

  db.updatePlaylist(req.params.id, { tracks: playlist.tracks });
  res.json({ success: true, updatedCount, playlist });
});

// Auto-clasificar géneros de TODAS las listas existentes del bar
app.post('/api/playlists/auto-classify-all', (req, res) => {
  const updatedCount = db.autoClassifyAllTracks();
  res.json({ success: true, updatedCount, playlists: db.getPlaylists() });
});

// Generar lista con IA (Gemini con fallback automático inteligente de YouTube)
app.post('/api/playlists/ai-generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Por favor escribe qué tipo de música quieres para la lista.' });
  }

  const settings = db.getSettings();
  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;

  try {
    let fullTracks = [];

    if (apiKey) {
      try {
        const generatedTracks = await aiDj.generatePlaylistWithAI(prompt, apiKey);
        for (const t of generatedTracks) {
          const searchRes = await youtube.search(`${t.title} ${t.artist}`, 1);
          if (searchRes && searchRes.length > 0) {
            fullTracks.push({
              videoId: searchRes[0].videoId,
              title: t.title,
              artist: t.artist,
              genre: t.genre || 'Crossover',
              duration: searchRes[0].duration,
              thumbnail: searchRes[0].thumbnail
            });
          }
        }
      } catch (geminiErr) {
        console.warn('Error en Gemini, usando generador inteligente automático:', geminiErr.message);
        fullTracks = await aiDj.generatePlaylistFallback(prompt);
      }
    } else {
      // Sin clave de Gemini configurada: usar generador inteligente directo de YouTube
      fullTracks = await aiDj.generatePlaylistFallback(prompt);
    }

    if (!fullTracks || fullTracks.length === 0) {
      return res.status(404).json({ error: 'No se encontraron temas para esa búsqueda. Intenta con otros términos.' });
    }

    res.json({
      success: true,
      usedGemini: !!apiKey,
      tracks: fullTracks
    });
  } catch (err) {
    console.error('Error generando con IA:', err);
    res.status(500).json({ error: err.message || 'Error al generar lista' });
  }
});

// Acciones de administración de la cola
app.post('/api/admin/skip', (req, res) => {
  const next = advanceToNextSong();
  res.json({ success: true, currentlyPlaying: next });
});

app.post('/api/admin/remove-queued', (req, res) => {
  const { songId } = req.body;
  db.removeFromQueue(songId);
  io.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });
  res.json({ success: true });
});

app.post('/api/admin/reorder', (req, res) => {
  const { queue } = req.body;
  if (Array.isArray(queue)) {
    db.setQueue(queue);
    io.emit('state-changed', {
      currentlyPlaying,
      queue: db.getQueue(),
      settings: db.getSettings()
    });
  }
  res.json({ success: true });
});

app.post('/api/admin/play-now', async (req, res) => {
  const { videoId, title, artist, genre, duration, thumbnail } = req.body;
  if (!videoId) return res.status(400).json({ error: 'Falta videoId' });

  if (currentlyPlaying) {
    db.addToHistory(currentlyPlaying);
  }

  currentlyPlaying = {
    id: `forced_${Date.now()}`,
    videoId,
    title: title || 'Canción',
    artist: artist || 'Artista',
    genre: genre || 'Crossover',
    duration: duration || '3:30',
    thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    requestedBy: { table: null, name: 'DJ / Bar' },
    isBaseTrack: false,
    startedAt: Date.now()
  };

  io.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });

  res.json({ success: true, currentlyPlaying });
});

// Modo Micrófono / Anuncio (baja volumen suavemente en la TV)
app.post('/api/admin/mic-mode', (req, res) => {
  micModeActive = !micModeActive;
  io.emit('mic-mode', { active: micModeActive });
  res.json({ success: true, micModeActive });
});

// Baneo y desbaneo de mesas problemáticas
app.post('/api/admin/ban-table', (req, res) => {
  const { table, minutes } = req.body;
  db.banTable(table, minutes || 30);
  const banned = db.getBannedTables();
  io.emit('banned-tables-updated', banned);
  res.json({ success: true, bannedTables: banned });
});

app.post('/api/admin/unban-table', (req, res) => {
  const { table } = req.body;
  db.unbanTable(table);
  const banned = db.getBannedTables();
  io.emit('banned-tables-updated', banned);
  res.json({ success: true, bannedTables: banned });
});

app.get('/api/admin/banned-tables', (req, res) => {
  res.json({ bannedTables: db.getBannedTables() });
});

// Códigos QR
app.get('/api/qrs', async (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  const settings = db.getSettings();
  const qrs = await qrService.generateBatch(baseUrl, settings.totalTables || 20);
  res.json({ baseUrl, qrs });
});

// Ajustes del bar
app.get('/api/settings', (req, res) => {
  res.json({ settings: db.getSettings() });
});

app.post('/api/settings', (req, res) => {
  const updated = db.updateSettings(req.body);
  io.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: updated
  });
  res.json({ success: true, settings: updated });
});

// Historial y tendencias
app.get('/api/history', (req, res) => {
  res.json({ history: db.getHistory() });
});

app.get('/api/trends', (req, res) => {
  const history = db.getHistory(100);
  const songCounts = {};
  const genreCounts = {};

  for (const item of history) {
    const key = `${item.title} - ${item.artist}`;
    songCounts[key] = (songCounts[key] || 0) + 1;
    if (item.genre) {
      genreCounts[item.genre] = (genreCounts[item.genre] || 0) + 1;
    }
  }

  const topSongs = Object.entries(songCounts)
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topGenres = Object.entries(genreCounts)
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count);

  res.json({ topSongs, topGenres });
});

// ==========================================
// SOCKET.IO (Sincronización en tiempo real)
// ==========================================
io.on('connection', (socket) => {
  // Enviar estado actual al cliente recién conectado
  socket.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });

  // El reproductor de pantalla avisa que terminó una canción
  socket.on('song-ended', () => {
    advanceToNextSong();
  });

  // El reproductor reporta cambios de estado
  socket.on('player-status', (data) => {
    io.emit('player-broadcast', data);
  });
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎵 Asistente Music Bar - Rockola Digital con DJ IA`);
  console.log(`======================================================`);
  console.log(`📱 Vista Cliente (Mesas):   http://localhost:${PORT}`);
  console.log(`📺 Vista Reproductor (TV):  http://localhost:${PORT}/player.html`);
  console.log(`🎛️ Vista Admin / DJ:        http://localhost:${PORT}/admin.html`);
  console.log(`🖨️ Códigos QR para Mesas:   http://localhost:${PORT}/qrs.html`);
  console.log(`======================================================\n`);
  ensurePlaying();
});
