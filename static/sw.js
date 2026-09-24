/* ════════════════════════════════════════════════════════════
   COLLEGE SCHEDULE APP — Resilient Offline Service Worker
   ════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'college-schedule-v41';

const STATIC_ASSETS = [
  '/',
  '/static/style.css',
  '/static/app.js',
  '/static/onboarding.js',
  '/static/sortable.min.js',
  '/static/telegram-web-app.js',
  '/static/games/2048.js',
  '/static/games/tetris.js',
  '/static/games/minesweeper.js',
  '/static/games/snake.js',
  '/static/games/dino.js',
  '/static/games/sudoku.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[SW] Failed to pre-cache:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || !url.protocol.startsWith('http')) return;
  if (url.searchParams.has('secret') || url.searchParams.has('key') || url.searchParams.has('access')) return;

  // 1. Navigation requests (opening the web page)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // 2. API requests (/api/schedule, /api/tabs, /api/groups)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // 3. Static assets: Stale-While-Revalidate with ignoreSearch for versioned queries (?v=...)
  if (url.pathname.startsWith('/static/') || url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        const fetchPromise = fetch(req).then((netRes) => {
          if (netRes && netRes.status === 200) {
            const clone = netRes.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return netRes;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }
});
