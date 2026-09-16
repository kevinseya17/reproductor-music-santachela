const socket = io();

let ytPlayer = null;
let currentVideoId = null;
let isPlayerReady = false;
let pendingVideoId = null;

// Configuración y estado de reproducción / DJ
let currentSettings = {
  fadeTransitionEnabled: true,
  maxSongDuration: 210, // 3:30 min por defecto
  dynamicDurationOnQueue: true
};
let currentQueue = [];
let currentlyPlayingSong = null;
let masterVolume = 100;
let isFading = false;
let activeFadeInterval = null;
let progressMonitorInterval = null;
let hasReportedSongEnded = false;
let isFadingInNewSong = false;
let savedVolumeBeforeMic = 100;

// 1. YouTube IFrame API Callback global
window.onYouTubeIframeAPIReady = function() {
  ytPlayer = new YT.Player('ytPlayer', {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 1,
      controls: 1,
      modestbranding: 1,
      rel: 0,
      fs: 1,
      iv_load_policy: 3
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    }
  });
};

function onPlayerReady(event) {
  isPlayerReady = true;
  masterVolume = ytPlayer.getVolume() || 100;
  event.target.playVideo();

  startProgressMonitor();
  startPromoRotation();

  if (pendingVideoId) {
    loadAndPlay(pendingVideoId);
    pendingVideoId = null;
  }
}

function onPlayerStateChange(event) {
  const playPauseIcon = document.getElementById('playPauseIcon');

  if (event.data === YT.PlayerState.ENDED) {
    if (!hasReportedSongEnded) {
      hasReportedSongEnded = true;
      console.log('Canción terminada por YouTube, solicitando siguiente...');
      socket.emit('song-ended');
    }
  } else if (event.data === YT.PlayerState.PLAYING) {
    if (playPauseIcon) playPauseIcon.textContent = '⏸️';

    // Si requiere Fade-In suave al iniciar la canción
    if (isFadingInNewSong && currentSettings.fadeTransitionEnabled !== false) {
      isFadingInNewSong = false;
      fadeVolume(0, masterVolume, 1800);
    }
  } else if (event.data === YT.PlayerState.PAUSED) {
    if (playPauseIcon) playPauseIcon.textContent = '▶️';
  }
}

function onPlayerError(event) {
  console.warn('Error en video de YouTube (código ' + event.data + '), saltando al siguiente...');
  setTimeout(() => {
    if (!hasReportedSongEnded) {
      hasReportedSongEnded = true;
      socket.emit('song-ended');
    }
  }, 1500);
}

function loadAndPlay(videoId) {
  if (!videoId) return;
  currentVideoId = videoId;
  hasReportedSongEnded = false;
  isFading = false;

  if (activeFadeInterval) {
    clearInterval(activeFadeInterval);
    activeFadeInterval = null;
  }

  // Preparar volumen para inicio suave (Fade In)
  if (currentSettings.fadeTransitionEnabled !== false) {
    isFadingInNewSong = true;
    if (isPlayerReady && ytPlayer && ytPlayer.setVolume) {
      ytPlayer.setVolume(0);
    }
  } else {
    isFadingInNewSong = false;
    if (isPlayerReady && ytPlayer && ytPlayer.setVolume) {
      ytPlayer.setVolume(masterVolume);
    }
  }

  if (isPlayerReady && ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById({
      videoId: videoId,
      suggestedQuality: 'hd1080'
    });
  } else {
    pendingVideoId = videoId;
  }
}

// 2. Controladores de Reproducción
function togglePlayPause() {
  if (!ytPlayer || !isPlayerReady) return;
  const state = ytPlayer.getPlayerState();
  if (state === YT.PlayerState.PLAYING) {
    ytPlayer.pauseVideo();
  } else {
    ytPlayer.playVideo();
  }
}

async function skipSong() {
  try {
    // Si la transición suave está activa, desvanecer rápido y saltar
    if (currentSettings.fadeTransitionEnabled !== false && ytPlayer && isPlayerReady) {
      fadeVolume(ytPlayer.getVolume(), 0, 700, async () => {
        await fetch('/api/admin/skip', { method: 'POST' });
      });
    } else {
      await fetch('/api/admin/skip', { method: 'POST' });
    }
  } catch (err) {
    console.error('Error saltando canción:', err);
  }
}

