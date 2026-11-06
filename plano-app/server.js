// Plano a AutoCAD: servidor local sin dependencias.
// Recibe la foto ya enderezada y limpia desde el navegador (PNG), la vectoriza con
// VectorCraft, exporta DXF a escala y genera DWG y vista previa con CADCraft.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { planoACad } = require('./plano');

const BASE = path.resolve(__dirname, '..');
const VC = path.join(BASE, 'vectorcraft', 'vectorcraft-0.21.1-windows-x64-portable', 'vectorcraft-cli.exe');
const CC = path.join(BASE, 'cadcraft', 'cadcraft-0.17.1-windows-x64-portable', 'cadcraft-cli.exe');
const PUB = path.join(__dirname, 'public');
const OUT = path.join(__dirname, 'planos');
const PORT = Number(process.env.PORT) || 8765;
const PRESETS = ['Technical Drawing', 'Line Art', 'Sketched Art', 'Black and White Logo'];
const MM_POR_UNIDAD = { mm: 1, cm: 10, m: 1000 };
const MAX_BYTES = 80 * 1024 * 1024;

for (const exe of [VC, CC]) {
  if (!fs.existsSync(exe)) { console.error('No encuentro ' + exe); process.exit(1); }
}
fs.mkdirSync(OUT, { recursive: true });

function ejecutar(exe, args) {
  return new Promise((ok, mal) => execFile(exe, args,
    { maxBuffer: 64 << 20, timeout: 10 * 60 * 1000, windowsHide: true },
    (err, so, se) => err ? mal(new Error(String(se || so || err.message).trim().slice(-800))) : ok(String(so))));
}
const pasos = (salida) => salida.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const barras = (p) => p.replace(/\\/g, '/');

// Las conversiones se hacen de una en una: el trazado usa mucha CPU y memoria.
let cola = Promise.resolve();
function enCola(fn) { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; }

// Retoques al DXF que exporta VectorCraft para que se vea bien en AutoCAD:
// - quita el color verdadero negro (código 420) de cada entidad; queda el color 7 de AutoCAD,
//   que se ve blanco sobre fondo oscuro y negro sobre fondo blanco;
// - con escala real, marca las unidades (INSUNITS 4 mm, 5 cm, 6 m): con una escala distinta
//   de 1 VectorCraft deja el dibujo "sin unidades" aunque las coordenadas ya estén en esa unidad.
function ajustarDxf(fichero, unidad) {
  const texto = fs.readFileSync(fichero, 'latin1');
  const salto = texto.includes('\r\n') ? '\r\n' : '\n';
  const lineas = texto.split(/\r?\n/);
  const fuera = [];
  for (let i = 0; i + 1 < lineas.length; i += 2) {
    const codigo = lineas[i].trim();
    if (codigo === '420' || codigo === '430') continue;
    fuera.push(lineas[i], lineas[i + 1]);
  }
  if (lineas.length % 2) fuera.push(lineas[lineas.length - 1]);
  let resultado = fuera.join(salto);
  if (unidad) {
    const codigo = { mm: 4, cm: 5, m: 6 }[unidad];
    resultado = resultado.replace(/(\$INSUNITS\r?\n\s*70\r?\n)\s*\d+/, `$1     ${codigo}`);
  }
  fs.writeFileSync(fichero, resultado, 'latin1');
}

