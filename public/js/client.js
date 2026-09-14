// Conexión Socket.io
const socket = io();

// Estado local del cliente
let currentTable = '1';
let selectedSongForModal = null;
let searchDebounceTimer = null;

// Inicialización al cargar la página
document.addEventListener('DOMContentLoaded', () => {
  initTable();
  setupSearch();
  fetchInitialStatus();
  setupSocketListeners();
  renderPopularHits();
});

// 1. Detección y manejo de la Mesa
function initTable() {
  const urlParams = new URLSearchParams(window.location.search);
  const mesaParam = urlParams.get('mesa');

  if (mesaParam) {
    currentTable = mesaParam.trim();
    localStorage.setItem('music_bar_table', currentTable);
  } else {
    const saved = localStorage.getItem('music_bar_table');
    if (saved) {
      currentTable = saved;
    }
  }

  updateTableUI();
}

function updateTableUI() {
  const badge = document.getElementById('currentTableText');
  if (badge) {
    badge.textContent = `Mesa ${currentTable}`;
  }
}

function promptChangeTable() {
  const newTable = prompt('Ingresa el número de tu mesa:', currentTable);
  if (newTable && newTable.trim()) {
    currentTable = newTable.trim();
    localStorage.setItem('music_bar_table', currentTable);
    updateTableUI();
    showToast('Mesa cambiada', `Ahora estás ordenando para la Mesa ${currentTable}`, '📍');
  }
}

// 2. Cargar estado inicial
async function fetchInitialStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    renderStatus(data);
  } catch (err) {
    console.error('Error al obtener estado inicial:', err);
  }
}

// 3. Renderizar "Sonando Ahora" y la Cola
function renderStatus(data) {
  if (!data) return;

  const { currentlyPlaying, queue, settings } = data;

  if (settings && settings.barName) {
    const barTitle = document.getElementById('barName');
    if (barTitle) barTitle.textContent = settings.barName;
  }

  // Sonando Ahora
  if (currentlyPlaying) {
    document.getElementById('currentTitle').textContent = currentlyPlaying.title || 'Música del bar';
    document.getElementById('currentArtist').textContent = currentlyPlaying.artist || '';
    document.getElementById('currentThumb').src = currentlyPlaying.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150';
    
    const genreBadge = document.getElementById('currentGenreBadge');
    genreBadge.textContent = currentlyPlaying.genre || 'Música';
    genreBadge.className = `genre-badge genre-${currentlyPlaying.genre || 'Crossover'}`;

    const requestedByEl = document.getElementById('currentRequestedBy');
    if (currentlyPlaying.requestedBy && currentlyPlaying.requestedBy.name) {
      requestedByEl.textContent = `✨ Pedida por: ${currentlyPlaying.requestedBy.name}`;
    } else {
      requestedByEl.textContent = `✨ Lista del bar`;
    }
  }

  // Lista en cola
  renderQueue(queue || []);
}

function renderQueue(queue) {
  const listEl = document.getElementById('upcomingList');
  const countEl = document.getElementById('queueBadgeCount');
  countEl.textContent = queue.length;

  if (!queue || queue.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-gray-500 text-center py-3">No hay pedidos pendientes. ¡Sé el primero en pedir una canción!</p>`;
    return;
  }

  listEl.innerHTML = queue.slice(0, 5).map((song, index) => {
    const isMyTable = song.requestedBy && song.requestedBy.table === currentTable;
    return `
      <div class="flex items-center gap-3 p-2 rounded-xl ${isMyTable ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-white/5'}">
        <span class="text-xs font-bold text-gray-400 w-4 text-center">#${index + 1}</span>
        <img src="${song.thumbnail}" class="w-10 h-10 rounded-lg object-cover">
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold text-white truncate">${escapeHtml(song.title)}</p>
          <p class="text-[11px] text-gray-400 truncate">${escapeHtml(song.artist)}</p>
        </div>
        <div class="text-right">
          <span class="genre-badge genre-${song.genre || 'Crossover'} text-[10px] py-0.5 px-2">${song.genre || 'Música'}</span>
          ${isMyTable ? '<p class="text-[10px] text-amber-400 font-bold mt-0.5">¡Tu pedido!</p>' : ''}
        </div>
      </div>
    `;
  }).join('');

  if (queue.length > 5) {
    listEl.innerHTML += `<p class="text-[11px] text-gray-500 text-center pt-1">+${queue.length - 5} canciones más organizadas en bloques</p>`;
  }
}

