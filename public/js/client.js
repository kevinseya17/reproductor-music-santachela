// Conexión Socket.io
const socket = io();

// Estado local del cliente
let currentTable = '1';
let selectedSongForModal = null;
let searchDebounceTimer = null;
let currentRequestMode = 'open';
let clientPlaylists = [];
let currentSelectedPlaylistId = null;
let currentPlaylistFilteredTracks = [];

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
  // Deshabilitado: La mesa queda fijada estrictamente por el código QR escaneado
  console.log('La mesa está bloqueada al código QR escaneado.');
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

  // Aplicar modo de pedidos (abierto vs solo listas) y opción desbloqueable de foto con mensaje
  if (settings) {
    const newMode = settings.requestMode || 'open';
    if (newMode !== currentRequestMode || !window.hasInitRequestMode) {
      window.hasInitRequestMode = true;
      applyRequestMode(newMode);
    }

    const photoSection = document.getElementById('clientPhotoDedicationContainer');
    window.allowClientPhotoDedication = settings.allowClientPhotoDedication === true;
    if (photoSection) {
      if (window.allowClientPhotoDedication) {
        photoSection.classList.remove('hidden');
      } else {
        photoSection.classList.add('hidden');
        if (typeof clearClientPhoto === 'function') clearClientPhoto();
      }
    }
  }

  // Sonando Ahora
  if (currentlyPlaying) {
    const thumbUrl = currentlyPlaying.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150';
    document.getElementById('currentTitle').textContent = currentlyPlaying.title || 'Música del bar';
    document.getElementById('currentArtist').textContent = currentlyPlaying.artist || '';
    document.getElementById('currentThumb').src = thumbUrl;
    const blurThumb = document.getElementById('currentThumbBlur');
    if (blurThumb) blurThumb.src = thumbUrl;
    
    const genreBadge = document.getElementById('currentGenreBadge');
    genreBadge.textContent = currentlyPlaying.genre || 'Música';
    genreBadge.className = `genre-badge genre-${currentlyPlaying.genre || 'Crossover'}`;

    const requestedByEl = document.getElementById('currentRequestedBy');
    if (currentlyPlaying.requestedBy && currentlyPlaying.requestedBy.name) {
      requestedByEl.textContent = `✨ Solicitud en vivo: ${currentlyPlaying.requestedBy.name}`;
    } else {
      requestedByEl.textContent = `✨ Mezcla Inteligente MOCD`;
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
    listEl.innerHTML = `
      <div class="text-center py-5 px-3 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
        <p class="text-xs text-gray-400 font-medium">No hay solicitudes en espera. ¡Sé el primero en programar tu canción en las pantallas!</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = queue.slice(0, 6).map((song, index) => {
    const isMyTable = song.requestedBy && song.requestedBy.table === currentTable;
    return `
      <div class="mocd-track-card flex items-center gap-3 p-2.5 sm:p-3 ${isMyTable ? '!border-cyan-400/60 !bg-gradient-to-r !from-cyan-500/15 !via-indigo-500/10 !to-purple-500/15 shadow-[0_0_20px_rgba(0,229,255,0.2)]' : ''}">
        <span class="w-6 h-6 rounded-lg bg-white/[0.06] border border-white/10 text-[11px] font-black text-cyan-300 flex items-center justify-center shrink-0">#${index + 1}</span>
        <img src="${song.thumbnail}" class="w-11 h-11 rounded-xl object-cover border border-white/15 shrink-0">
        <div class="flex-1 min-w-0">
          <p class="font-display text-xs sm:text-sm font-bold text-white truncate leading-tight">${escapeHtml(song.title)}</p>
          <p class="text-[11px] text-gray-300 truncate mt-0.5">${escapeHtml(song.artist)}</p>
        </div>
        <div class="text-right shrink-0 flex flex-col items-end gap-1">
          <span class="genre-badge genre-${song.genre || 'Crossover'} !text-[9px] !py-0.5 !px-2">${song.genre || 'Música'}</span>
          ${isMyTable ? '<span class="text-[9.5px] px-2 py-0.5 rounded-md bg-cyan-400/20 border border-cyan-400/40 text-cyan-300 font-extrabold tracking-wider uppercase">✨ Tu Mesa</span>' : ''}
        </div>
      </div>
    `;
  }).join('');

  if (queue.length > 6) {
    listEl.innerHTML += `<p class="text-[11px] text-cyan-300/80 font-semibold text-center pt-1">+${queue.length - 6} canciones más organizadas por bloques inteligentes</p>`;
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
    <div class="mocd-track-card flex items-center justify-between p-2.5 sm:p-3 gap-3">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="relative shrink-0">
          <img src="${song.thumbnail}" class="w-14 h-11 rounded-xl object-cover border border-white/15">
          <span class="absolute bottom-0.5 right-0.5 bg-black/85 text-[8.5px] px-1 rounded text-cyan-300 font-mono font-bold">${song.duration || '3:45'}</span>
        </div>
        <div class="min-w-0 flex-1">
          <p class="font-display font-bold text-white text-xs sm:text-sm truncate leading-tight">${song.title}</p>
          <p class="text-[11px] text-gray-300 truncate mt-0.5">${song.artist} <span class="text-purple-400">•</span> <span class="text-cyan-300 font-bold">${song.genre}</span></p>
        </div>
      </div>
      <button onclick="requestDirectHit(${i})" class="btn-neon-mocd text-xs py-2 px-3.5 rounded-xl whitespace-nowrap shrink-0">
        <span>Pedir</span>
        <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
        </svg>
      </button>
    </div>
  `).join('');
}

