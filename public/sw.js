const CACHE_NAME = 'nt-mecanicos-v5';
const OFFLINE_URL = '/';

const PRECACHE_URLS = [
  '/',
  '/login',
  '/os',
  '/os-enviadas',
  '/requisicoes',
  '/requisicoes-enviadas',
  '/diario',
  '/agenda',
  '/perfil',
  '/manifest.json',
  '/capa_app.png',
  '/Logo_Nova.png',
];

// Assets que devem ser cacheados agressivamente (cache-first)
const CACHE_FIRST_PATTERNS = [
  /\/_next\/static\//,
  /\.(?:png|jpg|jpeg|svg|gif|ico|webp|woff2?)$/,
  /\/manifest\.json$/,
];

// URLs do Supabase que devem usar network-first com fallback
const API_PATTERNS = [
  /supabase\.co/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
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

  const url = event.request.url;

  // Cache-first para assets estáticos (muito mais rápido)
  if (CACHE_FIRST_PATTERNS.some((p) => p.test(url))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Network-first para tudo o resto (páginas, API)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Não cachear respostas de API do Supabase (dados dinâmicos ficam no IndexedDB)
        if (!API_PATTERNS.some((p) => p.test(url))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match(OFFLINE_URL))
      )
  );
});
