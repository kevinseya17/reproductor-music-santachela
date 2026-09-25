const socket = io();

let currentQueueState = [];
let generatedTracksFromAI = [];
let playerTelemetry = {
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  volume: 100
};
let isUserDraggingScrubber = false;

document.addEventListener('DOMContentLoaded', () => {
  setupSocket();
  loadInitialData();
  setupAdminSearchInput();
});

function setupSocket() {
  socket.on('state-changed', (data) => {
    renderAdminState(data);
  });
  socket.on('mic-mode', ({ active }) => {
    renderMicModeState(active);
  });
  socket.on('banned-tables-updated', (banned) => {
    renderBannedTables(banned);
  });
  socket.on('player-telemetry', (data) => {
    updatePlayerTelemetry(data);
  });
}

async function loadInitialData() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    renderAdminState(data);
    if (data.micModeActive !== undefined) renderMicModeState(data.micModeActive);
    if (data.bannedTables) renderBannedTables(data.bannedTables);
    loadPlaylists();
    loadTrends();
  } catch (err) {
    console.error('Error cargando datos iniciales:', err);
  }
}

// 1. Renderizado de Estado en Vivo
function renderAdminState(data) {
  if (!data) return;
  const { currentlyPlaying, queue, settings } = data;

  currentQueueState = queue || [];

  if (settings && settings.barName) {
    document.getElementById('adminBarName').textContent = settings.barName;
    document.getElementById('settingBarName').value = settings.barName;
    document.getElementById('settingMaxRequests').value = settings.maxRequestsPerTable || 2;
    document.getElementById('settingWindow').value = settings.smartSlottingWindow || 3;
    document.getElementById('settingTotalTables').value = settings.totalTables || 20;
    document.getElementById('settingAutoDJ').checked = settings.autoDJEnabled !== false;
    document.getElementById('settingApiKey').value = settings.geminiApiKey || '';
    if (document.getElementById('settingRequestMode')) {
      document.getElementById('settingRequestMode').value = settings.requestMode || 'open';
    }
    if (document.getElementById('settingFadeTransition')) {
      document.getElementById('settingFadeTransition').checked = settings.fadeTransitionEnabled !== false;
    }
    if (document.getElementById('settingMaxSongDuration')) {
      document.getElementById('settingMaxSongDuration').value = settings.maxSongDuration !== undefined ? settings.maxSongDuration : 0;
    }
    if (document.getElementById('settingGenreBatchSize')) {
      document.getElementById('settingGenreBatchSize').value = settings.genreBatchSize || 3;
    }
    if (document.getElementById('settingDynamicDuration')) {
      document.getElementById('settingDynamicDuration').checked = settings.dynamicDurationOnQueue === true;
    }

    // Actualizar controles de Modo de Reproducción Base
    renderBasePlaybackModeControls(settings);

    // Renderizar ajustes de control, filtro y promociones
    renderBlacklistWords(settings.blacklistWords);
    renderPromosList(settings.promos);
    renderSchedule(settings.schedule, settings.scheduleEnabled);
  }

  // Sonando Ahora (Deck Principal y Mini Player de Barra Lateral)
  if (currentlyPlaying) {
    const titleEl = document.getElementById('adminNowTitle');
    const artistEl = document.getElementById('adminNowArtist');
    const thumbEl = document.getElementById('adminNowThumb');
    const originTextEl = document.getElementById('adminNowOriginText');

    if (titleEl) titleEl.textContent = currentlyPlaying.title;
    if (artistEl) artistEl.textContent = currentlyPlaying.artist;
    if (thumbEl) thumbEl.src = currentlyPlaying.thumbnail;
    
    const miniThumb = document.getElementById('adminSidebarMiniThumb');
    const miniTitle = document.getElementById('adminSidebarMiniTitle');
    const miniArtist = document.getElementById('adminSidebarMiniArtist');
    if (miniThumb) miniThumb.src = currentlyPlaying.thumbnail;
    if (miniTitle) miniTitle.textContent = currentlyPlaying.title;
    if (miniArtist) miniArtist.textContent = currentlyPlaying.artist;

    const genreEl = document.getElementById('adminNowGenre');
    if (genreEl) {
      genreEl.textContent = currentlyPlaying.genre || 'Crossover';
      genreEl.className = `genre-badge genre-${currentlyPlaying.genre || 'Crossover'}`;
    }

    const reqEl = document.getElementById('adminNowRequested');
    if (reqEl) {
      if (currentlyPlaying.requestedBy && currentlyPlaying.requestedBy.table) {
        const ded = currentlyPlaying.requestedBy.dedication ? ` | "${escapeHtml(currentlyPlaying.requestedBy.dedication)}"` : '';
        reqEl.innerHTML = `• Pedida por: Mesa ${escapeHtml(currentlyPlaying.requestedBy.table)}${ded}`;
        if (originTextEl) originTextEl.textContent = `Pedido Mesa ${currentlyPlaying.requestedBy.table}`;
      } else {
        reqEl.textContent = `• Lista Base`;
        if (originTextEl) originTextEl.textContent = `Lista Base del Bar`;
      }
    }
  }

  // Cola de espera (unificada 50+ temas)
  const counterEl = document.getElementById('queueCounter');
  const badgeEl = document.getElementById('queueCustomerBadge');
  const oldBadgeEl = document.getElementById('queueCounterBadge');
  const customerCount = currentQueueState.filter(s => s.isBaseTrack !== true).length;
  
  if (counterEl) counterEl.textContent = currentQueueState.length;
  if (oldBadgeEl) oldBadgeEl.textContent = currentQueueState.length;
  if (badgeEl) {
    if (customerCount > 0) {
      badgeEl.textContent = `${customerCount} de mesas`;
      badgeEl.classList.remove('hidden');
    } else {
      badgeEl.classList.add('hidden');
    }
  }

  renderQueueList(currentQueueState);
}

// Formateador de segundos a mm:ss
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Telemetría de progreso y estado en tiempo real (proveniente de player.html vía WebSocket)
function updatePlayerTelemetry(data) {
  if (!data) return;
  playerTelemetry = { ...playerTelemetry, ...data };

  const currentFormatted = formatTime(playerTelemetry.currentTime);
  const totalFormatted = formatTime(playerTelemetry.duration);

  const currentEl = document.getElementById('adminCurrentTime');
  const totalEl = document.getElementById('adminTotalDuration');
  const elapsedLabel = document.getElementById('scrubberElapsedLabel');
  const totalLabel = document.getElementById('scrubberTotalLabel');
  const miniTime = document.getElementById('adminSidebarMiniTime');

  if (currentEl) currentEl.textContent = currentFormatted;
  if (totalEl) totalEl.textContent = totalFormatted;
  if (elapsedLabel) elapsedLabel.textContent = currentFormatted;
  if (totalLabel) totalLabel.textContent = totalFormatted;
  if (miniTime) miniTime.textContent = currentFormatted;

  // Actualizar la barra de progreso únicamente si el usuario no la está arrastrando en este instante
  if (!isUserDraggingScrubber && playerTelemetry.duration > 0) {
    const scrubber = document.getElementById('adminPlayerScrubber');
    if (scrubber) {
      const pct = (playerTelemetry.currentTime / playerTelemetry.duration) * 100;
      scrubber.value = Math.min(100, Math.max(0, pct));
    }
  }

  // Botón Play / Pause en vivo
  const playPauseBtn = document.getElementById('btnPlayPause');
  const playPauseIcon = document.getElementById('btnPlayPauseIcon');
  const playPauseText = document.getElementById('btnPlayPauseText');

  if (playPauseBtn && playPauseIcon && playPauseText) {
    if (playerTelemetry.isPlaying) {
      playPauseIcon.textContent = '⏸️';
      playPauseText.textContent = 'PAUSAR';
      playPauseBtn.className = 'tactile-btn-gold px-7 sm:px-8 py-2.5 sm:py-3 text-base sm:text-lg flex items-center gap-2';
    } else {
      playPauseIcon.textContent = '▶️';
      playPauseText.textContent = 'REANUDAR';
      playPauseBtn.className = 'tactile-btn-dark px-7 sm:px-8 py-2.5 sm:py-3 text-base sm:text-lg flex items-center gap-2 border-amber-400 text-amber-400';
    }
  }

  // Deslizador de volumen
  if (data.volume !== undefined) {
    const volSlider = document.getElementById('adminVolumeSlider');
    const volDisplay = document.getElementById('adminVolumeDisplay');
    if (volSlider && document.activeElement !== volSlider) {
      volSlider.value = data.volume;
    }
    if (volDisplay) {
      volDisplay.textContent = `${Math.round(data.volume)}%`;
    }
  }
}

// Interacción con Scrubber / Barra de Progreso
function onScrubberInput(val) {
  isUserDraggingScrubber = true;
  if (playerTelemetry.duration > 0) {
    const seconds = (val / 100) * playerTelemetry.duration;
    const label = document.getElementById('scrubberElapsedLabel');
    if (label) label.textContent = formatTime(seconds);
  }
}

function onScrubberChange(val) {
  isUserDraggingScrubber = false;
  if (playerTelemetry.duration > 0) {
    const seekTime = (val / 100) * playerTelemetry.duration;
    socket.emit('player-command', { command: 'seek', value: seekTime });
  }
}

// Controles Remotos de Transporte
function togglePlayPauseRemote() {
  socket.emit('player-command', { command: 'toggle' });
}

function remoteSeek(deltaSeconds) {
  socket.emit('player-command', { command: 'seekRelative', value: deltaSeconds });
}

function onVolumeChange(val) {
  const vol = parseInt(val, 10);
  const volDisplay = document.getElementById('adminVolumeDisplay');
  if (volDisplay) volDisplay.textContent = `${vol}%`;
  socket.emit('player-command', { command: 'volume', value: vol });
}

// Modo Micrófono / Ducking
async function toggleMicMode() {
  try {
    const res = await fetch('/api/admin/mic-mode', { method: 'POST' });
    const data = await res.json();
    renderMicModeState(data.micModeActive);
  } catch (err) {
    console.error('Error alternando modo micrófono:', err);
  }
}