function requestDirectHit(index) {
  const song = POPULAR_HITS[index];
  if (!song) return;

  if (typeof window.waveEnergyBoost !== 'undefined') window.waveEnergyBoost = 1.65;
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

  if (typeof window.waveEnergyBoost !== 'undefined') window.waveEnergyBoost = 1.5;
  if (suggestionsSection) suggestionsSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  resultsList.innerHTML = `
    <div class="glass-card text-center py-8 px-4">
      <div class="inline-block w-7 h-7 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(0,229,255,0.4)]"></div>
      <p class="text-xs text-cyan-200 font-semibold mt-2.5">Motor IA buscando canciones verificadas...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const videos = data.results || [];

    if (videos.length === 0) {
      resultsList.innerHTML = `<p class="text-xs text-gray-400 text-center py-6 glass-card">No se encontraron canciones verificadas. Intenta con el nombre del tema o artista.</p>`;
      resultsCount.textContent = '0 resultados';
      return;
    }

    resultsCount.textContent = `${videos.length} temas`;

    resultsList.innerHTML = videos.map((v, i) => `
      <div class="mocd-track-card p-2.5 sm:p-3 flex items-center gap-3">
        <div class="relative shrink-0">
          <img src="${v.thumbnail}" class="w-16 h-12 rounded-xl object-cover border border-white/15">
          <span class="absolute bottom-1 right-1 bg-black/85 text-[9px] px-1.5 py-0.5 rounded text-cyan-300 font-mono font-bold">${v.duration}</span>
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="font-display text-xs sm:text-sm font-bold text-white truncate leading-tight">${escapeHtml(v.title)}</h4>
          <p class="text-[11px] text-gray-300 truncate mt-0.5">${escapeHtml(v.artist)}</p>
          <span class="inline-flex items-center gap-1 text-[9.5px] text-cyan-300 font-bold mt-0.5">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Pista Oficial Verificada
          </span>
        </div>
        <button onclick="openConfirmModal(${i})" class="btn-neon-mocd text-xs py-2 px-3.5 rounded-xl whitespace-nowrap shrink-0">
          <span>Pedir</span>
          <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
          </svg>
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

let currentClientPhotoDataUrl = null;

function drawClientSourceToJpegDataUrl(source, width, height, maxDim = 800, quality = 0.80) {
  let w = width || source.width || source.naturalWidth || 800;
  let h = height || source.height || source.naturalHeight || 800;
  if (w > h && w > maxDim) {
    h = Math.max(1, Math.round((h * maxDim) / w));
    w = maxDim;
  } else if (h >= w && h > maxDim) {
    w = Math.max(1, Math.round((w * maxDim) / h));
    h = maxDim;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

async function decodeClientPhotoFile(file, maxDim = 800, quality = 0.80) {
  // 1. Intento nativo acelerado por hardware (soporta fotos de Galería sin MIME, WhatsApp, Google Photos y orientación EXIF)
  if (typeof window.createImageBitmap === 'function') {
    try {
      const bitmap = await window.createImageBitmap(file);
      const dataUrl = drawClientSourceToJpegDataUrl(bitmap, bitmap.width, bitmap.height, maxDim, quality);
      if (typeof bitmap.close === 'function') bitmap.close();
      if (dataUrl && dataUrl.startsWith('data:image/')) return dataUrl;
    } catch (err) {
      console.warn('createImageBitmap fallback en cliente:', err);
    }
  }

  // 2. Intento con URL.createObjectURL (soporta fotos grandes de Galería 12MP/48MP/50MP sin agotar RAM)
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const blob = (!file.type || file.type === 'application/octet-stream')
        ? new Blob([file], { type: 'image/jpeg' })
        : file;
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const out = drawClientSourceToJpegDataUrl(img, img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim, quality);
          URL.revokeObjectURL(objectUrl);
          resolve(out);
        } catch (e) {
          URL.revokeObjectURL(objectUrl);
          reject(e);
        }
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(objectUrl);
        reject(e);
      };
      img.src = objectUrl;
    });
    if (dataUrl && dataUrl.startsWith('data:image/')) return dataUrl;
  } catch (err) {
    console.warn('ObjectURL fallback en cliente:', err);
  }

  // 3. Intento con FileReader corrigiendo MIME vacío o application/octet-stream de Android Galería
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        let rawDataUrl = String(e.target.result || '');
        if (rawDataUrl.startsWith('data:application/octet-stream;base64,') || rawDataUrl.startsWith('data:;base64,')) {
          rawDataUrl = rawDataUrl.replace(/^data:[^;]*;base64,/, 'data:image/jpeg;base64,');
        }
        const img = new Image();
        img.onload = () => {
          try {
            resolve(drawClientSourceToJpegDataUrl(img, img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim, quality));
          } catch (err2) {
            reject(err2);
          }
        };
        img.onerror = reject;
        img.src = rawDataUrl;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    if (dataUrl && dataUrl.startsWith('data:image/')) return dataUrl;
  } catch (err) {
    console.warn('FileReader fallback en cliente:', err);
  }

  // 4. Fallback automático para fotos HEIC / HEIF de galería (iPhone / Samsung)
  try {
    if (typeof window.heic2any !== 'function') {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    if (typeof window.heic2any === 'function') {
      const converted = await window.heic2any({ blob: file, toType: 'image/jpeg', quality });
      const jpgBlob = Array.isArray(converted) ? converted[0] : converted;
      const objectUrl = URL.createObjectURL(jpgBlob);
      const dataUrl = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const out = drawClientSourceToJpegDataUrl(img, img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim, quality);
            URL.revokeObjectURL(objectUrl);
            resolve(out);
          } catch (e) {
            URL.revokeObjectURL(objectUrl);
            reject(e);
          }
        };
        img.onerror = (e) => {
          URL.revokeObjectURL(objectUrl);
          reject(e);
        };
        img.src = objectUrl;
      });
      if (dataUrl && dataUrl.startsWith('data:image/')) return dataUrl;
    }
  } catch (err) {
    console.warn('HEIC fallback en cliente:', err);
  }

  throw new Error('No se pudo procesar la foto seleccionada');
}

