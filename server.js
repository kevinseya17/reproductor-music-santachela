require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

const fs = require('fs');
const dbFactory = require('./lib/db');
const youtube = require('./lib/youtube');
const aiDj = require('./lib/ai-dj');
const qrService = require('./lib/qr');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e7
});

const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Si se abre /player.html desde un celular móvil, redirigir directamente al Panel de Administrador (/admin.html)
app.get('/player.html', (req, res, next) => {
  if (req.query.force === '1' || req.query.preview === '1') return next();
  const ua = req.headers['user-agent'] || '';
  const isTV = /SmartTV|Tizen|Web0S|BRAVIA|NetCast|Android TV|GoogleTV|AFT[A-Z]|CrKey|AppleTV|Roku|HbbTV|Xbox|PlayStation/i.test(ua);
  if (isTV) return next();
  const isMobileUA = /iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua));
  if (isMobileUA) {
    return res.redirect('/admin.html');
  }
  next();
});

// Blindaje global para motores de búsqueda: BLOQUEAR el programa de los bares en Google; SOLO permitir la página web comercial (/ventas, /mocd, /mocdmusic, /promo)
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  const host = String(req.hostname || req.headers.host || '').toLowerCase();
  const isCommercialWebPage =
    p === '/ventas' ||
    p === '/ventas.html' ||
    p === '/mocd' ||
    p === '/mocdmusic' ||
    p === '/promo' ||
    p === '/robots.txt' ||
    p === '/sitemap.xml' ||
    (p === '/' && host.includes('mocd') && !req.query.mesa);

  if (!isCommercialWebPage) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  }
  next();
});

// Si entran por un dominio propio de MOCD MUSIC (ej: mocdmusic.com) en la raíz /, mostrar la Página Comercial de Ventas
app.get('/', (req, res, next) => {
  const host = String(req.hostname || req.headers.host || '').toLowerCase();
  if (host.includes('mocd') && !req.query.mesa) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(path.join(__dirname, 'public', 'ventas.html'));
  }
  next();
});

// SEO Oficial para Google Chrome: permitir indexar únicamente la página comercial de MOCD MUSIC y ocultar el programa de los bares
app.get('/robots.txt', (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers.host || 'reproductor-music-santachela.onrender.com';
  const baseUrl = `${proto}://${host}`;
  res.type('text/plain').send(
`User-agent: *
Allow: /ventas
Allow: /ventas.html
Allow: /mocd
Allow: /mocdmusic
Allow: /promo
Disallow: /index.html
Disallow: /*?mesa=*
Disallow: /admin
Disallow: /admin.html
Disallow: /dj
Disallow: /player
Disallow: /player.html
Disallow: /tv
Disallow: /qrs.html
Disallow: /links
Disallow: /links.html
Disallow: /bares
Disallow: /central
Disallow: /ambar
Disallow: /ambar/
Disallow: /bar3
Disallow: /bar3/
Disallow: /bar4
Disallow: /bar4/
Disallow: /api/

Sitemap: ${baseUrl}/sitemap.xml
`
  );
});

