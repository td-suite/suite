// Suite TD · service worker minimale: app shell in cache, API sempre dalla rete (network-first con fallback)
const VERSION = 'td-suite-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/logo-light.svg', '/logo-dark.svg', '/icon.svg', '/icon-192.png', '/icon-512.png', '/theme.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API e lanci SSO: rete, senza cache (fallback a una risposta JSON di cortesia se offline)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/go/')) {
    e.respondWith(fetch(req).catch(() => new Response(JSON.stringify({ error: 'Connessione assente. Riprova quando sei di nuovo in rete.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // Navigazioni: rete prima, poi la shell in cache
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/index.html', copy)).catch(() => {}); return res; }).catch(() => caches.match('/index.html')));
    return;
  }

  // Asset statici (hash nel nome): cache prima, poi rete
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname))) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  })));
});
