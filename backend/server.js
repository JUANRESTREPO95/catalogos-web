const express     = require('express');
const fs          = require('fs');
const path        = require('path');
const multer      = require('multer');
const XLSX        = require('xlsx');
const PDFDocument = require('pdfkit');
const pdfParse    = require('pdf-parse');
const sharp       = require('sharp');
const speakeasy   = require('speakeasy');
const QRCode      = require('qrcode');
const app         = express();
const PRODUCTOS_PATH = '/data/productos.json';
const IMAGENES_PATH  = '/data/imagenes';
const CACHE_PATH     = '/data/imagenes_cache';
const AGOTADOS_PATH  = '/data/agotados';
const UBICACIONES_PATH = '/data/ubicaciones_vendedor.json';
const https = require('https');
const http = require('http');

async function obtenerCiudad(ip) {
  if (ip === 'unknown' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return 'Red local';
  }
  return new Promise((resolve) => {
    const url = `http://ip-api.com/json/${ip}?fields=status,country,regionName,city`;
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'success') {
            resolve(`${json.city}, ${json.regionName}, ${json.country}`);
          } else {
            resolve('No disponible');
          }
        } catch { resolve('No disponible'); }
      });
    }).on('error', (e) => { console.log('Error geolocalización:', e.message); resolve('No disponible'); });
  });
}

// CORS permitido solo para dominio oficial
app.use((req, res, next) => {
  const allowedOrigin = 'https://luxora-gems.col.lt';
  const origin = req.headers.origin;
  if (origin === allowedOrigin) {
    res.header('Access-Control-Allow-Origin', allowedOrigin);
  }
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-password');
  if (req.method === 'OPTIONS') {
    if (origin !== allowedOrigin) return res.sendStatus(403);
    return res.sendStatus(204);
  }
  next();
});

if (!fs.existsSync(CACHE_PATH)) fs.mkdirSync(CACHE_PATH, { recursive: true });