app.get('/sitemap.xml', (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers.host || 'reproductor-music-santachela.onrender.com';
  const baseUrl = `${proto}://${host}`;
  const today = new Date().toISOString().split('T')[0];
  res.type('application/xml').send(
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/ventas</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/mocdmusic</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
</urlset>`
  );
});

app.use(express.static(path.join(__dirname, 'public')));

// Atajos cortos adicionales (sin afectar los enlaces existentes)
app.get(['/dj', '/admin'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get(['/tv', '/player'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

app.get(['/links', '/bares', '/central'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'links.html'));
});

app.get(['/ventas', '/promo', '/mocd', '/mocdmusic'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'ventas.html'));
});

function createBarProgram(instanceId = 'default', routePrefix = '') {
  const db = dbFactory.getInstance(instanceId);
  const router = express.Router();
  const roomName = 'instance:' + instanceId;
  const roomIo = {
    emit: (...args) => io.to(roomName).emit(...args)
  };

// Estado de reproducción en memoria y persistente
let currentlyPlaying = db.getCurrentlyPlaying();
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
      roomIo.emit('state-changed', {
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
let crossoverPercentageCounter = 0;

/**
 * Selecciona la siguiente lista respetando una distribución porcentual ponderada
 * (Punto 3: ej 60% Salsa, 30% Reguetón, 10% Vallenato, distribuidos proporcionalmente)
 */
function getPlaylistByPercentage(eligiblePlaylists, percentages) {
  if (eligiblePlaylists.length === 1) return eligiblePlaylists[0];

  const weights = eligiblePlaylists.map(pl => {
    const raw = percentages[pl.id];
    const n = (raw !== undefined && !isNaN(Number(raw)) && Number(raw) > 0) ? Number(raw) : 10;
    return n;
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;

  const cycle = 100;
  const step = (crossoverPercentageCounter++) % cycle;
  let cumulative = 0;

  for (let i = 0; i < eligiblePlaylists.length; i++) {
    cumulative += (weights[i] / total) * cycle;
    if (step < cumulative) {
      return eligiblePlaylists[i];
    }
  }
  return eligiblePlaylists[0];
}

/**
 * Obtiene la siguiente canción de la lista base (El Norte)
 * Soporta 3 modos:
 * 1. 'single': Una sola lista base activa.
 * 2. 'crossover': Mezcla automática (por tandas de 1 a 5 canciones o por porcentajes %).
 * 3. 'sequential': Consecutivo (termina toda la Lista A, luego toda la Lista B, etc).
 */
function getNextBaseSong() {
  const settings = db.getSettings();
  const allPlaylists = db.getPlaylists();
  if (!allPlaylists || allPlaylists.length === 0) return null;

  const mode = settings.basePlaybackMode || 'single';

  // ----------------------------------------------------
  // MODO 2: CROSSOVER MULTILISTAS (TANDAS O PORCENTAJES)
  // ----------------------------------------------------
  if (mode === 'crossover') {
    const selectedIds = Array.isArray(settings.crossoverPlaylists) && settings.crossoverPlaylists.length > 0
      ? settings.crossoverPlaylists
      : allPlaylists.map(p => p.id);

    const eligiblePlaylists = selectedIds
      .map(id => db.getPlaylist(id))
      .filter(p => p && p.tracks && p.tracks.length > 0);

    if (eligiblePlaylists.length > 0) {
      const distType = settings.crossoverDistributionType || 'batch'; // 'batch' o 'percentage'
      const batchSize = Math.max(1, settings.crossoverBatchSize || 3);
      let selectedTrack = null;
      let activeList = null;

      if (distType === 'percentage') {
        // MODO PORCENTAJE (Punto 3: distribución uniforme sin agrupar canciones del mismo género)
        activeList = getPlaylistByPercentage(eligiblePlaylists, settings.crossoverPercentages || {});
        const numTracks = activeList.tracks.length;
        const startIdx = (activeList._crossoverIndex || 0) % numTracks;

        for (let i = 0; i < numTracks; i++) {
          const cIdx = (startIdx + i) % numTracks;
          const candidate = activeList.tracks[cIdx];
          const windowSize = Math.max(5, Math.min(25, numTracks * 2));
          if (!db.isRecentlyPlayed(candidate.videoId, candidate.title, candidate.artist, windowSize)) {
            selectedTrack = candidate;
            activeList._crossoverIndex = cIdx + 1;
            break;
          }
        }
        if (!selectedTrack) {
          const trackIndex = (activeList._crossoverIndex || 0) % numTracks;
          activeList._crossoverIndex = trackIndex + 1;
          selectedTrack = activeList.tracks[trackIndex];
        }
      } else {
        // MODO TANDAS INTERCALADAS (ej. 2 o 3 canciones por lista)
        let listsChecked = 0;
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
            if (crossoverSongCountInCurrentList >= batchSize || crossoverSongCountInCurrentList >= numTracks) {
              crossoverCurrentListIdx = (crossoverCurrentListIdx + 1) % eligiblePlaylists.length;
              crossoverSongCountInCurrentList = 0;
            }
            break;
          } else {
            crossoverCurrentListIdx = (crossoverCurrentListIdx + 1) % eligiblePlaylists.length;
            crossoverSongCountInCurrentList = 0;
            listsChecked++;
          }
        }

        if (!selectedTrack) {
          activeList = eligiblePlaylists[crossoverCurrentListIdx];
          const trackIndex = (activeList._crossoverIndex || 0) % activeList.tracks.length;
          activeList._crossoverIndex = trackIndex + 1;
          selectedTrack = activeList.tracks[trackIndex];
          crossoverCurrentListIdx = (crossoverCurrentListIdx + 1) % eligiblePlaylists.length;
          crossoverSongCountInCurrentList = 0;
        }
      }

      const songGenre = selectedTrack.genre && selectedTrack.genre !== 'Crossover'
        ? selectedTrack.genre
        : aiDj.classifyGenreFast(selectedTrack.title, selectedTrack.artist, activeList.name);

      return {
        id: `base_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        videoId: selectedTrack.videoId,
        title: selectedTrack.title,
        artist: selectedTrack.artist,
        genre: songGenre || 'Crossover',
        duration: selectedTrack.duration || '3:30',
        thumbnail: selectedTrack.thumbnail || `https://i.ytimg.com/vi/${selectedTrack.videoId}/hqdefault.jpg`,
        playlistId: activeList ? activeList.id : null,
        playlistName: activeList ? activeList.name : null,
        requestedBy: { table: null, name: activeList ? activeList.name : 'Lista Base' },
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
    id: `base_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    videoId: track.videoId,
    title: track.title,
    artist: track.artist,
    genre: track.genre || 'Crossover',
    duration: track.duration || '3:30',
    thumbnail: track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`,
    playlistId: playlist.id,
    playlistName: playlist.name,
    requestedBy: { table: null, name: playlist.name || 'Lista Base' },
    isBaseTrack: true,
    addedAt: Date.now()
  };
}

/**
 * Rellena la cola de reproducción anticipada con al menos 50 canciones
 * (Punto 1 y 2: Permite al DJ ver, mover y editar las mezclas de listas y pedidos)
 */
function replenishPlaybackQueue(targetCount = 50) {
  let queue = db.getQueue();
  const allPlaylists = db.getPlaylists();
  if (!allPlaylists || allPlaylists.length === 0) return queue;

  let added = false;
  let attempts = 0;
  while (queue.length < targetCount && attempts < 100) {
    attempts++;
    const nextBase = getNextBaseSong();
    if (!nextBase) break;
    queue.push(nextBase);
    added = true;
  }

  if (added) {
    db.setQueue(queue);
  }
  return queue;
}

/**
 * Regenera las canciones base de la cola cuando el DJ cambia de lista o modo de mezcla,
 * manteniendo a salvo todos los pedidos de clientes de mesas.
 */
function regenerateBaseTracksInQueue(targetCount = 50) {
  let queue = db.getQueue();
  // Conservar pedidos de mesas y solicitudes manuales no-base
  const clientRequests = queue.filter(s => s.isBaseTrack !== true);
  db.setQueue(clientRequests);
  replenishPlaybackQueue(targetCount);

  roomIo.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });
}

