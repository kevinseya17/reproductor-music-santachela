const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'music_bar_data.json');

// Listas iniciales de alta calidad con éxitos garantizados
const DEFAULT_PLAYLISTS = [
  {
    id: 'rumba-cantina',
    name: '🔥 Viernes de Rumba y Cantina',
    description: 'Mezcla equilibrada de Salsa brava, Música Popular de despecho y Vallenato.',
    tracks: [
      { videoId: '7KxkMLAZlzw', title: 'Cali Pachanguero', artist: 'Grupo Niche', genre: 'Salsa', duration: '5:10', thumbnail: 'https://i.ytimg.com/vi/7KxkMLAZlzw/hqdefault.jpg' },
      { videoId: 'JLwmBfrbYR4', title: 'Sobredosis', artist: 'Los Titanes', genre: 'Salsa', duration: '3:12', thumbnail: 'https://i.ytimg.com/vi/JLwmBfrbYR4/hqdefault.jpg' },
      { videoId: 'oWBf9hfW_4Y', title: 'Rebelión', artist: 'Joe Arroyo', genre: 'Salsa', duration: '4:45', thumbnail: 'https://i.ytimg.com/vi/oWBf9hfW_4Y/hqdefault.jpg' },
      { videoId: 'YIo5Rq8ptFU', title: 'Nadie Es Eterno', artist: 'Darío Gómez', genre: 'Popular', duration: '3:50', thumbnail: 'https://i.ytimg.com/vi/YIo5Rq8ptFU/hqdefault.jpg' },
      { videoId: 'l2ABZsKHl2Y', title: 'Guaro (Remix)', artist: 'Pipe Bueno, Carin León, Alzate, Jessi Uribe', genre: 'Popular', duration: '5:20', thumbnail: 'https://i.ytimg.com/vi/l2ABZsKHl2Y/hqdefault.jpg' },
      { videoId: '29RynFdnJ8w', title: 'El Precio de tu Error', artist: 'Luis Alfonso / Posada', genre: 'Popular', duration: '3:30', thumbnail: 'https://i.ytimg.com/vi/29RynFdnJ8w/hqdefault.jpg' },
      { videoId: 'EtZ4LRr9mQ8', title: 'La Plata', artist: 'Diomedes Díaz', genre: 'Vallenato', duration: '4:20', thumbnail: 'https://i.ytimg.com/vi/EtZ4LRr9mQ8/hqdefault.jpg' },
      { videoId: 'ZqQCEYKW2f8', title: 'Obsesión', artist: 'Peter Manjarrés', genre: 'Vallenato', duration: '4:15', thumbnail: 'https://i.ytimg.com/vi/ZqQCEYKW2f8/hqdefault.jpg' }
    ]
  },
  {
    id: 'salsa-pesada',
    name: '🎺 Salsa Brava y Clásica',
    description: '100% Salsa para salsómanos y bailadores.',
    tracks: [
      { videoId: 'gxlB1B9emDc', title: 'Llorarás', artist: 'Oscar D\'León', genre: 'Salsa', duration: '3:50', thumbnail: 'https://i.ytimg.com/vi/gxlB1B9emDc/hqdefault.jpg' },
      { videoId: 'fIPOjkmMpKk', title: 'El Día de Mi Suerte', artist: 'Héctor Lavoe & Willie Colón', genre: 'Salsa', duration: '5:28', thumbnail: 'https://i.ytimg.com/vi/fIPOjkmMpKk/hqdefault.jpg' },
      { videoId: '7KxkMLAZlzw', title: 'Cali Pachanguero', artist: 'Grupo Niche', genre: 'Salsa', duration: '5:10', thumbnail: 'https://i.ytimg.com/vi/7KxkMLAZlzw/hqdefault.jpg' },
      { videoId: 'JLwmBfrbYR4', title: 'Sobredosis', artist: 'Los Titanes', genre: 'Salsa', duration: '3:12', thumbnail: 'https://i.ytimg.com/vi/JLwmBfrbYR4/hqdefault.jpg' }
    ]
  },
  {
    id: 'despecho-cantina',
    name: '🥃 Cantina y Despecho Puro',
    description: 'Música popular, ranchera y norteña para el trago y el sentimiento.',
    tracks: [
      { videoId: 'YIo5Rq8ptFU', title: 'Nadie Es Eterno', artist: 'Darío Gómez', genre: 'Popular', duration: '3:50', thumbnail: 'https://i.ytimg.com/vi/YIo5Rq8ptFU/hqdefault.jpg' },
      { videoId: 'l2ABZsKHl2Y', title: 'Guaro (Remix)', artist: 'Pipe Bueno, Carin León, Jessi Uribe', genre: 'Popular', duration: '5:20', thumbnail: 'https://i.ytimg.com/vi/l2ABZsKHl2Y/hqdefault.jpg' },
      { videoId: '29RynFdnJ8w', title: 'El Precio de tu Error', artist: 'Luis Alfonso', genre: 'Popular', duration: '3:30', thumbnail: 'https://i.ytimg.com/vi/29RynFdnJ8w/hqdefault.jpg' }
    ]
  }
];