function renderMicModeState(active) {
  const icon = document.getElementById('micModeIcon');
  const text = document.getElementById('micModeText');
  const deckLabel = document.getElementById('deckMicLabel');
  const deckBtn = document.getElementById('btnDeckMic');
  const topBtn = document.getElementById('btnMicMode');

  if (active) {
    if (icon) icon.className = 'w-2 h-2 rounded-full bg-red-500 animate-ping inline-block';
    if (text) text.textContent = 'Mic ACTIVO';
    if (topBtn) topBtn.className = 'btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3 bg-red-500/20 text-red-400 border-red-500/40 font-bold';
    if (deckLabel) deckLabel.textContent = 'Mic ON';
    if (deckBtn) deckBtn.className = 'tactile-btn-gold px-3.5 py-2 text-xs flex items-center gap-1.5 border-red-400 bg-red-500 text-white';
  } else {
    if (icon) icon.className = 'w-2 h-2 rounded-full bg-gray-400 inline-block';
    if (text) text.textContent = 'Modo Micrófono';
    if (topBtn) topBtn.className = 'btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3 transition';
    if (deckLabel) deckLabel.textContent = 'Mic';
    if (deckBtn) deckBtn.className = 'tactile-btn-dark px-3.5 py-2 text-xs flex items-center gap-1.5';
  }
}

// Alternar menú lateral en pantallas móviles
function toggleSidebarMobile() {
  const sidebar = document.getElementById('adminSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar) return;
  const isClosed = sidebar.classList.contains('-translate-x-full');
  if (isClosed) {
    sidebar.classList.remove('-translate-x-full');
    backdrop?.classList.remove('hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    backdrop?.classList.add('hidden');
  }
}

// ============================================================
// DRAG & DROP REORDENAMIENTO DE COLA EN VIVO
// ============================================================
let draggedQueueIndex = null;

function handleQueueDragStart(e, index) {
  draggedQueueIndex = index;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(index));
  const row = document.getElementById(`queue-row-${index}`);
  if (row) {
    row.classList.add('opacity-50', 'scale-[0.99]', 'border-amber-400', 'bg-amber-500/10');
  }
}

function handleQueueDragOver(e, index) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleQueueDragEnter(e, index) {
  e.preventDefault();
  if (draggedQueueIndex === null || draggedQueueIndex === index) return;
  const row = document.getElementById(`queue-row-${index}`);
  if (row) {
    row.classList.add('border-amber-400', 'bg-amber-500/15', 'ring-2', 'ring-amber-400/50', 'translate-y-[-2px]');
  }
}

function handleQueueDragLeave(e, index) {
  const row = document.getElementById(`queue-row-${index}`);
  if (row) {
    row.classList.remove('border-amber-400', 'bg-amber-500/15', 'ring-2', 'ring-amber-400/50', 'translate-y-[-2px]');
  }
}

function handleQueueDrop(e, targetIndex) {
  e.preventDefault();
  e.stopPropagation();

  const targetRow = document.getElementById(`queue-row-${targetIndex}`);
  if (targetRow) {
    targetRow.classList.remove('border-amber-400', 'bg-amber-500/15', 'ring-2', 'ring-amber-400/50', 'translate-y-[-2px]');
  }

  if (draggedQueueIndex === null || draggedQueueIndex === targetIndex) {
    draggedQueueIndex = null;
    return;
  }

  const fromIndex = draggedQueueIndex;
  draggedQueueIndex = null;

  // Reordenar localmente de inmediato (0ms de latencia visual)
  const newQueue = [...currentQueueState];
  const [movedSong] = newQueue.splice(fromIndex, 1);
  newQueue.splice(targetIndex, 0, movedSong);
  currentQueueState = newQueue;
  renderQueueList(currentQueueState);

  // Persistir en el servidor
  fetch('/api/admin/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue: newQueue })
  }).catch(err => {
    console.error('Error guardando reorden de cola:', err);
  });
}

function handleQueueDragEnd(e) {
  draggedQueueIndex = null;
  const rows = document.querySelectorAll('.queue-row');
  rows.forEach(r => {
    r.classList.remove('opacity-50', 'scale-[0.99]', 'border-amber-400', 'bg-amber-500/10', 'bg-amber-500/15', 'ring-2', 'ring-amber-400/50', 'translate-y-[-2px]');
  });
}

