const CACHE_NAME = 'nt-mecanicos-v17';
const APP_SHELL_KEY = 'nt-app-shell';

// Apenas assets que sempre retornam 200 (sem autenticação)
const PRECACHE_URLS = [
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
  /\/api\//,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
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
    ).then(() => self.clients.claim())
  );
});

/**
 * Salva a primeira resposta HTML de navegação como "app shell".
 * Será usada como fallback para QUALQUER rota offline.
 * (Todas as páginas são 'use client', o router client-side renderiza certo)
 */
async function saveAppShell(response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(APP_SHELL_KEY, response);
  } catch (e) {
    console.warn('[SW] Erro ao salvar app shell:', e);
  }
}

async function getAppShell() {
  try {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(APP_SHELL_KEY);
  } catch {
    return null;
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Ignorar requests de API (Supabase, /api/*) — dados ficam no IndexedDB
  if (API_PATTERNS.some((p) => p.test(event.request.url))) return;

  // RSC payloads (Next.js app router) — network-first, cachear para offline
  if (event.request.headers.get('RSC') === '1') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          // Tentar cache exato desta rota
          const cached = await caches.match(event.request);
          if (cached) return cached;

          // Sem RSC em cache — devolver app shell para forçar MPA navigation.
          // Next.js detecta que a resposta não é RSC e faz hard navigation,
          // que cai no handler de 'navigate' abaixo e serve o app shell normalmente.
          const shell = await getAppShell();
          if (shell) return shell;

          return new Response('', { status: 404 });
        })
    );
    return;
  }

  // Navegação (HTML pages) — network-first, app shell como fallback offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            // Cachear esta página específica
            const clone1 = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone1));
            // Salvar como app shell (qualquer página serve de shell)
            const clone2 = response.clone();
            saveAppShell(clone2);
          }
          return response;
        })
        .catch(async () => {
          // 1. Tentar cache exato desta URL
          const exact = await caches.match(event.request);
          if (exact) return exact;

          // 2. Fallback: app shell (qualquer página HTML cacheada)
          const shell = await getAppShell();
          if (shell) return shell;

          // 3. Último recurso: página offline mínima
          return new Response(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <title>NT Mecanicos - Offline</title>
              <style>
                *{margin:0;padding:0;box-sizing:border-box}
                body{min-height:100vh;display:flex;align-items:center;justify-content:center;
                  font-family:-apple-system,sans-serif;
                  background:linear-gradient(180deg,#1E3A5F 0%,#0F1F33 100%);color:#fff;padding:32px}
                .c{text-align:center;max-width:320px}
                .icon{width:80px;height:80px;border-radius:22px;background:rgba(255,255,255,.1);
                  display:flex;align-items:center;justify-content:center;margin:0 auto 24px}
                h2{font-size:20px;font-weight:800;margin-bottom:8px}
                p{font-size:14px;color:rgba(255,255,255,.7);line-height:1.7}
                .btn{margin-top:24px;padding:14px 28px;border-radius:14px;border:none;
                  background:rgba(255,255,255,.15);color:#F59E0B;font-size:14px;font-weight:700;cursor:pointer}
              </style>
            </head>
            <body>
              <div class="c">
                <div class="icon">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2">
                    <path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
                    <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
                    <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
                    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                    <line x1="12" y1="20" x2="12.01" y2="20"/>
                  </svg>
                </div>
                <h2>Sem conexao</h2>
                <p>Conecte-se a internet para carregar esta pagina. Depois de baixar os dados, voce podera navegar offline.</p>
                <button class="btn" onclick="location.reload()">Tentar novamente</button>
              </div>
            </body>
            </html>
          `, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        })
    );
    return;
  }

  // Cache-first para assets estáticos (imagens, fonts, JS/CSS chunks)
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
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // Outros requests — network-first
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((c) => c || new Response('', { status: 404 })))
  );
});

// ── Push Notifications ──
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const title = data.title || 'Nova Tratores';
  const options = {
    body: data.body || '',
    icon: data.icon || '/Logo_Nova.png',
    badge: data.badge || '/Logo_Nova.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: [{ action: 'open', title: 'Abrir' }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
