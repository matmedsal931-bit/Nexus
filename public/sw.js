// Service worker: instala o Nexo como app e mostra a nossa tela de carregamento
// (com a logo) enquanto o servidor acorda, no lugar da página do Render.
const CACHE = 'nexo-v20';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/settings.js', '/features.js', '/account.js', '/sounds.js', '/channels.js', '/manifest.json',
  '/loading.html', '/icons/icon-192.png', '/icons/icon-512.png',
  '/fonts/onest-latin.woff2', '/fonts/onest-latin-ext.woff2', '/fonts/bricolage-latin.woff2', '/fonts/bricolage-latin-ext.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // /health nunca passa pelo cache: é ele que diz se o servidor acordou de verdade
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api') || url.pathname === '/health' || url.pathname.endsWith('.apk')) return;

  // Abrir o app: se o servidor demorar (serviço dormindo), mostramos a nossa tela
  if (e.request.mode === 'navigate' && url.pathname !== '/loading.html') {
    e.respondWith((async () => {
      try {
        const res = await timeout(fetch(e.request), 4000);
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)); }
        return res;
      } catch {
        return (await caches.match('/loading.html')) || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/loading.html')))
  );
});
