const ASSETS_CACHE = 'nt-assets-v21';
const PAGES_CACHE = 'nt-pages-v2';
const APP_SHELL_KEY = 'nt-app-shell';

const PRECACHE_URLS = [
  '/manifest.json',
  '/capa_app.png',
  '/Logo_Nova.png',
];

const CACHE_FIRST_PATTERNS = [
  /\/_next\/static\//,
  /\.(?:png|jpg|jpeg|svg|gif|ico|webp|woff2?)$/,
  /\/manifest\.json$/,
];

const API_PATTERNS = [
  /supabase\.co/,
  /\/api\//,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(ASSETS_CACHE).then(async (cache) => {
      for (const url of PRECACHE_URLS) {
        try { await cache.add(url); } catch (err) {
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
      Promise.all(keys.filter((k) => k !== ASSETS_CACHE && k !== PAGES_CACHE).map((k) => caches.delete(k)))
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
    const cache = await caches.open(PAGES_CACHE);
    await cache.put(APP_SHELL_KEY, response);
  } catch (e) {
    console.warn('[SW] Erro ao salvar app shell:', e);
  }
}

async function getAppShell() {
  try {
    const cache = await caches.open(PAGES_CACHE);
    return await cache.match(APP_SHELL_KEY);
  } catch {
    return null;
  }
}

/**
 * Race fetch com timeout — no celular navigator.onLine pode ser true sem internet,
 * fazendo o fetch ficar pendurado por 30s+. O timeout garante fallback rápido.
 */
function fetchWithTimeout(request, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Ignorar requests de API (Supabase, /api/*) — dados ficam no IndexedDB
  if (API_PATTERNS.some((p) => p.test(event.request.url))) return;

  // RSC payloads (Next.js app router) — network-first com timeout rápido
  if (event.request.headers.get('RSC') === '1') {
    event.respondWith(
      fetchWithTimeout(event.request, 3000)
        .then((response) => {
          if (response.ok) {
            // Salvar SEM o header Vary para que qualquer RSC request bata no cache
            const headers = new Headers(response.headers);
            headers.delete('Vary');
            const cleaned = new Response(response.clone().body, { status: response.status, headers });
            caches.open(PAGES_CACHE).then((cache) => cache.put(event.request.url, cleaned));
          }
          return response;
        })
        .catch(async () => {
          // ignoreVary: RSC prefetch vs RSC navigation tem headers diferentes
          const cached = await caches.match(event.request, { ignoreVary: true });
          if (cached) return cached;

          // Tentar pelo URL direto (sem considerar headers)
          const byUrl = await caches.match(event.request.url);
          if (byUrl) return byUrl;

          return new Response('', { status: 503 });
        })
    );
    return;
  }

  // Navegação (HTML pages) — network-first com timeout, app shell como fallback offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(event.request, 3000)
        .then((response) => {
          if (response.ok) {
            // Cachear esta página específica
            const clone1 = response.clone();
            caches.open(PAGES_CACHE).then((cache) => cache.put(event.request, clone1));
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
          if (shell) return shell.clone();

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
            caches.open(ASSETS_CACHE).then((cache) => cache.put(event.request, clone));
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
          caches.open(PAGES_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((c) => c || new Response('', { status: 404 })))
  );
});

// ── Background Sync — baixa dados sem o app aberto ──

const IDB_NAME = 'nt-mecanicos-offline';
const IDB_STORE = 'cache';

function idbGet(key) {
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB_STORE, 'readonly');
      const get = tx.objectStore(IDB_STORE).get(key);
      get.onsuccess = () => resolve(get.result ? get.result.data : null);
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

function idbSet(key, data) {
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ key, data, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    };
    req.onerror = () => resolve();
  });
}

async function backgroundPrefetch() {
  const config = await idbGet('sw-config');
  if (!config || !config.supabaseUrl || !config.tecnicoNome) return;

  const { supabaseUrl, supabaseKey, tecnicoNome, tecnicoNomeReal } = config;
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const base = `${supabaseUrl}/rest/v1`;

  console.log('[SW] Background sync iniciando para', tecnicoNome);

  try {
    // 1. OS do técnico
    const encNome = encodeURIComponent(tecnicoNome);
    const osUrl = `${base}/Ordem_Servico?select=*&Status=not.in.("Concluida","Cancelada","Concluída","cancelada")&or=(Os_Tecnico.ilike.%25${encNome}%25,Os_Tecnico2.ilike.%25${encNome}%25)&order=Id_Ordem.desc`;
    const osRes = await fetch(osUrl, { headers });
    if (!osRes.ok) return;
    const osList = await osRes.json();

    await idbSet('prefetch:os-list', osList);
    for (const os of osList) {
      await idbSet(`prefetch:os:${os.Id_Ordem}`, os);
    }

    // 2. OS_Tecnicos
    const ids = osList.map(o => `"${o.Id_Ordem}"`).join(',');
    if (ids) {
      const tecUrl = `${base}/Ordem_Servico_Tecnicos?select=*&Ordem_Servico=in.(${ids})`;
      const tecRes = await fetch(tecUrl, { headers });
      if (tecRes.ok) {
        const tecEntries = await tecRes.json();
        for (const e of tecEntries) {
          await idbSet(`prefetch:os-tec:${e.Ordem_Servico}`, e);
        }
      }
    }

    // 3. Dados de referência
    const [tecnicosRes, veiculosRes] = await Promise.all([
      fetch(`${base}/Tecnicos_Appsheet?select=UsuNome&order=UsuNome`, { headers }),
      fetch(`${base}/SupaPlacas?select=IdPlaca,NumPlaca&order=NumPlaca`, { headers }),
    ]);
    if (tecnicosRes.ok) await idbSet('prefetch:tecnicos', await tecnicosRes.json());
    if (veiculosRes.ok) await idbSet('prefetch:veiculos', await veiculosRes.json());

    // 4. PPV de cada OS
    const osComPPV = osList.filter(o => o.ID_PPV);
    for (const os of osComPPV) {
      const ppvRes = await fetch(`${base}/movimentacoes?select=*&Id_PPV=eq.${os.ID_PPV}`, { headers });
      if (ppvRes.ok) await idbSet(`prefetch:ppv:${os.ID_PPV}`, await ppvRes.json());
    }

    // 5. Pré-cachear páginas HTML + RSC para navegação offline
    const cache = await caches.open(PAGES_CACHE);
    const rscHeaders2 = { RSC: '1', 'Next-Router-Prefetch': '1' };
    const pageFetches = osList.slice(0, 20).flatMap(os => [
      fetch(`/os/${os.Id_Ordem}`, { headers: rscHeaders2 }).then(r => r.ok && cache.put(`/os/${os.Id_Ordem}`, r)).catch(() => {}),
      fetch(`/os/${os.Id_Ordem}/preencher`, { headers: rscHeaders2 }).then(r => r.ok && cache.put(`/os/${os.Id_Ordem}/preencher`, r)).catch(() => {}),
    ]);
    await Promise.allSettled(pageFetches);

    console.log('[SW] Background sync completo:', osList.length, 'OS');
  } catch (err) {
    console.warn('[SW] Background sync falhou:', err);
  }
}

// ── Periodic Background Sync — roda a cada ~2h quando tem internet ──
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'bg-prefetch') {
    event.waitUntil(backgroundPrefetch());
  }
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

  // Mostrar notificação E baixar dados em background
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      backgroundPrefetch(),
    ])
  );
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