async function onClientPhotoSelected(event) {
  const inputEl = event && event.target;
  const file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;

  try {
    const dataUrl = await decodeClientPhotoFile(file, 800, 0.80);
    currentClientPhotoDataUrl = dataUrl;

    const previewImg = document.getElementById('clientPhotoPreviewImg');
    const previewBox = document.getElementById('clientPhotoPreviewBox');
    const buttonsRow = document.getElementById('clientPhotoButtonsRow');
    if (previewImg) previewImg.src = currentClientPhotoDataUrl;
    if (previewBox) previewBox.classList.remove('hidden');
    if (buttonsRow) buttonsRow.classList.add('hidden');
  } catch (err) {
    console.error('Error cargando foto de galería en cliente:', err);
    showToast('Error con la foto', 'No se pudo leer esa imagen de la galería. Intenta con otra foto.', '⚠️');
  } finally {
    if (inputEl) {
      try { inputEl.value = ''; } catch (e) {}
    }
  }
}

function clearClientPhoto() {
  currentClientPhotoDataUrl = null;
  const camInput = document.getElementById('clientPhotoInputCamera');
  const galInput = document.getElementById('clientPhotoInputGallery');
  if (camInput) camInput.value = '';
  if (galInput) galInput.value = '';

  const previewBox = document.getElementById('clientPhotoPreviewBox');
  const buttonsRow = document.getElementById('clientPhotoButtonsRow');
  if (previewBox) previewBox.classList.add('hidden');
  if (buttonsRow) buttonsRow.classList.remove('hidden');
}