// Renderizado de Lista UP NEXT / QUEUE (Estilo Referencia Pro con Arrastre y Cola Unificada 50+)
function renderQueueList(queue) {
  const container = document.getElementById('adminQueueList');
  if (!container) return;

  if (!queue || queue.length === 0) {
    container.innerHTML = `
      <div class="p-8 rounded-2xl bg-black/20 border border-white/5 text-center space-y-2">
        <div class="text-2xl text-amber-400">✨</div>
        <p class="text-xs sm:text-sm font-bold text-white">No hay canciones en la cola</p>
        <p class="text-[11px] text-gray-400 max-w-sm mx-auto">
          Las canciones de la lista base o pedidos de las mesas aparecerán aquí. Puedes arrastrarlas o usar las flechas ▲ ▼ para cambiar su orden de reproducción.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = queue.map((song, i) => {
    const isFirst = i === 0;
    const isLast = i === queue.length - 1;
    const isClientReq = song.isBaseTrack !== true;

    // Distinción clara: Pedido de Mesa (dorado/destacado) vs Canción Base (sobria con nombre de lista)
    let badgeHtml = '';
    let rowBorderClass = 'border-white/5 hover:border-amber-500/40 bg-[#141720]';
    let vipButtonHtml = '';

    if (isClientReq) {
      const tableNum = song.requestedBy?.table || '?';
      badgeHtml = `<span class="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-black tracking-wide">👑 MESA ${escapeHtml(tableNum)}</span>`;
      rowBorderClass = 'border-amber-500/40 bg-amber-500/[0.05] hover:border-amber-400/80 shadow-[0_0_15px_rgba(245,158,11,0.06)]';
      if (!isFirst) {
        vipButtonHtml = `
          <button onclick="setSongPriority('${song.id}')" class="btn-secondary text-[11px] sm:text-xs py-1 px-1.5 sm:px-2.5 text-amber-300 font-bold border-amber-500/40 hover:bg-amber-500/20 whitespace-nowrap" title="Dar Prioridad VIP para que suene a continuación">
            <span class="sm:hidden">⭐ VIP</span><span class="hidden sm:inline">⭐ Prioridad VIP</span>
          </button>
        `;
      }
    } else {
      const plName = song.playlistName || song.genre || 'Crossover';
      badgeHtml = `<span class="px-2 py-0.5 rounded-md bg-white/10 text-gray-300 text-[10px] font-medium">🎵 Base: ${escapeHtml(plName)}</span>`;
    }

    return `
      <div id="queue-row-${i}"
           draggable="true"
           ondragstart="handleQueueDragStart(event, ${i})"
           ondragover="handleQueueDragOver(event, ${i})"
           ondragenter="handleQueueDragEnter(event, ${i})"
           ondragleave="handleQueueDragLeave(event, ${i})"
           ondrop="handleQueueDrop(event, ${i})"
           ondragend="handleQueueDragEnd(event)"
           class="queue-row flex items-center justify-between p-2 sm:p-3 rounded-2xl ${rowBorderClass} gap-1.5 sm:gap-3 group select-none cursor-grab active:cursor-grabbing transition-all">
        
        <!-- Izquierda: Agarre (Grip Handle), Botones de Reordenar ▲ ▼ y Número 1., 2., 3. -->
        <div class="flex items-center gap-1 sm:gap-2 shrink-0">
          <span class="text-gray-500 group-hover:text-amber-400 text-xs px-1 cursor-grab" title="Arrastra para cambiar de posición">⋮⋮</span>
          <div class="flex flex-col items-center">
            <button onclick="reorderQueueItem(${i}, 'up')" class="text-[11px] px-1 text-gray-400 hover:text-amber-400 hover:bg-white/10 rounded transition ${isFirst ? 'opacity-20 cursor-not-allowed' : ''}" title="Subir turno" ${isFirst ? 'disabled' : ''}>▲</button>
            <button onclick="reorderQueueItem(${i}, 'down')" class="text-[11px] px-1 text-gray-400 hover:text-amber-400 hover:bg-white/10 rounded transition ${isLast ? 'opacity-20 cursor-not-allowed' : ''}" title="Bajar turno" ${isLast ? 'disabled' : ''}>▼</button>
          </div>
          <span class="font-mono font-black text-amber-400 text-xs sm:text-sm w-5 text-center">${i + 1}.</span>
        </div>

        <!-- Carátula + Info de la canción -->
        <div class="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 pointer-events-none">
          <img src="${song.thumbnail || 'https://i.ytimg.com/vi/' + song.videoId + '/hqdefault.jpg'}" class="w-10 h-8 sm:w-12 sm:h-9 rounded-xl object-cover border border-white/10 shrink-0 shadow-md">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="text-xs sm:text-sm font-bold text-white truncate group-hover:text-amber-300 transition" title="${escapeHtml(song.title)}">
                ${escapeHtml(song.title)}
              </p>
              <span class="genre-badge genre-${song.genre || 'Crossover'} text-[9px] py-0.2 px-2 hidden sm:inline-flex">${escapeHtml(song.genre || 'Crossover')}</span>
            </div>
            <div class="flex items-center gap-2 text-[11px] text-gray-400 truncate mt-0.5">
              <span class="truncate font-semibold text-gray-300">${escapeHtml(song.artist)}</span>
              <span>•</span>
              ${badgeHtml}
              ${song.requestedBy?.dedication ? `<span class="text-pink-400 italic truncate hidden md:inline">"${escapeHtml(song.requestedBy.dedication)}"</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Duración + Acciones -->
        <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <span class="font-mono text-xs text-gray-300 font-bold hidden sm:inline">${song.duration || '3:30'}</span>
          ${vipButtonHtml}
          <button onclick="playNowDirect('${song.videoId}', '${escapeHtml(song.title)}', '${escapeHtml(song.artist)}', '${song.genre}')" class="tactile-btn-gold text-[11px] sm:text-xs py-1 sm:py-1.5 px-2 sm:px-3 font-bold whitespace-nowrap" title="Reproducir ahora mismo">
            Sonar Ya
          </button>
          <button onclick="removeQueueItem('${song.id}')" class="text-gray-400 hover:text-red-400 p-1 sm:p-1.5 rounded-lg hover:bg-white/10 transition" title="Eliminar de la cola">
            ✕
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Asignar Prioridad VIP a un pedido para que suene a continuación
async function setSongPriority(songId) {
  try {
    const res = await fetch('/api/admin/queue/priority', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId })
    });
    if (res.ok) {
      showAdminToast('⭐ Prioridad VIP: Canción movida al turno #1', '👑');
    }
  } catch (err) {
    console.error('Error asignando prioridad VIP:', err);
  }
}

// Regenerar manualmente la cola de 50 temas base
async function refreshPlaybackQueue() {
  try {
    const res = await fetch('/api/admin/queue/refresh', { method: 'POST' });
    if (res.ok) {
      showAdminToast('🔄 Mezcla base regenerada (50 temas)', '🔄');
    }
  } catch (err) {
    console.error('Error regenerando mezcla de cola:', err);
  }
}

// 2. Control de la Cola
async function skipCurrentSong() {
  await fetch('/api/admin/skip', { method: 'POST' });
}

async function removeQueueItem(songId) {
  await fetch('/api/admin/remove-queued', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId })
  });
}

async function reorderQueueItem(index, direction) {
  try {
    await fetch('/api/queue/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index, direction })
    });
  } catch (err) {
    console.error('Error reordenando cola:', err);
  }
}

async function playNowDirect(videoId, title, artist, genre) {
  await fetch('/api/admin/play-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId, title, artist, genre })
  });
}

// 3. Búsqueda rápida de DJ con soporte para Enter, Debounce y caché
let adminSearchDebounce = null;
let lastAdminSearchVideos = [];

function setupAdminSearchInput() {
  const input = document.getElementById('adminSearchInput');
  const clearBtn = document.getElementById('adminSearchInputClear');
  const clearTopBtn = document.getElementById('adminClearSearchBtn');
  if (!input) return;

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    const hasText = query.length > 0;
    if (clearBtn) clearBtn.classList.toggle('hidden', !hasText);
    if (clearTopBtn) clearTopBtn.classList.toggle('hidden', !hasText);

    if (!hasText) {
      document.getElementById('adminSearchResults')?.classList.add('hidden');
      return;
    }

    // Si el usuario escribe al menos 3 letras, buscar con debounce rápido de 450ms
    clearTimeout(adminSearchDebounce);
    if (query.length >= 3) {
      adminSearchDebounce = setTimeout(() => {
        adminSearchSong();
      }, 450);
    }
  });
}

function handleAdminSearchKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    clearTimeout(adminSearchDebounce);
    adminSearchSong();
  }
}

function clearAdminSearch() {
  const input = document.getElementById('adminSearchInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  document.getElementById('adminSearchInputClear')?.classList.add('hidden');
  document.getElementById('adminClearSearchBtn')?.classList.add('hidden');
  document.getElementById('adminSearchResults')?.classList.add('hidden');
}

async function adminSearchSong() {
  const input = document.getElementById('adminSearchInput');
  const query = input ? input.value.trim() : '';
  if (!query) return;

  const resultsBox = document.getElementById('adminSearchResults');
  const searchBtnLabel = document.getElementById('adminSearchBtnLabel');
  if (resultsBox) {
    resultsBox.classList.remove('hidden');
    resultsBox.innerHTML = `
      <div class="flex items-center gap-2 text-xs text-amber-400 py-3">
        <div class="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
        <span>Buscando en YouTube...</span>
      </div>
    `;
  }
  if (searchBtnLabel) searchBtnLabel.textContent = '...';

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const videos = data.results || [];

    if (searchBtnLabel) searchBtnLabel.textContent = 'Buscar';

    if (videos.length === 0) {
      resultsBox.innerHTML = `
        <div class="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-gray-400 flex items-center justify-between">
          <span>No se encontraron resultados para "<strong>${escapeHtml(query)}</strong>".</span>
          <button onclick="adminSearchSong()" class="text-amber-400 hover:underline font-semibold ml-2">Reintentar</button>
        </div>
      `;
      return;
    }

    lastAdminSearchVideos = videos;

    resultsBox.innerHTML = `
      <div class="flex items-center justify-between text-[11px] text-gray-400 px-1 pb-1">
        <span>Resultados encontrados (${videos.length}):</span>
        <button onclick="clearAdminSearch()" class="hover:text-white">Cerrar</button>
      </div>
      <div class="space-y-1.5">
        ${videos.slice(0, 6).map((v, idx) => `
          <div class="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5 hover:border-amber-400/30 transition">
            <div class="flex items-center gap-3 min-w-0 flex-1 mr-2">
              <img src="${v.thumbnail}" class="w-12 h-9 rounded object-cover shrink-0">
              <div class="min-w-0 flex-1">
                <p class="text-xs font-bold text-white truncate" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</p>
                <p class="text-[11px] text-gray-400 truncate">${escapeHtml(v.artist)} • ${v.duration}</p>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button onclick="adminAddSongFromSearch(${idx})" class="btn-secondary text-xs py-1.5 px-2.5 whitespace-nowrap text-amber-400 font-semibold border-amber-400/30 hover:bg-amber-400/10" title="Agregar a la cola de espera sin límite de canciones">
                + Cola
              </button>
              <button onclick="adminPlayNowFromSearch(${idx})" class="btn-primary text-xs py-1.5 px-2.5 whitespace-nowrap font-bold" title="Reproducir inmediatamente">
                Sonar Ya
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error('Error buscando canción en admin:', err);
    if (searchBtnLabel) searchBtnLabel.textContent = 'Buscar';
    resultsBox.innerHTML = `
      <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center justify-between">
        <span>Error al conectar con el servicio de búsqueda.</span>
        <button onclick="adminSearchSong()" class="btn-secondary text-xs py-1 px-2.5">Reintentar</button>
      </div>
    `;
  }
}

function adminAddSongFromSearch(idx) {
  const v = lastAdminSearchVideos[idx];
  if (!v) return;
  adminAddSongToQueue(v.videoId, v.title, v.artist, v.duration, v.thumbnail);
}

function adminPlayNowFromSearch(idx) {
  const v = lastAdminSearchVideos[idx];
  if (!v) return;
  playNowDirect(v.videoId, v.title, v.artist, 'Crossover');
  clearAdminSearch();
}

async function adminAddSongToQueue(videoId, title, artist, duration, thumbnail) {
  try {
    const res = await fetch('/api/admin/add-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        title,
        artist,
        duration,
        thumbnail
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'No se pudo agregar la canción');
      return;
    }
    clearAdminSearch();
    showAdminToast(`✓ "${title}" agregada a la cola`);
  } catch (err) {
    console.error('Error agregando cancion como DJ:', err);
    alert('Error al agregar canción.');
  }
}

function showAdminToast(msg, icon = '🎵') {
  let toast = document.getElementById('adminDynamicToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'adminDynamicToast';
    toast.className = 'fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 bg-amber-400 text-black font-bold text-xs rounded-xl shadow-2xl backdrop-blur-md transition-all duration-300 transform translate-y-10 opacity-0 pointer-events-none';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span class="text-base">${icon}</span> <span class="truncate max-w-[280px]">${escapeHtml(msg)}</span>`;
  toast.classList.remove('translate-y-10', 'opacity-0');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.add('translate-y-10', 'opacity-0');
  }, 3500);
}

// 4. Pestaña de Listas Maestras
async function loadPlaylists() {
  try {
    const res = await fetch('/api/playlists');
    const data = await res.json();
    let playlists = data.playlists || [];

    // Sincronización automática de respaldo con LocalStorage (protección contra reinicios de Render)
    try {
      const localBackupRaw = localStorage.getItem('santachela_playlists_backup');
      if (localBackupRaw) {
        const localBackup = JSON.parse(localBackupRaw);
        if (Array.isArray(localBackup) && localBackup.length > 0) {
          const missingOnServer = localBackup.filter(l => 
            !playlists.some(s => s.id === l.id || s.name.trim().toLowerCase() === l.name.trim().toLowerCase())
          );

          if (missingOnServer.length > 0) {
            console.log(`Restaurando ${missingOnServer.length} lista(s) guardadas en este navegador...`);
            await fetch('/api/playlists/restore', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playlists: missingOnServer })
            });
            const refreshed = await fetch('/api/playlists');
            const refData = await refreshed.json();
            playlists = refData.playlists || [];
          }
        }
      }
      localStorage.setItem('santachela_playlists_backup', JSON.stringify(playlists));
    } catch (storageErr) {
      console.warn('LocalStorage sync warning:', storageErr);
    }

    currentPlaylistsList = playlists;
    populateSchedulePlaylistsDropdown();

    let activeId = '';
    let currentMode = 'single';
    let crossoverList = [];
    let crossoverDistType = 'batch';
    let crossoverPercentages = {};
    try {
      const statusRes = await fetch('/api/status');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        const settings = statusData.settings || {};
        activeId = settings.activePlaylistId || '';
        currentMode = settings.basePlaybackMode || 'single';
        crossoverList = Array.isArray(settings.crossoverPlaylists) ? settings.crossoverPlaylists : [];
        crossoverDistType = settings.crossoverDistributionType || 'batch';
        crossoverPercentages = settings.crossoverPercentages || {};
        renderBasePlaybackModeControls(settings);
      }
    } catch (statusErr) {
      console.warn('Error obteniendo status para listas:', statusErr);
    }

    const grid = document.getElementById('playlistsGrid');
    if (!grid) return;

    if (!playlists || playlists.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full text-center py-10 bg-white/5 border border-white/10 rounded-2xl p-6">
          <h4 class="text-white font-bold text-base">No hay listas de reproducción aún</h4>
          <p class="text-xs text-gray-400 mt-1 max-w-sm mx-auto">Crea tu primera lista con el botón "+ Nueva Lista" de arriba o importa canciones para comenzar.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = playlists.map(p => {
      const isActive = p.id === activeId;
      const isIncludedInRotation = crossoverList.includes(p.id) || (crossoverList.length === 0);
      const isPercentageCrossover = currentMode === 'crossover' && crossoverDistType === 'percentage' && isIncludedInRotation;
      const currentPct = (crossoverPercentages && crossoverPercentages[p.id] !== undefined) ? crossoverPercentages[p.id] : 25;

      return `
        <div class="glass-card p-5 space-y-3 ${isActive ? 'border-amber-400/50 bg-amber-500/5' : ''}">
          <div class="flex items-start justify-between">
            <div>
              <h3 class="font-bold text-base text-white">${escapeHtml(p.name)}</h3>
              <p class="text-xs text-gray-400 mt-1">${escapeHtml(p.description || '')}</p>
            </div>
            <div class="flex flex-col items-end gap-1">
              ${isActive ? '<span class="genre-badge genre-Popular">Activa Ahora</span>' : ''}
              ${(currentMode === 'crossover' || currentMode === 'sequential') ? `
                <button onclick="togglePlaylistInRotation('${p.id}')" class="text-[10px] px-2 py-0.5 rounded-full font-bold transition ${isIncludedInRotation ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-white/10 text-gray-400 border border-white/10'}" title="Activar/Desactivar de la rotación automática">
                  ${isIncludedInRotation ? 'En Rotación' : 'Fuera de Rotación'}
                </button>
              ` : ''}
            </div>
          </div>

          <div class="text-xs text-gray-400 flex items-center justify-between flex-wrap gap-2">
            <span>${p.tracks ? p.tracks.length : 0} temas listos</span>
            ${isPercentageCrossover ? `
              <div class="flex items-center gap-1.5 bg-black/50 px-2.5 py-1 rounded-xl border border-amber-500/30">
                <label class="text-[10px] text-gray-300 font-bold">Ponderación:</label>
                <input type="number" min="1" max="100" value="${currentPct}" onchange="updatePlaylistPercentage('${p.id}', this.value)" class="w-12 bg-black/80 border border-white/20 rounded px-1.5 py-0.5 text-xs text-amber-400 font-black text-center outline-none focus:border-amber-400">
                <span class="text-xs text-amber-400 font-bold">%</span>
              </div>
            ` : ''}
          </div>

          <div class="pt-2 flex flex-wrap items-center gap-2">
            <button onclick="viewPlaylistTracks('${p.id}')" class="btn-secondary text-xs py-2 px-3 flex-1 min-w-[130px] font-semibold" title="Ver y editar canciones">
              Ver y Editar (${p.tracks ? p.tracks.length : 0})
            </button>
            ${!isActive ? `<button onclick="activatePlaylist('${p.id}')" class="btn-primary text-xs py-2 px-3 font-bold">Activar</button>` : '<button disabled class="btn-secondary text-xs py-2 px-3 opacity-50">Sonando</button>'}
            ${!isActive ? `<button onclick="deletePlaylistDirect('${p.id}', '${escapeHtml(p.name)}')" class="btn-secondary text-xs py-2 px-2.5 text-red-400 hover:text-red-300" title="Eliminar lista">Eliminar</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error cargando listas:', err);
  }
}

// 4.0 Funciones de Modo de Reproducción Base (Única, Crossover, Consecutivo, Género Específico)
function renderBasePlaybackModeControls(settings) {
  const mode = settings.basePlaybackMode || 'single';
  const badge = document.getElementById('basePlaybackModeBadge');
  const crossoverPanel = document.getElementById('crossoverSettingsPanel');
  const sequentialPanel = document.getElementById('sequentialSettingsPanel');
  const genreFocusPanel = document.getElementById('genreFocusSettingsPanel');
  const batchSelect = document.getElementById('crossoverBatchSizeSelect');
  const distTypeSelect = document.getElementById('crossoverDistTypeSelect');
  const batchOption = document.getElementById('crossoverBatchOption');
  const pctOption = document.getElementById('crossoverPercentageOption');
  const seqOrderSelect = document.getElementById('sequentialOrderTypeSelect');
  const focusGenreSelect = document.getElementById('focusGenreSelect');
  const genreStyleSelect = document.getElementById('genrePlaybackStyleSelect');

  // Marcar radio button
  const radios = document.getElementsByName('basePlaybackModeRadio');
  radios.forEach(r => {
    r.checked = (r.value === mode);
  });

  const distType = settings.crossoverDistributionType || 'batch';
  if (distTypeSelect) {
    distTypeSelect.value = distType;
  }
  if (distType === 'percentage') {
    batchOption?.classList.add('hidden');
    pctOption?.classList.remove('hidden');
  } else {
    batchOption?.classList.remove('hidden');
    pctOption?.classList.add('hidden');
  }

  if (batchSelect && settings.crossoverBatchSize) {
    batchSelect.value = settings.crossoverBatchSize;
  }
  if (seqOrderSelect && settings.sequentialOrderType) {
    seqOrderSelect.value = settings.sequentialOrderType;
  }
  if (focusGenreSelect && settings.focusGenre) {
    focusGenreSelect.value = settings.focusGenre;
  }
  if (genreStyleSelect && settings.genrePlaybackStyle) {
    genreStyleSelect.value = settings.genrePlaybackStyle;
  }

  // Ocultar todos los paneles
  if (crossoverPanel) crossoverPanel.classList.add('hidden');
  if (sequentialPanel) sequentialPanel.classList.add('hidden');
  if (genreFocusPanel) genreFocusPanel.classList.add('hidden');

  if (mode === 'crossover') {
    const crossoverSummary = distType === 'percentage'
      ? 'Distribución por %'
      : `${settings.crossoverBatchSize || 2} temas x lista`;
    if (badge) badge.innerHTML = `<span class="text-amber-400 font-bold">Modo: Crossover (${crossoverSummary})</span>`;
    if (crossoverPanel) crossoverPanel.classList.remove('hidden');
  } else if (mode === 'sequential') {
    const isCustom = settings.sequentialOrderType === 'custom';
    if (badge) badge.innerHTML = `<span class="text-sky-400 font-bold">Modo: Consecutivo (${isCustom ? 'Orden Personalizado' : 'Orden Natural'})</span>`;
    if (sequentialPanel) {
      sequentialPanel.classList.remove('hidden');
      renderSequentialChainList(settings);
    }
  } else if (mode === 'genre_focus') {
    const genre = settings.focusGenre || 'Salsa';
    if (badge) badge.innerHTML = `<span class="text-emerald-400 font-bold">Modo: 100% ${genre}</span>`;
    if (genreFocusPanel) {
      genreFocusPanel.classList.remove('hidden');
      updateGenreFocusStatsDisplay(genre);
    }
  } else {
    if (badge) badge.innerHTML = `<span class="text-white font-bold">Modo: Lista Única</span>`;
  }
}

// Renderizar lista interactiva ordenable de listas para el modo consecutivo
function renderSequentialChainList(settings) {
  const container = document.getElementById('sequentialChainList');
  if (!container) return;

  const crossoverList = Array.isArray(settings.crossoverPlaylists) && settings.crossoverPlaylists.length > 0
    ? settings.crossoverPlaylists
    : (currentPlaylistsList || []).map(p => p.id);

  // Filtrar solo las listas activas en rotación
  let activePlaylists = crossoverList
    .map(id => (currentPlaylistsList || []).find(p => p.id === id))
    .filter(p => p && p.tracks && p.tracks.length > 0);

  // Si tiene orden personalizado, ordenar según sequentialPlaylistOrder
  if (settings.sequentialOrderType === 'custom' && Array.isArray(settings.sequentialPlaylistOrder) && settings.sequentialPlaylistOrder.length > 0) {
    const orderMap = new Map();
    settings.sequentialPlaylistOrder.forEach((id, idx) => orderMap.set(id, idx));
    activePlaylists.sort((a, b) => {
      const idxA = orderMap.has(a.id) ? orderMap.get(a.id) : 999;
      const idxB = orderMap.has(b.id) ? orderMap.get(b.id) : 999;
      return idxA - idxB;
    });
  }

  if (activePlaylists.length === 0) {
    container.innerHTML = `<p class="text-gray-400 py-2 text-center text-xs">No hay listas con canciones en rotación.</p>`;
    return;
  }

  container.innerHTML = activePlaylists.map((p, idx) => `
    <div class="flex items-center justify-between p-2 rounded-xl bg-black/50 border border-white/5 hover:border-sky-500/30 transition">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <span class="font-bold text-sky-400 text-xs w-5 font-mono">#${idx + 1}</span>
        <div class="min-w-0 flex-1">
          <p class="font-bold text-white text-xs truncate">${escapeHtml(p.name)}</p>
          <p class="text-[10px] text-gray-400 truncate">${p.tracks ? p.tracks.length : 0} canciones</p>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0 ml-2">
        <button onclick="moveSequentialPlaylistItem(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} class="px-2.5 py-1 rounded bg-white/10 hover:bg-sky-500/20 text-white disabled:opacity-30 text-xs font-bold" title="Mover hacia arriba en la cadena">
          ▲
        </button>
        <button onclick="moveSequentialPlaylistItem(${idx}, 1)" ${idx === activePlaylists.length - 1 ? 'disabled' : ''} class="px-2.5 py-1 rounded bg-white/10 hover:bg-sky-500/20 text-white disabled:opacity-30 text-xs font-bold" title="Mover hacia abajo en la cadena">
          ▼
        </button>
      </div>
    </div>
  `).join('');
}

// Mover lista en la secuencia del modo Consecutivo
async function moveSequentialPlaylistItem(index, direction) {
  try {
    const statusRes = await fetch('/api/status');
    const statusData = await statusRes.json();
    const settings = statusData.settings || {};

    const crossoverList = Array.isArray(settings.crossoverPlaylists) && settings.crossoverPlaylists.length > 0
      ? settings.crossoverPlaylists
      : (currentPlaylistsList || []).map(p => p.id);

    let activePlaylists = crossoverList
      .map(id => (currentPlaylistsList || []).find(p => p.id === id))
      .filter(p => p && p.tracks && p.tracks.length > 0);

    let currentOrder = [];
    if (settings.sequentialOrderType === 'custom' && Array.isArray(settings.sequentialPlaylistOrder) && settings.sequentialPlaylistOrder.length > 0) {
      const orderMap = new Map();
      settings.sequentialPlaylistOrder.forEach((id, idx) => orderMap.set(id, idx));
      activePlaylists.sort((a, b) => {
        const idxA = orderMap.has(a.id) ? orderMap.get(a.id) : 999;
        const idxB = orderMap.has(b.id) ? orderMap.get(b.id) : 999;
        return idxA - idxB;
      });
      currentOrder = activePlaylists.map(p => p.id);
    } else {
      currentOrder = activePlaylists.map(p => p.id);
    }

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= currentOrder.length) return;

    // Intercambiar
    const temp = currentOrder[index];
    currentOrder[index] = currentOrder[newIndex];
    currentOrder[newIndex] = temp;

    await saveSettingsPartial({
      sequentialOrderType: 'custom',
      sequentialPlaylistOrder: currentOrder
    });

    loadPlaylists();
  } catch (err) {
    console.error('Error moviendo orden de lista:', err);
  }
}

