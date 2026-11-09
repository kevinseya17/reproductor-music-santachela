const ytSearch = require('yt-search');

// Lista maestra de palabras y patrones de videos que NO son canciones (memes, bromas, juegos, novelas, partidos, infantil, etc.)
const NON_MUSIC_BLOCKLIST = [
  // Memes, bromas, troleos y efectos de sonido
  'gemido', 'gemidos', 'broma', 'bromas', 'meme', 'memes', 'shitpost', 'shitposting',
  'parodia', 'chiste', 'chistes', 'stand up', 'audio viral', 'troll', 'troleo',
  'earrape', 'saturado', 'momazo', 'si te ries', 'no te rias', 'efecto de sonido',
  'efectos de sonido', 'sound effect', 'sound effects', 'sfx', 'alarma', 'sirena',
  'eructo', 'pedo', 'fart', 'asmr', 'sonido de ', 'ruido de ', 'para bobear',
  // Duraciones excesivas / enganchados / loops
  'mix ', 'megamix', 'enganchado', 'set completo', 'full album', 'disco completo',
  'concierto completo', '1 hora', '2 horas', '3 horas', '4 horas', '10 horas',
  // Infantil y caricaturas usadas para trolear en bares
  'bebe juan', 'vaca lola', 'la vaca lola', 'cocomelon', 'cancion infantil',
  'canciones infantiles', 'rondas infantiles', 'peppa pig', 'bob esponja',
  'paw patrol', 'dora la exploradora', 'baby shark', 'bartolito', 'granja de zenon',
  'gallina pintadita', 'plim plim', 'pocoyo', 'chuchu tv', 'super simple songs',
  'biper y sus amigos', 'mundo bita', 'luli pampin',
  // Deportes, partidos, noticias, TV, novelas y podcasts
  'resumen ', 'partido ', 'goles de', 'gol de ', 'tanda de penales', 'rueda de prensa',
  'noticiero', 'noticias ', 'debate ', 'discurso ', 'alocucion', 'entrevista ',
  'podcast', 'episodio ', 'capitulo ', 'telenovela', 'escena de ', 'trailer ',
  'pelicula completa', 'documental', 'caso cerrado', 'rosa de guadalupe',
  'predica ', 'sermon ', 'oracion ', 'santo rosario', 'misa de ',
  // Videojuegos, tutoriales, reacciones y vlogs
  'gameplay', 'walkthrough', 'minecraft', 'roblox', 'free fire', 'fortnite',
  'tutorial ', 'como hacer ', 'curso de ', 'clase de ', 'reaccion a ', 'reaccionando a',
  'unboxing', 'review ', 'resena ', 'experimento social', 'storytime', 'top 10 ', 'top 5 '
];