const DEFAULT_SETTINGS = {
  barName: 'Santa Chela Music Bar',
  maxRequestsPerTable: 2,
  cooldownMinutes: 10,
  autoDJEnabled: true,
  smartSlottingWindow: 3, // Máximo número de canciones de espera antes de insertar
  activePlaylistId: 'rumba-cantina',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  totalTables: 20,
  blacklistWords: ['gemido', 'gemidos', 'broma', 'audio viral', 'chistoso', 'meme', 'bebe juan', 'la vaca lola', 'cocomelon', 'cancion infantil'],
  promos: [
    '🍻 ¡Pregunta por nuestras promociones de cerveza en la barra!',
    '🍔 Prueba nuestras picadas y alitas Santa Chela',
    '🥃 Pide tu botella favorita para compartir con tu parche'
  ],
  schedule: [
    { start: '17:00', end: '20:30', playlistId: 'rumba-cantina', name: 'Tardeo y Buena Vibra' },
    { start: '20:30', end: '23:30', playlistId: 'salsa-pesada', name: 'Previa y Salsa Brava' },
    { start: '23:30', end: '04:00', playlistId: 'despecho-cantina', name: 'Cantina y Despecho a Grito Herido' }
  ],
  scheduleEnabled: true
};

class Database {
  constructor() {
    this.data = {
      settings: { ...DEFAULT_SETTINGS },
      playlists: DEFAULT_PLAYLISTS,
      queue: [],
      history: [],
      tableRequests: {}, // mesa -> [timestamp]
      bannedTables: {}   // mesa -> timestampHastaDondeEstaBaneada
    };
    this.init();
  }

