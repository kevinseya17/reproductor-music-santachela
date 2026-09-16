const socket = io();

let currentQueueState = [];
let generatedTracksFromAI = [];

document.addEventListener('DOMContentLoaded', () => {
  setupSocket();
  loadInitialData();
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

    // Renderizar ajustes de control, filtro y promociones
    renderBlacklistWords(settings.blacklistWords);
    renderPromosList(settings.promos);
    renderSchedule(settings.schedule, settings.scheduleEnabled);
  }

  // Sonando Ahora
  if (currentlyPlaying) {
    document.getElementById('adminNowTitle').textContent = currentlyPlaying.title;
    document.getElementById('adminNowArtist').textContent = currentlyPlaying.artist;
    document.getElementById('adminNowThumb').src = currentlyPlaying.thumbnail;
    
    const genreEl = document.getElementById('adminNowGenre');
    genreEl.textContent = currentlyPlaying.genre;
    genreEl.className = `genre-badge genre-${currentlyPlaying.genre || 'Crossover'}`;

    const reqEl = document.getElementById('adminNowRequested');
    if (currentlyPlaying.requestedBy && currentlyPlaying.requestedBy.table) {
      const ded = currentlyPlaying.requestedBy.dedication ? ` | 🎂 "${escapeHtml(currentlyPlaying.requestedBy.dedication)}"` : '';
      reqEl.innerHTML = `• Pedida por: Mesa ${currentlyPlaying.requestedBy.table}${ded}`;
    } else {
      reqEl.textContent = `• Lista Base`;
    }
  }

  // Cola
  document.getElementById('queueCounter').textContent = currentQueueState.length;
  renderQueueList(currentQueueState);
}

function renderQueueList(queue) {
  const container = document.getElementById('adminQueueList');
  if (!queue || queue.length === 0) {
    container.innerHTML = `<p class="text-xs text-gray-500 py-6 text-center">La cola de pedidos está vacía. El reproductor está usando la Lista Base activa.</p>`;
    return;
  }

  container.innerHTML = queue.map((song, i) => `
    <div class="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/15 transition gap-4">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <span class="text-xs font-bold text-amber-400 w-5">#${i + 1}</span>
        <img src="${song.thumbnail}" class="w-12 h-10 rounded-lg object-cover">
        <div class="min-w-0">
          <p class="text-sm font-bold text-white truncate leading-tight">${escapeHtml(song.title)}</p>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-xs text-gray-400 truncate">${escapeHtml(song.artist)}</span>
            <span class="genre-badge genre-${song.genre || 'Crossover'} text-[10px] py-0.2 px-2">${song.genre}</span>
            <span class="text-[11px] text-amber-400/90 font-medium">📍 ${song.requestedBy?.name || 'Mesa'}</span>
          </div>
          ${song.requestedBy?.dedication ? `<p class="text-[11px] text-pink-300 font-medium italic mt-1 truncate">🎂 "${escapeHtml(song.requestedBy.dedication)}"</p>` : ''}
        </div>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        ${song.requestedBy?.table && song.requestedBy.table !== 'DJ' ? `
          <button onclick="banTableDirect('${escapeHtml(song.requestedBy.table)}')" class="btn-secondary text-xs px-2 py-1.5 text-amber-300 hover:text-amber-200 border-amber-500/30" title="Pausar pedidos de esta mesa">
            ⏸️ Mesa ${escapeHtml(song.requestedBy.table)}
          </button>
        ` : ''}
        <button onclick="moveQueueItem(${i}, -1)" ${i === 0 ? 'disabled class="opacity-30"' : 'class="btn-secondary text-xs px-2.5 py-1.5"'} title="Subir">↑</button>
        <button onclick="moveQueueItem(${i}, 1)" ${i === queue.length - 1 ? 'disabled class="opacity-30"' : 'class="btn-secondary text-xs px-2.5 py-1.5"'} title="Bajar">↓</button>
        <button onclick="playNowDirect('${song.videoId}', '${escapeHtml(song.title)}', '${escapeHtml(song.artist)}', '${song.genre}')" class="btn-primary text-xs py-1.5 px-3">Sonar Ya</button>
        <button onclick="removeQueueItem('${song.id}')" class="btn-secondary text-xs py-1.5 px-2.5 text-red-400 hover:text-red-300" title="Eliminar">✕</button>
      </div>
    </div>
  `).join('');
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

async function moveQueueItem(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= currentQueueState.length) return;

  const newQueue = [...currentQueueState];
  const item = newQueue.splice(index, 1)[0];
  newQueue.splice(newIndex, 0, item);

  await fetch('/api/admin/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue: newQueue })
  });
}

