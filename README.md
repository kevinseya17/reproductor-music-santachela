# 🎷 Asistente Music Bar - Rockola Digital con DJ Inteligente

Sistema web para bares que permite a los clientes pedir canciones desde sus mesas escaneando un código QR, seleccionando la versión exacta de YouTube, mientras un **DJ Inteligente (con IA)** organiza la música en bloques temáticos armónicos sobre una lista base curada para que el bar nunca pare de sonar.

---

## 🌟 Características Principales

1. **📱 Experiencia del Cliente (Móvil vía QR):**
   - Escaneo de código QR en mesa (detecta la mesa automáticamente, ej. `Mesa 4`).
   - Búsqueda en YouTube con miniaturas y duración para elegir la **versión exacta** (original, en vivo, acústico).
   - "Sonando Ahora" en vivo con ecualizador animado y género musical.
   - Cola de reproducción visible con posición en turno.
   - Cero descargas: abre directo en el navegador de cualquier teléfono.

2. **🤖 DJ Inteligente (IA & Tandas):**
   - **Clasificador de Género:** Reconoce Salsa, Popular/Despecho, Vallenato, Reggaetón, Rock y Crossover.
   - **Inserción Inteligente ("Smart Slotting"):** Ubica la canción pedida dentro de la tanda correspondiente en los próximos 2 a 4 turnos (evita que el cliente espere horas).
   - **Reglas Anti-Spam:** Límite configurable de canciones simultáneas por mesa.

3. **📺 Pantalla del Reproductor (`/player.html`):**
   - Diseñado para proyectar en los televisores del bar o reproducir en el computador principal.
   - Reproductor oficial YouTube IFrame continuo (audio/video de alta fidelidad sin comerciales en cuentas Premium).
   - Cartelera elegante: *"Pedida por Mesa 4"*, género y *"A continuación"*.
   - Código QR en la esquina de la pantalla para escanear directamente desde la barra o lejos.

4. **🎛️ Panel de Control del Bar (`/admin.html`):**
   - Control en vivo: saltar canciones, pausar, cambiar orden o forzar un tema inmediato.
   - **Listas Maestras (El Norte):** Selección de listas de respaldo (Viernes de Rumba, Sábado Crossover, Cantina) para que el bar nunca se quede en silencio.
   - **Generador de Listas con IA (Gemini):** Crea playlists temáticas completas escribiendo una simple instrucción en texto.
   - Métricas y tendencias: qué canciones y qué géneros son los más pedidos por los clientes.

5. **🖨️ Generador de Tarjetas QR (`/qrs.html`):**
   - Tarjetas imprimibles listas para colocar en los soportes acrílicos de las mesas (Mesa 1 a 20 y Barra).

---

## 🚀 Cómo Ponerlo a Rodar en el Bar

### 1. Iniciar el Servidor
Abre la terminal en la carpeta del proyecto y ejecuta:
```bash
npm start
```

El servidor arrancará en:
- **Vista Cliente:** `http://localhost:3000` (o `http://[IP-DEL-PC]:3000/?mesa=1`)
- **Pantalla Reproductor (TV):** `http://localhost:3000/player.html`
- **Panel Admin / DJ:** `http://localhost:3000/admin.html`
- **Imprimir QRs:** `http://localhost:3000/qrs.html`

### 2. Conectar a los Clientes en el WiFi del Bar
1. Asegúrate de que el computador esté conectado a la red WiFi del bar.
2. Abre la terminal y escribe `ipconfig` para ver tu dirección IP local (ejemplo: `192.168.1.50`).
3. Los clientes pueden conectarse desde su celular a `http://192.168.1.50:3000/?mesa=1`.
*(Opcional: puedes usar herramientas como Cloudflare Tunnel o Ngrok si deseas que la URL sea un dominio público en internet).*
