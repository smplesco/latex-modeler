/* LaTeX Modeler's service worker (written into dist/sw.js at build time from src/sw-template.js).
   Keeps the app on this device so it opens without a connection after one visit.
   Pages are fetched fresh when online (so updates arrive) and from the cache when not;
   everything else has a content hash in its name, so the cached copy is always right. */
const CACHE = 'lm-__VERSION__';
const FILES = __FILES__;

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never stores an older file
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('lm-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope);
  const path = url.pathname.slice(scope.pathname.length);
  if (path.startsWith('board/') || path === 'sw.js') return;          // board mode looks after itself
  if (req.mode === 'navigate') {
    // fresh when online, the saved copy when not (allowing 4 s on a slow connection)
    e.respondWith((async () => {
      const cached = () => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match(path.startsWith('figure') ? './figure.html' : './'));
      try {
        const net = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))]);
        if (net && net.ok) { const copy = net.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return net;
      } catch { return (await cached()) || Response.error(); }
    })());
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
