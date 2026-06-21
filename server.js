const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PUERTO = 3000;
const CARPETA_PUBLICA = path.join(__dirname, 'public');
const CARPETA_DATOS = path.join(__dirname, 'data');

function cargarEnv() {
  const rutaEnv = path.join(__dirname, '.env');
  if (!fs.existsSync(rutaEnv)) return {};

  const contenido = fs.readFileSync(rutaEnv, 'utf8');
  const variables = {};
  contenido.split(/\r?\n/).forEach(linea => {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) return;
    const idx = limpia.indexOf('=');
    if (idx === -1) return;
    const clave = limpia.slice(0, idx).trim();
    const valor = limpia.slice(idx + 1).trim();
    variables[clave] = valor;
  });
  return variables;
}

const ENV = cargarEnv();
const URL_CSV_SHEET = process.env.GOOGLE_SHEET_CSV_URL || ENV.GOOGLE_SHEET_CSV_URL || '';
const USANDO_SHEET_REAL = Boolean(URL_CSV_SHEET);

const DURACION_CACHE_MS = 15 * 1000; // 15 segundos
let cachePartidos = { datos: null, expiraEn: 0 };

function descargarTexto(url, redireccionesRestantes = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (redireccionesRestantes <= 0) {
          return reject(new Error('Demasiadas redirecciones al descargar el CSV'));
        }
        res.resume(); 
        return resolve(descargarTexto(res.headers.location, redireccionesRestantes - 1));
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`El Sheet respondió con estado ${res.statusCode}`));
      }

      let cuerpo = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { cuerpo += chunk; });
      res.on('end', () => resolve(cuerpo));
    }).on('error', reject);
  });
}

function parsearLineaCSV(linea) {
  const campos = [];
  let actual = '';
  let dentroDeComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      dentroDeComillas = !dentroDeComillas;
    } else if (c === ',' && !dentroDeComillas) {
      campos.push(actual.trim());
      actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual.trim());
  return campos;
}

function normalizarEstado(textoEstado, hayMarcador) {
  const limpio = (textoEstado || '').toLowerCase().trim();
  if (limpio.includes('vivo')) return 'en_vivo';
  if (limpio.includes('final')) return 'finalizado';
  if (limpio === '' && hayMarcador) return 'finalizado'; 
  return 'programado';
}

function aNumeroOnull(texto) {
  if (texto === undefined || texto === null) return null;
  const limpio = String(texto).trim();
  if (limpio === '') return null;
  const n = parseInt(limpio, 10);
  return Number.isNaN(n) ? null : n;
}

function csvAMapaPorId(textoCSV) {
  const lineas = textoCSV.split(/\r?\n/).filter(l => l.trim() !== '');
  const mapa = {};

  lineas.forEach((linea, indice) => {
    const campos = parsearLineaCSV(linea);
    const idCampo = (campos[0] || '').trim();

    if (indice === 0 && Number.isNaN(parseInt(idCampo, 10))) return;
    if (idCampo === '') return;

    const marcadorLocal = aNumeroOnull(campos[4]);
    const marcadorVisitante = aNumeroOnull(campos[5]);
    const estado = normalizarEstado(campos[6], marcadorLocal !== null && marcadorVisitante !== null);

    mapa[idCampo] = { estado, marcadorLocal, marcadorVisitante };
  });

  return mapa;
}

function leerCalendarioFijo() {
  return new Promise((resolve, reject) => {
    const ruta = path.join(CARPETA_DATOS, 'partidos-demo.json');
    fs.readFile(ruta, 'utf8', (err, contenido) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(contenido));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function obtenerPartidosDesdeSheet() {
  const calendario = await leerCalendarioFijo();
  const textoCSV = await descargarTexto(URL_CSV_SHEET);
  const mapaEnVivo = csvAMapaPorId(textoCSV);

  const partidos = calendario.partidos.map(partido => {
    const enVivo = mapaEnVivo[partido.id];
    if (!enVivo) {
      return { ...partido, estado: 'programado', minuto: null, marcadorLocal: null, marcadorVisitante: null };
    }
    return {
      ...partido,
      estado: enVivo.estado,
      minuto: null,
      marcadorLocal: enVivo.marcadorLocal,
      marcadorVisitante: enVivo.marcadorVisitante
    };
  });

  return {
    ultimaActualizacion: new Date().toISOString(),
    partidos
  };
}

async function obtenerPartidos(callback) {
  const ahora = Date.now();

  if (cachePartidos.datos && ahora < cachePartidos.expiraEn) {
    return callback(null, cachePartidos.datos);
  }

  if (!USANDO_SHEET_REAL) {
    return obtenerPartidosDemo(callback);
  }

  try {
    const datos = await obtenerPartidosDesdeSheet();
    cachePartidos = { datos, expiraEn: ahora + DURACION_CACHE_MS };
    callback(null, datos);
  } catch (err) {
    console.error('⚠️  Error leyendo el Google Sheet, usando datos de ejemplo como respaldo:', err.message);
    obtenerPartidosDemo(callback);
  }
}

function obtenerPartidosDemo(callback) {
  leerCalendarioFijo()
    .then(datos => callback(null, datos))
    .catch(err => callback(err));
}

function obtenerPronosticos(callback) {
  const ruta = path.join(CARPETA_DATOS, 'pronosticos.json');
  fs.readFile(ruta, 'utf8', (err, contenido) => {
    if (err) return callback(err);
    try {
      callback(null, JSON.parse(contenido));
    } catch (e) {
      callback(e);
    }
  });
}

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function enviarJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function servirArchivoEstatico(req, res) {
  let rutaSolicitada = req.url === '/' ? '/index.html' : req.url;
  const rutaCompleta = path.join(CARPETA_PUBLICA, rutaSolicitada);

  if (!rutaCompleta.startsWith(CARPETA_PUBLICA)) {
    res.writeHead(403);
    return res.end('Prohibido');
  }

  fs.readFile(rutaCompleta, (err, contenido) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Archivo no encontrado: ' + rutaSolicitada);
    }
    const ext = path.extname(rutaCompleta);
    const tipo = TIPOS_MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': tipo });
    res.end(contenido);
  });
}

const servidor = http.createServer((req, res) => {
  if (req.url === '/api/partidos') {
    obtenerPartidos((err, datos) => {
      if (err) return enviarJSON(res, 500, { error: 'No se pudieron leer los partidos' });
      enviarJSON(res, 200, datos);
    });
    return;
  }

  if (req.url === '/api/pronosticos') {
    obtenerPronosticos((err, datos) => {
      if (err) return enviarJSON(res, 500, { error: 'No se pudieron leer los pronósticos' });
      enviarJSON(res, 200, datos);
    });
    return;
  }

  servirArchivoEstatico(req, res);
});

servidor.listen(PUERTO, () => {
  console.log('');
  console.log('🏆  Quiniela Familiar corriendo en:');
  console.log(`    http://localhost:${PUERTO}`);
  console.log('');
  if (USANDO_SHEET_REAL) {
    console.log('   ✅ Usando marcadores del Google Sheet (modo manual)');
  } else {
    console.log('   ℹ️  Usando datos de EJEMPLO (data/partidos-demo.json)');
    console.log('      Crea un archivo .env con GOOGLE_SHEET_CSV_URL=tu_url_csv para usar el Sheet real.');
  }
  console.log('');
  console.log('   Para detenerlo: Ctrl + C en esta terminal');
  console.log('');
});
