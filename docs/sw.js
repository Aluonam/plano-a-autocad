// Guarda la aplicación en la tablet para que funcione sin conexión. Las fotos y los planos no pasan por aquí:
// se procesan en memoria y solo se guardan donde el usuario decida (Guardar o Compartir).
'use strict';
const VERSION = 'plano-a-cad-7';
const FICHEROS = ['./', 'index.html', 'reconocer.js', 'dxf.js', 'trabajo.js', 'manifest.webmanifest', 'icono-192.png', 'icono-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHEROS.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Primero la copia guardada (funciona sin red); si hay red, se actualiza para la próxima vez.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const guardada = await cache.match(e.request, { ignoreSearch: true });
    const red = fetch(e.request).then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => guardada);
    return guardada || red;
  }));
});