// Restablecer orden natural para el modo Consecutivo
async function resetSequentialToNaturalOrder() {
  await saveSettingsPartial({
    sequentialOrderType: 'natural',
    sequentialPlaylistOrder: []
  });
  loadPlaylists();
}

async function updateSequentialOrderType(type) {
  await saveSettingsPartial({ sequentialOrderType: type });
  loadPlaylists();
}

async function updateFocusGenre(genre) {
  await saveSettingsPartial({ focusGenre: genre });
  loadPlaylists();
}

async function updateGenrePlaybackStyle(style) {
  await saveSettingsPartial({ genrePlaybackStyle: style });
  loadPlaylists();
}

// Calcular y mostrar cuántas canciones hay disponibles del género seleccionado
function updateGenreFocusStatsDisplay(genre) {
  const statsEl = document.getElementById('genreFocusStats');
  if (!statsEl) return;

  let count = 0;
  let listsCount = 0;

  for (const pl of (currentPlaylistsList || [])) {
    let hasFromPl = false;
    if (Array.isArray(pl.tracks)) {
      for (const t of pl.tracks) {
        if (t.genre && t.genre.toLowerCase() === genre.toLowerCase()) {
          count++;
          hasFromPl = true;
        }
      }
    }
    if (hasFromPl) listsCount++;
  }

  statsEl.innerHTML = `<strong>${count} canciones</strong> de ${genre} encontradas en <strong>${listsCount} listas</strong>`;
}