// ════════════════════════════════
//  PRE-CALENTAR CACHÉ AL ARRANCAR
// ════════════════════════════════
async function precalentarCache() {
  if (!fs.existsSync(IMAGENES_PATH)) return;
  const todasLasImagenes = [];
  function recorrer(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) recorrer(fullPath);
      else if (/\.(jpg|jpeg|png|webp)$/i.test(entry.name)) todasLasImagenes.push(fullPath);
    }
  }
  recorrer(IMAGENES_PATH);
  const total = todasLasImagenes.length;
  console.log(`🖼  Precalentando caché: ${total} imágenes...`);
  let procesadas = 0, omitidas = 0, errores = 0;
  const WIDTH_WEB = 800;  // WebP para página
  const WIDTH_PDF = 800;  // JPEG para PDF
  const CONCURRENCIA = 8;
  for (let i = 0; i < todasLasImagenes.length; i += CONCURRENCIA) {
    const lote = todasLasImagenes.slice(i, i + CONCURRENCIA);
    await Promise.all(lote.map(async (origPath) => {
      try {
        const relPath       = path.relative(IMAGENES_PATH, origPath);
        const cachePathWebp = path.join(CACHE_PATH, relPath.replace(/[\\/]/g, '_') + `_w${WIDTH_WEB}.webp`);
        const cachePathJpeg = path.join(CACHE_PATH, relPath.replace(/[\/]/g, '_') + `_w${WIDTH_PDF}.jpg`);
        const yaWebp = fs.existsSync(cachePathWebp);
        const yaJpeg = fs.existsSync(cachePathJpeg);
        if (yaWebp && yaJpeg) { omitidas++; return; }
        if (!yaWebp) await sharp(origPath).resize({ width: WIDTH_WEB, withoutEnlargement: true }).webp({ quality: 88 }).toFile(cachePathWebp);
        if (!yaJpeg) await sharp(origPath).resize({ width: WIDTH_PDF, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(cachePathJpeg);
        procesadas++;
      } catch (err) {
        errores++;
        console.error(`  ✗ Error en ${origPath}: ${err.message}`);
      }
    }));
    if ((i + CONCURRENCIA) % 100 === 0 || i + CONCURRENCIA >= total) {
      console.log(`  → ${Math.min(i + CONCURRENCIA, total)}/${total} completadas`);
    }
  }
  console.log(`✅ Caché listo — procesadas: ${procesadas}, ya existían: ${omitidas}, errores: ${errores}`);
}
precalentarCache().catch(err => console.error('Error precalentando caché:', err));

// ════════════════════════════════
//  WATCHER — procesar imágenes nuevas automáticamente
// ════════════════════════════════
const IMG_WIDTH_WEB = 800;
const IMG_WIDTH_PDF = 800;
function procesarImagenNueva(fullPath) {
  if (!/\.(jpg|jpeg|png|webp)$/i.test(fullPath)) return;
  const relPath       = path.relative(IMAGENES_PATH, fullPath);
  const cachePathWebp = path.join(CACHE_PATH, relPath.replace(/[\\/]/g, '_') + `_w${IMG_WIDTH_WEB}.webp`);
  const cachePathJpeg = path.join(CACHE_PATH, relPath.replace(/[\/]/g, '_') + `_w${IMG_WIDTH_PDF}.jpg`);
  if (fs.existsSync(cachePathWebp) && fs.existsSync(cachePathJpeg)) return;
  setTimeout(async () => {
    try {
      if (!fs.existsSync(cachePathWebp))
        await sharp(fullPath).resize({ width: IMG_WIDTH_WEB, withoutEnlargement: true }).webp({ quality: 88 }).toFile(cachePathWebp);
      if (!fs.existsSync(cachePathJpeg))
        await sharp(fullPath).resize({ width: IMG_WIDTH_PDF, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(cachePathJpeg);
      invalidarMapaImagenes();
      console.log(`✅ Nueva imagen cacheada: ${relPath}`);
    } catch (err) {
      console.error(`✗ Error cacheando ${relPath}: ${err.message}`);
    }
  }, 500);
}

fs.watch(IMAGENES_PATH, { recursive: true }, (evento, archivo) => {
  if (!archivo) return;
  const fullPath = path.join(IMAGENES_PATH, archivo);
  if (evento === 'rename' && fs.existsSync(fullPath)) procesarImagenNueva(fullPath);
});
console.log('👁  Watching imagenes/ para nuevas fotos...');

app.use(express.json({ limit: '50mb' }));

// ── Ruta de imágenes optimizadas con caché ──
app.get('/imagenes/*path', async (req, res) => {
  try {
    const relPath   = (Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path).replace(/^\/+/, "");
    const origPath  = path.join(IMAGENES_PATH, relPath);
    if (!fs.existsSync(origPath)) return res.status(404).send('Not found');
    const cachePath = path.join(CACHE_PATH, relPath.replace(/[\\/]/g, '_') + `_w${IMG_WIDTH_WEB}.webp`);
    if (fs.existsSync(cachePath)) {
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(cachePath).pipe(res);
    }
    const outputBuffer = await sharp(origPath)
      .resize({ width: IMG_WIDTH_WEB, withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer();
    fs.writeFileSync(cachePath, outputBuffer);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(outputBuffer);
  } catch (err) {
    console.error('Error optimizando imagen:', err.message);
    res.status(500).send('Error');
  }
});

app.use(express.static('/data/frontend'));

// ════════════════════════════════
//  HELPERS JSON
// ════════════════════════════════
function leerProductos() {
  if (!fs.existsSync(PRODUCTOS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(PRODUCTOS_PATH, 'utf8')); }
  catch(e) { console.error('⚠️  productos.json corrupto:', e.message); return []; }
}
function guardarProductos(productos) {
  fs.writeFileSync(PRODUCTOS_PATH, JSON.stringify(productos, null, 2), 'utf8');
}

const EXISTENCIAS_PATH = '/data/existencias.json';
function leerExistencias() {
  if (!fs.existsSync(EXISTENCIAS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(EXISTENCIAS_PATH, 'utf8')); }
  catch(e) { console.error('⚠️  existencias.json corrupto:', e.message); return {}; }
}
function guardarExistencias(data) {
  fs.writeFileSync(EXISTENCIAS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ════════════════════════════════
//  ESCANEAR IMÁGENES — con cache en memoria
// ════════════════════════════════
function escanearImagenes() {
  const mapa = {};
  if (!fs.existsSync(IMAGENES_PATH)) return mapa;
  const categorias = fs.readdirSync(IMAGENES_PATH, { withFileTypes: true })
    .filter(d => d.isDirectory());
  for (const cat of categorias) {
    const catPath = path.join(IMAGENES_PATH, cat.name);
    const subcats = fs.readdirSync(catPath, { withFileTypes: true })
      .filter(d => d.isDirectory());
    if (subcats.length === 0) {
      const archivos = fs.readdirSync(catPath).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
      for (const archivo of archivos) {
        const ref = path.parse(archivo).name.toUpperCase();
        mapa[ref] = { img: `/imagenes/${cat.name}/${archivo}`, categoria: cat.name, subcategoria: '' };
      }
    } else {
      for (const sub of subcats) {
        const subPath  = path.join(catPath, sub.name);
        const archivos = fs.readdirSync(subPath).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
        for (const archivo of archivos) {
          const ref = path.parse(archivo).name.toUpperCase();
          mapa[ref] = { img: `/imagenes/${cat.name}/${sub.name}/${archivo}`, categoria: cat.name, subcategoria: sub.name };
        }
      }
    }
  }
  return mapa;
}

let _mapaCache = null;
function getMapaImagenes() {
  if (!_mapaCache) {
    _mapaCache = escanearImagenes();
    console.log(`🗂  Mapa imágenes: ${Object.keys(_mapaCache).length} entradas`);
  }
  return _mapaCache;
}
function invalidarMapaImagenes() { _mapaCache = null; }

// ════════════════════════════════
//  AUTH
// ════════════════════════════════
const CLAVES_PATH     = '/data/claves.json';
const DESTACADOS_PATH = '/data/destacados.json';
const NUEVOS_PATH     = '/data/nuevos.json';
const CONTACTOS_PATH  = '/data/contactos.json';
function leerDestacados() {
  if (!fs.existsSync(DESTACADOS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(DESTACADOS_PATH, 'utf8')); }
  catch(e) { console.error('⚠️  destacados.json corrupto:', e.message); return []; }
}
function guardarDestacados(lista) {
  fs.writeFileSync(DESTACADOS_PATH, JSON.stringify(lista, null, 2));
}
function leerNuevos() {
  if (!fs.existsSync(NUEVOS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(NUEVOS_PATH, 'utf8')); }
  catch(e) { console.error('⚠️  nuevos.json corrupto:', e.message); return []; }
}
function guardarNuevos(lista) {
  fs.writeFileSync(NUEVOS_PATH, JSON.stringify(lista, null, 2));
}
function leerContactos() {
  if (!fs.existsSync(CONTACTOS_PATH)) return { introduccion: '', contactos: [] };
  return JSON.parse(fs.readFileSync(CONTACTOS_PATH, 'utf8'));
}
function guardarContactos(data) {
  fs.writeFileSync(CONTACTOS_PATH, JSON.stringify(data, null, 2));
}
function leerClaves() {
  if (!fs.existsSync(CLAVES_PATH)) {
    const defaults = { admin: '1234', vendedor: '123', usuario: '123' };
    fs.writeFileSync(CLAVES_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CLAVES_PATH, 'utf8'));
}
function guardarClaves(claves) {
  fs.writeFileSync(CLAVES_PATH, JSON.stringify(claves, null, 2));
}
function checkAuth(req, res, next) {
  const clave  = req.headers['x-admin-password'];
  const claves = leerClaves();
  // Aceptar admin, vendedor o usuario
  if (clave !== claves.admin && clave !== claves.vendedor && clave !== claves.usuario) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  // Guardar el rol según la contraseña usada
  if (clave === claves.admin) req.adminRol = 'admin';
  else if (clave === claves.vendedor) req.adminRol = 'vendedor';
  else if (clave === claves.usuario) req.adminRol = 'usuario';
  next();
}
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const claves = leerClaves();
  if (password !== claves.admin) return res.status(401).json({ error: 'Contraseña incorrecta' });
  
  // Si 2FA está habilitado, pedir código
  if (claves.admin2FA?.enabled) {
    return res.status(400).json({ error: 'Código 2FA requerido', requires2FA: true });
  }
  
  res.json({ ok: true });
});
app.post('/api/vendedor/login', async (req, res) => {
  const { password } = req.body;
  const claves = leerClaves();
  if (password === claves.vendedor) {
    let ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || req.ip || 'unknown';
    if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
    const ciudad = await obtenerCiudad(ip);
    const ahora = new Date().toISOString();
    let datos = [];
    try {
      if (fs.existsSync(UBICACIONES_PATH)) {
        datos = JSON.parse(fs.readFileSync(UBICACIONES_PATH, 'utf8'));
      }
    } catch (e) { console.log('Error leyendo:', e.message); }
    datos.unshift({ fecha: ahora, ip: ip, ciudad: ciudad });
    try {
      fs.writeFileSync(UBICACIONES_PATH, JSON.stringify(datos, null, 2));
      console.log('✅ Ubicación guardada:', ip, '->', ciudad);
    } catch (e) { console.log('Error escribiendo:', e.message); }
    res.json({ ok: true });
  }
  else res.status(401).json({ error: 'Contraseña incorrecta' });
});
app.post('/api/usuario/login', (req, res) => {
  const { password } = req.body;
  const claves = leerClaves();
  if (password === claves.usuario) res.json({ ok: true, rol: 'usuario' });
  else res.status(401).json({ error: 'Contraseña incorrecta' });
});

// 2FA Setup - Generar QR para admin
app.post('/api/admin/2fa/setup', checkAuth, async (req, res) => {
  if (req.adminRol !== 'admin') return res.status(403).json({ error: 'Solo admin puede configurar 2FA' });
  
  const secret = speakeasy.generateSecret({ name: 'Luxora Gems Admin' });
  const qr = await QRCode.toDataURL(secret.otpauth_url);
  
  const claves = leerClaves();
  claves.admin2FA = { enabled: false, secret: secret.base32 };
  guardarClaves(claves);
  
  res.json({ qr, secret: secret.base32 });
});

// 2FA Verify - Verificar código y activar
app.post('/api/admin/2fa/verify', checkAuth, async (req, res) => {
  const { code } = req.body;
  const claves = leerClaves();
  const secret = claves.admin2FA?.secret;
  
  if (!secret) return res.status(400).json({ error: 'No hay secretos configurado' });
  
  const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 1 });
  
  if (verified) {
    claves.admin2FA.enabled = true;
    guardarClaves(claves);
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Código inválido' });
  }
});

// 2FA Login - Login con 2FA
app.post('/api/admin/login/2fa', (req, res) => {
  const { password, code } = req.body;
  const claves = leerClaves();
  
  if (password !== claves.admin) return res.status(401).json({ error: 'Contraseña incorrecta' });
  
  // Si 2FA está enabled, verificar código
  if (claves.admin2FA?.enabled) {
    if (!code) return res.status(400).json({ error: 'Código 2FA requerido', requires2FA: true });
    const secret = claves.admin2FA.secret;
    const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 1 });
    if (!verified) return res.status(401).json({ error: 'Código 2FA inválido' });
  }
  
  res.json({ ok: true });
});

// 2FA Disable - Desactivar 2FA
app.post('/api/admin/2fa/disable', checkAuth, async (req, res) => {
  const { code } = req.body;
  if (req.adminRol !== 'admin') return res.status(403).json({ error: 'Solo admin puede desactivar 2FA' });
  
  const claves = leerClaves();
  const secret = claves.admin2FA?.secret;
  
  if (!secret) return res.status(400).json({ error: '2FA no está configurado' });
  
  const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 1 });
  if (!verified) return res.status(401).json({ error: 'Código inválido' });
  
  claves.admin2FA = { enabled: false, secret: null };
  guardarClaves(claves);
  res.json({ ok: true });
});