// 4. Búsqueda en YouTube con Debounce
function setupSearch() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (query.length > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
      hideSearchResults();
      return;
    }

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      performSearch(query);
    }, 400);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.add('hidden');
    hideSearchResults();
  });
}

function quickSearch(genreText) {
  const input = document.getElementById('searchInput');
  input.value = genreText;
  document.getElementById('clearSearchBtn').classList.remove('hidden');
  performSearch(genreText);
}

const POPULAR_HITS = [
  { videoId: 'ROgcM9-N9jM', title: 'SE ME OLVIDA', artist: 'Feid & Maisak', genre: 'Reggaetón', duration: '3:45', thumbnail: 'https://i.ytimg.com/vi/ROgcM9-N9jM/hqdefault.jpg' },
  { videoId: '7KxkMLAZlzw', title: 'Cali Pachanguero', artist: 'Grupo Niche', genre: 'Salsa', duration: '5:10', thumbnail: 'https://i.ytimg.com/vi/7KxkMLAZlzw/hqdefault.jpg' },
  { videoId: 'YIo5Rq8ptFU', title: 'Nadie Es Eterno', artist: 'Darío Gómez', genre: 'Popular', duration: '3:50', thumbnail: 'https://i.ytimg.com/vi/YIo5Rq8ptFU/hqdefault.jpg' },
  { videoId: 'JLwmBfrbYR4', title: 'Sobredosis', artist: 'Los Titanes', genre: 'Salsa', duration: '3:12', thumbnail: 'https://i.ytimg.com/vi/JLwmBfrbYR4/hqdefault.jpg' },
  { videoId: 'EtZ4LRr9mQ8', title: 'La Plata', artist: 'Diomedes Díaz', genre: 'Vallenato', duration: '4:20', thumbnail: 'https://i.ytimg.com/vi/EtZ4LRr9mQ8/hqdefault.jpg' },
  { videoId: 'l2ABZsKHl2Y', title: 'Guaro (Remix)', artist: 'Pipe Bueno, Carin León', genre: 'Popular', duration: '5:20', thumbnail: 'https://i.ytimg.com/vi/l2ABZsKHl2Y/hqdefault.jpg' }
];

function renderPopularHits() {
  const container = document.getElementById('popularHitsList');
  if (!container) return;
  container.innerHTML = POPULAR_HITS.map((song, i) => `
    <div class="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5 hover:border-amber-500/30 transition">
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        <img src="${song.thumbnail}" class="w-11 h-9 rounded-lg object-cover">
        <div class="min-w-0 flex-1">
          <p class="font-bold text-white text-xs truncate">${song.title}</p>
          <p class="text-[10px] text-gray-400 truncate">${song.artist} • <span class="text-amber-400 font-semibold">${song.genre}</span></p>
        </div>
      </div>
      <button onclick="requestDirectHit(${i})" class="btn-primary text-xs py-1.5 px-3 whitespace-nowrap ml-2">
        Pedir 🎵
      </button>
    </div>
  `).join('');
}

function requestDirectHit(index) {
  const song = POPULAR_HITS[index];
  if (!song) return;

  selectedSongForModal = song;

  document.getElementById('modalThumb').src = song.thumbnail;
  document.getElementById('modalTitle').textContent = song.title;
  document.getElementById('modalArtist').textContent = song.artist;
  document.getElementById('modalTable').textContent = `Mesa ${currentTable}`;

  document.getElementById('confirmModal').classList.remove('hidden');
}