function normalizeForFilter(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Módulo para interactuar con YouTube
 */
class YouTubeService {
  /**
   * Convierte texto de duración ("3:45" o "1:02:15") a segundos
   */
  parseDurationSeconds(durationText) {
    if (!durationText || typeof durationText !== 'string') return 0;
    const parts = durationText.trim().split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  /**
   * Detecta si un título o canal corresponde a un video que NO es una canción musical
   */
  isNonMusicVideo(title, artist = '') {
    const norm = ` ${normalizeForFilter(title)} ${normalizeForFilter(artist)} `;
    for (const bad of NON_MUSIC_BLOCKLIST) {
      if (norm.includes(bad)) {
        return { blocked: true, word: bad.trim() };
      }
    }
    return { blocked: false };
  }

  /**
   * Valida que un pedido sea realmente una canción válida (duración musical 1:10 a 8:30 y sin contenido no musical)
   */
  validateIsRealSong({ title, artist, duration, seconds }) {
    const checkText = this.isNonMusicVideo(title, artist);
    if (checkText.blocked) {
      return {
        valid: false,
        reason: '⚠️ Solo se permiten canciones reales. No se permiten memes, bromas, videos infantiles ni contenido que no sea música.'
      };
    }

    const durSecs = Number(seconds) || this.parseDurationSeconds(duration);
    if (durSecs > 0 && durSecs < 70) {
      return {
        valid: false,
        reason: '⚠️ Este video es demasiado corto (menos de 1:10 min). Solo se permiten canciones completas reales, no clips ni audios cortos.'
      };
    }
    if (durSecs > 510) {
      return {
        valid: false,
        reason: '⚠️ Este video supera la duración máxima permitida para una canción (8:30 min). No se permiten mixes largos ni programas.'
      };
    }

    return { valid: true };
  }
  /**
   * Extrae el video ID si se ingresa un enlace completo de YouTube (incluso con ?si=...)
   */
  extractVideoId(urlOrId) {
    if (!urlOrId) return null;
    const clean = urlOrId.trim();

    // Enlaces cortos tipo youtu.be/ROgcM9-N9jM o youtu.be/ROgcM9-N9jM?si=...
    const shortMatch = clean.match(/youtu\.be\/([\w-]{11})/);
    if (shortMatch) return shortMatch[1];

    // Enlaces estándar tipo youtube.com/watch?v=ROgcM9-N9jM
    const longMatch = clean.match(/(?:youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (longMatch) return longMatch[1];

    // Si ya es un ID directo de 11 caracteres
    if (/^[\w-]{11}$/.test(clean)) return clean;

    return null;
  }

  /**
   * Obtiene información oficial de YouTube vía oEmbed (rápido, sin bloqueos de IP)
   */
  async getOEmbedInfo(videoId) {
    try {
      const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return {
        videoId,
        title: data.title || 'Video de YouTube',
        artist: data.author_name || 'Artista',
        duration: '3:45',
        seconds: 225,
        thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        views: 0,
        ago: ''
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Caché en memoria para búsquedas instantáneas
   */
  static searchCache = new Map();

  /**
   * Búsqueda nativa directa en YouTube mediante ytInitialData (rápida, estable, sin errores de librería externa)
   */
  async directSearch(query, limit = 8) {
    try {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
        }
      });
      if (!res.ok) return [];
      const html = await res.text();
      const match = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
      if (!match) return [];

      let data;
      try {
        data = JSON.parse(match[1]);
      } catch (jsonErr) {
        return [];
      }

      const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
      if (!contents || !Array.isArray(contents)) return [];

      const itemSection = contents.find(c => c.itemSectionRenderer?.contents)?.itemSectionRenderer?.contents || [];

      const candidates = [];
      for (const item of itemSection) {
        const v = item.videoRenderer;
        if (!v || !v.videoId) continue;

        let rawTitle = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
        if (!rawTitle || typeof rawTitle !== 'string') continue;

        const durationText = v.lengthText?.simpleText || '';
        const seconds = this.parseDurationSeconds(durationText);

        // Solo permitir duración real de canciones (entre 1:10 min = 70s y 8:30 min = 510s)
        // Descarta automáticamente Shorts, memes cortos, efectos de sonido (<70s), transmisiones en vivo (0s) y programas/mixes largos (>510s)
        if (!seconds || seconds < 70 || seconds > 510) continue;

        const rawArtist = v.ownerText?.runs?.[0]?.text || 'Artista';

        // Verificar que no sea un video de broma, meme, infantil, partido, novela o contenido no musical
        if (this.isNonMusicVideo(rawTitle, rawArtist).blocked) continue;

        // Detectar si el canal tiene insignia de Artista Oficial (♪) o indicadores musicales claros
        const badges = v.ownerBadges || [];
        const hasArtistBadge = badges.some(b =>
          b.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST' ||
          /artist|m[uú]sica|music/i.test(b.metadataBadgeRenderer?.tooltip || '')
        );
        const hasMusicIndicator = hasArtistBadge ||
          /vevo|-\s*topic|records|music|oficial|official|video\s*oficial|audio\s*oficial|letra|lyrics/i.test(`${rawTitle} ${rawArtist}`);

        const thumbnail = v.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
        const views = v.viewCountText?.simpleText || '';
        const ago = v.publishedTimeText?.simpleText || '';

        // Limpieza de sufijos comunes de YouTube
        let cleanTitle = rawTitle
          .replace(/\s*[\(\[](?:video\s*oficial|official\s*video|official\s*music\s*video|official\s*audio|audio\s*oficial|en\s*vivo|live|lyric\s*video|letra|video\s*con\s*letra|video\s*lyric|audio|remastered|hd|4k)[\)\]]/gi, '')
          .replace(/^[\d]+[\.\-\s]+/g, '')
          .trim();

        candidates.push({
          videoId: v.videoId,
          title: cleanTitle || rawTitle.trim(),
          artist: rawArtist.trim(),
          duration: durationText || '3:30',
          seconds,
          thumbnail,
          views,
          ago,
          _isMusicPriority: hasMusicIndicator ? 1 : 0
        });

        if (candidates.length >= limit * 2) break;
      }

      // Priorizar primero canales de artistas oficiales y videos musicales verificados
      candidates.sort((a, b) => b._isMusicPriority - a._isMusicPriority);
      return candidates.slice(0, limit).map(({ _isMusicPriority, ...rest }) => rest);
    } catch (err) {
      console.error('Error en directSearch de YouTube:', err);
      return [];
    }
  }

  /**
   * Busca canciones en YouTube devolviendo versiones, miniaturas y metadatos con caché de alta velocidad
   */
  async search(query, limit = 8) {
    if (!query || !query.trim()) return [];
    const cleanQuery = query.trim();

    // 0. Si la búsqueda misma es una broma, meme o término no musical prohibido, bloquear de inmediato
    if (this.isNonMusicVideo(cleanQuery, '').blocked) {
      return [];
    }

    const cacheKey = `${cleanQuery.toLowerCase()}_${limit}`;

    // 1. Verificar caché en memoria (< 15 minutos)
    const cached = YouTubeService.searchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 15 * 60 * 1000)) {
      return cached.results;
    }

    try {
      // 2. Si el usuario ingresó un enlace o ID directo de YouTube
      const directId = this.extractVideoId(cleanQuery);
      if (directId) {
        const oembed = await this.getOEmbedInfo(directId);
        if (oembed && !this.isNonMusicVideo(oembed.title, oembed.artist).blocked) {
          return [oembed];
        }
        return [];
      }

      // 3. Búsqueda nativa directa (ultrarrápida y robusta)
      let results = await this.directSearch(cleanQuery, limit);

      // 4. Si la búsqueda directa no devolvió resultados, intentar con ytSearch de respaldo
      if (!results || results.length === 0) {
        try {
          const ytRes = await ytSearch({ query: cleanQuery, pageStart: 1, pageEnd: 1 });
          const rawVideos = (ytRes && Array.isArray(ytRes.videos)) ? ytRes.videos : [];
          results = rawVideos
            .filter(v => {
              if (!v || !v.videoId) return false;
              const secs = Number(v.seconds) || 0;
              if (secs < 70 || secs > 510) return false;
              const t = typeof v.title === 'string' ? v.title : (v.title?.text || '');
              const a = v.author ? v.author.name : '';
              return !this.isNonMusicVideo(t, a).blocked;
            })
            .slice(0, limit)
            .map(v => ({
              videoId: v.videoId,
              title: typeof v.title === 'string' ? v.title.trim() : (v.title?.text || 'Canción'),
              artist: v.author ? v.author.name : 'Artista',
              duration: v.timestamp || '0:00',
              seconds: v.seconds || 0,
              thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
              views: v.views || 0,
              ago: v.ago || ''
            }));
        } catch (ytErr) {
          console.warn('Fallback ytSearch no disponible:', ytErr.message);
        }
      }

      // Guardar en caché si se encontraron resultados
      if (results && results.length > 0) {
        if (YouTubeService.searchCache.size > 300) {
          // Limpiar entradas viejas si el caché es muy grande
          const firstKey = YouTubeService.searchCache.keys().next().value;
          YouTubeService.searchCache.delete(firstKey);
        }
        YouTubeService.searchCache.set(cacheKey, {
          timestamp: Date.now(),
          results
        });
      }

      return results || [];
    } catch (err) {
      console.error('Error general al buscar en YouTube:', err);
      return [];
    }
  }

  /**
   * Obtiene detalles de un video específico por ID
   */
  async getVideoDetails(videoId) {
    try {
      const oembed = await this.getOEmbedInfo(videoId);
      if (oembed) return oembed;
      return null;
    } catch (err) {
      console.error('Error al obtener video:', err);
      return null;
    }
  }

  /**
   * Importa una playlist completa de YouTube a partir de su enlace o ID
   */
  async importPlaylist(playlistUrlOrId) {
    if (!playlistUrlOrId) return null;
    const cleanInput = String(playlistUrlOrId).trim();

    // Extraer listId de múltiples formatos posibles (youtube.com, music.youtube.com, youtu.be, etc.)
    const match = cleanInput.match(/[&?]list=([^&]+)/) || cleanInput.match(/^PL[\w-]+$/);
    const listId = match ? (match[1] || match[0]) : cleanInput;

    try {
      const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          'Cookie': 'CONSENT=YES+cb; SOCS=CAESEwgDEgk2OTU5NzQwODUaAmVuIAEaBgiA_LyaBg;'
        }
      });
      if (!res.ok) return null;
      const text = await res.text();

      // Extraer videos del JSON interno ytInitialData
      const jsonMatch = text.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
      if (!jsonMatch) return null;

      let data;
      try {
        data = JSON.parse(jsonMatch[1]);
      } catch (jsonErr) {
        return null;
      }

      // 1. Extraer título de la playlist
      let playlistTitle = 'Playlist Importada';
      const pageHeader = data.header?.pageHeaderRenderer;
      if (pageHeader?.pageTitle) {
        playlistTitle = pageHeader.pageTitle;
      } else {
        const titleMatch = text.match(/<title>(.*?)<\/title>/);
        if (titleMatch) {
          playlistTitle = titleMatch[1].replace('- YouTube', '').trim();
        }
      }

      const aiDj = require('./ai-dj');
      const tracks = [];
      const seenVideoIds = new Set();

      function processTrack(videoId, rawTitle, rawArtist, durationText) {
        if (!videoId || seenVideoIds.has(videoId)) return;
        seenVideoIds.add(videoId);

        // Limpiar sufijos típicos de YouTube (Video Oficial, En Vivo, etc.)
        let cleanTitle = (rawTitle || 'Canción')
          .replace(/\s*[\(\[](?:video\s*oficial|official\s*video|official\s*music\s*video|official\s*audio|audio\s*oficial|en\s*vivo|live|lyric\s*video|letra|video\s*con\s*letra|video\s*lyric|audio|remastered|hd|4k)[\)\]]/gi, '')
          .replace(/^[\d]+[\.\-\s]+/g, '')
          .trim();

        let cleanArtist = (rawArtist || 'Artista').trim();

        // Si el título viene en formato "Artista - Canción"
        const splitMatch = cleanTitle.match(/^(.+?)\s*[-–—|:]\s*(.+)$/);
        if (splitMatch) {
          const part1 = splitMatch[1].trim();
          const part2 = splitMatch[2].trim();
          if (!cleanArtist || cleanArtist === 'Artista' || cleanArtist === 'YouTube' || /topic|vevo|records|music|oficial|official/i.test(cleanArtist)) {
            cleanArtist = part1;
            cleanTitle = part2;
          }
        }

        const detectedGenre = aiDj.classifyGenreFast(cleanTitle, cleanArtist, playlistTitle);

        tracks.push({
          videoId,
          title: cleanTitle || rawTitle,
          artist: cleanArtist || 'Artista',
          genre: detectedGenre || 'Crossover',
          duration: durationText || '3:30',
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        });
      }

      // Escaneo recursivo para extraer canciones en formato moderno (lockupViewModel) o clásico (playlistVideoRenderer)
      function scanForTracks(obj, depth = 0) {
        if (!obj || depth > 30 || typeof obj !== 'object') return;

        // Formato A: lockupViewModel (YouTube 2025/2026)
        if (obj.lockupViewModel && obj.lockupViewModel.contentId) {
          const l = obj.lockupViewModel;
          const meta = l.metadata?.lockupMetadataViewModel;
          const rawTitle = meta?.title?.content || 'Canción';
          const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
          const rawArtist = rows[0]?.metadataParts?.[0]?.text?.content || 'Artista';
          processTrack(l.contentId, rawTitle, rawArtist, '3:30');
          return;
        }

        // Formato B: playlistVideoRenderer (YouTube estándar)
        if (obj.playlistVideoRenderer && obj.playlistVideoRenderer.videoId) {
          const pvr = obj.playlistVideoRenderer;
          const rawTitle = pvr.title?.runs?.[0]?.text || pvr.title?.simpleText || 'Canción';
          const rawArtist = pvr.shortBylineText?.runs?.[0]?.text || 'Artista';
          const duration = pvr.lengthText?.simpleText || '3:30';
          processTrack(pvr.videoId, rawTitle, rawArtist, duration);
          return;
        }

        if (Array.isArray(obj)) {
          for (const item of obj) {
            scanForTracks(item, depth + 1);
          }
        } else {
          for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'object') {
              scanForTracks(obj[key], depth + 1);
            }
          }
        }
      }

      scanForTracks(data);

      if (tracks.length > 0) {
        return {
          id: `imported-${Date.now()}`,
          name: `📥 ${playlistTitle}`,
          description: `Importada directamente de YouTube (${tracks.length} canciones)`,
          tracks
        };
      }

      return null;
    } catch (err) {
      console.error('Error importando playlist de YouTube:', err);
      return null;
    }
  }
}

module.exports = new YouTubeService();