/**
 * Avanza a la siguiente canción
 */
function advanceToNextSong() {
  let queue = db.getQueue();

  if (currentlyPlaying) {
    db.addToHistory(currentlyPlaying);
  }

  // Si la cola está vacía o baja, rellenar de inmediato
  if (queue.length === 0) {
    replenishPlaybackQueue(50);
    queue = db.getQueue();
  }

  if (queue.length > 0) {
    const nextSong = queue.shift();
    db.setQueue(queue);
    currentlyPlaying = {
      ...nextSong,
      startedAt: Date.now()
    };
    db.setCurrentlyPlaying(currentlyPlaying);
    // Mantener siempre 50 temas en la cola visible de fondo
    replenishPlaybackQueue(50);
  } else {
    currentlyPlaying = null;
    db.setCurrentlyPlaying(null);
  }

  // Notificar a todos los clientes conectados
  roomIo.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });

  return currentlyPlaying;
}

// Inicializar la primera canción si no hay nada sonando
function ensurePlaying() {
  if (!currentlyPlaying) {
    currentlyPlaying = db.getCurrentlyPlaying();
  }
  replenishPlaybackQueue(50);
  if (!currentlyPlaying) {
    advanceToNextSong();
  }
}

// ==========================================
// RUTAS DE LA API
// ==========================================

// Estado general del sistema
router.get('/api/status', (req, res) => {
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
router.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });

  const results = await youtube.search(query, 8);
  res.json({ results });
});

