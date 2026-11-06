// Service worker mínimo: permite instalar la página como aplicación y abrirla aunque el servidor
// tarde en responder. La conversión siempre necesita el servidor del PC; nada de los planos se guarda aquí.
'use strict';
const CACHE = 'plano-a-cad-v1';
const BASICO = ['/manifest.webmanifest', '/icono-192.png', '/icono-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICO)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // Solo los iconos y el manifiesto salen de la caché; la página, la API y los planos van siempre a la red.
  if (BASICO.includes(u.pathname)) e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
