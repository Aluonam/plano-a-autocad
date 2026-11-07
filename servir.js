// Sirve la aplicación de la tablet (carpeta docs/) en la red local, para usarla desde otro dispositivo.
// Solo entrega los ficheros de la aplicación: las fotos se procesan en el dispositivo y aquí no llega nada.
// Uso: node servir.js [puerto]   (por defecto 8080)
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, 'docs');
const PUERTO = Number(process.argv[2] || process.env.PORT) || 8080;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};
// Solo redes privadas (casa u oficina) y el propio PC.
function ipPermitida(ip) {
  ip = String(ip || '').replace(/^::ffff:/, '');
  if (ip === '::1' || ip.startsWith('127.')) return true;
  const p = ip.split('.').map(Number);
  if (p.length !== 4) return /^f[cde]/i.test(ip);
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}

http.createServer((req, res) => {
  if (!ipPermitida(req.socket.remoteAddress)) { res.writeHead(403); return res.end('Acceso no permitido'); }
  let ruta;
  try { ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (ruta.endsWith('/')) ruta += 'index.html';
  const fichero = path.resolve(RAIZ, '.' + ruta);
  if (!fichero.startsWith(RAIZ + path.sep) || !fs.existsSync(fichero) || !fs.statSync(fichero).isFile()) { res.writeHead(404); return res.end('No encontrado'); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(fichero)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(fichero).pipe(res);
}).listen(PUERTO, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.') && !a.address.startsWith('192.168.56.'))
    .map((a) => a.address);
  console.log('\n  Plano a AutoCAD está disponible en la red local.\n');
  console.log(`  En este PC:         http://localhost:${PUERTO}`);
  for (const ip of ips) console.log(`  En otro dispositivo: http://${ip}:${PUERTO}`);
  console.log('\n  El otro dispositivo tiene que estar conectado a la misma red.');
  console.log('  Cierra esta ventana para apagarlo.\n');
}).on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `El puerto ${PUERTO} ya está en uso. Prueba con: node servir.js 8081` : e.message);
  process.exit(1);
});