async function changeBasePlaybackMode(newMode) {
  await saveSettingsPartial({ basePlaybackMode: newMode });
  loadPlaylists();
}

async function updateCrossoverBatchSize(newSize) {
  const size = parseInt(newSize) || 3;
  await saveSettingsPartial({ crossoverBatchSize: size });
  loadPlaylists();
}

async function updateCrossoverDistType(distType) {
  await saveSettingsPartial({ crossoverDistributionType: distType });
  loadPlaylists();
}

async function updatePlaylistPercentage(playlistId, value) {
  const val = parseInt(value, 10);
  if (isNaN(val) || val < 0) return;
  try {
    const statusRes = await fetch('/api/status');
    const statusData = await statusRes.json();
    const currentPercentages = statusData.settings.crossoverPercentages || {};
    currentPercentages[playlistId] = val;
    await saveSettingsPartial({ crossoverPercentages: currentPercentages });
    showAdminToast(`Porcentaje guardado (${val}%)`, '📊');
  } catch (err) {
    console.error('Error guardando porcentaje de lista:', err);
  }
}

async function togglePlaylistInRotation(playlistId) {
  try {
    const statusRes = await fetch('/api/status');
    const statusData = await statusRes.json();
    let crossoverList = statusData.settings.crossoverPlaylists || [];

    // Si estaba vacía, inicialmente todas las listas estaban incluidas
    if (crossoverList.length === 0 && currentPlaylistsList.length > 0) {
      crossoverList = currentPlaylistsList.map(p => p.id);
    }

    if (crossoverList.includes(playlistId)) {
      crossoverList = crossoverList.filter(id => id !== playlistId);
    } else {
      crossoverList.push(playlistId);
    }

    await saveSettingsPartial({ crossoverPlaylists: crossoverList });
    loadPlaylists();
  } catch (err) {
    console.error('Error al alternar lista en rotación:', err);
  }
}

async function activatePlaylist(id) {
  await fetch(`/api/playlists/${id}/activate`, { method: 'POST' });
  loadPlaylists();
}

// 4.1 Modal y Funciones de Importación de Playlists
function openImportModal() {
  document.getElementById('multipleUrlsInput').value = '';
  document.getElementById('searchChannelPlaylistInput').value = '';
  document.getElementById('channelPlaylistsResults').innerHTML = '<p class="text-xs text-gray-500 text-center py-4">Escribe el nombre de tu canal o bar arriba para buscar tus listas.</p>';
  switchImportTab('links');
  document.getElementById('importPlaylistsModal').classList.remove('hidden');
}

function closeImportModal() {
  document.getElementById('importPlaylistsModal').classList.add('hidden');
}

function switchImportTab(tab) {
  const btnLinks = document.getElementById('importTabBtnLinks');
  const btnSearch = document.getElementById('importTabBtnSearch');
  const viewLinks = document.getElementById('importViewLinks');
  const viewSearch = document.getElementById('importViewSearch');

  if (tab === 'links') {
    btnLinks.className = 'pb-2 border-b-2 border-amber-400 text-amber-400';
    btnSearch.className = 'pb-2 border-b-2 border-transparent text-gray-400 hover:text-white';
    viewLinks.classList.remove('hidden');
    viewSearch.classList.add('hidden');
  } else {
    btnSearch.className = 'pb-2 border-b-2 border-amber-400 text-amber-400';
    btnLinks.className = 'pb-2 border-b-2 border-transparent text-gray-400 hover:text-white';
    viewSearch.classList.remove('hidden');
    viewLinks.classList.add('hidden');
  }
}