function setVolume(val) {
  masterVolume = val;
  if (ytPlayer && isPlayerReady && !isFading) {
    ytPlayer.setVolume(val);
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => console.log(err));
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

// 3. Monitor de Progreso, Límite de Duración y Fade-Out
function startProgressMonitor() {
  if (progressMonitorInterval) clearInterval(progressMonitorInterval);

  progressMonitorInterval = setInterval(() => {
    if (!ytPlayer || !isPlayerReady) return;
    if (hasReportedSongEnded) return;

    try {
      const state = ytPlayer.getPlayerState();
      if (state !== YT.PlayerState.PLAYING) return;

      const currentTime = ytPlayer.getCurrentTime();
      const duration = ytPlayer.getDuration();
      if (!duration || duration <= 0) return;

      // Calcular límite de duración configurado
      let targetMaxDuration = duration;
      const configuredMax = currentSettings.maxSongDuration || 0; // 0 = sin límite

      if (configuredMax > 0) {
        if (currentSettings.dynamicDurationOnQueue) {
          // Solo recortar si hay pedidos de clientes en cola o si el tema actual fue pedido por una mesa
          const hasPendingRequests = (currentQueue && currentQueue.length > 0) || (currentlyPlayingSong?.requestedBy?.table);
          if (hasPendingRequests) {
            targetMaxDuration = Math.min(configuredMax, duration);
          }
        } else {
          targetMaxDuration = Math.min(configuredMax, duration);
        }
      }

      const timeLeft = targetMaxDuration - currentTime;

      // Si quedan 6 segundos o menos para el límite/final y el fundido está activo
      if (currentSettings.fadeTransitionEnabled !== false && timeLeft <= 6 && timeLeft > 0.8) {
        if (!isFading) {
          isFading = true;
          const fadeDuration = Math.max(1200, Math.round(timeLeft * 1000));
          console.log(`Iniciando Fade Out suave de ${Math.round(timeLeft)}s...`);
          fadeVolume(ytPlayer.getVolume(), 0, fadeDuration, () => {
            if (!hasReportedSongEnded) {
              hasReportedSongEnded = true;
              isFading = false;
              console.log('Canción terminada con Fade Out, solicitando siguiente...');
              socket.emit('song-ended');
            }
          });
        }
      } else if (timeLeft <= 0.8 || currentTime >= targetMaxDuration) {
        // Fin de tiempo o fin de video sin fundido
        if (!hasReportedSongEnded) {
          hasReportedSongEnded = true;
          isFading = false;
          console.log('Tiempo límite cumplido, pasando al siguiente tema...');
          socket.emit('song-ended');
        }
      }
    } catch (e) {
      // Chequeos transitorios durante la carga del iframe
    }
  }, 400);
}

// 4. Fundido de Volumen (Fade Suave)
function fadeVolume(fromVol, targetVol, durationMs = 1500, onComplete = null) {
  if (!ytPlayer || !isPlayerReady) {
    if (onComplete) onComplete();
    return;
  }

  if (activeFadeInterval) {
    clearInterval(activeFadeInterval);
    activeFadeInterval = null;
  }

  const steps = 20;
  const stepTime = Math.max(20, Math.round(durationMs / steps));
  const volStep = (targetVol - fromVol) / steps;
  let currentStep = 0;

  ytPlayer.setVolume(Math.max(0, Math.min(100, Math.round(fromVol))));

  activeFadeInterval = setInterval(() => {
    currentStep++;
    const newVol = Math.round(fromVol + (volStep * currentStep));
    if (ytPlayer && isPlayerReady) {
      ytPlayer.setVolume(Math.max(0, Math.min(100, newVol)));
    }
    if (currentStep >= steps) {
      clearInterval(activeFadeInterval);
      activeFadeInterval = null;
      if (ytPlayer && isPlayerReady) {
        ytPlayer.setVolume(Math.max(0, Math.min(100, targetVol)));
      }
      if (onComplete) onComplete();
    }
  }, stepTime);
}

// 5. Sincronización en tiempo real vía Socket.io
socket.on('state-changed', (data) => {
  if (!data) return;
  const { currentlyPlaying, queue, settings } = data;

  if (settings) {
    currentSettings = { ...currentSettings, ...settings };
    if (settings.barName) {
      document.getElementById('barName').textContent = settings.barName;
    }
    if (settings.promos && Array.isArray(settings.promos)) {
      activePromos = settings.promos;
    }
  }

  currentQueue = queue || [];
  currentlyPlayingSong = currentlyPlaying;

  if (currentlyPlaying) {
    // Si la canción cambió, cargar el nuevo video
    if (currentlyPlaying.videoId && currentlyPlaying.videoId !== currentVideoId) {
      loadAndPlay(currentlyPlaying.videoId);
    }

    document.getElementById('currentTitle').textContent = currentlyPlaying.title || 'Música';
    document.getElementById('currentArtist').textContent = currentlyPlaying.artist || '';
    document.getElementById('currentThumb').src = currentlyPlaying.thumbnail || '';

    const genreEl = document.getElementById('currentGenre');
    genreEl.textContent = currentlyPlaying.genre || 'Música';
    genreEl.className = `genre-badge genre-${currentlyPlaying.genre || 'Crossover'}`;

    const reqBadge = document.getElementById('requestedByBadge');
    if (currentlyPlaying.requestedBy && currentlyPlaying.requestedBy.table) {
      reqBadge.textContent = `🎉 Pedida por Mesa ${currentlyPlaying.requestedBy.table}`;
      reqBadge.className = 'bg-amber-500 text-black font-extrabold text-xs px-3 py-1 rounded-full animate-pulse';
    } else {
      reqBadge.textContent = `✨ Lista Base del Bar`;
      reqBadge.className = 'bg-white/10 text-gray-300 font-medium text-xs px-3 py-1 rounded-full';
    }

    // Dedicatoria especial en TV
    const dedBanner = document.getElementById('dedicationBanner');
    const dedText = document.getElementById('dedicationText');
    const dedFromText = document.getElementById('dedicationFromText');

    if (currentlyPlaying.requestedBy && currentlyPlaying.requestedBy.dedication) {
      dedFromText.textContent = `MENSAJE ESPECIAL DE ${currentlyPlaying.requestedBy.name.toUpperCase()}`;
      dedText.textContent = `"${currentlyPlaying.requestedBy.dedication}"`;
      dedBanner.classList.remove('hidden');

      // Ocultar después de 25 segundos
      clearTimeout(window.dedicationTimer);
      window.dedicationTimer = setTimeout(() => {
        dedBanner.classList.add('hidden');
      }, 25000);
    } else {
      dedBanner.classList.add('hidden');
    }
  }

  // Siguiente canción
  if (queue && queue.length > 0) {
    const next = queue[0];
    document.getElementById('nextTitle').textContent = next.title;
    document.getElementById('nextGenre').textContent = `[${next.genre || 'Música'}] - ${next.requestedBy?.table ? 'Mesa ' + next.requestedBy.table : 'Bar'}`;
  } else {
    document.getElementById('nextTitle').textContent = 'Continuará con la lista base';
    document.getElementById('nextGenre').textContent = 'DJ Inteligente';
  }
});

// Promociones de Santa Chela en Pantalla
let activePromos = [
  '🍻 ¡Pregunta por nuestras promociones de cerveza en la barra!',
  '🍔 Prueba nuestras picadas y alitas Santa Chela',
  '🥃 Pide tu botella favorita para compartir con tu parche'
];
let currentPromoIdx = 0;

function startPromoRotation() {
  const promoTextEl = document.getElementById('promoText');
  if (!promoTextEl) return;

  setInterval(() => {
    if (!activePromos || activePromos.length === 0) return;
    currentPromoIdx = (currentPromoIdx + 1) % activePromos.length;
    promoTextEl.textContent = activePromos[currentPromoIdx];
  }, 12000);
}

// Modo Micrófono / Anuncio con Fade Suave de Volumen
socket.on('mic-mode', ({ active }) => {
  const indicator = document.getElementById('micModeIndicator');
  if (!ytPlayer || !isPlayerReady) return;

  if (active) {
    if (indicator) indicator.classList.remove('hidden');
    savedVolumeBeforeMic = ytPlayer.getVolume() || masterVolume || 100;
    fadeVolume(savedVolumeBeforeMic, 15, 1200);
  } else {
    if (indicator) indicator.classList.add('hidden');
    fadeVolume(ytPlayer.getVolume(), savedVolumeBeforeMic, 1200);
  }
});

// Alerta animada en pantalla cuando entra una petición
socket.on('new-request-alert', (data) => {
  const notif = document.getElementById('newRequestNotification');
  const text = document.getElementById('newRequestText');

  if (notif && text && data.song) {
    const tableStr = data.song.requestedBy?.table ? `Mesa ${data.song.requestedBy.table}` : 'un cliente';
    text.textContent = `¡Nuevo pedido de ${tableStr}: "${data.song.title}"!`;
    notif.classList.remove('hidden');

    setTimeout(() => {
      notif.classList.add('hidden');
    }, 5000);
  }
});

// Cargar QR para la esquina de la pantalla
async function loadScreenQR() {
  try {
    const res = await fetch('/api/qrs');
    const data = await res.json();
    if (data.qrs && data.qrs.length > 0) {
      // Usar QR general o el de la mesa 1
      document.getElementById('screenQr').src = data.qrs[0].qrDataUrl;
    }
  } catch (err) {
    console.warn('No se pudo cargar QR en pantalla:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadScreenQR();
});