async function convertir(png, q) {
  const nombre = String(q.get('name') || 'plano').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'plano';
  const sello = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const id = `${sello}-${nombre}`;
  const dir = path.join(OUT, id);
  fs.mkdirSync(dir, { recursive: true });
  const img = path.join(dir, 'foto-limpia.png');
  const dxf = path.join(dir, nombre + '.dxf');
  const dwg = path.join(dir, nombre + '.dwg');
  const prev = path.join(dir, 'vista-previa.png');
  fs.writeFileSync(img, png);

  const unidad = MM_POR_UNIDAD[q.get('unit')] ? q.get('unit') : 'm';
  const real = parseFloat(q.get('real'));
  const p1 = [parseFloat(q.get('x1')), parseFloat(q.get('y1'))], p2 = [parseFloat(q.get('x2')), parseFloat(q.get('y2'))];
  const px = [...p1, ...p2].every(Number.isFinite) ? Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) : 0;
  const url = (f) => `/planos/${encodeURIComponent(id)}/${encodeURIComponent(path.basename(f))}`;
  const t0 = Date.now();

  if (q.get('tipo') !== 'calco') {
    // Plano de vivienda: muros, puertas y ventanas reconocidos.
    const r = await planoACad(png, dir, nombre, {
      unidad, muros: q.get('muros') === 'dobles' ? 'dobles' : 'grueso',
      referencia: real > 0 && px > 0 ? { p1, p2, real } : null,
    }, ejecutar, CC);
    await ejecutar(CC, ['convert', dxf, dwg]);
    await ejecutar(CC, ['convert', dxf, prev]);
    return {
      tipo: 'plano', carpeta: dir, unidad, escala: r.origenEscala, resumen: r.modelo.resumen,
      avisos: r.modelo.avisos, segundos: Math.round((Date.now() - t0) / 1000),
      dxf: url(dxf), dwg: url(dwg), vista: url(prev),
    };
  }

  // Calco exacto con VectorCraft.
  const preset = PRESETS.includes(q.get('preset')) ? q.get('preset') : PRESETS[0];
  let escala = 1;
  let calibrado = false;
  if (real > 0 && px > 0) {
    // Tamaño de un píxel en la hoja de VectorCraft (72 ppp si el PNG no dice otra cosa).
    const info = pasos(await ejecutar(VC, ['run', '--in', img, '--cmd', 'select.all', '--cmd', 'image.info']))
      .find((s) => s.command === 'image.info').result;
    const mmPorPx = (info.width * 25.4 / 72) / info.pixelWidth;
    const enHoja = px * mmPorPx / MM_POR_UNIDAD[unidad]; // lo que mide la cota marcada en la hoja, en la unidad elegida
    escala = real / enHoja;
    calibrado = true;
  }

  const cmds = path.join(dir, 'comandos.json');
  fs.writeFileSync(cmds, JSON.stringify([
    { command: 'select.all', params: {} },
    { command: 'imageTrace.makeAndExpand', params: { preset } },
    { command: 'document.exportDxf', params: { path: barras(dxf), unit: unidad, scale: escala, version: '2018' } },
  ]));
  const res = pasos(await ejecutar(VC, ['run', '--in', img, '--commands', cmds]));
  const traza = (res.find((s) => s.command === 'imageTrace.makeAndExpand') || {}).result || {};
  ajustarDxf(dxf, calibrado ? unidad : null);
  await ejecutar(CC, ['convert', dxf, dwg]);
  await ejecutar(CC, ['convert', dxf, prev]);

  return {
    tipo: 'calco', carpeta: dir, preset, unidad, escala: calibrado ? 'medida' : 'ninguna', trazos: traza.paths || 0,
    segundos: Math.round((Date.now() - t0) / 1000), avisos: traza.warnings || [],
    dxf: url(dxf), dwg: url(dwg), vista: url(prev),
  };
}

