const db = require('./db');

// Diccionario heurístico exhaustivo de artistas y palabras clave comunes en bares latinos
const GENRE_RULES = [
  {
    genre: 'Reggaetón',
    keywords: [
      'reggaeton', 'reggaetón', 'regaeton', 'regaetoon', 'regueton', 'urbano', 'trap latino',
      'dembow', 'perreo', 'perreo intenso', 'bellaqueo', 'sandungueo', 'bellakeo', 'maleanteo',
      'discoteca', 'rumba latina', 'perreito'
    ],
    artists: [
      'feid', 'ferxxo', 'bad bunny', 'karol g', 'daddy yankee', 'don omar', 'j balvin', 'maluma',
      'wisin', 'yandel', 'wisin & yandel', 'wisin y yandel', 'plan b', 'arcangel', 'nicky jam',
      'zion & lennox', 'zion y lennox', 'chencho corleone', 'chencho', 'rauw alejandro', 'ryan castro',
      'blessd', 'anuel', 'anuel aa', 'ozuna', 'ivy queen', 'tego calderon', 'farruko', 'myke towers',
      'el alfa', 'cris mj', 'floyy', 'floyymenor', 'saiko', 'mora', 'jhayco', 'jhay cortez', 'quevedo',
      'bizarrap', 'young miko', 'trueno', 'duki', 'nicki nicole', 'paulo londra', 'manuel turizo',
      'sebastian yatra', 'sech', 'lenny tavarez', 'dalex', 'justin quiles', 'lunay', 'natti natasha',
      'becky g', 'bebeshito', 'oniel bebeshito', 'charly & johayron', 'alex rose', 'de la ghetto',
      'jowell y randy', 'jowell & randy', 'alexis y fido', 'alexis & fido', 'baby rasta', 'gringo',
      'trebol clan', 'hector el father', 'cosculluela', 'tempo', 'messiah', 'rochy rd', 'chimbala',
      'bulin 47', 'darell', 'brray', 'luar la l', 'roddy ricch', 'chucky73', 'noriel', 'bryant myers',
      'almigthy', 'anonimus', 'miky woodz', 'luigi 21 plus', 'ñengo flow', 'ñejo y dalmata', 'ñejo', 'dalmata'
    ]
  },
  {
    genre: 'Salsa',
    keywords: [
      'salsa', 'guaguanco', 'son montuno', 'timba', 'descarga', 'boogaloo', 'salsa brava',
      'salsa choque', 'salsa romantica', 'salsa clásica', 'salsa dura', 'charanga'
    ],
    artists: [
      'grupo niche', 'joe arroyo', 'hector lavoe', 'willie colon', 'ruben blades', 'cheo feliciano',
      'oscar d\'leon', 'los van van', 'gran combo', 'el gran combo', 'guayacan', 'orquesta guayacan',
      'los titanes', 'titanes', 'frankie ruiz', 'eddie santiago', 'miky taveras', 'adolescentes orquesta',
      'los adolescentes', 'puerto rican power', 'gilberto santa rosa', 'victor manuelle', 'orquesta la 33',
      'la 33', 'rey ruiz', 'tony vega', 'tito nieves', 'ismael rivera', 'ismael miranda', 'la sonora ponceña',
      'sonora ponceña', 'celia cruz', 'papo lucca', 'ray barreto', 'yiyo sarante', 'chiquito team band',
      'david pabon', 'maelo ruiz', 'marc anthony', 'tito rojas', 'lalo rodriguez', 'pedrito calvo',
      'christian alicea', 'willy garcia', 'javier vasquez', 'hermanos lebron', 'sonora matancera',
      'bobby valentin', 'tommy olivencia', 'roberto blades', 'grupo caneo', 'grupo gale', 'la suprema corte',
      'hansel y raul', 'jerry rivera', 'charlie aponte', 'andy montañez', 'son cali', 'orquesta canela',
      'orquesta boliche', 'luis enrique', 'pedro arroyo', 'nino zegarra', 'marcella', 'latin brothers'
    ]
  },
  {
    genre: 'Popular',
    keywords: [
      'musica popular', 'música popular', 'despecho', 'cantina', 'guaro', 'aguardiente', 'traicion',
      'charrascal', 'ranchera', 'norteña', 'corrido', 'regional', 'regional mexicano', 'corridos tumbados',
      'cantinero', 'fonda', 'despecho a grito herido', 'pal trago', 'trago y despecho'
    ],
    artists: [
      'dario gomez', 'luis alberto posada', 'charrito negro', 'el charrito negro', 'jhonny rivera',
      'jessi uribe', 'pipe bueno', 'paola jara', 'alzate', 'arelys henao', 'yeison jimenez', 'francy',
      'carin leon', 'christian nodal', 'hernan gomez', 'el andariego', 'alexis escobar', 'luisito muñoz',
      'sebastian campos', 'los tigres del norte', 'calibre 50', 'fidel rueda', 'los relicarios',
      'las hermanitas calle', 'antonio aguilar', 'vicente fernandez', 'pedro infante', 'javier solis',
      'alejandro fernandez', 'luis alfonso', 'grupo frontera', 'peso pluma', 'fuerza regida', 'junior h',
      'natanael cano', 'gabito ballesteros', 'xavi', 'tito double p', 'marca registrada', 'chicho castro',
      'los dos carnales', 'eslabon armado', 'eden muñoz', 'espinoza paz', 'gerardo ortiz', 'alfredo olivas',
      'el fantasma', 'giovanny ayala', 'alan ramirez', 'ciro quiñonez', 'lady yuliana', 'dueto buritica',
      'los rayos de mexico', 'los bukis', 'marco antonio solis', 'los temerarios', 'temerarios',
      'los bibys', 'tucanes de tijuana', 'banda ms', 'la arrolladora', 'intocable', 'pesado'
    ]
  },
  {
    genre: 'Vallenato',
    keywords: [
      'vallenato', 'acordeon', 'acordeón', 'paseo', 'merengue vallenato', 'puya', 'son vallenato',
      'parranda', 'parranda vallenata', 'vallenato clasico', 'vallenato romantico', 'nueva ola vallenata'
    ],
    artists: [
      'diomedes diaz', 'poncho zuleta', 'jorge oñate', 'rafael orozco', 'binomio de oro', 'los inquietos',
      'los diablitos', 'peter manjarres', 'silvestre dangond', 'martin elias', 'elver diaz', 'kaleth morales',
      'felipe pelaez', 'jean carlos centeno', 'jorge celedon', 'nelson velasquez', 'hebert vargas',
      'miguel morales', 'ivan villazon', 'churo diaz', 'diego daza', 'elder dayan', 'ana del castillo',
      'omar geles', 'los gigantes del vallenato', 'daniel calderon', 'luifer cuello', 'mono zabaleta',
      'rafa perez', 'karen lizarazo', 'natalia curvelo', 'yader romero', 'beto zabaleta', 'silvio brito',
      'ivan ovalle', 'farid ortiz', 'osmar perez', 'los chiches del vallenato', 'los chiches', 'embajadores del vallenato'
    ]
  },
  {
    genre: 'Merengue / Bachata',
    keywords: ['merengue', 'bachata', 'mambo dominicano', 'bachata rosa', 'bachata sensual'],
    artists: [
      'romeo santos', 'aventura', 'juan luis guerra', 'eddy herrera', 'sergio vargas', 'los hermanos rosario',
      'wilfrido vargas', 'kinito mendez', 'el torito', 'hector acosta', 'prince royce', 'frank reyes',
      'anthony santos', 'los toros band', 'rikarena', 'elvis crespo', 'zacarias ferreira', 'raulin rodriguez',
      'luis vargas', 'bonny cepeda', 'fernando villalona', 'toño rosario', 'sandy y papo', 'proyecto uno',
      'monchy y alexandra'
    ]
  },
  {
    genre: 'Rock / Pop',
    keywords: ['rock en español', 'pop', 'ska', 'rock', 'clasicos del rock', 'rock latino', 'pop latino'],
    artists: [
      'soda stereo', 'gustavo cerati', 'enanitos verdes', 'heroes del silencio', 'hombres g', 'vilma palma',
      'los prisioneros', 'charly garcia', 'fito paez', 'molotov', 'caifanes', 'jaguar', 'bunbury',
      'la mosca', 'los fabulosos cadillacs', 'autenticos decadentes', 'mana', 'maná', 'juanes', 'kraken',
      'aterciopelados', 'shakira', 'carlos vives', 'la ley', 'elefante', 'jarabe de palo', 'zoe'
    ]
  }
];