function closeModal() {
  selectedSongForModal = null;
  clearClientPhoto();
  document.getElementById('confirmModal').classList.add('hidden');
}

let isSubmittingSongRequest = false;

async function confirmAndSendRequest() {
  if (!selectedSongForModal || isSubmittingSongRequest) return;
  isSubmittingSongRequest = true;

  const btn = document.getElementById('sendRequestBtn');
  const customerName = document.getElementById('customerNameInput').value.trim();
  const dedicationInput = document.getElementById('customerDedicationInput');
  const dedication = dedicationInput ? dedicationInput.value.trim() : '';

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Enviando...';
  }

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
        customerName: customerName || `Mesa ${currentTable}`,
        dedication,
        ...(window.allowClientPhotoDedication && currentClientPhotoDataUrl ? { photo: currentClientPhotoDataUrl } : {})
      })
    });

    const data = await res.json();

    if (!res.ok || (!data.success && !data.ok)) {
      showToast('No se pudo pedir', data.error || 'Intenta más tarde', '⚠️');
    } else {
      showToast('¡Canción Agregada!', data.message || 'Tu canción fue añadida a la cola', '🎉');
      closeModal();
      document.getElementById('searchInput').value = '';
      document.getElementById('clearSearchBtn').classList.add('hidden');
      hideSearchResults();
      document.getElementById('customerNameInput').value = '';
      if (dedicationInput) dedicationInput.value = '';
      clearClientPhoto();
    }
  } catch (err) {
    console.error('Error enviando pedido:', err);
    showToast('Error', 'No se pudo conectar con el servidor del bar', '❌');
  } finally {
    isSubmittingSongRequest = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '¡Pedir Canción! 🎶';
    }
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

// ==========================================
// 8. CONTROL DE MODO DE PEDIDOS (ABIERTO vs SOLO PLAYLISTS)
// ==========================================
function applyRequestMode(mode) {
  currentRequestMode = mode;
  const openContainer = document.getElementById('openModeContainer');
  const playlistContainer = document.getElementById('playlistModeContainer');

  if (mode === 'playlist') {
    if (openContainer) openContainer.classList.add('hidden');
    if (playlistContainer) playlistContainer.classList.remove('hidden');
    loadClientPlaylists();
  } else {
    if (openContainer) openContainer.classList.remove('hidden');
    if (playlistContainer) playlistContainer.classList.add('hidden');
  }
}

async function loadClientPlaylists() {
  try {
    const res = await fetch('/api/playlists');
    const data = await res.json();
    clientPlaylists = data.playlists || [];

    const select = document.getElementById('clientPlaylistSelector');
    if (!select) return;

    if (clientPlaylists.length === 0) {
      select.innerHTML = '<option value="">No hay listas disponibles en este momento</option>';
      renderClientPlaylistTracks([]);
      return;
    }

    const previousSelected = currentSelectedPlaylistId;
    select.innerHTML = clientPlaylists.map(pl => `
      <option value="${escapeHtml(pl.id)}">${escapeHtml(pl.name)} (${pl.tracks ? pl.tracks.length : 0} temas)</option>
    `).join('');

    if (previousSelected && clientPlaylists.some(pl => pl.id === previousSelected)) {
      select.value = previousSelected;
    } else {
      currentSelectedPlaylistId = clientPlaylists[0].id;
      select.value = currentSelectedPlaylistId;
    }

    onClientPlaylistChange();
  } catch (err) {
    console.error('Error cargando listas para cliente:', err);
  }
}