function ipsLocales() {
  const ips = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const a of lista || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) ips.push(a.address);
  }
  // Las redes domésticas primero; 192.168.56.x suele ser VirtualBox.
  return ips.sort((a, b) => (a.startsWith('192.168.56.') ? 1 : 0) - (b.startsWith('192.168.56.') ? 1 : 0));
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.dxf': 'application/dxf', '.dwg': 'application/acad', '.json': 'application/json' };
function servirFichero(res, raiz, relativo, descarga) {
  const f = path.resolve(raiz, '.' + path.sep + relativo);
  if (!f.startsWith(raiz + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('No encontrado'); }
  const ext = path.extname(f).toLowerCase();
  const cab = { 'Content-Type': TIPOS[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (descarga && (ext === '.dxf' || ext === '.dwg')) cab['Content-Disposition'] = `attachment; filename="${path.basename(f)}"`;
  res.writeHead(200, cab);
  fs.createReadStream(f).pipe(res);
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }

// ---- Acceso: el propio PC entra sin más; cualquier otro dispositivo necesita la clave.
// La clave se guarda en clave.txt (no se sube a GitHub) o se da con la variable PLANO_CLAVE.
const FICHERO_CLAVE = path.join(__dirname, 'clave.txt');
let CLAVE = String(process.env.PLANO_CLAVE || '').trim();
if (!CLAVE && fs.existsSync(FICHERO_CLAVE)) CLAVE = fs.readFileSync(FICHERO_CLAVE, 'utf8').trim();
if (!CLAVE) { CLAVE = crypto.randomBytes(12).toString('base64url'); fs.writeFileSync(FICHERO_CLAVE, CLAVE + '\n'); }
const sinPrefijo = (ip) => String(ip || '').replace(/^::ffff:/, '');
const esLocal = (ip) => { ip = sinPrefijo(ip); return ip === '::1' || ip.startsWith('127.'); };
// Solo redes privadas: la de casa, la VPN de Tailscale (100.64.0.0/10 y fd7a:…) y el propio PC.
function ipPermitida(ip) {
  ip = sinPrefijo(ip);
  if (esLocal(ip)) return true;
  const p = ip.split('.').map(Number);
  if (p.length !== 4) return /^f[cd]/i.test(ip) || /^fe80/i.test(ip);
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}
const iguales = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const claveCookie = (req) => { const m = /(?:^|;\s*)clave=([^;]+)/.exec(req.headers.cookie || ''); return m ? decodeURIComponent(m[1]) : ''; };
// Una petición que llega a través de un proxy (por ejemplo «tailscale serve») viene de 127.0.0.1, pero no es el PC: pide clave.
const delPropioPc = (req) => esLocal(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
const autorizado = (req) => delPropioPc(req) || iguales(claveCookie(req), CLAVE);
const PUBLICOS = new Set(['/manifest.webmanifest', '/sw.js', '/icono-192.png', '/icono-512.png']);
TIPOS['.webmanifest'] = 'application/manifest+json'; TIPOS['.js'] = 'text/javascript; charset=utf-8';
const PAGINA_CLAVE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Plano a AutoCAD</title><style>body{font:17px system-ui,sans-serif;max-width:420px;margin:60px auto;padding:0 18px;color:#1d2733}
input,button{font:inherit;padding:12px;border-radius:9px;border:1px solid #c8d0da;width:100%;box-sizing:border-box;margin-top:10px}
button{background:#1565c0;color:#fff;border-color:#1565c0;font-weight:600}</style></head><body>
<h1>Plano a AutoCAD</h1><p>Escribe la clave de acceso. Está en la ventana del servidor, en el PC, y en el fichero clave.txt.</p>
<form method="get" action="/"><input name="clave" autocomplete="current-password" placeholder="Clave" required><button>Entrar</button></form></body></html>`;

const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!ipPermitida(req.socket.remoteAddress)) { res.writeHead(403); return res.end('Acceso no permitido'); }
  if (u.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && PUBLICOS.has(u.pathname)) return servirFichero(res, PUB, u.pathname.slice(1));
  // Entrar con ?clave=…: se guarda en una cookie para no volver a pedirla en ese dispositivo.
  if (u.searchParams.has('clave')) {
    if (iguales(u.searchParams.get('clave'), CLAVE)) {
      const segura = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.writeHead(303, { Location: '/', 'Set-Cookie': `clave=${encodeURIComponent(CLAVE)}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Strict${segura}` });
      return res.end();
    }
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGINA_CLAVE.replace('<form', '<p style="color:#b3261e;font-weight:600">Clave incorrecta.</p><form'));
  }
  if (!autorizado(req)) {
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) { res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAGINA_CLAVE); }
    return json(res, 401, { error: 'Falta la clave de acceso. Vuelve a abrir el enlace con la clave.' });
  }
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) return servirFichero(res, PUB, 'index.html');
  if (req.method === 'GET' && u.pathname === '/api/estado') {
    const urls = ipsLocales().map((ip) => `http://${ip}:${PORT}`);
    return json(res, 200, delPropioPc(req) ? { urls, enlaceMovil: urls[0] ? `${urls[0]}/?clave=${CLAVE}` : null } : { urls: [] });
  }
  if (req.method === 'GET' && u.pathname.startsWith('/planos/')) return servirFichero(res, OUT, decodeURIComponent(u.pathname.slice(8)), true);
  if (req.method === 'POST' && u.pathname === '/api/convertir') {
    const trozos = []; let total = 0; let abortado = false;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BYTES) { abortado = true; json(res, 413, { error: 'Imagen demasiado grande' }); req.destroy(); } else trozos.push(c);
    });
    req.on('end', () => {
      if (abortado) return;
      const png = Buffer.concat(trozos);
      if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) return json(res, 400, { error: 'Se esperaba una imagen PNG' });
      console.log(`[${new Date().toLocaleTimeString()}] Convirtiendo "${u.searchParams.get('name') || 'plano'}" (${Math.round(png.length / 1024)} KB)...`);
      enCola(() => convertir(png, u.searchParams))
        .then((r) => { console.log(`   listo en ${r.segundos} s: ${r.carpeta}`); json(res, 200, r); })
        .catch((e) => { console.error('   error:', e.message); json(res, 500, { error: e.message }); });
    });
    return;
  }
  res.writeHead(404); res.end('No encontrado');
});

module.exports = { ajustarDxf };
if (require.main === module) servidor.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Plano a AutoCAD esta funcionando.\n');
  console.log(`  En este PC:   http://localhost:${PORT}`);
  for (const u of ipsLocales().map((ip) => `http://${ip}:${PORT}`)) console.log(`  En el movil:  ${u}/?clave=${CLAVE}`);
  console.log(`\n  Clave de acceso para otros dispositivos: ${CLAVE}`);
  console.log('  El movil tiene que estar en la misma wifi que el PC, o conectado con Tailscale (ver README).');
  console.log(`  Los planos se guardan en: ${OUT}`);
  console.log('  Cierra esta ventana para apagarlo.\n');
  if (process.env.ABRIR === '1') execFile('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { windowsHide: true });
});
servidor.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `El puerto ${PORT} ya esta en uso: puede que la herramienta ya este abierta.` : e.message);
  process.exit(1);
});