async function playNowDirect(videoId, title, artist, genre) {
  await fetch('/api/admin/play-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId, title, artist, genre })
  });
}

// 3. Búsqueda rápida de DJ
async function adminSearchSong() {
  const input = document.getElementById('adminSearchInput');
  const query = input.value.trim();
  if (!query) return;

  const resultsBox = document.getElementById('adminSearchResults');
  resultsBox.classList.remove('hidden');
  resultsBox.innerHTML = `<p class="text-xs text-gray-400 py-2">Buscando en YouTube...</p>`;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const videos = data.results || [];

    if (videos.length === 0) {
      resultsBox.innerHTML = `<p class="text-xs text-gray-500 py-2">No se encontraron resultados.</p>`;
      return;
    }

    resultsBox.innerHTML = videos.slice(0, 4).map(v => `
      <div class="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5">
        <div class="flex items-center gap-3 min-w-0">
          <img src="${v.thumbnail}" class="w-12 h-9 rounded object-cover">
          <div class="min-w-0">
            <p class="text-xs font-bold text-white truncate">${escapeHtml(v.title)}</p>
            <p class="text-[11px] text-gray-400 truncate">${escapeHtml(v.artist)} • ${v.duration}</p>
          </div>
        </div>
        <div class="flex gap-1.5 shrink-0">
          <button onclick="adminAddSongToQueue('${v.videoId}', '${escapeHtml(v.title)}', '${escapeHtml(v.artist)}', '${v.duration}', '${v.thumbnail}')" class="btn-secondary text-xs py-1.5 px-3">Agregar a Cola</button>
          <button onclick="playNowDirect('${v.videoId}', '${escapeHtml(v.title)}', '${escapeHtml(v.artist)}', 'Crossover')" class="btn-primary text-xs py-1.5 px-3">Sonar Ya</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

async function adminAddSongToQueue(videoId, title, artist, duration, thumbnail) {
  await fetch('/api/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      title,
      artist,
      duration,
      thumbnail,
      table: 'DJ',
      customerName: 'DJ / Bar'
    })
  });
  document.getElementById('adminSearchResults').classList.add('hidden');
  document.getElementById('adminSearchInput').value = '';
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

    const statusRes = await fetch('/api/status');
    const statusData = await statusRes.json();
    const activeId = statusData.settings.activePlaylistId;

    const grid = document.getElementById('playlistsGrid');
    grid.innerHTML = playlists.map(p => {
      const isActive = p.id === activeId;
      return `
        <div class="glass-card p-5 space-y-3 ${isActive ? 'border-amber-400/50 bg-amber-500/5' : ''}">
          <div class="flex items-start justify-between">
            <div>
              <h3 class="font-bold text-base text-white">${escapeHtml(p.name)}</h3>
              <p class="text-xs text-gray-400 mt-1">${escapeHtml(p.description || '')}</p>
            </div>
            ${isActive ? '<span class="genre-badge genre-Popular">Activa Ahora</span>' : ''}
          </div>

          <div class="text-xs text-gray-400">
            <span>🎵 ${p.tracks ? p.tracks.length : 0} temas listos</span>
          </div>

          <div class="pt-2 flex items-center gap-2">
            <button onclick="viewPlaylistTracks('${p.id}')" class="btn-secondary text-xs py-2 px-3 flex-1 font-semibold" title="Ver y editar canciones">
              ✏️ Ver y Editar (${p.tracks ? p.tracks.length : 0})
            </button>
            ${!isActive ? `<button onclick="activatePlaylist('${p.id}')" class="btn-primary text-xs py-2 px-3">Activar</button>` : '<button disabled class="btn-secondary text-xs py-2 px-3 opacity-50">Sonando</button>'}
            ${!isActive ? `<button onclick="deletePlaylistDirect('${p.id}', '${escapeHtml(p.name)}')" class="btn-secondary text-xs py-2 px-2.5 text-red-400 hover:text-red-300" title="Eliminar lista">🗑️</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error cargando listas:', err);
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
    btn.innerHTML = `<span>🚀</span> Importar Todas las Listas Ahora`;
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
      btnElement.textContent = '✓ Importada';
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
    btn.innerHTML = `<span>✨</span> Generar Lista Automática con IA`;
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

  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      barName,
      maxRequestsPerTable,
      smartSlottingWindow,
      totalTables,
      autoDJEnabled,
      geminiApiKey
    })
  });

  alert('¡Ajustes guardados correctamente!');
}

// 8. Navegación de Pestañas (Corrección de IDs de botones y contenido)
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
      btn.className = 'pb-3 border-b-2 border-amber-400 text-amber-400 flex items-center gap-2 font-bold whitespace-nowrap';
      content.classList.remove('hidden');
    } else {
      btn.className = 'pb-3 border-b-2 border-transparent text-gray-400 hover:text-white flex items-center gap-2 font-normal whitespace-nowrap';
      content.classList.add('hidden');
    }
  });

  if (tabId === 'playlists') loadPlaylists();
  if (tabId === 'stats') loadTrends();
  if (tabId === 'control') {
    loadBannedTables();
    loadPlaylists();
  }
}

// ==============================================
// 8.1 CONTROL DE MODO MICRÓFONO / ANUNCIO
// ==============================================
let isMicModeActive = false;

async function toggleMicMode() {
  try {
    const res = await fetch('/api/admin/mic-mode', { method: 'POST' });
    const data = await res.json();
    renderMicModeState(data.micModeActive);
  } catch (err) {
    console.error('Error al alternar modo micrófono:', err);
  }
}

function renderMicModeState(active) {
  isMicModeActive = !!active;
  const btn = document.getElementById('btnMicMode');
  const icon = document.getElementById('micModeIcon');
  const text = document.getElementById('micModeText');
  if (!btn) return;

  if (isMicModeActive) {
    btn.className = 'bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-3 py-1.5 rounded-xl flex items-center gap-1.5 animate-pulse shadow-lg shadow-red-500/30';
    if (icon) icon.textContent = '🔴';
    if (text) text.textContent = 'MIC ACTIVO (15% Vol)';
  } else {
    btn.className = 'btn-secondary text-xs flex items-center gap-1.5 transition-all duration-300';
    if (icon) icon.textContent = '🎙️';
    if (text) text.textContent = 'Modo Micrófono';
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
        🟢 Desbloquear
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

  newCustomPlaylistTracks.push({
    videoId: track.videoId,
    title: track.title,
    artist: track.artist,
    genre: 'Crossover',
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

  listEl.innerHTML = playlist.tracks.map((t, idx) => `
    <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition gap-2">
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        <span class="font-bold text-amber-400 text-xs w-5">#${idx + 1}</span>
        <img src="${t.thumbnail}" class="w-12 h-9 rounded-lg object-cover">
        <div class="min-w-0 flex-1">
          <p class="font-bold text-white text-xs truncate">${escapeHtml(t.title)}</p>
          <p class="text-[10px] text-gray-400 truncate">${escapeHtml(t.artist)} • <span class="text-amber-400">${t.genre || 'Crossover'}</span></p>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button onclick="playNowDirect('${t.videoId}', '${escapeHtml(t.title)}', '${escapeHtml(t.artist)}', '${t.genre || 'Crossover'}'); closeViewPlaylistModal();" class="btn-primary text-[11px] py-1.5 px-2.5">
          Sonar Ya
        </button>
        <button onclick="removeTrackFromPlaylist(${idx})" class="btn-secondary text-[11px] py-1.5 px-2 text-red-400 hover:text-red-300 border-red-500/20" title="Quitar de esta lista">
          🗑️ Quitar
        </button>
      </div>
    </div>
  `).join('');
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