  init() {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = { ...this.data, ...parsed };
      } catch (err) {
        console.error('Error al leer base de datos, usando valores por defecto:', err);
      }
    } else {
      this.save();
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Error al guardar base de datos:', err);
    }
  }

  getSettings() {
    return this.data.settings;
  }

  updateSettings(newSettings) {
    this.data.settings = { ...this.data.settings, ...newSettings };
    this.save();
    return this.data.settings;
  }

  getPlaylists() {
    return this.data.playlists;
  }

  getPlaylist(id) {
    return this.data.playlists.find(p => p.id === id);
  }

  addPlaylist(playlist) {
    const existingIdx = this.data.playlists.findIndex(p => p.id === playlist.id);
    if (existingIdx !== -1) {
      this.data.playlists[existingIdx] = { ...this.data.playlists[existingIdx], ...playlist };
    } else {
      this.data.playlists.push(playlist);
    }
    this.save();
    return playlist;
  }

  restorePlaylists(playlistsList) {
    if (!Array.isArray(playlistsList)) return this.data.playlists;
    for (const pl of playlistsList) {
      if (pl && pl.id && pl.name) {
        const idx = this.data.playlists.findIndex(p => p.id === pl.id);
        if (idx !== -1) {
          this.data.playlists[idx] = { ...this.data.playlists[idx], ...pl };
        } else {
          this.data.playlists.push(pl);
        }
      }
    }
    this.save();
    return this.data.playlists;
  }

  updatePlaylist(id, updatedData) {
    const idx = this.data.playlists.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.data.playlists[idx] = { ...this.data.playlists[idx], ...updatedData };
      this.save();
      return this.data.playlists[idx];
    }
    return null;
  }

  deletePlaylist(id) {
    this.data.playlists = this.data.playlists.filter(p => p.id !== id);
    this.save();
  }

  getQueue() {
    return this.data.queue;
  }

  setQueue(newQueue) {
    this.data.queue = newQueue;
    this.save();
    return this.data.queue;
  }

  addToQueue(song) {
    this.data.queue.push(song);
    this.save();
    return this.data.queue;
  }

  insertInQueueAt(index, song) {
    this.data.queue.splice(index, 0, song);
    this.save();
    return this.data.queue;
  }

  removeFromQueue(songId) {
    this.data.queue = this.data.queue.filter(s => s.id !== songId);
    this.save();
    return this.data.queue;
  }

  getHistory(limit = 50) {
    return this.data.history.slice(-limit).reverse();
  }

  addToHistory(playedSong) {
    this.data.history.push({
      ...playedSong,
      playedAt: new Date().toISOString()
    });
    // Guardar los últimos 500 temas
    if (this.data.history.length > 500) {
      this.data.history.shift();
    }
    this.save();
  }

  isBlacklisted(title, artist) {
    const text = `${title || ''} ${artist || ''}`.toLowerCase();
    const blacklist = this.data.settings.blacklistWords || [];
    for (const word of blacklist) {
      if (text.includes(word.toLowerCase())) {
        return { blacklisted: true, word };
      }
    }
    return { blacklisted: false };
  }

  isTableBanned(tableNumber) {
    if (!tableNumber) return false;
    const bannedUntil = this.data.bannedTables?.[tableNumber];
    if (bannedUntil && bannedUntil > Date.now()) {
      return true;
    }
    return false;
  }

  banTable(tableNumber, minutes = 30) {
    if (!this.data.bannedTables) this.data.bannedTables = {};
    this.data.bannedTables[tableNumber] = Date.now() + (minutes * 60 * 1000);
    this.save();
    return this.data.bannedTables;
  }

  unbanTable(tableNumber) {
    if (this.data.bannedTables && this.data.bannedTables[tableNumber]) {
      delete this.data.bannedTables[tableNumber];
      this.save();
    }
    return this.data.bannedTables;
  }

  getBannedTables() {
    const now = Date.now();
    const active = {};
    for (const [table, until] of Object.entries(this.data.bannedTables || {})) {
      if (until > now) active[table] = Math.ceil((until - now) / 60000);
    }
    return active;
  }

  canTableRequest(tableNumber) {
    if (!tableNumber) return { allowed: true };

    // 1. Revisar si la mesa está baneada/pausada
    if (this.isTableBanned(tableNumber)) {
      return {
        allowed: false,
        reason: 'Esta mesa ha sido pausada temporalmente por el bar. Consulta con el personal.'
      };
    }
    
    const now = Date.now();
    const windowMs = (this.data.settings.cooldownMinutes || 10) * 60 * 1000;
    const max = this.data.settings.maxRequestsPerTable || 2;

    const timestamps = (this.data.tableRequests[tableNumber] || []).filter(
      t => now - t < windowMs
    );
    this.data.tableRequests[tableNumber] = timestamps;

    const activeInQueue = this.data.queue.filter(
      s => s.requestedBy && s.requestedBy.table === tableNumber
    ).length;

    if (activeInQueue >= max) {
      return {
        allowed: false,
        reason: `Tu mesa ya tiene ${activeInQueue} canción(es) en espera. ¡Pronto sonarán para dar turno a las demás mesas!`
      };
    }

    return { allowed: true };
  }

  recordTableRequest(tableNumber) {
    if (!tableNumber) return;
    if (!this.data.tableRequests[tableNumber]) {
      this.data.tableRequests[tableNumber] = [];
    }
    this.data.tableRequests[tableNumber].push(Date.now());
    this.save();
  }
}

module.exports = new Database();