// 2FA Status - Consultar estado
app.get('/api/admin/2fa/status', checkAuth, (req, res) => {
  const claves = leerClaves();
  res.json({ enabled: claves.admin2FA?.enabled || false });
});

app.post('/api/admin/claves', checkAuth, (req, res) => {
  const { tipo, nueva, confirmar } = req.body;
  if (!tipo || !nueva || !confirmar) return res.status(400).json({ error: 'Faltan campos' });
  if (nueva !== confirmar) return res.status(400).json({ error: 'Las contraseñas no coinciden' });
  if (nueva.length < 4) return res.status(400).json({ error: 'Mínimo 4 caracteres' });
  if (!['admin','vendedor','usuario','api_existencias'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });

  // Vendedor no puede cambiar claves desde panel admin
  if (req.adminRol === 'vendedor') {
    return res.status(403).json({ error: 'No tienes permisos para cambiar contraseñas' });
  }

  // Usuario no puede cambiar clave de admin
  if (req.adminRol === 'usuario' && tipo === 'admin') {
    return res.status(403).json({ error: 'No tienes permisos para cambiar contraseña admin' });
  }
  
  const claves = leerClaves();
  claves[tipo] = nueva;
  guardarClaves(claves);
  res.json({ ok: true });
});

// ════════════════════════════════
//  API CATÁLOGO
// ════════════════════════════════
app.get('/api/productos', (req, res) => {
  try {
    const productos   = leerProductos();
    const mapa        = getMapaImagenes();
    const destacados  = new Set(leerDestacados().map(r => r.toUpperCase()));
    const nuevos      = new Set(leerNuevos().map(r => r.toUpperCase()));
    const existencias = leerExistencias();
    const resultado   = productos.map(p => {
      const ref  = p.ref.toUpperCase();
      const info = mapa[ref] || {};
      return {
        ref:          p.ref,
        nombre:       p.nombre,
        precio:       p.precio,
        img:          info.img          || null,
        categoria:    info.categoria    || 'Sin categoría',
        subcategoria: info.subcategoria || 'Sin subcategoría',
        destacado:    destacados.has(ref),
        nuevo:        nuevos.has(ref),
        existencia:   existencias[ref] || 0
      };
    });
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error leyendo productos' });
  }
});

app.get('/api/productos/refs', (req, res) => {
  try {
    const productos = leerProductos();
    const refs = productos.map(p => p.ref.toUpperCase());
    res.json({ refs });
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo productos' });
  }
});
app.get('/api/categorias', (req, res) => {
  const mapa = getMapaImagenes();
  const cats = {};
  for (const info of Object.values(mapa)) {
    if (!cats[info.categoria]) cats[info.categoria] = new Set();
    cats[info.categoria].add(info.subcategoria);
  }
  res.json(Object.entries(cats).map(([cat, subs]) => ({
    categoria: cat,
    subcategorias: [...subs]
  })));
});

// ════════════════════════════════
//  API DESTACADOS
// ════════════════════════════════
app.get('/api/destacados', checkAuth, (req, res) => {
  res.json(leerDestacados());
});
app.post('/api/destacados/toggle', checkAuth, (req, res) => {
  const { ref } = req.body;
  if (!ref) return res.status(400).json({ error: 'Falta ref' });
  const refUp  = ref.toUpperCase();
  let lista    = leerDestacados().map(r => r.toUpperCase());
  const idx    = lista.indexOf(refUp);
  if (idx === -1) lista.push(refUp);
  else            lista.splice(idx, 1);
  guardarDestacados(lista);
  res.json({ ok: true, destacado: idx === -1, total: lista.length });
});