class AIDJEngine {
  /**
   * Clasificación rápida y síncrona basada en heurísticas de artistas, títulos y nombre de lista
   */
  classifyGenreFast(title, artist, playlistName = '') {
    const normalize = str => (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const fullText = normalize(`${title || ''} ${artist || ''}`);

    for (const rule of GENRE_RULES) {
      for (const a of rule.artists) {
        if (fullText.includes(normalize(a))) {
          return rule.genre;
        }
      }
      for (const kw of rule.keywords) {
        if (fullText.includes(normalize(kw))) {
          return rule.genre;
        }
      }
    }

    if (playlistName) {
      const plNorm = normalize(playlistName);
      if (/reg+a+e*t|perreo|urbano|dembow|blessd|feid|bad bunny|baile|trap|dembow/i.test(plNorm)) return 'Reggaetón';
      if (/salsa|son|guaguanco/i.test(plNorm)) return 'Salsa';
      if (/cantina|despecho|popular|ranchera|guaro/i.test(plNorm)) return 'Popular';
      if (/vallenato|parranda|acordeon/i.test(plNorm)) return 'Vallenato';
      if (/rock|pop|metal|indie/i.test(plNorm)) return 'Rock / Pop';
    }

    return 'Crossover';
  }

  /**
   * Clasifica el género de una canción analizando título y autor
   */
  async classifyGenre(title, artist, playlistName = '') {
    const fastGenre = this.classifyGenreFast(title, artist, playlistName);
    if (fastGenre !== 'Crossover') {
      return fastGenre;
    }

    // 2. Si hay Gemini API Key configurada, usar IA para máxima precisión
    const settings = db.getSettings();
    if (settings.geminiApiKey) {
      try {
        const aiGenre = await this.classifyWithGemini(title, artist, settings.geminiApiKey);
        if (aiGenre) return aiGenre;
      } catch (err) {
        console.warn('Fallo al clasificar con Gemini, usando fallback:', err.message);
      }
    }

    return 'Crossover';
  }

  /**
   * Consulta a Gemini API para clasificar género y vibra
   */
  async classifyWithGemini(title, artist, apiKey) {
    const prompt = `Actúa como un DJ profesional de bar latino. Clasifica la siguiente canción en exactamente UNO de estos géneros:
- Salsa
- Popular (música de cantina, despecho o regional)
- Vallenato
- Reggaetón
- Merengue / Bachata
- Rock / Pop
- Crossover

Canción: "${title}"
Artista: "${artist}"

Responde ÚNICAMENTE con el nombre del género de la lista anterior, sin puntuación ni texto adicional.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 20 }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API respondió con status: ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text) {
      const match = GENRE_RULES.find(r => r.genre.toLowerCase() === text.toLowerCase());
      return match ? match.genre : text;
    }
    return null;
  }

  /**
   * ALGORITMO DE INSERCIÓN INTELIGENTE (Smart Slotting)
   * 
   * Determina en qué posición exacta de la cola debe entrar una canción para:
   * 1. Respetar la tanda de géneros (salsa con salsa, popular con popular).
   * 2. No hacer esperar al cliente más del tiempo de ventana (ej. próximas 2 a 4 canciones).
   */
  calculateSmartSlot(queue, newSongGenre, currentlyPlaying = null) {
    const settings = db.getSettings();
    const windowSize = settings.smartSlottingWindow || 3;

    // Si la cola está vacía, va de primera
    if (!queue || queue.length === 0) {
      return 0;
    }

    // Rango de búsqueda: desde la primera en cola hasta el tamaño máximo de la ventana
    const searchLimit = Math.min(queue.length, windowSize);

    const maxBatch = settings.genreBatchSize || 3;

    // 1. Contar cuántas canciones del mismo género ya están acumuladas consecutivamente
    // al inicio de la cola (incluyendo si la que está sonando actualmente es del mismo género)
    let currentConsecutiveGenreCount = 0;
    if (currentlyPlaying && currentlyPlaying.genre === newSongGenre) {
      currentConsecutiveGenreCount++;
    }
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].genre === newSongGenre) {
        currentConsecutiveGenreCount++;
      } else {
        break; // terminó el bloque consecutivo
      }
    }

    // Si la tanda actual aún tiene cupo (< maxBatch):
    if (currentConsecutiveGenreCount < maxBatch) {
      // Si la que está sonando actualmente es de este género y en cola no hay aún, va de primera
      if (currentlyPlaying && currentlyPlaying.genre === newSongGenre && queue.length === 0) {
        return 0;
      }
      // Si hay temas de este género en la ventana inicial, insertarla justo tras el último de su tanda
      let lastMatchingIndex = -1;
      for (let i = 0; i < searchLimit; i++) {
        if (queue[i].genre === newSongGenre) {
          lastMatchingIndex = i;
        } else if (lastMatchingIndex !== -1) {
          // El bloque terminó
          break;
        }
      }
      if (lastMatchingIndex !== -1) {
        return lastMatchingIndex + 1;
      }
      if (currentlyPlaying && currentlyPlaying.genre === newSongGenre) {
        return 0;
      }
    }

    // 2. Si el bloque actual ya alcanzó el tamaño máximo de tanda (o no hay tanda activa de este género),
    // buscar si más adelante en la cola (respetando la ventana de espera) hay otro bloque de este género
    let laterMatchIndex = -1;
    for (let i = 0; i < searchLimit; i++) {
      if (queue[i].genre === newSongGenre) {
        laterMatchIndex = i;
      }
    }
    if (laterMatchIndex !== -1 && currentConsecutiveGenreCount < maxBatch) {
      return laterMatchIndex + 1;
    }

    // 3. De lo contrario, insertamos al final de la ventana de espera para abrir una nueva tanda ordenada
    return searchLimit;
  }

  /**
   * Genera una lista completa con Gemini a partir de una descripción en lenguaje natural
   */
  async generatePlaylistWithAI(promptText, apiKey) {
    const prompt = `Eres un experto DJ y programador musical de bares en Colombia y Latinoamérica.
Genera una lista de 8 canciones recomendadas para la siguiente petición:
"${promptText}"

Devuelve ÚNICAMENTE un JSON válido (un array de objetos) con el siguiente formato exacto, sin bloques markdown extra:
[
  {
    "title": "Nombre de la canción",
    "artist": "Nombre del artista",
    "genre": "Salsa | Popular | Vallenato | Reggaetón | Merengue / Bachata | Rock / Pop"
  }
]`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 }
      })
    });

    if (!response.ok) {
      throw new Error(`Error en Gemini API: ${response.status}`);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    // Limpiar markdown si viene envuelto en ```json ... ```
    const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  }

  /**
   * Generador inteligente automático sin requerir clave de API (Fallback con YouTube)
   */
  async generatePlaylistFallback(promptText) {
    const youtube = require('./youtube');

    // Detectar género musical a partir del texto
    let detectedGenre = 'Crossover';
    const lowerPrompt = (promptText || '').toLowerCase();
    for (const rule of GENRE_RULES) {
      for (const kw of rule.keywords) {
        if (lowerPrompt.includes(kw)) {
          detectedGenre = rule.genre;
          break;
        }
      }
      if (detectedGenre !== 'Crossover') break;
    }

    // Limpiar palabras de orden
    const cleanTerms = lowerPrompt
      .replace(/crea|armame|arma|genera|dame|pon|quiero|una|lista|de|\d+|canciones|cancion|temas|lo|mas|mas|popular|exitos|exitos|para|el|bar|reggaeton|regaeton|salsa|popular|vallenato/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const searchQueries = [
      `${detectedGenre} ${cleanTerms} exitos`,
      `${promptText} exitos`,
      `${detectedGenre} perreo clasicos exitos`,
      `${detectedGenre} exitos mas escuchados`,
      `${detectedGenre} discoteca fiesta`
    ];

    const foundMap = new Map();
    for (const q of searchQueries) {
      if (foundMap.size >= 10) break;
      const results = await youtube.search(q, 8);
      for (const r of results) {
        const lowerTitle = r.title.toLowerCase();
        if (lowerTitle.startsWith('mix ') || lowerTitle.includes(' mix') || lowerTitle.includes('enganchado') || lowerTitle.includes('set ')) continue;
        if (!foundMap.has(r.videoId) && foundMap.size < 10) {
          foundMap.set(r.videoId, {
            videoId: r.videoId,
            title: r.title,
            artist: r.artist || detectedGenre,
            genre: detectedGenre,
            duration: r.duration,
            thumbnail: r.thumbnail
          });
        }
      }
    }

    return Array.from(foundMap.values());
  }
}

module.exports = new AIDJEngine();