async function performSearch(query) {
  const resultsSection = document.getElementById('searchResultsSection');
  const suggestionsSection = document.getElementById('suggestionsSection');
  const resultsList = document.getElementById('searchResultsList');
  const resultsCount = document.getElementById('resultsCount');

  if (suggestionsSection) suggestionsSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  resultsList.innerHTML = `
    <div class="text-center py-6">
      <div class="inline-block w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
      <p class="text-xs text-gray-400 mt-2">Buscando canciones individuales en YouTube...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const videos = data.results || [];

    if (videos.length === 0) {
      resultsList.innerHTML = `<p class="text-xs text-gray-500 text-center py-4">No se encontraron canciones individuales. Intenta escribir el nombre del artista o canción.</p>`;
      resultsCount.textContent = '0 canciones';
      return;
    }

    resultsCount.textContent = `${videos.length} canciones encontradas`;

    resultsList.innerHTML = videos.map((v, i) => `
      <div class="glass-card p-2.5 flex items-center gap-3 hover:border-amber-500/40 transition">
        <div class="relative">
          <img src="${v.thumbnail}" class="w-16 h-12 rounded-lg object-cover">
          <span class="absolute bottom-1 right-1 bg-black/80 text-[10px] px-1 rounded text-white font-mono">${v.duration}</span>
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="text-xs font-bold text-white truncate leading-tight">${escapeHtml(v.title)}</h4>
          <p class="text-[11px] text-gray-400 truncate">${escapeHtml(v.artist)}</p>
          <span class="text-[10px] text-amber-400/80 font-medium">Canción individual</span>
        </div>
        <button onclick="openConfirmModal(${i})" class="btn-primary text-xs py-2 px-3 whitespace-nowrap">
          Pedir 🎵
        </button>
      </div>
    `).join('');

    // Guardar temporalmente en memoria los resultados para el modal
    window.currentSearchResults = videos;

  } catch (err) {
    console.error('Error buscando:', err);
    resultsList.innerHTML = `<p class="text-xs text-red-400 text-center py-4">Error al buscar. Verifica tu conexión.</p>`;
  }
}

function hideSearchResults() {
  document.getElementById('searchResultsSection').classList.add('hidden');
  const suggestionsSection = document.getElementById('suggestionsSection');
  if (suggestionsSection) suggestionsSection.classList.remove('hidden');
}

// 5. Modal de Confirmación
function openConfirmModal(index) {
  const song = window.currentSearchResults[index];
  if (!song) return;

  selectedSongForModal = song;

  document.getElementById('modalThumb').src = song.thumbnail;
  document.getElementById('modalTitle').textContent = song.title;
  document.getElementById('modalArtist').textContent = song.artist;
  document.getElementById('modalTable').textContent = `Mesa ${currentTable}`;

  document.getElementById('confirmModal').classList.remove('hidden');
}

function closeModal() {
  selectedSongForModal = null;
  document.getElementById('confirmModal').classList.add('hidden');
}

async function confirmAndSendRequest() {
  if (!selectedSongForModal) return;

  const btn = document.getElementById('sendRequestBtn');
  const customerName = document.getElementById('customerNameInput').value.trim();

  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: selectedSongForModal.videoId,
        title: selectedSongForModal.title,
        artist: selectedSongForModal.artist,
        duration: selectedSongForModal.duration,
        thumbnail: selectedSongForModal.thumbnail,
        table: currentTable,
        customerName: customerName || `Mesa ${currentTable}`
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast('No se pudo pedir', data.error || 'Intenta más tarde', '⚠️');
    } else {
      showToast('¡Canción Agregada!', data.message, '🎉');
      closeModal();
      document.getElementById('searchInput').value = '';
      document.getElementById('clearSearchBtn').classList.add('hidden');
      hideSearchResults();
      document.getElementById('customerNameInput').value = '';
    }
  } catch (err) {
    console.error('Error enviando pedido:', err);
    showToast('Error', 'No se pudo conectar con el servidor del bar', '❌');
  } finally {
    btn.disabled = false;
    btn.textContent = '¡Pedir Canción! 🎶';
  }
}

// 6. Socket.io en tiempo real
function setupSocketListeners() {
  socket.on('state-changed', (data) => {
    renderStatus(data);
  });

  socket.on('new-request-alert', (data) => {
    // Si la canción la pidió otra mesa, podemos mostrar un pequeño aviso sutil
    if (data.song && data.song.requestedBy && data.song.requestedBy.table !== currentTable) {
      // Opcional: mostrar notificación discreta
    }
  });
}

// 7. Utilitarios de UI
function showToast(title, message, icon = '🎉') {
  const toast = document.getElementById('toast');
  document.getElementById('toastIcon').textContent = icon;
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastMessage').textContent = message;

  toast.classList.remove('translate-y-24');
  setTimeout(() => {
    toast.classList.add('translate-y-24');
  }, 4500);
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
}
