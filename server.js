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

/**
 * Obtiene la siguiente canción de la lista base (El Norte)
 */
function getNextBaseSong() {
  const settings = db.getSettings();
  const playlist = db.getPlaylist(settings.activePlaylistId) || db.getPlaylists()[0];
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
    settings: db.getSettings()
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
    const { videoId, title, artist, duration, thumbnail, table, customerName } = req.body;
    const tableClean = table ? String(table).trim() : 'Mesa';

    if (!videoId || !title) {
      return res.status(400).json({ error: 'Faltan datos de la canción' });
    }

    // 1. Validar reglas de la mesa (anti-spam / límites)
    const check = db.canTableRequest(tableClean);
    if (!check.allowed) {
      return res.status(429).json({ error: check.reason });
    }

    // 2. Clasificar género con el DJ Inteligente
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
        name: customerName ? customerName.trim() : `Mesa ${tableClean}`
      },
      isBaseTrack: false,
      addedAt: Date.now()
    };

    const currentQueue = db.getQueue();
    const settings = db.getSettings();

    // 3. Si no hay nada sonando actualmente, reproducir de inmediato
    if (!currentlyPlaying) {
      currentlyPlaying = { ...song, startedAt: Date.now() };
      db.recordTableRequest(tableClean);
      io.emit('state-changed', {
        currentlyPlaying,
        queue: db.getQueue(),
        settings
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
  const { name, description, tracks } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  const newPlaylist = {
    id,
    name,
    description: description || '',
    tracks: tracks || []
  };

  db.addPlaylist(newPlaylist);
  res.json({ success: true, playlist: newPlaylist });
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

// Activar lista base activa
app.post('/api/playlists/:id/activate', (req, res) => {
  const playlist = db.getPlaylist(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Lista no encontrada' });

  db.updateSettings({ activePlaylistId: req.params.id });
  currentPlaylistIndex = 0;

  io.emit('state-changed', {
    currentlyPlaying,
    queue: db.getQueue(),
    settings: db.getSettings()
  });

  res.json({ success: true, activePlaylist: playlist });
});

// Generar lista con IA (Gemini)
app.post('/api/playlists/ai-generate', async (req, res) => {
  const { prompt } = req.body;
  const settings = db.getSettings();
  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({
      error: 'Se requiere configurar la clave de API de Gemini en Ajustes para generar listas con IA.'
    });
  }

  try {
    const generatedTracks = await aiDj.generatePlaylistWithAI(prompt, apiKey);
    
    // Buscar cada canción en YouTube para asociar su videoId y miniatura real
    const fullTracks = [];
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

    res.json({ success: true, tracks: fullTracks });
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