// Pedir canción (Cliente desde la mesa)
router.post('/api/request', async (req, res) => {
  try {
    const { videoId, title, artist, duration, thumbnail, table, customerName, dedication, photo } = req.body;
    const tableClean = table ? String(table).trim() : 'Mesa';
    const isDJOrAdmin = req.body.isAdmin === true || ['dj', 'admin', 'bar', 'caja'].includes(tableClean.toLowerCase());
    const currentSettings = db.getSettings();

    if (!videoId || !title) {
      return res.status(400).json({ error: 'Faltan datos de la canción' });
    }

    // Las restricciones de límites, cooldown, lista negra y modo cerrado aplican SOLO a clientes QR
    if (!isDJOrAdmin) {
      // 1. Validar reglas de la mesa (anti-spam / límites / baneos)
      const check = db.canTableRequest(tableClean);
      if (!check.allowed) {
        return res.status(429).json({ error: check.reason });
      }

      // 2. Filtro Anti-Trolls, Lista Negra y Verificación de Solo Canciones Reales
      const blSong = db.isBlacklisted(title, artist);
      const blDed = dedication ? db.isBlacklisted(dedication, '') : { blacklisted: false };
      if (blSong.blacklisted || blDed.blacklisted) {
        return res.status(400).json({
          error: 'Esta canción o mensaje contiene términos o audios no permitidos en el bar.'
        });
      }

      const realSongCheck = youtube.validateIsRealSong({ title, artist, duration });
      if (!realSongCheck.valid) {
        return res.status(400).json({
          error: realSongCheck.reason
        });
      }

      // 3. Validar modo de solicitud (abierto vs. solo listas)
      if (currentSettings.requestMode === 'playlist') {
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
    }

    // 4. Clasificar género con el DJ Inteligente
    const genre = await aiDj.classifyGenre(title, artist);

    // Validar foto opcional si la función está desbloqueada en Configuración (o si es el DJ)
    const canAttachPhoto = currentSettings.allowClientPhotoDedication === true || isDJOrAdmin;
    const validPhoto = (canAttachPhoto && typeof photo === 'string' && photo.startsWith('data:image/') && photo.length < 3500000)
      ? photo
      : null;

    const song = {
      id: `${isDJOrAdmin ? 'admin' : 'req'}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      videoId,
      title,
      artist: artist || 'Artista',
      genre,
      duration: duration || '3:30',
      thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      requestedBy: {
        table: isDJOrAdmin ? 'DJ' : tableClean,
        name: isDJOrAdmin ? 'DJ / Bar' : (customerName ? customerName.trim() : `Mesa ${tableClean}`),
        dedication: (dedication || '').trim().slice(0, 120),
        ...(validPhoto ? { photo: validPhoto } : {})
      },
      isBaseTrack: false,
      addedAt: Date.now()
    };

    const currentQueue = db.getQueue();

    // 5. Si no hay absolutamente nada sonando, reproducir de inmediato
    if (!currentlyPlaying) {
      currentlyPlaying = { ...song, startedAt: Date.now() };
      if (!isDJOrAdmin) db.recordTableRequest(tableClean);
      roomIo.emit('state-changed', {
        currentlyPlaying,
        queue: db.getQueue(),
        settings: db.getSettings()
      });
      roomIo.emit('new-request-alert', {
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

    // 6. Si ya hay una canción sonando (de fondo o de otro cliente),
    // la canción actual sigue sonando sin cortarse y la nueva entra a la cola
    let slotIndex = 0;
    const existingClientRequests = currentQueue.filter(s => s.isBaseTrack !== true);

    if (existingClientRequests.length > 0) {
      // Si ya hay pedidos de clientes en cola, colocarlo después de los pedidos previos
      slotIndex = existingClientRequests.length;
    } else {
      // Si solo hay canciones base de fondo, colocar el pedido del cliente en el turno 1 (sonar a continuación)
      slotIndex = Math.min(1, currentQueue.length);
    }

    if (currentSettings.autoDJEnabled && existingClientRequests.length > 1) {
      slotIndex = aiDj.calculateSmartSlot(currentQueue.slice(0, Math.min(10, currentQueue.length)), genre, currentlyPlaying);
    }

    db.insertInQueueAt(slotIndex, song);

    // Registrar pedido de la mesa (solo para mesas de clientes, el DJ nunca acumula esperas)
    if (!isDJOrAdmin) {
      db.recordTableRequest(tableClean);
    }

    // Calcular posición aproximada para el usuario (1-indexed)
    const displayPosition = slotIndex + 1;

    // Avisar en tiempo real a la pantalla del bar y a los demás usuarios
    roomIo.emit('state-changed', {
      currentlyPlaying,
      queue: db.getQueue(),
      settings: currentSettings
    });

    roomIo.emit('new-request-alert', {
      song,
      position: displayPosition
    });

    const isNext = displayPosition === 1;
    const msg = isNext
      ? '¡Canción agregada! Sonará justo al terminar la canción actual.'
      : `¡Canción agregada con éxito! Está en el turno #${displayPosition} dentro de la tanda de ${genre}.`;

    res.json({
      ok: true,
      success: true,
      message: msg,
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
router.get('/api/playlists', (req, res) => {
  res.json({ playlists: db.getPlaylists() });
});

// Guardar / Crear lista
router.post('/api/playlists', (req, res) => {
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
router.post('/api/playlists/restore', (req, res) => {
  const { playlists } = req.body;
  if (!Array.isArray(playlists)) return res.status(400).json({ error: 'Formato no válido' });
  const updated = db.restorePlaylists(playlists);
  res.json({ success: true, total: updated.length, playlists: updated });
});

// Importar lista completa pegando enlace de YouTube
router.post('/api/playlists/import-youtube', async (req, res) => {
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
router.post('/api/playlists/import-multiple', async (req, res) => {
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
router.get('/api/playlists/search-youtube', async (req, res) => {
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
router.post('/api/playlists/:id/activate', (req, res) => {
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
    basePlaybackMode: 'single',
    scheduleEnabled: false,
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

  // 3. Regenerar de inmediato la cola unificada visible de 50 temas con la nueva lista
  regenerateBaseTracksInQueue(50);

  // Si actualmente no hay nada sonando o suena tema base de fondo, empezar a sonar la nueva lista de inmediato
  if (!currentlyPlaying || currentlyPlaying.isBaseTrack) {
    advanceToNextSong();
  } else {
    roomIo.emit('state-changed', {
      currentlyPlaying,
      queue: db.getQueue(),
      settings: db.getSettings()
    });
  }

  res.json({ success: true, activePlaylist: playlist });
});

// Actualizar información o temas de una lista
router.put('/api/playlists/:id', (req, res) => {
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
router.delete('/api/playlists/:id', (req, res) => {
  const playlist = db.getPlaylist(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Lista no encontrada' });

  db.deletePlaylist(req.params.id);
  res.json({ success: true });
});

// Agregar canción a una lista existente
router.post('/api/playlists/:id/tracks', (req, res) => {
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
router.delete('/api/playlists/:id/tracks/:index', (req, res) => {
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
router.put('/api/playlists/:id/tracks/:index/genre', (req, res) => {
  const { genre } = req.body;
  const index = parseInt(req.params.index, 10);
  const updated = db.updateTrackGenre(req.params.id, index, genre);
  if (!updated) return res.status(404).json({ error: 'No se pudo actualizar el género' });
  res.json({ success: true, track: updated });
});

// Auto-clasificar géneros de todas las canciones de una lista específica
router.post('/api/playlists/:id/auto-classify', (req, res) => {
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
router.post('/api/playlists/auto-classify-all', (req, res) => {
  const updatedCount = db.autoClassifyAllTracks();
  res.json({ success: true, updatedCount, playlists: db.getPlaylists() });
});

// Generar lista con IA (Gemini con fallback automático inteligente de YouTube)
router.post('/api/playlists/ai-generate', async (req, res) => {
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
router.post('/api/admin/skip', (req, res) => {
  const next = advanceToNextSong();
  res.json({ success: true, currentlyPlaying: next });
});

router.post('/api/admin/remove-queued', (req, res) => {
  const { songId } = req.body;
  db.removeFromQueue(songId);
  roomIo.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });
  res.json({ success: true });
});

router.post('/api/admin/reorder', (req, res) => {
  const { queue } = req.body;
  if (Array.isArray(queue)) {
    db.setQueue(queue);
    roomIo.emit('state-changed', {
      currentlyPlaying,
      queue: db.getQueue(),
      settings: db.getSettings()
    });
  }
  res.json({ success: true });
});

// Agregar canción a la cola de reproducción como DJ / Bar (Sin límites ni restricciones)
router.post('/api/admin/add-queue', async (req, res) => {
  try {
    const { videoId, title, artist, duration, thumbnail, genre: customGenre } = req.body;
    if (!videoId || !title) {
      return res.status(400).json({ error: 'Faltan datos de la canción' });
    }

    const genre = customGenre || await aiDj.classifyGenre(title, artist);

    const song = {
      id: `admin_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      videoId,
      title,
      artist: artist || 'Artista',
      genre,
      duration: duration || '3:30',
      thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      requestedBy: {
        table: 'DJ',
        name: 'DJ / Bar',
        dedication: ''
      },
      isBaseTrack: false,
      addedAt: Date.now()
    };

    const currentQueue = db.getQueue();
    const settings = db.getSettings();

    if (!currentlyPlaying) {
      currentlyPlaying = { ...song, startedAt: Date.now() };
    } else {
      let slotIndex = currentQueue.length;
      if (settings.autoDJEnabled) {
        slotIndex = aiDj.calculateSmartSlot(currentQueue, genre, currentlyPlaying);
        db.insertInQueueAt(slotIndex, song);
      } else {
        db.addToQueue(song);
      }
    }

    roomIo.emit('state-changed', {
      currentlyPlaying,
      queue: db.getQueue(),
      settings: db.getSettings()
    });

    roomIo.emit('new-request-alert', {
      song,
      position: db.getQueue().length
    });

    res.json({
      success: true,
      message: 'Canción agregada a la cola por el DJ (sin límites)',
      song
    });
  } catch (err) {
    console.error('Error al agregar tema desde admin:', err);
    res.status(500).json({ error: 'Error al agregar canción' });
  }
});

// Asignar Prioridad VIP a una canción (subir directamente a turno #1 para sonar a continuación)
router.post('/api/admin/queue/priority', (req, res) => {
  const { songId } = req.body;
  const queue = db.getQueue();
  const idx = queue.findIndex(s => s.id === songId);
  if (idx > -1) {
    const [song] = queue.splice(idx, 1);
    queue.unshift(song);
    db.setQueue(queue);
    roomIo.emit('state-changed', {
      currentlyPlaying,
      queue: db.getQueue(),
      settings: db.getSettings()
    });
    return res.json({ success: true, message: 'Prioridad VIP asignada: Sonará a continuación' });
  }
  res.status(404).json({ error: 'Canción no encontrada en la cola' });
});

// Regenerar la mezcla de 50 temas base a solicitud del DJ
router.post('/api/admin/queue/refresh', (req, res) => {
  regenerateBaseTracksInQueue(50);
  res.json({ success: true, queue: db.getQueue() });
});

// Vaciar la lista de espera a solicitud del DJ (elimina turnos/pedidos acumulados y refresca base)
router.post('/api/admin/queue/clear', (req, res) => {
  db.setQueue([]);
  replenishPlaybackQueue(50);
  roomIo.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });
  res.json({ success: true, message: 'Lista de espera despejada', queue: db.getQueue() });
});

router.post('/api/admin/play-now', async (req, res) => {
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

  roomIo.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });

  res.json({ success: true, currentlyPlaying });
});

// Modo Micrófono / Anuncio (baja volumen suavemente en la TV)
router.post('/api/admin/mic-mode', (req, res) => {
  micModeActive = !micModeActive;
  roomIo.emit('mic-mode', { active: micModeActive });
  res.json({ success: true, micModeActive });
});

// Baneo y desbaneo de mesas problemáticas
router.post('/api/admin/ban-table', (req, res) => {
  const { table, minutes } = req.body;
  db.banTable(table, minutes || 30);
  const banned = db.getBannedTables();
  roomIo.emit('banned-tables-updated', banned);
  res.json({ success: true, bannedTables: banned });
});

router.post('/api/admin/unban-table', (req, res) => {
  const { table } = req.body;
  db.unbanTable(table);
  const banned = db.getBannedTables();
  roomIo.emit('banned-tables-updated', banned);
  res.json({ success: true, bannedTables: banned });
});

router.get('/api/admin/banned-tables', (req, res) => {
  res.json({ bannedTables: db.getBannedTables() });
});

// Códigos QR
router.get('/api/qrs', async (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}${routePrefix}`;
  const settings = db.getSettings();
  const qrs = await qrService.generateBatch(baseUrl, settings.totalTables || 20);
  res.json({ baseUrl, qrs });
});

// Ajustes del bar
router.get('/api/settings', (req, res) => {
  res.json({ settings: db.getSettings() });
});

router.post('/api/settings', (req, res) => {
  const updated = db.updateSettings(req.body);
  // Regenerar la cola visible de 50 temas si cambiaron modos de reproducción, listas o porcentajes
  if (req.body.basePlaybackMode !== undefined || req.body.focusGenre !== undefined || req.body.crossoverPlaylists !== undefined || req.body.crossoverBatchSize !== undefined || req.body.crossoverDistributionType !== undefined || req.body.crossoverPercentages !== undefined || req.body.activePlaylistId !== undefined) {
    regenerateBaseTracksInQueue(50);
  } else {
    roomIo.emit('state-changed', {
      currentlyPlaying,
      queue: db.getQueue(),
      settings: updated
    });
  }
  res.json({ success: true, settings: updated });
});

// Historial y tendencias
router.get('/api/history', (req, res) => {
  res.json({ history: db.getHistory() });
});

router.get('/api/trends', (req, res) => {
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

// Reordenar canciones en la cola (subir o bajar prioridad con flechas ▲ ▼)
router.post('/api/queue/reorder', (req, res) => {
  const { index, direction } = req.body;
  const queue = [...db.getQueue()];
  const idx = parseInt(index, 10);

  if (isNaN(idx) || idx < 0 || idx >= queue.length) {
    return res.status(400).json({ error: 'Índice no válido' });
  }

  if (direction === 'up' && idx > 0) {
    const temp = queue[idx];
    queue[idx] = queue[idx - 1];
    queue[idx - 1] = temp;
  } else if (direction === 'down' && idx < queue.length - 1) {
    const temp = queue[idx];
    queue[idx] = queue[idx + 1];
    queue[idx + 1] = temp;
  } else {
    return res.json({ success: true, queue });
  }

  db.setQueue(queue);
  roomIo.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });

  res.json({ success: true, queue });
});

// Eliminar canción específica de la cola
router.delete('/api/queue/:index', (req, res) => {
  const queue = [...db.getQueue()];
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= queue.length) {
    return res.status(400).json({ error: 'Índice no válido' });
  }
  const removed = queue.splice(idx, 1);
  db.setQueue(queue);
  roomIo.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });
  res.json({ success: true, removed: removed[0], queue });
});

// ==========================================
// SOCKET.IO (Sincronización en tiempo real)
// ==========================================
let lastSongEndedTimestamp = 0;

function handleSocket(socket) {
  // Enviar estado actual al cliente recién conectado
  socket.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });

  // El reproductor de pantalla avisa que terminó una canción (con protección anti-rebote)
  socket.on('song-ended', () => {
    const now = Date.now();
    if (now - lastSongEndedTimestamp < 5000) {
      console.warn('[Server] Descartando song-ended duplicado (dentro de cooldown de 5s)');
      return;
    }
    lastSongEndedTimestamp = now;
    advanceToNextSong();
  });

  // El reproductor reporta cambios de estado
  socket.on('player-status', (data) => {
    roomIo.emit('player-broadcast', data);
  });

  // Comandos remotos desde la consola de DJ hacia la pantalla de TV
  socket.on('player-command', (data) => {
    roomIo.emit('player-control', data);
  });

  // Estado de pantalla completa del TV reportado a la consola DJ
  socket.on('player-fullscreen-status', (data) => {
    roomIo.emit('tv-fullscreen-status', data);
  });

  // Efecto Drag-to-Cast: Canción lanzada desde el celular / consola hacia el TV
  socket.on('cast-song-to-tv', (data) => {
    const { videoId, title, artist, genre, duration, thumbnail, requestedBy, queueIndex } = data || {};
    if (!videoId) return;

    // Si la canción estaba en la cola, removerla de la cola
    if (typeof queueIndex === 'number' && queueIndex >= 0) {
      const q = [...db.getQueue()];
      if (q[queueIndex] && q[queueIndex].videoId === videoId) {
        q.splice(queueIndex, 1);
        db.setQueue(q);
      }
    }

    if (currentlyPlaying) {
      db.addToHistory(currentlyPlaying);
    }

    currentlyPlaying = {
      id: `cast_${Date.now()}`,
      videoId,
      title: title || 'Canción',
      artist: artist || 'Artista',
      genre: genre || 'Crossover',
      duration: duration || '3:30',
      thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      requestedBy: requestedBy || { table: null, name: 'DJ / Celular' },
      isBaseTrack: false,
      startedAt: Date.now()
    };

    // 1. Emitir animación de impacto supersónico en la pantalla del TV
    roomIo.emit('tv-song-casted', {
      song: currentlyPlaying,
      senderName: requestedBy?.name || (requestedBy?.table ? `Mesa ${requestedBy.table}` : 'DJ / Celular')
    });

    // 2. Transmitir actualización de estado a todas las vistas
    roomIo.emit('state-changed', {
      currentlyPlaying,
      queue: db.getQueue(),
      settings: db.getSettings()
    });
  });

  // Progreso en tiempo real desde el reproductor TV hacia la consola DJ
  socket.on('player-progress', (data) => {
    roomIo.emit('player-telemetry', data);
  });

  // ==========================================================
  // RULETA 3D INTERACTIVA EN VIVO (DESDE CELULAR DJ HACIA TV)
  // ==========================================================
  socket.on('roulette-show', (data) => {
    roomIo.emit('tv-roulette-show', data);
  });

  socket.on('roulette-drag', (data) => {
    socket.to(roomName).emit('tv-roulette-drag', data);
  });

  socket.on('roulette-spin', (data) => {
    roomIo.emit('tv-roulette-spin', data);
  });

  socket.on('roulette-hide', () => {
    roomIo.emit('tv-roulette-hide');
  });

  // ==========================================================
  // SANTA CHELA CAM (FOTO / SELFIE VOLADORA DEL DJ AL TV)
  // ==========================================================
  socket.on('cast-photo-to-tv', (data) => {
    if (!data || !data.photo || typeof data.photo !== 'string') return;
    roomIo.emit('tv-photo-casted', {
      photo: data.photo,
      caption: (data.caption || '').trim().slice(0, 120),
      senderLabel: (data.senderLabel || '📸 SANTA CHELA CAM • EN VIVO').trim().slice(0, 80),
      durationMs: Number(data.durationMs) || 12000
    });
  });

  socket.on('hide-photo-from-tv', () => {
    roomIo.emit('tv-photo-hide');
  });
}

  return {
    instanceId,
    routePrefix,
    roomName,
    db,
    router,
    ensurePlaying,
    handleSocket
  };
}

// ==========================================
// 4 PROGRAMAS COMPLETAMENTE INDEPENDIENTES
// 1. default (Santa Chela Oficial): / , /admin.html , /player.html , /qrs.html
// 2. ambar (Ámbar):                 /ambar/ , /ambar/admin.html , /ambar/player.html , /ambar/qrs.html
// 3. bar3 (Programa 3):             /bar3/ , /bar3/admin.html , /bar3/player.html , /bar3/qrs.html
// 4. bar4 (Programa 4):             /bar4/ , /bar4/admin.html , /bar4/player.html , /bar4/qrs.html
// ==========================================
const programs = {
  default: createBarProgram('default', ''),
  ambar: createBarProgram('ambar', '/ambar'),
  bar3: createBarProgram('bar3', '/bar3'),
  bar4: createBarProgram('bar4', '/bar4')
};

// Montar API de Santa Chela (raíz original intacta)
app.use('/', programs.default.router);

// Función para servir páginas HTML aisladas para /ambar, /bar3 y /bar4
function renderIsolatedHtmlPage(filePath, instanceId, routePrefix) {
  let html = fs.readFileSync(filePath, 'utf8');

  const bootstrapScript = `
  <script>
    (function() {
      var INSTANCE = '${instanceId}';
      var PREFIX = '${routePrefix}';
      window.__BAR_INSTANCE__ = INSTANCE;
      window.__BAR_PREFIX__ = PREFIX;

      // 1. Aislar localStorage por programa para que no compartan ni mezclen datos en el navegador
      try {
        var origGetItem = Storage.prototype.getItem;
        var origSetItem = Storage.prototype.setItem;
        var origRemoveItem = Storage.prototype.removeItem;
        Storage.prototype.getItem = function(k) { return origGetItem.call(this, INSTANCE + '_' + k); };
        Storage.prototype.setItem = function(k, v) { return origSetItem.call(this, INSTANCE + '_' + k, v); };
        Storage.prototype.removeItem = function(k) { return origRemoveItem.call(this, INSTANCE + '_' + k); };
      } catch (e) {}

      // 2. Redirigir todas las llamadas fetch('/api/...') al backend exclusivo de este programa
      var origFetch = window.fetch;
      if (origFetch) {
        window.fetch = function(input, init) {
          if (typeof input === 'string' && input.indexOf('/api/') === 0) {
            input = PREFIX + input;
          }
          return origFetch.call(this, input, init);
        };
      }
    })();
  </script>`;

  const socketWrapScript = `<script src="/socket.io/socket.io.js"></script>
  <script>
    (function() {
      var origIo = window.io;
      if (origIo) {
        window.io = function(url, opts) {
          if (typeof url === 'object' || !url) {
            opts = Object.assign({}, url, { query: Object.assign({}, url && url.query, { instance: '${instanceId}' }) });
            return origIo(opts);
          }
          opts = Object.assign({}, opts, { query: Object.assign({}, opts && opts.query, { instance: '${instanceId}' }) });
          return origIo(url, opts);
        };
        Object.assign(window.io, origIo);
      }
    })();
  </script>`;

  html = html.replace('<head>', '<head>' + bootstrapScript);
  html = html.replace('<script src="/socket.io/socket.io.js"></script>', socketWrapScript);

  // Ajustar enlaces internos para que apunten siempre dentro de su propio programa (/ambar/..., /bar3/..., /bar4/...)
  html = html.replace(/href="\/player\.html"/g, 'href="' + routePrefix + '/player.html"');
  html = html.replace(/href="\/admin\.html"/g, 'href="' + routePrefix + '/admin.html"');
  html = html.replace(/href="\/qrs\.html"/g, 'href="' + routePrefix + '/qrs.html"');
  html = html.replace(/href="\/manifest\.json"/g, 'href="' + routePrefix + '/manifest.json"');
  html = html.replace(/window\.location\.replace\('\/admin\.html'\)/g, "window.location.replace('" + routePrefix + "/admin.html')");
  html = html.replace(/window\.location\.href = '\/admin\.html'/g, "window.location.href = '" + routePrefix + "/admin.html'");
  html = html.replace(/window\.location\.href = '\/'/g, "window.location.href = '" + routePrefix + "/'");

  return html;
}

['ambar', 'bar3', 'bar4'].forEach((instId) => {
  const prefix = '/' + instId;
  const prog = programs[instId];

  // Montar API independiente (/ambar/api/..., /bar3/api/..., /bar4/api/...)
  app.use(prefix, prog.router);

  // Manifest PWA independiente para poder instalar la App de cada bar por separado
  app.get(prefix + '/manifest.json', (req, res) => {
    const barName = prog.db.getSettings()?.barName || instId.toUpperCase();
    res.json({
      id: prefix + '/admin.html',
      name: barName + ' | Consola DJ',
      short_name: barName,
      description: 'Consola DJ y Control Musical Independiente • ' + barName,
      start_url: prefix + '/admin.html',
      scope: prefix + '/',
      display: 'standalone',
      display_override: ['standalone', 'fullscreen'],
      background_color: '#0c0e12',
      theme_color: '#0c0e12',
      orientation: 'portrait',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    });
  });

  // Protección móvil para la pantalla TV del programa independiente
  app.get([prefix + '/player.html', prefix + '/tv', prefix + '/player'], (req, res) => {
    if (req.query.force !== '1' && req.query.preview !== '1') {
      const ua = req.headers['user-agent'] || '';
      const isTV = /SmartTV|Tizen|Web0S|BRAVIA|NetCast|Android TV|GoogleTV|AFT[A-Z]|CrKey|AppleTV|Roku|HbbTV|Xbox|PlayStation/i.test(ua);
      const isMobileUA = !isTV && (/iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua)));
      if (isMobileUA) {
        return res.redirect(prefix + '/admin.html');
      }
    }
    res.type('html').send(renderIsolatedHtmlPage(path.join(__dirname, 'public', 'player.html'), instId, prefix));
  });

  // Consola DJ del programa independiente
  app.get([prefix + '/admin.html', prefix + '/dj', prefix + '/admin'], (req, res) => {
    res.type('html').send(renderIsolatedHtmlPage(path.join(__dirname, 'public', 'admin.html'), instId, prefix));
  });

  // Códigos QR para Mesas del programa independiente
  app.get(prefix + '/qrs.html', (req, res) => {
    res.type('html').send(renderIsolatedHtmlPage(path.join(__dirname, 'public', 'qrs.html'), instId, prefix));
  });

  // Vista Cliente (Mesas) del programa independiente
  app.get([prefix, prefix + '/', prefix + '/index.html'], (req, res) => {
    if (req.path === prefix) {
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return res.redirect(prefix + '/' + qs);
    }
    res.type('html').send(renderIsolatedHtmlPage(path.join(__dirname, 'public', 'index.html'), instId, prefix));
  });
});

// Enrutador central de Socket.io: conecta cada cliente exclusivamente a la sala de su programa
io.on('connection', (socket) => {
  let instId = String(socket.handshake.query?.instance || '').toLowerCase().trim();
  if (!instId || !programs[instId]) {
    const ref = socket.handshake.headers?.referer || '';
    if (ref.includes('/ambar/') || ref.endsWith('/ambar')) instId = 'ambar';
    else if (ref.includes('/bar3/') || ref.endsWith('/bar3')) instId = 'bar3';
    else if (ref.includes('/bar4/') || ref.endsWith('/bar4')) instId = 'bar4';
    else instId = 'default';
  }
  const targetProgram = programs[instId] || programs.default;
  socket.join(targetProgram.roomName);
  targetProgram.handleSocket(socket);
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎵 Asistente Music Bar - 4 Programas Independientes`);
  console.log(`======================================================`);
  console.log(`🍺 1. Santa Chela:  http://localhost:${PORT}/admin.html`);
  console.log(`🍸 2. Ámbar:        http://localhost:${PORT}/ambar/admin.html`);
  console.log(`🎶 3. Bar 3:        http://localhost:${PORT}/bar3/admin.html`);
  console.log(`🎶 4. Bar 4:        http://localhost:${PORT}/bar4/admin.html`);
  console.log(`======================================================\n`);
  Object.values(programs).forEach(p => p.ensurePlaying());
});