// ════════════════════════════════
//  API LO NUEVO
// ════════════════════════════════
app.get('/api/nuevos', checkAuth, (req, res) => {
  res.json(leerNuevos());
});
app.post('/api/nuevos/toggle', checkAuth, (req, res) => {
  const { ref } = req.body;
  if (!ref) return res.status(400).json({ error: 'Falta ref' });
  const refUp = ref.toUpperCase();
  let lista   = leerNuevos().map(r => r.toUpperCase());
  const idx   = lista.indexOf(refUp);
  if (idx === -1) lista.push(refUp);
  else            lista.splice(idx, 1);
  guardarNuevos(lista);
  res.json({ ok: true, nuevo: idx === -1, total: lista.length });
});

// ════════════════════════════════
//  IMPORTAR EXCEL → DESTACADOS
// ════════════════════════════════
const uploadDest = multer({ storage: multer.memoryStorage() });
app.post('/api/destacados/importar', checkAuth, uploadDest.single('archivo'), (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const filas    = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const mapa     = getMapaImagenes();
    const lista    = [];
    for (let i = 1; i < filas.length; i++) {
      const ref = filas[i][0] ? String(filas[i][0]).trim().toUpperCase() : '';
      if (ref && mapa[ref]) lista.push(ref);
    }
    guardarDestacados(lista);
    res.json({ ok: true, total: lista.length });
  } catch(err) {
    res.status(500).json({ error: 'Error procesando Excel: ' + err.message });
  }
});

// ════════════════════════════════
//  IMPORTAR EXCEL → NUEVOS
// ════════════════════════════════
app.post('/api/nuevos/importar', checkAuth, uploadDest.single('archivo'), (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const filas    = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const mapa     = getMapaImagenes();
    const lista    = [];
    for (let i = 1; i < filas.length; i++) {
      const ref = filas[i][0] ? String(filas[i][0]).trim().toUpperCase() : '';
      if (ref && mapa[ref]) lista.push(ref);
    }
    guardarNuevos(lista);
    res.json({ ok: true, total: lista.length });
  } catch(err) {
    res.status(500).json({ error: 'Error procesando Excel: ' + err.message });
  }
});

// ════════════════════════════════
//  API CONTACTOS
// ════════════════════════════════
app.get('/api/contactos', (req, res) => {
  res.json(leerContactos());
});
app.post('/api/admin/contactos', checkAuth, (req, res) => {
  const { introduccion, contactos } = req.body;
  if (introduccion === undefined || !Array.isArray(contactos))
    return res.status(400).json({ error: 'Datos inválidos' });
  guardarContactos({ introduccion, contactos });
  res.json({ ok: true });
});

// ════════════════════════════════
//  API ADMIN — CRUD
// ════════════════════════════════
app.get('/api/admin/productos', checkAuth, (req, res) => {
  res.json(leerProductos());
});
app.post('/api/admin/productos', checkAuth, (req, res) => {
  const { ref, nombre, precio } = req.body;
  if (!ref || !nombre || precio === undefined)
    return res.status(400).json({ error: 'Faltan campos: ref, nombre, precio' });
  const productos = leerProductos();
  if (productos.find(p => p.ref.toUpperCase() === ref.toUpperCase()))
    return res.status(409).json({ error: `Ya existe un producto con ref "${ref}"` });
  productos.push({ ref: ref.toUpperCase(), nombre, precio: Number(precio) });
  guardarProductos(productos);
  res.json({ ok: true });
});
app.put('/api/admin/productos/:ref', checkAuth, (req, res) => {
  const refBuscar = req.params.ref.toUpperCase();
  const { nombre, precio } = req.body;
  const productos = leerProductos();
  const idx = productos.findIndex(p => p.ref.toUpperCase() === refBuscar);
  if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
  if (nombre !== undefined) productos[idx].nombre = nombre;
  if (precio !== undefined) productos[idx].precio = Number(precio);
  guardarProductos(productos);
  res.json({ ok: true });
});
app.delete('/api/admin/productos/:ref', checkAuth, (req, res) => {
  const refBuscar = req.params.ref.toUpperCase();
  const productos = leerProductos();
  const nuevos    = productos.filter(p => p.ref.toUpperCase() !== refBuscar);
  if (nuevos.length === productos.length)
    return res.status(404).json({ error: 'Producto no encontrado' });
  guardarProductos(nuevos);

  // Borrar imagen original y archivos de caché
  const mapa = getMapaImagenes();
  const info = mapa[refBuscar];
  if (info && info.img) {
    const origPath = path.join(IMAGENES_PATH, info.img.replace('/imagenes/', ''));
    if (fs.existsSync(origPath)) {
      try { fs.unlinkSync(origPath); } catch(e) { console.error('Error borrando imagen:', e.message); }
    }
    const relPath = info.img.replace('/imagenes/', '');
    const prefijo = relPath.replace(/[\\/]/g, '_');
    const categoria = relPath.split(/[\\/]/)[0];
    if (fs.existsSync(CACHE_PATH)) {
      for (const archivo of fs.readdirSync(CACHE_PATH)) {
        if (archivo.startsWith(prefijo)) {
          if (archivo.endsWith('.webp')) {
            const destDir = path.join(AGOTADOS_PATH, categoria);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            try {
              const src = path.join(CACHE_PATH, archivo);
              const dst = path.join(destDir, archivo);
              fs.copyFileSync(src, dst);
              fs.unlinkSync(src);
              console.log(`📦 WebP movido a agotados/${categoria}/${archivo}`);
            } catch(e) { console.error('Error moviendo .webp:', e.message); }
          } else {
            try { fs.unlinkSync(path.join(CACHE_PATH, archivo)); } catch(e) { console.error('Error borrando caché:', e.message); }
          }
        }
      }
    }
    invalidarMapaImagenes();
  }

  res.json({ ok: true });
});

