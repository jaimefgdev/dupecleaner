// Service worker de DupeCleaner.
// - Al instalarse guarda en caché todos los archivos de la app (PRECACHE).
// - Archivos propios: primero la red (siempre la versión más reciente si hay
//   conexión) y, sin conexión, la copia en caché.
// Al cambiar cualquier archivo de la app, sube VERSION para renovar la caché.

const VERSION = 'v4';
const CACHE   = 'dupecleaner-' + VERSION;

const PRECACHE = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'vendor/fonts/inter-latin-400.woff2',
  'vendor/fonts/inter-latin-700.woff2',
  'vendor/fonts/fira-code-latin-400.woff2',
  'vendor/fonts/fira-code-latin-700.woff2',
  'vendor/fontawesome/css/fontawesome.min.css',
  'vendor/fontawesome/css/solid.min.css',
  'vendor/fontawesome/webfonts/fa-solid-900.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable.svg',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'src/app.js',
  'src/dupe-index.js',
  'src/filters.js',
  'src/format.js',
  'src/hash-worker.js',
  'src/hasher.js',
  'src/quarantine.js',
  'src/safety.js',
  'src/sha256.js',
  'src/virtual-scroller.js',
  'src/wasm-sha256.js',
  'vendor/hash-wasm/sha256.umd.min.js',
];

self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('dupecleaner-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evt => {
  const req = evt.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  if (url.origin === self.location.origin) {
    // Red primero; sin conexión, caché (las navegaciones caen en index.html)
    evt.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      } catch {
        return (await cache.match(req, { ignoreSearch: true }))
          || (req.mode === 'navigate' && await cache.match('index.html'))
          || Response.error();
      }
    })());
  }
  // Otros orígenes: sin intervención (la app no usa ninguno)
});