function onClientPlaylistChange() {
  const select = document.getElementById('clientPlaylistSelector');
  if (!select) return;
  currentSelectedPlaylistId = select.value;
  const pl = clientPlaylists.find(p => p.id === currentSelectedPlaylistId);
  const searchInput = document.getElementById('playlistSongSearchInput');
  if (searchInput) searchInput.value = '';

  const header = document.getElementById('playlistTracksHeader');
  if (header && pl) {
    header.textContent = `Temas de "${pl.name}"`;
  }

  if (pl && pl.tracks) {
    currentPlaylistFilteredTracks = [...pl.tracks];
    renderClientPlaylistTracks(currentPlaylistFilteredTracks);
  } else {
    currentPlaylistFilteredTracks = [];
    renderClientPlaylistTracks([]);
  }
}

function filterClientPlaylistSongs() {
  const query = (document.getElementById('playlistSongSearchInput')?.value || '').trim().toLowerCase();
  const pl = clientPlaylists.find(p => p.id === currentSelectedPlaylistId);
  if (!pl || !pl.tracks) return;

  if (!query) {
    currentPlaylistFilteredTracks = [...pl.tracks];
  } else {
    currentPlaylistFilteredTracks = pl.tracks.filter(t => 
      (t.title && t.title.toLowerCase().includes(query)) ||
      (t.artist && t.artist.toLowerCase().includes(query)) ||
      (t.genre && t.genre.toLowerCase().includes(query))
    );
  }
  renderClientPlaylistTracks(currentPlaylistFilteredTracks);
}

function renderClientPlaylistTracks(tracks) {
  const listEl = document.getElementById('playlistTracksList');
  const countEl = document.getElementById('playlistTracksCount');
  if (!listEl) return;

  if (countEl) {
    countEl.textContent = `${tracks.length} tema${tracks.length === 1 ? '' : 's'}`;
  }

  if (!tracks || tracks.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-gray-500 text-center py-6">No se encontraron canciones en esta lista.</p>`;
    return;
  }

  listEl.innerHTML = tracks.map((song, i) => `
    <div class="mocd-track-card p-2.5 sm:p-3 flex items-center gap-3">
      <div class="relative shrink-0">
        <img src="${song.thumbnail || 'https://i.ytimg.com/vi/' + song.videoId + '/hqdefault.jpg'}" class="w-15 h-11 rounded-xl object-cover border border-white/15">
        <span class="absolute bottom-0.5 right-0.5 bg-black/85 text-[8.5px] px-1 rounded text-cyan-300 font-mono font-bold">${song.duration || '3:30'}</span>
      </div>
      <div class="flex-1 min-w-0">
        <h4 class="font-display text-xs sm:text-sm font-bold text-white truncate leading-tight">${escapeHtml(song.title)}</h4>
        <p class="text-[11px] text-gray-300 truncate mt-0.5">${escapeHtml(song.artist || 'Artista')}</p>
        <span class="genre-badge genre-${song.genre || 'Crossover'} !text-[9px] !py-0.5 !px-2 mt-1">${song.genre || 'Música'}</span>
      </div>
      <button onclick="requestPlaylistTrack(${i})" class="btn-neon-mocd text-xs py-2 px-3.5 rounded-xl whitespace-nowrap shrink-0">
        <span>Pedir</span>
        <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
        </svg>
      </button>
    </div>
  `).join('');
}

function requestPlaylistTrack(index) {
  const song = currentPlaylistFilteredTracks[index];
  if (!song) return;

  selectedSongForModal = song;

  document.getElementById('modalThumb').src = song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`;
  document.getElementById('modalTitle').textContent = song.title;
  document.getElementById('modalArtist').textContent = song.artist || 'Artista';
  document.getElementById('modalTable').textContent = `Mesa ${currentTable}`;

  document.getElementById('confirmModal').classList.remove('hidden');
}