// ════════════════════════════════
//  AGOTADOS — ver productos eliminados
// ════════════════════════════════
app.get('/api/admin/agotados/categorias', checkAuth, (req, res) => {
  if (!fs.existsSync(AGOTADOS_PATH)) return res.json([]);
  const cats = fs.readdirSync(AGOTADOS_PATH, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
  res.json(cats);
});

app.get('/api/admin/agotados/:categoria', checkAuth, (req, res) => {
  const catPath = path.join(AGOTADOS_PATH, req.params.categoria);
  if (!fs.existsSync(catPath)) return res.json([]);
  const archivos = fs.readdirSync(catPath).filter(f => f.endsWith('.webp')).sort();
  res.json(archivos);
});

app.get('/api/admin/agotados/img/:categoria/:archivo', (req, res) => {
  const filePath = path.join(AGOTADOS_PATH, req.params.categoria, req.params.archivo);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// ════════════════════════════════
//  LIMPIAR CACHÉ DE IMÁGENES
// ════════════════════════════════
app.post('/api/admin/limpiar-cache', checkAuth, async (req, res) => {
  try {
    if (!fs.existsSync(CACHE_PATH)) return res.json({ ok: true, borrados: 0 });
    const archivos = fs.readdirSync(CACHE_PATH);
    let borrados = 0;
    for (const archivo of archivos) {
      try { fs.unlinkSync(path.join(CACHE_PATH, archivo)); borrados++; } catch(e) {}
    }
    invalidarMapaImagenes();
    precalentarCache().catch(err => console.error('Error recalentando caché:', err));
    res.json({ ok: true, borrados });
  } catch(err) {
    res.status(500).json({ error: 'Error limpiando caché: ' + err.message });
  }
});

// ════════════════════════════════
//  API ADMIN — IMPORTAR EXCEL
// ════════════════════════════════
const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/admin/importar', checkAuth, upload.single('archivo'), (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const filas    = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const productos = leerProductos();
    const mapa = getMapaImagenes();
    let agregados = 0, actualizados = 0, saltados = 0;
    for (let i = 1; i < filas.length; i++) {
      const f      = filas[i];
      const ref    = f[0] ? String(f[0]).trim() : '';
      const nombre = f[1] ? String(f[1]).trim() : '';
      const precio = parseFloat(f[2]) || 0;
      if (!ref || !nombre) { saltados++; continue; }
      if (!mapa[ref.toUpperCase()]) { saltados++; continue; }
      const idx = productos.findIndex(p => p.ref.toUpperCase() === ref.toUpperCase());
      if (idx >= 0) {
        productos[idx].nombre = nombre;
        productos[idx].precio = precio;
        actualizados++;
      } else {
        productos.push({ ref: ref.toUpperCase(), nombre, precio });
        agregados++;
      }
    }
    guardarProductos(productos);
    res.json({ ok: true, agregados, actualizados, saltados });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando el archivo: ' + err.message });
  }
});

