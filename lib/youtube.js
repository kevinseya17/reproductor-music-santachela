const ytSearch = require('yt-search');

/**
 * Módulo para interactuar con YouTube
 */
class YouTubeService {
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
      const blacklist = ['mix', '1 hora', '2 horas', '3 horas', 'enganchado', 'megamix', 'set completo', 'full album', 'disco completo', 'concierto completo', 'playlist'];

      const results = [];
      for (const item of itemSection) {
        const v = item.videoRenderer;
        if (!v || !v.videoId) continue;

        let rawTitle = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
        if (!rawTitle || typeof rawTitle !== 'string') continue;

        const durationText = v.lengthText?.simpleText || '';
        let seconds = 0;
        if (durationText) {
          const parts = durationText.split(':').map(Number);
          if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
          if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }

        // Descartar videos demasiado largos (> 9 minutos)
        if (seconds > 540) continue;

        const titleLower = rawTitle.toLowerCase();
        if (blacklist.some(w => titleLower.includes(w))) continue;

        const rawArtist = v.ownerText?.runs?.[0]?.text || 'Artista';
        const thumbnail = v.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
        const views = v.viewCountText?.simpleText || '';
        const ago = v.publishedTimeText?.simpleText || '';

        // Limpieza de sufijos comunes de YouTube
        let cleanTitle = rawTitle
          .replace(/\s*[\(\[](?:video\s*oficial|official\s*video|official\s*music\s*video|official\s*audio|audio\s*oficial|en\s*vivo|live|lyric\s*video|letra|video\s*con\s*letra|video\s*lyric|audio|remastered|hd|4k)[\)\]]/gi, '')
          .replace(/^[\d]+[\.\-\s]+/g, '')
          .trim();

        results.push({
          videoId: v.videoId,
          title: cleanTitle || rawTitle.trim(),
          artist: rawArtist.trim(),
          duration: durationText || '3:30',
          seconds: seconds || 210,
          thumbnail,
          views,
          ago
        });

        if (results.length >= limit) break;
      }

      return results;
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
        // A. Intentar con oEmbed oficial de YouTube
        const oembed = await this.getOEmbedInfo(directId);
        if (oembed) {
          return [oembed];
        }
      }

      // 3. Búsqueda nativa directa (ultrarrápida y robusta)
      let results = await this.directSearch(cleanQuery, limit);

      // 4. Si la búsqueda directa no devolvió resultados, intentar con ytSearch de respaldo
      if (!results || results.length === 0) {
        try {
          const ytRes = await ytSearch({ query: cleanQuery, pageStart: 1, pageEnd: 1 });
          const rawVideos = (ytRes && Array.isArray(ytRes.videos)) ? ytRes.videos : [];
          results = rawVideos
            .filter(v => v && v.videoId && (!v.seconds || v.seconds <= 540))
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
    const match = playlistUrlOrId.match(/[&?]list=([^&]+)/) || playlistUrlOrId.match(/^PL[\w-]+$/);
    const listId = match ? (match[1] || match[0]) : playlistUrlOrId.trim();

    try {
      const url = `https://www.youtube.com/playlist?list=${listId}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      const text = await res.text();

      // Extraer título
      const titleMatch = text.match(/<title>(.*?)<\/title>/);
      const playlistTitle = titleMatch ? titleMatch[1].replace('- YouTube', '').trim() : 'Playlist Importada';

      // Extraer videos del JSON interno ytInitialData
      const jsonMatch = text.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        const twoCol = data.contents?.twoColumnBrowseResultsRenderer;
        const tab0 = twoCol?.tabs?.[0]?.tabRenderer;
        const secList = tab0?.content?.sectionListRenderer;
        const itemSec = secList?.contents?.[0]?.itemSectionRenderer;

        if (itemSec?.contents) {
          const aiDj = require('./ai-dj');
          const tracks = itemSec.contents
            .map(c => c.lockupViewModel)
            .filter(l => l && l.contentId)
            .map(l => {
              const meta = l.metadata?.lockupMetadataViewModel;
              let rawTitle = meta?.title?.content || 'Canción';
              const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
              let rawArtist = rows[0]?.metadataParts?.[0]?.text?.content || 'Artista';
              const duration = rows[0]?.metadataParts?.[1]?.text?.content || '3:30';

              // Limpiar sufijos típicos de YouTube (Video Oficial, En Vivo, etc.)
              let cleanTitle = rawTitle
                .replace(/\s*[\(\[](?:video\s*oficial|official\s*video|official\s*music\s*video|official\s*audio|audio\s*oficial|en\s*vivo|live|lyric\s*video|letra|video\s*con\s*letra|video\s*lyric|audio|remastered|hd|4k)[\)\]]/gi, '')
                .replace(/^[\d]+[\.\-\s]+/g, '')
                .trim();

              let cleanArtist = rawArtist.trim();

              // Si el título viene con formato "Artista - Canción"
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

              return {
                videoId: l.contentId,
                title: cleanTitle || rawTitle,
                artist: cleanArtist || 'Artista',
                genre: detectedGenre || 'Crossover',
                duration,
                thumbnail: `https://i.ytimg.com/vi/${l.contentId}/hqdefault.jpg`
              };
            });

          if (tracks.length > 0) {
            return {
              id: `imported-${Date.now()}`,
              name: `📥 ${playlistTitle}`,
              description: `Importada directamente de YouTube (${tracks.length} canciones)`,
              tracks
            };
          }
        }
      }

      return null;
    } catch (err) {
      console.error('Error importando playlist de YouTube:', err);
      return null;
    }
  }
}

module.exports = new YouTubeService();
