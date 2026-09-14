const ytSearch = require('yt-search');

/**
 * Módulo para interactuar con YouTube
 */
class YouTubeService {
  /**
   * Extrae el video ID si se ingresa un enlace completo de YouTube
   */
  extractVideoId(urlOrId) {
    if (!urlOrId) return null;
    const match = urlOrId.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (match) return match[1];
    if (/^[\w-]{11}$/.test(urlOrId)) return urlOrId;
    return null;
  }

  /**
   * Busca canciones en YouTube devolviendo versiones, miniaturas y metadatos
   */
  async search(query, limit = 8) {
    if (!query || !query.trim()) return [];

    try {
      // Si el usuario ingresó un enlace directo de YouTube
      const directId = this.extractVideoId(query.trim());
      if (directId) {
        const video = await ytSearch({ videoId: directId });
        if (video) {
          return [{
            videoId: video.videoId,
            title: video.title,
            artist: video.author ? video.author.name : 'Artista',
            duration: video.timestamp || '0:00',
            seconds: video.seconds || 0,
            thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
            views: video.views || 0,
            ago: video.ago || ''
          }];
        }
      }

      // Búsqueda general por texto
      const results = await ytSearch({ query: query.trim(), pageStart: 1, pageEnd: 1 });
      const videos = (results && results.videos) ? results.videos.slice(0, limit) : [];

      return videos.map(v => ({
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
      const video = await ytSearch({ videoId });
      if (!video) return null;
      return {
        videoId: video.videoId,
        title: video.title,
        artist: video.author ? video.author.name : 'Artista',
        duration: video.timestamp || '0:00',
        seconds: video.seconds || 0,
        thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`
      };
    } catch (err) {
      console.error('Error al obtener video:', err);
      return null;
    }
  }
}

module.exports = new YouTubeService();