// ════════════════════════════════
//  GENERAR PDF DEL PEDIDO
// ════════════════════════════════
app.post('/api/pedido/pdf', (req, res) => {
  const { items } = req.body;
  if (!items || items.length === 0)
    return res.status(400).json({ error: 'Carrito vacío' });
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="pedido.pdf"');
  doc.pipe(res);
  doc.fontSize(22).fillColor('#e91e63').text('Luxora Gems', { align: 'center' });
  doc.fontSize(13).fillColor('#333').text('Resumen del Pedido', { align: 'center' });
  doc.fontSize(10).fillColor('#888')
    .text(new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' }), { align: 'center' });
  doc.moveDown(1.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e91e63').lineWidth(2).stroke();
  doc.moveDown(0.8);
  const colRef=50, colNombre=130, colCant=320, colPU=375, colSub=460, rowH=22;
  const headerY = doc.y;
  doc.rect(50, headerY, 495, rowH).fill('#1a1a2e');
  doc.fontSize(10).fillColor('white')
    .text('REF',      colRef,    headerY + 6, { width: 75 })
    .text('NOMBRE',   colNombre, headerY + 6, { width: 185 })
    .text('CANT',     colCant,   headerY + 6, { width: 50,  align: 'center' })
    .text('P. UNIT',  colPU,     headerY + 6, { width: 80,  align: 'right' })
    .text('SUBTOTAL', colSub,    headerY + 6, { width: 80,  align: 'right' });
  doc.y = headerY + rowH + 2;

  // Función para redibujar el encabezado en páginas nuevas
  function dibujarEncabezadoTabla() {
    const hY = doc.y;
    doc.rect(50, hY, 495, rowH).fill('#1a1a2e');
    doc.fontSize(10).fillColor('white')
      .text('REF',      colRef,    hY + 6, { width: 75 })
      .text('NOMBRE',   colNombre, hY + 6, { width: 185 })
      .text('CANT',     colCant,   hY + 6, { width: 50,  align: 'center' })
      .text('P. UNIT',  colPU,     hY + 6, { width: 80,  align: 'right' })
      .text('SUBTOTAL', colSub,    hY + 6, { width: 80,  align: 'right' });
    doc.y = hY + rowH + 2;
  }

  const PAGE_BOTTOM = doc.page.height - 80;
  let total = 0;
  items.forEach((item, idx) => {
    const subtotal = item.precio * item.quantity;
    total += subtotal;

    // Salto de página si no cabe la siguiente fila
    if (doc.y + rowH > PAGE_BOTTOM) {
      doc.addPage();
      doc.moveDown(0.5);
      dibujarEncabezadoTabla();
    }

    const bg = idx % 2 === 0 ? '#f8f9fa' : '#ffffff';
    const y  = doc.y;
    doc.rect(50, y, 495, rowH).fill(bg);
    doc.fontSize(9).fillColor('#333')
      .text(item.ref,                                           colRef,    y + 6, { width: 75 })
      .text(item.nombre,                                        colNombre, y + 6, { width: 185 })
      .text(String(item.quantity),                              colCant,   y + 6, { width: 50,  align: 'center' })
      .text('$' + Number(item.precio).toLocaleString('es-CO'), colPU,     y + 6, { width: 80,  align: 'right' })
      .text('$' + subtotal.toLocaleString('es-CO'),            colSub,    y + 6, { width: 80,  align: 'right' });
    doc.y = y + rowH;
  });
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e91e63').lineWidth(1).stroke();
  doc.moveDown(0.8);
  const totalY = doc.y;
  doc.fontSize(12).fillColor('#1a1a2e').font('Helvetica-Bold')
    .text('TOTAL:', colPU, totalY, { width: 80, align: 'right' });
  doc.fontSize(13).fillColor('#e91e63')
    .text('$' + total.toLocaleString('es-CO'), colSub, totalY, { width: 80, align: 'right' });
  doc.moveDown(3);
  doc.fontSize(9).fillColor('#aaa').font('Helvetica').text('Generado por Luxora Gems', { align: 'center' });
  doc.end();
});

// ════════════════════════════════
//  GENERAR PDF CATÁLOGO CON FOTOS
// ════════════════════════════════
app.post('/api/catalogo/pdf', async (req, res) => {
  const { items, categoria, subcategoria } = req.body;
  if (!items || items.length === 0)
    return res.status(400).json({ error: 'No hay productos' });
  const COLS   = 1;
  const CELL_W = 290;
  const IMG_H  = 305;
  const TEXT_H = 58;
  const CELL_H = IMG_H + TEXT_H;
  const MARGIN = 14;
  const GAP    = 14;
  const PAGE_W = MARGIN * 2 + COLS * CELL_W + (COLS - 1) * GAP;
  const PAGE_H = 842;
  const doc = new PDFDocument({ margin: MARGIN, size: [PAGE_W, PAGE_H], autoFirstPage: true });
  res.setHeader('Content-Type', 'application/pdf');
  const catLabel = categoria && subcategoria
    ? `${categoria} — ${subcategoria}`
    : categoria || 'Todos los productos';
  const filename = 'catalogo_' + catLabel.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '') + '.pdf';
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  try {
    doc.fontSize(13).fillColor('#1a1a2e').font('Helvetica-Bold').text('LUXORA GEMS', { align: 'center' });
    doc.font('Helvetica');
    doc.fontSize(7).fillColor('#888')
      .text('Catálogo: ' + catLabel + '   ·   ' + new Date().toLocaleString('es-CO', { dateStyle: 'long' }), { align: 'center' });
    doc.moveDown(0.15);
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor('#dddddd').lineWidth(0.5).stroke();
    doc.moveDown(0.15);
    // Carga imagen de a una para no explotar la memoria con catálogos grandes
    async function cargarImagen(item) {
      if (!item.img) return null;
      const relPath      = item.img.replace('/imagenes/', '');
      const cacheKeyJpeg = relPath.replace(/[\/]/g, '_') + '_w800.jpg';
      const cachedJpeg   = path.join(CACHE_PATH, cacheKeyJpeg);
      try {
        if (fs.existsSync(cachedJpeg)) return fs.readFileSync(cachedJpeg);
        return await sharp(path.join(IMAGENES_PATH, relPath))
          .resize({ width: CELL_W * 2, withoutEnlargement: true })
          .jpeg({ quality: 88 }).toBuffer();
      } catch(e) { return null; }
    }
    const startY      = doc.y;
    const espPag1     = PAGE_H - MARGIN - startY;
    const espPagSig   = PAGE_H - MARGIN * 2;
    const filasPag1   = Math.floor(espPag1   / (CELL_H + 12));
    const filasPagSig = Math.floor(espPagSig / (CELL_H + 12));
    const gapPag1     = filasPag1   > 1 ? (espPag1   - filasPag1   * CELL_H) / (filasPag1   - 1) : 0;
    const gapPagSig   = filasPagSig > 1 ? (espPagSig - filasPagSig * CELL_H) / (filasPagSig - 1) : 0;
    let col = 0, fila = 0, pagina = 0, rowY = startY;
    function filasDePagina(p) { return p === 0 ? filasPag1   : filasPagSig; }
    function gapDePagina(p)   { return p === 0 ? gapPag1     : gapPagSig;   }
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const x    = MARGIN + col * (CELL_W + GAP);
      const y    = rowY;
      doc.save();
      doc.roundedRect(x, y, CELL_W, CELL_H, 3).fillAndStroke('#fafafa', '#eeeeee');
      doc.restore();
      const jpegBuf = await cargarImagen(item);
      if (jpegBuf) {
        try {
          doc.save();
          doc.rect(x, y, CELL_W, IMG_H).clip();
          const imgObj     = doc.openImage(jpegBuf);
          const imgAspect  = imgObj.width / imgObj.height;
          const cellAspect = CELL_W / IMG_H;
          let iw, ih, ix, iy;
          if (imgAspect > cellAspect) {
            iw = CELL_W; ih = CELL_W / imgAspect;
            ix = x; iy = y + (IMG_H - ih) / 2;
          } else {
            ih = IMG_H; iw = IMG_H * imgAspect;
            iy = y; ix = x + (CELL_W - iw) / 2;
          }
          doc.image(jpegBuf, ix, iy, { width: iw, height: ih });
          doc.restore();
        } catch(e) {
          doc.rect(x, y, CELL_W, IMG_H).fill('#f0f0f0');
          doc.fontSize(7).fillColor('#bbb').text('Sin imagen', x, y + IMG_H / 2 - 4, { width: CELL_W, align: 'center' });
        }
      } else {
        doc.rect(x, y, CELL_W, IMG_H).fill('#f0f0f0');
        doc.fontSize(7).fillColor('#bbb').text('Sin imagen', x, y + IMG_H / 2 - 4, { width: CELL_W, align: 'center' });
      }
      doc.rect(x, y + IMG_H, CELL_W, TEXT_H).fill('#ffffff');
      doc.moveTo(x + 10, y + IMG_H).lineTo(x + CELL_W - 10, y + IMG_H).strokeColor('#eeeeee').lineWidth(0.5).stroke();
      const tY = y + IMG_H + 7;
      doc.fontSize(7).fillColor('#aaaaaa').font('Helvetica')
        .text(item.ref, x, tY, { width: CELL_W, align: 'center', lineBreak: false });
      doc.fontSize(8.5).fillColor('#333333').font('Helvetica')
        .text(item.nombre, x + 4, tY + 12, { width: CELL_W - 8, align: 'center', lineBreak: false, ellipsis: true });
      doc.fontSize(11).fillColor('#1a1a2e').font('Helvetica-Bold')
        .text('$' + Number(item.precio).toLocaleString('es-CO'), x, tY + 28, { width: CELL_W, align: 'center', lineBreak: false });
      doc.font('Helvetica');
      col++;
      if (col >= COLS) {
        col = 0;
        fila++;
        if (fila >= filasDePagina(pagina)) {
          if (i < items.length - 1) {
            doc.addPage();
            pagina++;
            fila = 0;
            rowY = MARGIN;
          }
        } else {
          rowY += CELL_H + gapDePagina(pagina);
        }
      }
    }
    doc.moveDown(1);
    doc.fontSize(7).fillColor('#cccccc').font('Helvetica').text('© 2026 Desarrollado y producido por juanpablorestrepo95@gmail.com', { align: 'center' });
    doc.end();
  } catch(err) {
    console.error('Error generando catálogo PDF:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error generando PDF: ' + err.message });
  }
});

// ════════════════════════════════
//  LIMPIAR PRODUCTOS SIN IMAGEN
// ════════════════════════════════
app.post('/api/admin/limpiar', checkAuth, (req, res) => {
  const productos = leerProductos();
  const mapa      = getMapaImagenes();
  const antes     = productos.length;
  const limpios   = productos.filter(p => mapa[p.ref.toUpperCase()]);
  guardarProductos(limpios);
  res.json({ ok: true, eliminados: antes - limpios.length, quedaron: limpios.length });
});

