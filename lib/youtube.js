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
   * Busca canciones en YouTube devolviendo versiones, miniaturas y metadatos
   */
  async search(query, limit = 8) {
    if (!query || !query.trim()) return [];
    const cleanQuery = query.trim();

    try {
      // 1. Si el usuario ingresó un enlace o ID directo de YouTube
      const directId = this.extractVideoId(cleanQuery);
      if (directId) {
        // A. Intentar con oEmbed oficial de YouTube (el más confiable)
        const oembed = await this.getOEmbedInfo(directId);
        if (oembed) {
          return [oembed];
        }

        // B. Intentar buscar por el ID en el motor de búsqueda
        const idSearch = await ytSearch({ query: directId, pageStart: 1, pageEnd: 1 });
        if (idSearch && idSearch.videos && idSearch.videos.length > 0) {
          const matched = idSearch.videos.find(v => v.videoId === directId) || idSearch.videos[0];
          return [{
            videoId: matched.videoId,
            title: matched.title,
            artist: matched.author ? matched.author.name : 'Artista',
            duration: matched.timestamp || '0:00',
            seconds: matched.seconds || 0,
            thumbnail: matched.thumbnail || `https://i.ytimg.com/vi/${matched.videoId}/hqdefault.jpg`,
            views: matched.views || 0,
            ago: matched.ago || ''
          }];
        }
      }

      // 2. Búsqueda general por texto (artista, canción o letra)
      const results = await ytSearch({ query: cleanQuery, pageStart: 1, pageEnd: 1 });
      const rawVideos = (results && results.videos) ? results.videos : [];

      // Filtro estricto: solo CANCIONES INDIVIDUALES (no mixes de 1 hora ni discos completos)
      const blacklist = ['mix', '1 hora', '2 horas', '3 horas', 'enganchado', 'megamix', 'set completo', 'full album', 'disco completo', 'concierto completo', 'playlist'];

      const individualSongs = rawVideos.filter(v => {
        // Máximo 9 minutos (540s) y mínimo 45 segundos
        if (v.seconds && (v.seconds > 540 || v.seconds < 45)) return false;

        const titleLower = (v.title || '').toLowerCase();
        for (const word of blacklist) {
          if (titleLower.includes(word)) return false;
        }

        return true;
      });

      // Si el filtro dejó muy pocos, usar los que tengan duración razonable
      const finalVideos = (individualSongs.length > 0 ? individualSongs : rawVideos).slice(0, limit);

      return finalVideos.map(v => ({
        videoId: v.videoId,
        title: v.title,
        artist: v.author ? v.author.name : 'Artista',
        duration: v.timestamp || '0:00',
        seconds: v.seconds || 0,
        thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        views: v.views || 0,
        ago: v.ago || ''
      }));
    } catch (err) {
      console.error('Error al buscar en YouTube:', err);
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
      const title = titleMatch ? titleMatch[1].replace('- YouTube', '').trim() : 'Playlist Importada';

      // Extraer videos del JSON interno ytInitialData
      const jsonMatch = text.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        const twoCol = data.contents?.twoColumnBrowseResultsRenderer;
        const tab0 = twoCol?.tabs?.[0]?.tabRenderer;
        const secList = tab0?.content?.sectionListRenderer;
        const itemSec = secList?.contents?.[0]?.itemSectionRenderer;

        if (itemSec?.contents) {
          const tracks = itemSec.contents
            .map(c => c.lockupViewModel)
            .filter(l => l && l.contentId)
            .map(l => {
              const meta = l.metadata?.lockupMetadataViewModel;
              const title = meta?.title?.content || 'Canción';
              const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
              const artist = rows[0]?.metadataParts?.[0]?.text?.content || 'Artista';
              const duration = rows[0]?.metadataParts?.[1]?.text?.content || '3:30';
              return {
                videoId: l.contentId,
                title,
                artist,
                genre: 'Crossover',
                duration,
                thumbnail: `https://i.ytimg.com/vi/${l.contentId}/hqdefault.jpg`
              };
            });

          if (tracks.length > 0) {
            return {
              id: `imported-${Date.now()}`,
              name: `📥 ${title}`,
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