async function executeImportMultiple() {
  const input = document.getElementById('multipleUrlsInput').value;
  const urls = input.split(/[\n,]+/).map(u => u.trim()).filter(u => u.length > 0);

  if (urls.length === 0) {
    return alert('Pega al menos un enlace de lista de YouTube.');
  }

  const btn = document.getElementById('btnImportMultiple');
  btn.disabled = true;
  btn.innerHTML = `<span>⏳</span> Importando ${urls.length} lista(s)... Por favor espera`;

  try {
    const res = await fetch('/api/playlists/import-multiple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al importar listas');

    let msg = `¡Se importaron con éxito ${data.totalImported} lista(s) a Santa Chela!`;
    if (data.errors && data.errors.length > 0) {
      msg += `\n(${data.errors.length} lista(s) no se pudieron leer, verifica que sean públicas).`;
    }
    alert(msg);
    closeImportModal();
    loadPlaylists();
  } catch (err) {
    alert(err.message || 'Error al importar.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Importar Todas las Listas Ahora';
  }
}

async function executeSearchPlaylists() {
  const input = document.getElementById('searchChannelPlaylistInput');
  const query = input.value.trim();
  if (!query) return;

  const resultsBox = document.getElementById('channelPlaylistsResults');
  resultsBox.innerHTML = `<p class="text-xs text-gray-400 text-center py-4">Buscando playlists en YouTube...</p>`;

  try {
    const res = await fetch(`/api/playlists/search-youtube?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const playlists = data.playlists || [];

    if (playlists.length === 0) {
      resultsBox.innerHTML = `<p class="text-xs text-gray-500 text-center py-4">No se encontraron listas públicas con ese nombre. Intenta con otro término o pega los links directos.</p>`;
      return;
    }

    resultsBox.innerHTML = playlists.map((p) => `
      <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5 hover:border-amber-500/30 transition text-xs">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <img src="${p.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100'}" class="w-12 h-9 rounded object-cover">
          <div class="min-w-0 flex-1">
            <p class="font-bold text-white truncate">${escapeHtml(p.title)}</p>
            <p class="text-[10px] text-gray-400 truncate">${escapeHtml(p.author)} • <span class="text-amber-400 font-semibold">${p.videoCount} canciones</span></p>
          </div>
        </div>
        <button onclick="importFoundPlaylist('${p.url}', this)" class="btn-primary text-xs py-1.5 px-3 whitespace-nowrap ml-2">
          + Importar
        </button>
      </div>
    `).join('');
  } catch (err) {
    resultsBox.innerHTML = `<p class="text-xs text-red-400 text-center py-4">Error al buscar playlists.</p>`;
  }
}

async function importFoundPlaylist(url, btnElement) {
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = 'Importando...';
  }

  try {
    const res = await fetch('/api/playlists/import-youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(`¡Lista "${data.playlist.name}" importada con éxito (${data.playlist.tracks.length} temas)!`);
    loadPlaylists();
    if (btnElement) {
      btnElement.textContent = 'Importada';
      btnElement.className = 'btn-secondary text-xs py-1.5 px-3 opacity-60';
    }
  } catch (err) {
    alert(err.message || 'No se pudo importar la lista.');
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = '+ Importar';
    }
  }
}

// 5. Generador con IA (Gemini)
async function generatePlaylistAI() {
  const prompt = document.getElementById('aiPromptInput').value.trim();
  if (!prompt) return alert('Escribe una instrucción para la IA.');

  const btn = document.getElementById('generateAIBtn');
  btn.disabled = true;
  btn.innerHTML = `<span>⏳</span> Buscando y armando las mejores canciones...`;

  try {
    const res = await fetch('/api/playlists/ai-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    generatedTracksFromAI = data.tracks || [];

    const resultsBox = document.getElementById('aiGeneratedResults');
    const tracksList = document.getElementById('aiTracksList');
    resultsBox.classList.remove('hidden');

    tracksList.innerHTML = generatedTracksFromAI.map((t, idx) => `
      <div class="flex items-center gap-3 p-2 rounded-xl bg-white/5 border border-white/5 text-xs">
        <span class="font-bold text-amber-400">#${idx + 1}</span>
        <img src="${t.thumbnail}" class="w-10 h-8 rounded object-cover">
        <div class="min-w-0 flex-1">
          <p class="font-bold text-white truncate">${escapeHtml(t.title)}</p>
          <p class="text-gray-400 truncate">${escapeHtml(t.artist)} • <span class="text-amber-400">${t.genre}</span></p>
        </div>
      </div>
    `).join('');
  } catch (err) {
    alert(err.message || 'Error generando lista');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Generar Lista Automática con IA';
  }
}

async function saveAIGeneratedPlaylist() {
  if (generatedTracksFromAI.length === 0) return;
  const name = prompt('Nombre para la nueva lista:', 'Lista IA ' + new Date().toLocaleDateString());
  if (!name) return;

  await fetch('/api/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: 'Generada automáticamente con DJ IA',
      tracks: generatedTracksFromAI
    })
  });

  alert('¡Lista guardada con éxito!');
  document.getElementById('aiGeneratedResults').classList.add('hidden');
  document.getElementById('aiPromptInput').value = '';
  loadPlaylists();
  switchTab('playlists');
}

// 6. Tendencias e Historial
async function loadTrends() {
  try {
    const [trendsRes, histRes] = await Promise.all([
      fetch('/api/trends'),
      fetch('/api/history')
    ]);

    const { topSongs, topGenres } = await trendsRes.json();
    const { history } = await histRes.json();

    // Top Canciones
    const topSongsEl = document.getElementById('topSongsList');
    if (topSongs && topSongs.length > 0) {
      topSongsEl.innerHTML = topSongs.map((s, i) => `
        <div class="flex items-center justify-between p-2 rounded-lg bg-white/5">
          <span class="font-medium truncate flex-1">${i + 1}. ${escapeHtml(s.title)}</span>
          <span class="font-bold text-amber-400 ml-2">${s.count} pedidos</span>
        </div>
      `).join('');
    } else {
      topSongsEl.innerHTML = `<p class="text-gray-500">Aún no hay historial suficiente hoy.</p>`;
    }

    // Top Géneros
    const topGenresEl = document.getElementById('topGenresList');
    if (topGenres && topGenres.length > 0) {
      topGenresEl.innerHTML = topGenres.map(g => `
        <div class="flex items-center justify-between p-2 rounded-lg bg-white/5">
          <span class="font-medium">${g.genre}</span>
          <span class="font-bold text-amber-400">${g.count} canciones</span>
        </div>
      `).join('');
    } else {
      topGenresEl.innerHTML = `<p class="text-gray-500">Aún no hay datos de géneros.</p>`;
    }

    // Historial
    const histEl = document.getElementById('historyList');
    if (history && history.length > 0) {
      histEl.innerHTML = history.map(h => `
        <div class="flex items-center justify-between p-2 rounded-lg bg-white/5">
          <div class="min-w-0 flex-1">
            <p class="font-bold text-white truncate">${escapeHtml(h.title)} - ${escapeHtml(h.artist)}</p>
            <p class="text-[10px] text-gray-400">${h.requestedBy?.table ? 'Mesa ' + h.requestedBy.table : 'Lista Base'}</p>
          </div>
          <span class="genre-badge genre-${h.genre || 'Crossover'} text-[10px] py-0.5 px-2">${h.genre}</span>
        </div>
      `).join('');
    } else {
      histEl.innerHTML = `<p class="text-gray-500">El historial está vacío.</p>`;
    }
  } catch (err) {
    console.error('Error cargando tendencias:', err);
  }
}

// 7. Guardar Ajustes
async function saveSettings() {
  const barName = document.getElementById('settingBarName').value.trim();
  const maxRequestsPerTable = parseInt(document.getElementById('settingMaxRequests').value) || 2;
  const smartSlottingWindow = parseInt(document.getElementById('settingWindow').value) || 3;
  const totalTables = parseInt(document.getElementById('settingTotalTables').value) || 20;
  const autoDJEnabled = document.getElementById('settingAutoDJ').checked;
  const geminiApiKey = document.getElementById('settingApiKey').value.trim();
  const requestMode = document.getElementById('settingRequestMode')?.value || 'open';
  const fadeTransitionEnabled = document.getElementById('settingFadeTransition')?.checked !== false;
  const maxSongDurationVal = document.getElementById('settingMaxSongDuration')?.value;
  const maxSongDuration = maxSongDurationVal !== undefined && !isNaN(parseInt(maxSongDurationVal, 10)) ? parseInt(maxSongDurationVal, 10) : 0;
  const dynamicDurationOnQueue = document.getElementById('settingDynamicDuration')?.checked === true;
  const genreBatchSize = parseInt(document.getElementById('settingGenreBatchSize')?.value || 3);

  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      barName,
      maxRequestsPerTable,
      smartSlottingWindow,
      totalTables,
      autoDJEnabled,
      geminiApiKey,
      requestMode,
      fadeTransitionEnabled,
      maxSongDuration,
      dynamicDurationOnQueue,
      genreBatchSize
    })
  });

  alert('¡Ajustes guardados correctamente!');
}

// 8. Navegación de Pestañas de la Barra Lateral
function switchTab(tabId) {
  const tabs = {
    queue: { btn: 'tabBtnQueue', content: 'tabContentQueue' },
    playlists: { btn: 'tabBtnPlaylists', content: 'tabContentPlaylists' },
    control: { btn: 'tabBtnControl', content: 'tabContentControl' },
    ai: { btn: 'tabBtnAI', content: 'tabContentAI' },
    stats: { btn: 'tabBtnStats', content: 'tabContentStats' },
    settings: { btn: 'tabBtnSettings', content: 'tabContentSettings' }
  };

  Object.entries(tabs).forEach(([id, ids]) => {
    const btn = document.getElementById(ids.btn);
    const content = document.getElementById(ids.content);
    if (!btn || !content) return;

    if (id === tabId) {
      btn.className = 'w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.15)]';
      content.classList.remove('hidden');
    } else {
      btn.className = 'w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/5 border border-transparent transition';
      content.classList.add('hidden');
    }
  });

  // Cerrar sidebar en dispositivos móviles si estaba abierta
  const sidebar = document.getElementById('adminSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
    sidebar.classList.add('-translate-x-full');
    backdrop?.classList.add('hidden');
  }

  if (tabId === 'playlists') loadPlaylists();
  if (tabId === 'stats') loadTrends();
  if (tabId === 'control') {
    loadBannedTables();
    loadPlaylists();
  }
}

// ==============================================
// 8.2 CONTROL DE MESAS (BANEO / PAUSA)
// ==============================================
async function loadBannedTables() {
  try {
    const res = await fetch('/api/admin/banned-tables');
    const data = await res.json();
    renderBannedTables(data.bannedTables || {});
  } catch (err) {
    console.error('Error cargando mesas pausadas:', err);
  }
}

function renderBannedTables(banned) {
  const listEl = document.getElementById('bannedTablesList');
  if (!listEl) return;
  const entries = Object.entries(banned || {});
  if (entries.length === 0) {
    listEl.innerHTML = '<p class="text-xs text-gray-500 py-2">No hay ninguna mesa pausada actualmente.</p>';
    return;
  }

  listEl.innerHTML = entries.map(([table, mins]) => `
    <div class="flex items-center justify-between p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
      <div class="flex items-center gap-2">
        <span class="font-bold text-red-400">Mesa ${escapeHtml(table)}</span>
        <span class="text-gray-400 text-[11px]">(${mins} min restantes)</span>
      </div>
      <button onclick="unbanTable('${escapeHtml(table)}')" class="btn-primary text-[10px] py-1 px-2.5 bg-green-600 hover:bg-green-700">
        Desbloquear
      </button>
    </div>
  `).join('');
}

async function executeBanTable() {
  const tableInput = document.getElementById('banTableInput');
  const minsSelect = document.getElementById('banTableMinutes');
  const table = tableInput.value.trim();
  const minutes = parseInt(minsSelect.value) || 30;

  if (!table) return alert('Por favor escribe el número de la mesa.');

  try {
    const res = await fetch('/api/admin/ban-table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, minutes })
    });
    const data = await res.json();
    renderBannedTables(data.bannedTables);
    tableInput.value = '';
    alert(`Mesa ${table} pausada por ${minutes} minutos.`);
  } catch (err) {
    alert('Error al pausar mesa');
  }
}

async function banTableDirect(table) {
  if (!confirm(`¿Deseas pausar temporalmente los pedidos de la Mesa ${table} por 30 minutos?`)) return;
  try {
    const res = await fetch('/api/admin/ban-table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, minutes: 30 })
    });
    const data = await res.json();
    renderBannedTables(data.bannedTables);
    alert(`Mesa ${table} pausada por 30 minutos.`);
  } catch (err) {
    alert('Error al pausar mesa');
  }
}

async function unbanTable(table) {
  try {
    const res = await fetch('/api/admin/unban-table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table })
    });
    const data = await res.json();
    renderBannedTables(data.bannedTables);
  } catch (err) {
    alert('Error al desbloquear mesa');
  }
}

// ==============================================
// 8.3 FILTRO ANTI-TROLLS / PALABRAS PROHIBIDAS
// ==============================================
let currentBlacklistWords = [];

function renderBlacklistWords(words) {
  currentBlacklistWords = words || [];
  const container = document.getElementById('blacklistWordsTags');
  if (!container) return;
  if (currentBlacklistWords.length === 0) {
    container.innerHTML = '<p class="text-xs text-gray-500 py-2">No hay términos prohibidos.</p>';
    return;
  }

  container.innerHTML = currentBlacklistWords.map(w => `
    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-xs">
      <span>${escapeHtml(w)}</span>
      <button onclick="removeBlacklistWord('${escapeHtml(w)}')" class="text-red-400 hover:text-white font-bold ml-1">✕</button>
    </span>
  `).join('');
}

async function addBlacklistWord() {
  const input = document.getElementById('newBlacklistWordInput');
  const word = input.value.trim().toLowerCase();
  if (!word) return;
  if (currentBlacklistWords.includes(word)) return alert('Esta palabra ya se encuentra en la lista.');

  const updated = [...currentBlacklistWords, word];
  await saveSettingsPartial({ blacklistWords: updated });
  input.value = '';
  renderBlacklistWords(updated);
}

async function removeBlacklistWord(word) {
  const updated = currentBlacklistWords.filter(w => w !== word);
  await saveSettingsPartial({ blacklistWords: updated });
  renderBlacklistWords(updated);
}

// ==============================================
// 8.4 CINTA DE PROMOCIONES EN TV
// ==============================================
let currentPromos = [];

function renderPromosList(promos) {
  currentPromos = promos || [];
  const container = document.getElementById('promosAdminList');
  if (!container) return;
  if (currentPromos.length === 0) {
    container.innerHTML = '<p class="text-xs text-gray-500 py-2">No hay mensajes de promoción configurados.</p>';
    return;
  }

  container.innerHTML = currentPromos.map((p, idx) => `
    <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5">
      <span class="text-xs text-white truncate flex-1">${escapeHtml(p)}</span>
      <button onclick="removePromoMessage(${idx})" class="text-red-400 hover:text-red-300 ml-2 text-xs font-bold px-2 py-1">✕</button>
    </div>
  `).join('');
}

async function addPromoMessage() {
  const input = document.getElementById('newPromoInput');
  const text = input.value.trim();
  if (!text) return;

  const updated = [...currentPromos, text];
  await saveSettingsPartial({ promos: updated });
  input.value = '';
  renderPromosList(updated);
}

async function removePromoMessage(idx) {
  const updated = currentPromos.filter((_, i) => i !== idx);
  await saveSettingsPartial({ promos: updated });
  renderPromosList(updated);
}

// ==============================================
// 8.5 RELOJ DE HORARIOS MUSICALES AUTOMÁTICOS
// ==============================================
let currentSchedule = [];
let currentPlaylistsList = [];

function renderSchedule(schedule, scheduleEnabled) {
  currentSchedule = schedule || [];
  const checkEl = document.getElementById('settingScheduleEnabled');
  if (checkEl) checkEl.checked = !!scheduleEnabled;

  const listEl = document.getElementById('scheduleBlocksList');
  if (!listEl) return;

  if (currentSchedule.length === 0) {
    listEl.innerHTML = '<p class="text-xs text-gray-500 py-2">No hay bloques de horario configurados.</p>';
    return;
  }

  listEl.innerHTML = currentSchedule.map((b, idx) => {
    const pl = currentPlaylistsList.find(p => p.id === b.playlistId);
    const plName = pl ? pl.name : b.playlistId;
    return `
      <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold text-amber-400 font-mono">${escapeHtml(b.start)} - ${escapeHtml(b.end)}</span>
            <span class="font-semibold text-white">${escapeHtml(b.name || 'Tanda')}</span>
          </div>
          <p class="text-[11px] text-gray-400 mt-0.5">Lista: <span class="text-gray-300 font-medium">${escapeHtml(plName)}</span></p>
        </div>
        <button onclick="removeScheduleBlock(${idx})" class="btn-secondary text-xs py-1 px-2.5 text-red-400 hover:text-red-300">
          Eliminar
        </button>
      </div>
    `;
  }).join('');

  populateSchedulePlaylistsDropdown();
}

function populateSchedulePlaylistsDropdown() {
  const sel = document.getElementById('newSchedulePlaylistSelect');
  if (!sel) return;
  sel.innerHTML = currentPlaylistsList.map(p => `
    <option value="${p.id}">${escapeHtml(p.name)} (${p.tracks?.length || 0} canciones)</option>
  `).join('');
}

async function toggleScheduleEnabled(checked) {
  await saveSettingsPartial({ scheduleEnabled: checked });
}

async function addScheduleBlock() {
  const start = document.getElementById('newScheduleStart').value.trim();
  const end = document.getElementById('newScheduleEnd').value.trim();
  const name = document.getElementById('newScheduleName').value.trim();
  const playlistId = document.getElementById('newSchedulePlaylistSelect').value;

  if (!start || !end) return alert('Ingresa horario de inicio y fin.');
  if (!name) return alert('Ingresa un nombre para la tanda.');
  if (!playlistId) return alert('Selecciona una lista base.');

  const newBlock = { start, end, name, playlistId };
  const updated = [...currentSchedule, newBlock];
  await saveSettingsPartial({ schedule: updated });
  document.getElementById('newScheduleName').value = '';
  renderSchedule(updated, document.getElementById('settingScheduleEnabled').checked);
}

async function removeScheduleBlock(idx) {
  const updated = currentSchedule.filter((_, i) => i !== idx);
  await saveSettingsPartial({ schedule: updated });
  renderSchedule(updated, document.getElementById('settingScheduleEnabled').checked);
}

async function saveSettingsPartial(partial) {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial)
    });
    return await res.json();
  } catch (err) {
    console.error('Error guardando configuración parcial:', err);
  }
}

// 9. Modales de Creación y Edición de Listas
let newCustomPlaylistTracks = [];
let tempSearchResultsForPlaylist = [];

function openNewPlaylistModal() {
  newCustomPlaylistTracks = [];
  tempSearchResultsForPlaylist = [];
  document.getElementById('newPlaylistName').value = '';
  document.getElementById('newPlaylistDesc').value = '';
  document.getElementById('playlistSearchSongInput').value = '';
  document.getElementById('playlistSearchResults').innerHTML = '';
  document.getElementById('playlistSearchResults').classList.add('hidden');
  renderModalAddedTracks();
  document.getElementById('newPlaylistModal').classList.remove('hidden');
}

function closeNewPlaylistModal() {
  document.getElementById('newPlaylistModal').classList.add('hidden');
}

async function searchSongForPlaylist() {
  const input = document.getElementById('playlistSearchSongInput');
  const query = input.value.trim();
  if (!query) return;

  const resultsBox = document.getElementById('playlistSearchResults');
  resultsBox.classList.remove('hidden');
  resultsBox.innerHTML = `<p class="text-xs text-gray-400 py-2">Buscando...</p>`;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    tempSearchResultsForPlaylist = data.results || [];

    if (tempSearchResultsForPlaylist.length === 0) {
      resultsBox.innerHTML = `<p class="text-xs text-gray-500 py-2">No se encontraron resultados.</p>`;
      return;
    }

    resultsBox.innerHTML = tempSearchResultsForPlaylist.slice(0, 4).map((v, i) => `
      <div class="flex items-center justify-between p-2 rounded-lg bg-black/40 border border-white/5 text-xs">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <img src="${v.thumbnail}" class="w-9 h-7 rounded object-cover">
          <div class="min-w-0 flex-1">
            <p class="font-bold text-white truncate">${escapeHtml(v.title)}</p>
            <p class="text-[10px] text-gray-400 truncate">${escapeHtml(v.artist)} • ${v.duration}</p>
          </div>
        </div>
        <button onclick="addTrackToModalList(${i})" class="btn-primary text-[11px] py-1 px-2.5 ml-2">
          + Agregar
        </button>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

function addTrackToModalList(index) {
  const track = tempSearchResultsForPlaylist[index];
  if (!track) return;

  const plName = document.getElementById('newPlaylistName')?.value || '';
  let detectedGenre = 'Crossover';
  const fullText = `${track.title} ${track.artist} ${plName}`.toLowerCase();
  if (/salsa|son|guaguanco/i.test(fullText)) detectedGenre = 'Salsa';
  else if (/cantina|despecho|popular|ranchera|guaro/i.test(fullText)) detectedGenre = 'Popular';
  else if (/vallenato|acordeon|parranda/i.test(fullText)) detectedGenre = 'Vallenato';
  else if (/reggae|perreo|urbano|dembow|blessd|feid|bad bunny|baile/i.test(fullText)) detectedGenre = 'Reggaetón';
  else if (/rock|pop|metal|indie/i.test(fullText)) detectedGenre = 'Rock / Pop';

  newCustomPlaylistTracks.push({
    videoId: track.videoId,
    title: track.title,
    artist: track.artist,
    genre: detectedGenre,
    duration: track.duration,
    thumbnail: track.thumbnail
  });

  renderModalAddedTracks();
}

function removeTrackFromModalList(index) {
  newCustomPlaylistTracks.splice(index, 1);
  renderModalAddedTracks();
}

function renderModalAddedTracks() {
  const countEl = document.getElementById('modalTrackCount');
  const listEl = document.getElementById('modalAddedTracks');

  countEl.textContent = newCustomPlaylistTracks.length;

  if (newCustomPlaylistTracks.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-gray-500 py-3 text-center">Aún no has agregado canciones. Busca arriba para agregar.</p>`;
    return;
  }

  listEl.innerHTML = newCustomPlaylistTracks.map((t, idx) => `
    <div class="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5 text-xs">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <span class="text-gray-400 font-mono text-[10px]">#${idx + 1}</span>
        <img src="${t.thumbnail}" class="w-8 h-6 rounded object-cover">
        <div class="min-w-0 flex-1">
          <p class="font-bold text-white truncate text-[11px]">${escapeHtml(t.title)}</p>
          <p class="text-[10px] text-gray-400 truncate">${escapeHtml(t.artist)}</p>
        </div>
      </div>
      <button onclick="removeTrackFromModalList(${idx})" class="text-red-400 hover:text-red-300 ml-2 text-xs">✕</button>
    </div>
  `).join('');
}

async function saveCustomNewPlaylist() {
  const name = document.getElementById('newPlaylistName').value.trim();
  const description = document.getElementById('newPlaylistDesc').value.trim();

  if (!name) return alert('Por favor ingresa un nombre para la lista.');

  try {
    const res = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        tracks: newCustomPlaylistTracks || []
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    closeNewPlaylistModal();
    await loadPlaylists();
    alert('¡Lista creada y guardada con éxito!');

    // Si la lista se creó sin canciones, abrir de una vez el editor para agregar canciones
    if (newCustomPlaylistTracks.length === 0 && data.playlist && data.playlist.id) {
      viewPlaylistTracks(data.playlist.id);
    }
  } catch (err) {
    alert(err.message || 'No se pudo guardar la lista.');
  }
}

// 10. Ver y Editar temas de una lista existente
let currentViewingPlaylistId = null;

async function viewPlaylistTracks(playlistId) {
  try {
    currentViewingPlaylistId = playlistId;
    const res = await fetch('/api/playlists');
    const data = await res.json();
    const playlist = (data.playlists || []).find(p => p.id === playlistId);

    if (!playlist) return;

    document.getElementById('viewPlaylistTitle').textContent = playlist.name;
    document.getElementById('viewPlaylistDesc').textContent = playlist.description || '';
    document.getElementById('viewPlaylistTrackCount').textContent = `${playlist.tracks ? playlist.tracks.length : 0} temas`;

    // Limpiar buscador de temas dentro del modal
    document.getElementById('addSongToPlaylistInput').value = '';
    document.getElementById('addSongToPlaylistResults').innerHTML = '';
    document.getElementById('addSongToPlaylistResults').classList.add('hidden');

    renderPlaylistTracksInModal(playlist);

    document.getElementById('viewPlaylistModal').classList.remove('hidden');
  } catch (err) {
    console.error(err);
  }
}

function renderPlaylistTracksInModal(playlist) {
  const listEl = document.getElementById('viewPlaylistTracksList');
  if (!playlist.tracks || playlist.tracks.length === 0) {
    listEl.innerHTML = `<p class="text-gray-500 py-6 text-center text-xs">Esta lista no tiene canciones aún. Usa el buscador de arriba para agregar temas.</p>`;
    return;
  }

  const genres = ['Salsa', 'Popular', 'Vallenato', 'Reggaetón', 'Merengue / Bachata', 'Rock / Pop', 'Crossover'];

  listEl.innerHTML = playlist.tracks.map((t, idx) => {
    const currentGenre = t.genre || 'Crossover';
    const genreOptions = genres.map(g => `<option value="${g}" ${g === currentGenre ? 'selected' : ''}>${g}</option>`).join('');

    return `
      <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition gap-2">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <span class="font-bold text-amber-400 text-xs w-5">#${idx + 1}</span>
          <img src="${t.thumbnail}" class="w-12 h-9 rounded-lg object-cover">
          <div class="min-w-0 flex-1">
            <p class="font-bold text-white text-xs truncate">${escapeHtml(t.title)}</p>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-[10px] text-gray-400 truncate max-w-[130px] sm:max-w-[180px]">${escapeHtml(t.artist)}</span>
              <select onchange="changeTrackGenre(${idx}, this.value)" class="bg-black/70 border border-white/20 rounded px-1.5 py-0.5 text-[10px] text-amber-400 font-semibold outline-none cursor-pointer hover:border-amber-400/50" title="Cambiar género de esta canción">
                ${genreOptions}
              </select>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button onclick="adminAddTrackFromPlaylistModal(${idx})" class="btn-secondary text-[11px] py-1.5 px-2 text-amber-400 font-semibold border-amber-400/30 hover:bg-amber-400/10" title="Agregar a la cola de espera">
            + Cola
          </button>
          <button onclick="playNowDirect('${t.videoId}', '${escapeHtml(t.title)}', '${escapeHtml(t.artist)}', '${currentGenre}'); closeViewPlaylistModal();" class="btn-primary text-[11px] py-1.5 px-2.5">
            Sonar Ya
          </button>
          <button onclick="removeTrackFromPlaylist(${idx})" class="btn-secondary text-[11px] py-1.5 px-2 text-red-400 hover:text-red-300 border-red-500/20" title="Quitar de esta lista">
            Quitar
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function adminAddTrackFromPlaylistModal(trackIndex) {
  if (!currentViewingPlaylistId) return;
  const pl = currentPlaylistsList.find(p => p.id === currentViewingPlaylistId);
  if (!pl || !pl.tracks || !pl.tracks[trackIndex]) return;
  const t = pl.tracks[trackIndex];
  adminAddSongToQueue(t.videoId, t.title, t.artist, t.duration || '3:30', t.thumbnail || '');
}

// Cambiar género de una canción en la lista abierta actualmente
async function changeTrackGenre(trackIndex, newGenre) {
  if (!currentViewingPlaylistId) return;
  try {
    const res = await fetch(`/api/playlists/${currentViewingPlaylistId}/tracks/${trackIndex}/genre`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genre: newGenre })
    });
    if (!res.ok) throw new Error('Error al actualizar género');
    loadPlaylists();
  } catch (err) {
    console.error('Error cambiando género:', err);
  }
}

// Auto-clasificar todos los temas de la lista abierta
async function autoClassifyCurrentPlaylist() {
  if (!currentViewingPlaylistId) return;
  try {
    const res = await fetch(`/api/playlists/${currentViewingPlaylistId}/auto-classify`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success && data.playlist) {
      renderPlaylistTracksInModal(data.playlist);
      loadPlaylists();
      alert(`¡Listo! Se actualizaron ${data.updatedCount} canciones con su género detectado.`);
    }
  } catch (err) {
    alert('Error al auto-clasificar lista');
  }
}

// Auto-clasificar todas las listas del bar
async function autoClassifyAllPlaylists() {
  try {
    const res = await fetch('/api/playlists/auto-classify-all', {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      loadPlaylists();
      alert(`¡Listo! Se auto-detectaron y actualizaron los géneros de ${data.updatedCount} canciones en todas tus listas.`);
    }
  } catch (err) {
    alert('Error al auto-clasificar todas las listas');
  }
}

// Buscar canción para agregar a la lista abierta actualmente
async function searchSongToAddToCurrentPlaylist() {
  const input = document.getElementById('addSongToPlaylistInput');
  const query = input.value.trim();
  if (!query) return;

  const resultsBox = document.getElementById('addSongToPlaylistResults');
  resultsBox.classList.remove('hidden');
  resultsBox.innerHTML = `<p class="text-xs text-gray-400 py-2">Buscando en YouTube...</p>`;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const videos = data.results || [];

    if (videos.length === 0) {
      resultsBox.innerHTML = `<p class="text-xs text-gray-500 py-2">No se encontraron canciones.</p>`;
      return;
    }

    resultsBox.innerHTML = videos.slice(0, 5).map(v => `
      <div class="flex items-center justify-between p-2 rounded-xl bg-black/50 border border-white/5 text-xs">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <img src="${v.thumbnail}" class="w-10 h-7 rounded object-cover">
          <div class="min-w-0 flex-1">
            <p class="font-bold text-white truncate text-[11px]">${escapeHtml(v.title)}</p>
            <p class="text-[10px] text-gray-400 truncate">${escapeHtml(v.artist)} • ${v.duration}</p>
          </div>
        </div>
        <button onclick="addTrackToCurrentPlaylistDirect('${v.videoId}', '${escapeHtml(v.title)}', '${escapeHtml(v.artist)}', '${v.duration}', '${v.thumbnail}')" class="btn-primary text-[11px] py-1 px-3 ml-2 font-bold whitespace-nowrap">
          + Agregar
        </button>
      </div>
    `).join('');
  } catch (err) {
    resultsBox.innerHTML = `<p class="text-xs text-red-400 py-2">Error al buscar canciones.</p>`;
  }
}

// Agregar canción a la lista abierta
async function addTrackToCurrentPlaylistDirect(videoId, title, artist, duration, thumbnail) {
  if (!currentViewingPlaylistId) return;

  try {
    const res = await fetch(`/api/playlists/${currentViewingPlaylistId}/tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        title,
        artist,
        duration,
        thumbnail,
        genre: 'Crossover'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Refrescar modal y grid de listas
    document.getElementById('viewPlaylistTrackCount').textContent = `${data.playlist.tracks.length} temas`;
    renderPlaylistTracksInModal(data.playlist);
    document.getElementById('addSongToPlaylistResults').classList.add('hidden');
    document.getElementById('addSongToPlaylistInput').value = '';
    loadPlaylists();
  } catch (err) {
    alert(err.message || 'Error al agregar canción');
  }
}

// Quitar canción de la lista abierta
async function removeTrackFromPlaylist(index) {
  if (!currentViewingPlaylistId) return;

  try {
    const res = await fetch(`/api/playlists/${currentViewingPlaylistId}/tracks/${index}`, {
      method: 'DELETE'
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Refrescar modal y grid de listas
    document.getElementById('viewPlaylistTrackCount').textContent = `${data.playlist.tracks.length} temas`;
    renderPlaylistTracksInModal(data.playlist);
    loadPlaylists();
  } catch (err) {
    alert(err.message || 'Error al quitar canción');
  }
}

// Eliminar lista abierta actualmente desde el modal
async function deleteCurrentOpenedPlaylist() {
  if (!currentViewingPlaylistId) return;
  const targetId = currentViewingPlaylistId;
  const title = document.getElementById('viewPlaylistTitle').textContent;
  if (!confirm(`¿Estás seguro de eliminar la lista "${title}" por completo?`)) return;

  try {
    const res = await fetch(`/api/playlists/${targetId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al eliminar');

    // Remover del respaldo local para que no reaparezca
    try {
      const localBackupRaw = localStorage.getItem('santachela_playlists_backup');
      if (localBackupRaw) {
        const list = JSON.parse(localBackupRaw).filter(p => p.id !== targetId);
        localStorage.setItem('santachela_playlists_backup', JSON.stringify(list));
      }
    } catch (e) {}

    closeViewPlaylistModal();
    loadPlaylists();
    alert(`Lista "${title}" eliminada.`);
  } catch (err) {
    alert('No se pudo eliminar la lista.');
  }
}

// Eliminar lista directamente desde su tarjeta
async function deletePlaylistDirect(playlistId, playlistName) {
  if (!confirm(`¿Estás seguro de eliminar la lista "${playlistName}"?`)) return;

  try {
    const res = await fetch(`/api/playlists/${playlistId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al eliminar');

    // Remover del respaldo local
    try {
      const localBackupRaw = localStorage.getItem('santachela_playlists_backup');
      if (localBackupRaw) {
        const list = JSON.parse(localBackupRaw).filter(p => p.id !== playlistId);
        localStorage.setItem('santachela_playlists_backup', JSON.stringify(list));
      }
    } catch (e) {}

    loadPlaylists();
  } catch (err) {
    alert('No se pudo eliminar la lista.');
  }
}

// Exportar respaldo de listas a un archivo JSON
function exportPlaylistsBackup() {
  if (!currentPlaylistsList || currentPlaylistsList.length === 0) {
    return alert('No hay listas para respaldar.');
  }

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentPlaylistsList, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `santachela_listas_backup_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

// Disparar selector de archivo para restaurar
function triggerImportBackup() {
  document.getElementById('importBackupFileInput').click();
}

// Leer archivo de respaldo y restaurarlo en el servidor
async function handleBackupFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed)) throw new Error('El archivo no tiene formato válido de listas.');

      const res = await fetch('/api/playlists/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlists: parsed })
      });

      if (!res.ok) throw new Error('Error al enviar listas al servidor');

      localStorage.setItem('santachela_playlists_backup', JSON.stringify(parsed));
      alert(`¡Se restauraron ${parsed.length} lista(s) exitosamente!`);
      loadPlaylists();
    } catch (err) {
      alert('Error al restaurar archivo: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function closeViewPlaylistModal() {
  document.getElementById('viewPlaylistModal').classList.add('hidden');
  currentViewingPlaylistId = null;
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