// ════════════════════════════════
//  EXISTENCIAS — recibir desde .exe
// ════════════════════════════════
app.post('/api/existencias', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const claves = leerClaves();
  if (!apiKey || apiKey !== claves.api_existencias) {
    return res.status(401).json({ error: 'API key inválida' });
  }
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Se requiere un array items con {ref, existencia}' });
  }
  const existencias = {};
  for (const item of items) {
    if (item.ref && typeof item.existencia === 'number') {
      existencias[item.ref.toUpperCase()] = item.existencia;
    }
  }
  guardarExistencias(existencias);
  const total = Object.keys(existencias).length;
  console.log(`✅ Existencias actualizadas: ${total} productos`);
  res.json({ ok: true, actualizados: total });
});

// ════════════════════════════════
//  FACTURAS
// ════════════════════════════════
const MULTIPLICADOR = 2.5;
async function parsearFactura(buffer) {
  const parsed  = await pdfParse(buffer);
  const lines   = parsed.text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  let nroDoc = 'FACTURA';
  for (const l of lines) {
    const m = l.match(/Nro\.?\s*Doc\.?:\s*([A-Z][\s\d]+)/i);
    if (m) { nroDoc = m[1].replace(/\s/g, ''); break; }
  }
  let cliente = '';
  let cedula  = '';
  const razonMatches = [];
  for (const l of lines) {
    const mm = l.match(/^Raz[oó]n social\/Nombre:\s*(.+)/i);
    if (mm) razonMatches.push(mm[1].trim());
    if (!cedula && l.match(/C[eé]dula/i)) {
      const mc = l.match(/[\d]{6,}/);
      if (mc) cedula = mc[0];
    }
  }
  if (razonMatches.length >= 2) cliente = razonMatches[1];
  else if (razonMatches.length === 1) cliente = razonMatches[0];
  const items = [];
  for (const linea of lines) {
    const m = linea.match(/^\d{1,3}\s+([\w#.\-]+)\s+([\d.]+)\s+94\s+(.+?)\s+([\d,]+\.\d{2})(\s+IVA|$)/i);
    if (m) {
      const valUnit = parseFloat(m[4].replace(/,/g, ''));
      const cant    = parseFloat(m[2]);
      if (valUnit > 0 && cant > 0) {
        const precioReal = valUnit * MULTIPLICADOR;
        items.push({ ref: m[1], cant, nombre: m[3].trim(), valUnit: precioReal, subtotal: precioReal * cant });
      }
    }
  }
  return { nroDoc, cliente, cedula, items };
}
function escribirSeccionFactura(doc, factura, esUltima) {
  const { nroDoc, cliente, cedula, items } = factura;
  const colRef=50, colNombre=130, colCant=330, colPU=385, colSub=465, rowH=22;
  doc.fontSize(13).fillColor('#1a1a2e').font('Helvetica-Bold').text(`Factura ${nroDoc}`, 50);
  doc.font('Helvetica');
  if (cliente) doc.fontSize(9).fillColor('#555').text(`Cliente: ${cliente}${cedula ? '  |  Cédula: ' + cedula : ''}`, 50);
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e91e63').lineWidth(1).stroke();
  doc.moveDown(0.6);
  const headerY = doc.y;
  doc.rect(50, headerY, 495, rowH).fill('#1a1a2e');
  doc.fontSize(9).fillColor('white')
    .text('REF',      colRef,    headerY + 6, { width: 75 })
    .text('NOMBRE',   colNombre, headerY + 6, { width: 195 })
    .text('CANT',     colCant,   headerY + 6, { width: 50,  align: 'center' })
    .text('P. UNIT',  colPU,     headerY + 6, { width: 75,  align: 'right' })
    .text('SUBTOTAL', colSub,    headerY + 6, { width: 75,  align: 'right' });
  doc.y = headerY + rowH + 2;
  let subtotal = 0;
  items.forEach((item, idx) => {
    subtotal += item.subtotal;
    if (doc.y + rowH > doc.page.height - 80) doc.addPage();
    const bg = idx % 2 === 0 ? '#f8f9fa' : '#ffffff';
    const y  = doc.y;
    doc.rect(50, y, 495, rowH).fill(bg);
    doc.fontSize(8).fillColor('#333')
      .text(item.ref,                                    colRef,    y + 6, { width: 75 })
      .text(item.nombre,                                 colNombre, y + 6, { width: 195 })
      .text(String(item.cant),                           colCant,   y + 6, { width: 50,  align: 'center' })
      .text('$' + item.valUnit.toLocaleString('es-CO'),  colPU,     y + 6, { width: 75,  align: 'right' })
      .text('$' + item.subtotal.toLocaleString('es-CO'), colSub,    y + 6, { width: 75,  align: 'right' });
    doc.y = y + rowH;
  });
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e91e63').lineWidth(1).stroke();
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#1a1a2e').font('Helvetica-Bold')
    .text(`Subtotal factura ${nroDoc}:`, colPU, doc.y, { width: 75, align: 'right' });
  doc.fontSize(10).fillColor('#e91e63')
    .text('$' + subtotal.toLocaleString('es-CO'), colSub, doc.y - 14, { width: 75, align: 'right' });
  doc.font('Helvetica').moveDown(1.2);
  return subtotal;
}
app.post('/api/vendedor/facturas', upload.array('facturas', 50), async (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: 'No se recibieron archivos' });
  try {
    const facturas   = await Promise.all(req.files.map(f => parsearFactura(f.buffer)));
    const totalItems = facturas.reduce((s, f) => s + f.items.length, 0);
    if (totalItems === 0)
      return res.status(422).json({ error: 'No se encontraron productos en ninguna factura' });
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="pedido_combinado.pdf"');
    doc.pipe(res);
    doc.fontSize(22).fillColor('#e91e63').text('Luxora Gems', { align: 'center' });
    const nrosDocs = facturas.map(f => f.nroDoc).join(', ');
    doc.fontSize(12).fillColor('#333').text(`Pedido combinado — ${facturas.length} factura(s)`, { align: 'center' });
    doc.fontSize(10).fillColor('#888')
      .text(new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' }), { align: 'center' });
    doc.moveDown(0.5);
    const clientes = [...new Set(facturas.map(f => f.cliente).filter(Boolean))];
    if (clientes.length === 1) {
      const cedula = facturas.find(f => f.cedula)?.cedula || '';
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e91e63').lineWidth(2).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#1a1a2e').font('Helvetica-Bold').text('Cliente:', 50);
      doc.font('Helvetica').fillColor('#333').text(clientes[0], 50);
      if (cedula) doc.text('Cédula: ' + cedula, 50);
    }
    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e91e63').lineWidth(2).stroke();
    doc.moveDown(0.8);
    let grandTotal = 0;
    facturas.forEach((factura, i) => {
      if (factura.items.length === 0) return;
      if (i > 0 && doc.y > 100) {
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').lineWidth(1).stroke();
        doc.moveDown(0.8);
      }
      grandTotal += escribirSeccionFactura(doc, factura, i === facturas.length - 1);
    });
    if (facturas.length > 1) {
      if (doc.y + 60 > doc.page.height - 50) doc.addPage();
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e91e63').lineWidth(2).stroke();
      doc.moveDown(0.8);
      doc.fontSize(13).fillColor('#1a1a2e').font('Helvetica-Bold')
        .text('TOTAL GENERAL:', 50, doc.y, { width: 410, align: 'right' });
      doc.fontSize(14).fillColor('#e91e63')
        .text('$' + grandTotal.toLocaleString('es-CO'), 465, doc.y - 16, { width: 75, align: 'right' });
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#888').font('Helvetica').text(`Facturas incluidas: ${nrosDocs}`, { align: 'center' });
    }
    doc.moveDown(2);
    doc.fontSize(9).fillColor('#aaa').text('Generado por Luxora Gems', { align: 'center' });
    doc.end();
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando las facturas: ' + err.message });
  }
});


// ════════════════════════════════
//  MOCK CARTERA (Para Portafolio)
// ════════════════════════════════
app.get('/api/cartera-mock', (req, res) => {
  const action = req.query.action;
  const empresa = req.query.empresa || 'luxora_gems';

  if (action === 'cartera') {
    const anio = req.query.anio || '2026';
    const mes = req.query.mes || '01';
    
    res.json({
      encabezado: {
        totalSaldo: 1500000,
        saldoUltimos6Meses: 800000,
        saldoMas6Meses: 700000,
        totalDescuento: 50000,
        totalPagado: 1200000
      },
      datos: Array.from({ length: 50 }, (_, i) => ({
        fecha: `15/${Math.floor(Math.random() * 12) + 1}/${anio}`,
        factura: `FAC-${1000 + i}`,
        vendedor: ['Juan', 'Maria', 'Pedro', 'Ana'][Math.floor(Math.random() * 4)],
        ciudad: ['Bogotá', 'Medellín', 'Cali', 'Barranquilla'][Math.floor(Math.random() * 4)],
        monto: Math.floor(Math.random() * 500000) + 100000,
        estatus: 'Pendiente',
        dias: Math.floor(Math.random() * 90),
        saldo: Math.floor(Math.random() * 400000)
      }))
    });
  } else if (action === 'costos') {
    res.json({
      costos: {
        luxora_gems: {
          '2026': { 'ENERO': 5000, 'FEBRERO': 4500, 'MARZO': 6000 },
          '2025': { 'ENERO': 3000, 'FEBRERO': 3200 }
        },
        celeste_azure: { '2026': { 'ENERO': 2000 } }
      }
    });
  } else {
    res.status(400).json({ error: 'Acción no válida' });
  }
});


const MANIFIESTOS_PATH     = '/data/manifiestos.json';
const MANIFIESTOS_PDF_PATH = '/data/manifiestos';

function leerManifiestos() {
  if (!fs.existsSync(MANIFIESTOS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(MANIFIESTOS_PATH, 'utf8')); }
  catch(e) { return []; }
}
function guardarManifiestos(lista) {
  fs.writeFileSync(MANIFIESTOS_PATH, JSON.stringify(lista, null, 2), 'utf8');
}
function buscarManifiesto(ref) {
  const lista = leerManifiestos();
  return lista.find(m => m.referencia.toUpperCase() === ref.toUpperCase()) || null;
}

// HEAD — verifica si existe manifiesto para una ref
app.head('/api/manifiestos/:ref', (req, res) => {
  const entry = buscarManifiesto(req.params.ref);
  if (!entry) return res.status(404).end();
  const pdfPath = path.join(MANIFIESTOS_PDF_PATH, entry.manifiesto);
  if (!fs.existsSync(pdfPath)) return res.status(404).end();
  res.status(200).end();
});

// GET — descarga el PDF del manifiesto
app.get('/api/manifiestos/:ref', (req, res) => {
  const entry = buscarManifiesto(req.params.ref);
  if (!entry) return res.status(404).json({ error: 'Sin manifiesto para esta referencia' });
  const pdfPath = path.join(MANIFIESTOS_PDF_PATH, entry.manifiesto);
  if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: 'PDF no encontrado: ' + entry.manifiesto });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${entry.manifiesto}"`);
  fs.createReadStream(pdfPath).pipe(res);
});

