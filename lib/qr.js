const QRCode = require('qrcode');

/**
 * Generador de códigos QR para las mesas del bar
 */
class QRService {
  /**
   * Genera un DataURL (imagen base64) para una mesa específica
   */
  async generateForTable(baseUrl, tableNumber) {
    const url = `${baseUrl}/?mesa=${encodeURIComponent(tableNumber)}`;
    try {
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: {
          dark: '#111827', // Gris oscuro elegante
          light: '#ffffff'
        }
      });
      return {
        tableNumber,
        url,
        qrDataUrl
      };
    } catch (err) {
      console.error(`Error generando QR para mesa ${tableNumber}:`, err);
      return null;
    }
  }

  /**
   * Genera los QR para un rango de mesas
   */
  async generateBatch(baseUrl, totalTables = 20) {
    const results = [];
    for (let i = 1; i <= totalTables; i++) {
      const qrObj = await this.generateForTable(baseUrl, i);
      if (qrObj) results.push(qrObj);
    }
    // Agregar opción especial para la Barra
    const barraQr = await this.generateForTable(baseUrl, 'Barra');
    if (barraQr) results.push(barraQr);

    return results;
  }
}

module.exports = new QRService();
