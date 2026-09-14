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
      { videoId: 'h8xU6_4d4o4', title: 'Cali Pachanguero', artist: 'Grupo Niche', genre: 'Salsa', duration: '5:10', thumbnail: 'https://i.ytimg.com/vi/h8xU6_4d4o4/hqdefault.jpg' },
      { videoId: 'Z9Y0w4aVbFk', title: 'Sobredosis', artist: 'Los Titanes', genre: 'Salsa', duration: '4:45', thumbnail: 'https://i.ytimg.com/vi/Z9Y0w4aVbFk/hqdefault.jpg' },
      { videoId: '7XqO7D4vJcQ', title: 'Rebelión', artist: 'Joe Arroyo', genre: 'Salsa', duration: '4:45', thumbnail: 'https://i.ytimg.com/vi/7XqO7D4vJcQ/hqdefault.jpg' },
      { videoId: 'hT_nvWreIhg', title: 'Nadie Es Eterno', artist: 'Darío Gómez', genre: 'Popular', duration: '3:50', thumbnail: 'https://i.ytimg.com/vi/hT_nvWreIhg/hqdefault.jpg' },
      { videoId: 'bEs_Vv9L0iE', title: 'Guaro (Remix)', artist: 'Pipe Bueno, Carin León, Alzate, Jessi Uribe', genre: 'Popular', duration: '5:20', thumbnail: 'https://i.ytimg.com/vi/bEs_Vv9L0iE/hqdefault.jpg' },
      { videoId: 'Cceg_rTqUq8', title: 'El Precio de tu Error', artist: 'Luis Alberto Posada', genre: 'Popular', duration: '3:30', thumbnail: 'https://i.ytimg.com/vi/Cceg_rTqUq8/hqdefault.jpg' },
      { videoId: 'xP8k0n09p8c', title: 'La Plata', artist: 'Diomedes Díaz', genre: 'Vallenato', duration: '4:20', thumbnail: 'https://i.ytimg.com/vi/xP8k0n09p8c/hqdefault.jpg' },
      { videoId: 'k4V3gjsz7i0', title: 'Obsesión', artist: 'Peter Manjarrés', genre: 'Vallenato', duration: '4:15', thumbnail: 'https://i.ytimg.com/vi/k4V3gjsz7i0/hqdefault.jpg' }
    ]
  },
  {
    id: 'salsa-pesada',
    name: '🎺 Salsa Brava y Clásica',
    description: '100% Salsa para salsómanos y bailadores.',
    tracks: [
      { videoId: '9bZkp7q19f0', title: 'Llorarás', artist: 'Oscar D\'León', genre: 'Salsa', duration: '3:50', thumbnail: 'https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg' },
      { videoId: 'fJ9rUzIMcZQ', title: 'El Día de Mi Suerte', artist: 'Héctor Lavoe & Willie Colón', genre: 'Salsa', duration: '4:30', thumbnail: 'https://i.ytimg.com/vi/fJ9rUzIMcZQ/hqdefault.jpg' },
      { videoId: '3JZ4pnNfyxQ', title: 'Idilio', artist: 'Willie Colón', genre: 'Salsa', duration: '5:05', thumbnail: 'https://i.ytimg.com/vi/3JZ4pnNfyxQ/hqdefault.jpg' },
      { videoId: 'kXYiU_JCYtU', title: 'Pedro Navaja', artist: 'Rubén Blades', genre: 'Salsa', duration: '7:20', thumbnail: 'https://i.ytimg.com/vi/kXYiU_JCYtU/hqdefault.jpg' }
    ]
  },
  {
    id: 'despecho-cantina',
    name: '🥃 Cantina y Despecho Puro',
    description: 'Música popular, ranchera y norteña para el trago y el sentimiento.',
    tracks: [
      { videoId: 'Cceg_rTqUq8', title: 'El Precio de tu Error', artist: 'Luis Alberto Posada', genre: 'Popular', duration: '3:30', thumbnail: 'https://i.ytimg.com/vi/Cceg_rTqUq8/hqdefault.jpg' },
      { videoId: 'hT_nvWreIhg', title: 'Nadie Es Eterno', artist: 'Darío Gómez', genre: 'Popular', duration: '3:50', thumbnail: 'https://i.ytimg.com/vi/hT_nvWreIhg/hqdefault.jpg' },
      { videoId: '3nQNiWdeH2Q', title: 'Dulce Pecado', artist: 'Jessi Uribe', genre: 'Popular', duration: '3:40', thumbnail: 'https://i.ytimg.com/vi/3nQNiWdeH2Q/hqdefault.jpg' },
      { videoId: 'd020hgfb_AQ', title: 'Maldita Traición', artist: 'Alzate', genre: 'Popular', duration: '4:10', thumbnail: 'https://i.ytimg.com/vi/d020hgfb_AQ/hqdefault.jpg' }
    ]
  }
];

const DEFAULT_SETTINGS = {
  barName: 'La Rockola Music Bar',
  maxRequestsPerTable: 2,
  cooldownMinutes: 10,
  autoDJEnabled: true,
  smartSlottingWindow: 3, // Máximo número de canciones de espera antes de insertar
  activePlaylistId: 'rumba-cantina',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  totalTables: 20
};

class Database {
  constructor() {
    this.data = {
      settings: { ...DEFAULT_SETTINGS },
      playlists: DEFAULT_PLAYLISTS,
      queue: [],
      history: [],
      tableRequests: {} // mesa -> [timestamp]
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
    this.data.playlists.push(playlist);
    this.save();
    return playlist;
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

  canTableRequest(tableNumber) {
    if (!tableNumber) return { allowed: true };
    
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