// GET admin — listar todos los manifiestos
app.get('/api/admin/manifiestos', checkAuth, (req, res) => {
  res.json(leerManifiestos());
});

// POST admin — importar Excel (col A = referencia, col B = manifiesto)
// Fila 1 = encabezado (se salta). Solo refs en productos.json. Sin duplicados.
app.post('/api/admin/manifiestos/importar', checkAuth, uploadDest.single('archivo'), (req, res) => {
  try {
    const workbook    = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet       = workbook.Sheets[workbook.SheetNames[0]];
    const filas       = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const productos   = leerProductos();
    const refsValidas = new Set(productos.map(p => p.ref.toUpperCase()));
    const refsVistas  = new Set();
    // Cargar manifiestos existentes y construir mapa para merge
    const existentes  = leerManifiestos();
    const mapaExist   = new Map(existentes.map(m => [m.referencia.toUpperCase(), m]));
    let agregados = 0, reemplazados = 0, saltados = 0;
    for (let i = 1; i < filas.length; i++) {
      const referencia = filas[i][0] ? String(filas[i][0]).trim() : '';
      const manifiesto = filas[i][1] ? String(filas[i][1]).trim() : '';
      if (!referencia || !manifiesto) continue;
      const refUp = referencia.toUpperCase();
      if (!refsValidas.has(refUp) || refsVistas.has(refUp)) { saltados++; continue; }
      refsVistas.add(refUp);
      if (mapaExist.has(refUp)) { mapaExist.get(refUp).manifiesto = manifiesto; reemplazados++; }
      else                      { mapaExist.set(refUp, { referencia: refUp, manifiesto }); agregados++; }
    }
    const lista = [...mapaExist.values()];
    if (agregados + reemplazados === 0)
      return res.status(422).json({ error: 'Ninguna referencia del Excel coincide con productos del catálogo' });
    guardarManifiestos(lista);
    res.json({ ok: true, total: lista.length, agregados, reemplazados, saltados });
  } catch(err) {
    res.status(500).json({ error: 'Error procesando Excel: ' + err.message });
  }
});

// ════════════════════════════════
// ════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Luxora Gems corriendo en http://localhost:${PORT}`);
});
