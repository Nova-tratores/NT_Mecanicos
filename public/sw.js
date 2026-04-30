const CACHE_NAME = 'nt-mecanicos-v6';
const OFFLINE_URL = '/';

// Apenas assets que sempre retornam 200 (sem autenticação)
const PRECACHE_URLS = [
  '/',
  '/login',
  '/manifest.json',
  '/capa_app.png',
  '/Logo_Nova.png',
];

// Assets estáticos — cache-first (muito mais rápido)
const CACHE_FIRST_PATTERNS = [
  /\/_next\/static\//,
  /\.(?:png|jpg|jpeg|svg|gif|ico|webp|woff2?)$/,
  /\/manifest\.json$/,
];

// URLs do Supabase — não cachear no SW (dados ficam no IndexedDB)
const API_PATTERNS = [
  /supabase\.co/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cachear cada URL individualmente para não quebrar se alguma falhar
      for (const url of PRECACHE_URLS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('[SW] Falha ao precachear:', url, err);
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Ignorar requests do Supabase (dados gerenciados pelo IndexedDB)
  if (API_PATTERNS.some((p) => p.test(event.request.url))) return;

  // Cache-first para assets estáticos
  if (CACHE_FIRST_PATTERNS.some((p) => p.test(event.request.url))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => caches.match(OFFLINE_URL));
      })
    );
    return;
  }

  // Navegação (HTML pages) — network-first, fallback para app shell
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // Outros requests (JS chunks, CSS, etc.) — network-first com cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
