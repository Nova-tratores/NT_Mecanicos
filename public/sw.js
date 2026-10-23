// Versões dos caches (José, 23/10/2026): esta é a ÚNICA versão do app (o script do <head> com 'v27' saiu).
// Trocar o número limpa os arquivos de programa de deploys antigos; as páginas/OS offline são COPIADAS para o
// cache novo, nunca apagadas.
// Programa do deploy (/_next/static) num cache SEM limite: o limite expulsava JS do deploy atual quando
// imagens enchiam o cache (José, 23/10/2026). Imagens e outros GET ficam no cache com limite.
const STATIC_CACHE = 'nt-static-v32';
const ASSETS_CACHE = 'nt-assets-v32';
const PAGES_CACHE = 'nt-pages-v13';
const TILES_CACHE = 'nt-tiles-v1';
const APP_SHELL_KEY = 'nt-app-shell';
const MAX_ASSETS = 600; // imagens e outros arquivos (o programa não entra aqui)
const STATIC_RE = /\/_next\/static\//;
const MAX_TILES = 400;  // pedacinhos do mapa

const PRECACHE_URLS = [
  '/manifest.json',
  '/capa_app.png',
  '/Logo_Nova.png',
];

// cache-first só da MESMA origem (antes guardava imagem de qualquer site, sem limite)
const CACHE_FIRST_PATTERNS = [
  /\/_next\/static\//,
  /\.(?:png|jpg|jpeg|svg|gif|ico|webp|woff2?)$/,
  /\/manifest\.json$/,
];
const TILE_HOSTS = /(^|\.)tile\.openstreetmap\.org$/;

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
  // SEM skipWaiting aqui: a versão nova espera o toque em "Atualizar" (ServiceWorkerRegister) para não
  // recarregar no meio do relatório/assinatura (José, 23/10/2026)
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/** apaga as entradas mais antigas (ordem de inserção) acima do limite */
async function limitarCache(nome, max) {
  try {
    const cache = await caches.open(nome);
    const chaves = await cache.keys();
    if (chaves.length <= max) return;
    for (const k of chaves.slice(0, chaves.length - max)) await cache.delete(k);
  } catch { /* sem espaço/erro: ignora */ }
}
let putsDesdeLimpeza = 0;
function guardar(nome, request, response, max) {
  caches.open(nome).then((cache) => cache.put(request, response)).then(() => {
    if (++putsDesdeLimpeza >= 25) { putsDesdeLimpeza = 0; limitarCache(nome, max); }
  }).catch(() => {});
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const nomes = await caches.keys();
    const atuais = [STATIC_CACHE, ASSETS_CACHE, PAGES_CACHE, TILES_CACHE];
    for (const nome of nomes) {
      if (atuais.includes(nome)) continue;
      // páginas/OS offline de versões antigas: copia para o cache novo antes de apagar
      if (nome.startsWith('nt-pages')) {
        try {
          const velho = await caches.open(nome);
          const novo = await caches.open(PAGES_CACHE);
          for (const req of await velho.keys()) {
            if (await novo.match(req)) continue;
            const resp = await velho.match(req);
            if (resp) await novo.put(req, resp);
          }
        } catch { /* sem espaço: segue */ }
      }
      await caches.delete(nome);
    }
    await limitarCache(ASSETS_CACHE, MAX_ASSETS);
    await limitarCache(TILES_CACHE, MAX_TILES);
    await self.clients.claim();
  })());
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

/** só HTML serve de página: o cache também guarda o "RSC" (dados internos do Next) da mesma rota, e devolvê-lo
 *  numa navegação mostrava código na tela (teste offline, 22/10/2026) */
function ehHtml(resp) {
  return !!resp && (resp.headers.get('content-type') || '').includes('text/html');
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

  // RSC payloads (Next.js app router) — network-first com timeout rápido.
  // IMPORTANTE: o router adiciona ?_rsc=<hash> na URL, diferente a cada request.
  // Guardamos/buscamos pela ROTA (pathname), ignorando a query, senão offline
  // dá cache miss e o app "volta pro início".
  if (event.request.headers.get('RSC') === '1') {
    const rscKey = new URL(event.request.url).pathname + '?__rscq';
    event.respondWith(
      fetchWithTimeout(event.request, 3000)
        .then((response) => {
          // o "prefetch" dos links do Next é PARCIAL: guardado por cima do completo, a página não abria offline
          const parcial = event.request.headers.get('Next-Router-Prefetch') === '1';
          if (response.ok && !parcial) {
            // Salvar SEM o header Vary para que qualquer RSC request bata no cache
            const headers = new Headers(response.headers);
            headers.delete('Vary');
            const cleaned = new Response(response.clone().body, { status: response.status, headers });
            caches.open(PAGES_CACHE).then((cache) => cache.put(rscKey, cleaned));
          }
          return response;
        })
        .catch(async () => {
          // 1. Match normalizado pela rota (ignora ?_rsc)
          const byPath = await caches.match(rscKey);
          if (byPath) return byPath;

          // 2. ignoreVary: RSC prefetch vs RSC navigation tem headers diferentes
          const cached = await caches.match(event.request, { ignoreVary: true });
          if (cached) return cached;

          // 3. Tentar pelo URL direto (sem considerar headers)
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
            // Cachear esta página específica (pela URL sem query, para match offline)
            const clone1 = response.clone();
            const navUrl = new URL(event.request.url);
            navUrl.search = '';
            caches.open(PAGES_CACHE).then((cache) => cache.put(navUrl.href, clone1));
            // a casca de reserva é sempre a tela inicial (outra página abriria a tela errada)
            if (navUrl.pathname === '/') saveAppShell(response.clone());
          }
          return response;
        })
        .catch(async () => {
          // 1. Tentar cache exato desta URL (match por Request) — SÓ HTML
          const exact = await caches.match(event.request);
          if (ehHtml(exact)) return exact;

          // 1b. Match por URL sem query (prefetch grava com Request simples)
          const url = new URL(event.request.url);
          url.search = '';
          const byUrl = await caches.match(url.href);
          if (ehHtml(byUrl)) return byUrl;

          // 1c. Match ignorando query/vary (todas as entradas: a 1ª pode ser o RSC)
          const todas = await (await caches.open(PAGES_CACHE)).matchAll(event.request, { ignoreSearch: true, ignoreVary: true });
          const html = todas.find(ehHtml);
          if (html) return html;

          // 2. OS que não foi baixada: a "casca" de outra página mostraria a tela errada (ou outra OS) — avisa
          const ehOS = /^\/os\/[^/]+/.test(url.pathname);
          // 3. Fallback: app shell (qualquer página HTML cacheada) para as telas fixas
          const shell = ehOS ? null : await getAppShell();
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
                <h2>Sem internet</h2>
                <p>Esta tela ainda não foi baixada para usar sem internet. Volte para o início: as ordens baixadas abrem por lá. Com sinal, o app baixa tudo sozinho.</p>
                <button class="btn" onclick="location.href='/'">Ir para o início</button> <button class="btn" onclick="location.reload()">Tentar de novo</button>
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

  const url = new URL(event.request.url);
  const mesmaOrigem = url.origin === self.location.origin;

  // Pedacinhos do mapa (OpenStreetMap): cache-first com limite
  if (TILE_HOSTS.test(url.hostname)) {
    event.respondWith(
      caches.open(TILES_CACHE).then((c) => c.match(event.request)).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok || response.type === 'opaque') guardar(TILES_CACHE, event.request, response.clone(), MAX_TILES);
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // de outro site: não intercepta (o navegador resolve; nada vai para o cache)
  if (!mesmaOrigem) return;

  // Cache-first para assets estáticos da mesma origem (imagens, fonts, JS/CSS chunks)
  if (CACHE_FIRST_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            if (STATIC_RE.test(url.pathname)) {
              const copia = response.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(event.request, copia)).catch(() => {});
            } else guardar(ASSETS_CACHE, event.request, response.clone(), MAX_ASSETS);
          }
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // Outros GET da mesma origem — network-first; só guarda resposta "basic" ok, no cache com limite
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === 'basic') guardar(ASSETS_CACHE, event.request, response.clone(), MAX_ASSETS);
        return response;
      })
      .catch(() => caches.match(event.request).then((c) => c || new Response('', { status: 404 })))
  );
});

// ── Background Sync — baixa dados sem o app aberto ──

const IDB_NAME = 'nt-mecanicos-offline';
const IDB_STORE = 'cache';

function idbOpen() {
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    const get = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    get.onsuccess = () => resolve(get.result ? get.result.data : null);
    get.onerror = () => resolve(null);
  });
}

async function idbSet(key, data) {
  const db = await idbOpen();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ key, data, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function idbKeys() {
  const db = await idbOpen();
  if (!db) return [];
  return new Promise((resolve) => {
    const r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAllKeys();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => resolve([]);
  });
}

async function idbDelete(keys) {
  if (!keys.length) return;
  const db = await idbOpen();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    for (const k of keys) st.delete(k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// Mesmo nome? Cópia de mesmoNome (src/lib/push-server.ts) — o SW não importa módulos.
// "DANILO DE SOUZA" × "Danilo de Souza", "José Oliveira" × "JOSE ANTONIO DE OLIVEIRA"
function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
function mesmoNome(a, b) {
  const x = semAcento(a).split(/\s+/).filter((w) => w.length > 2), y = semAcento(b).split(/\s+/).filter((w) => w.length > 2);
  if (!x.length || !y.length) return false;
  return x[0] === y[0] && (x[x.length - 1] === y[y.length - 1] || x.every((w) => y.includes(w)) || y.every((w) => x.includes(w)));
}
function ehDoTecnico(nomeOS, nomes) {
  if (!nomeOS) return false;
  return nomes.some((n) => mesmoNome(nomeOS, n) || semAcento(nomeOS) === semAcento(n));
}

async function backgroundPrefetch() {
  const config = await idbGet('sw-config');
  if (!config || !config.supabaseUrl || !config.tecnicoNome) return;

  const { supabaseUrl, supabaseKey, tecnicoNome, tecnicoNomeReal } = config;
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const base = `${supabaseUrl}/rest/v1`;
  const nomes = [tecnicoNome, tecnicoNomeReal].filter(Boolean);

  console.log('[SW] Background sync iniciando para', tecnicoNome);

  try {
    // 1. OS do técnico: busca pelo PRIMEIRO nome e confere com a regra mesmoNome (antes o ilike do nome inteiro
    //    não achava "José Oliveira" × "JOSE ANTONIO DE OLIVEIRA") (José, 23/10/2026)
    //    O ilike não ignora acento: vogais e 'C' viram '_' ("JOSE" → "J_S_" acha "JOSÉ"); quem decide é o
    //    filtro mesmoNome logo abaixo (José, 23/10/2026)
    const primeiro = (semAcento(tecnicoNome).split(/\s+/)[0] || '').replace(/[^A-Z]/g, '');
    if (!primeiro) return;
    const curinga = primeiro.replace(/[AEIOUC]/g, '_');
    const LIMITE = 400;
    const osUrl = `${base}/Ordem_Servico?select=*&Status=not.in.("Concluida","Cancelada","Concluída","cancelada")&or=(Os_Tecnico.ilike.%25${curinga}%25,Os_Tecnico2.ilike.%25${curinga}%25)&order=Id_Ordem.desc&limit=${LIMITE}`;
    const osRes = await fetch(osUrl, { headers });
    if (!osRes.ok) return;
    const bruto = await osRes.json();
    if (!Array.isArray(bruto)) return;
    // lista cortada no limite não serve para apagar o que "saiu" (pode só não ter vindo)
    const listaCompleta = bruto.length < LIMITE;
    const osList = bruto.filter((o) => ehDoTecnico(o.Os_Tecnico, nomes) || ehDoTecnico(o.Os_Tecnico2, nomes));

    // lista vazia não apaga a lista offline boa (pode ser falha do filtro/servidor)
    const listaAnterior = await idbGet('prefetch:os-list');
    if (!osList.length && Array.isArray(listaAnterior) && listaAnterior.length) {
      console.log('[SW] lista veio vazia — mantém a offline');
      return;
    }

    await idbSet('prefetch:os-list', osList);
    for (const os of osList) {
      await idbSet(`prefetch:os:${os.Id_Ordem}`, os);
    }

    // 2. OS_Tecnicos
    const ids = osList.map(o => `"${o.Id_Ordem}"`).join(',');
    let tecEntries = [];
    if (ids) {
      const tecUrl = `${base}/Ordem_Servico_Tecnicos?select=*&Ordem_Servico=in.(${ids})`;
      const tecRes = await fetch(tecUrl, { headers });
      if (tecRes.ok) {
        tecEntries = await tecRes.json();
        for (const e of tecEntries) {
          await idbSet(`prefetch:os-tec:${e.Ordem_Servico}`, e);
        }
      }
    }

    // 2b. a lista que a tela /os lê sem internet (useCached `os:v2:<nome>`) — junta com o que já havia
    const chaveLista = `os:v2:${tecnicoNome}`;
    const ant = (await idbGet(chaveLista)) || {};
    const enviadas = new Set(Array.from(ant.enviadas || []).map(String));
    for (const e of tecEntries) if (e.Status === 'enviado') enviadas.add(String(e.Ordem_Servico));
    await idbSet(chaveLista, {
      ordens: osList,
      preenchidas: Array.from(new Set(tecEntries.map((e) => String(e.Ordem_Servico)))),
      enviadas: Array.from(enviadas),
      cidadeMap: ant.cidadeMap || {},
      enviadasCount: Math.max(ant.enviadasCount || 0, enviadas.size),
      agendaMap: ant.agendaMap || {},
    });

    // 2c. OS que saíram da lista (concluídas/canceladas/de outro): apaga do aparelho — só com a lista desta
    //     busca (deu certo, não vazia, não cortada no limite); busca que falhou já saiu lá em cima
    if (listaCompleta && osList.length) {
      const atuais = new Set(osList.map((o) => String(o.Id_Ordem)));
      const velhas = (await idbKeys()).filter((k) => {
        const m = /^prefetch:os(?:-tec)?:(.+)$/.exec(String(k));
        return m && !atuais.has(m[1]);
      });
      await idbDelete(velhas);
      try {
        const pc = await caches.open(PAGES_CACHE);
        for (const req of await pc.keys()) {
          const m = /^\/os\/([^/?]+)/.exec(new URL(req.url).pathname);
          if (m && !atuais.has(decodeURIComponent(m[1]))) await pc.delete(req);
        }
      } catch { /* sem Cache API */ }
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
    const rscHeaders2 = { RSC: '1' };
    const rscFetches = osList.slice(0, 40).flatMap(os => [
      fetch(`/os/${os.Id_Ordem}`, { headers: rscHeaders2 }).then(r => r.ok && cache.put(`/os/${os.Id_Ordem}?__rscq`, r)).catch(() => {}),
      fetch(`/os/${os.Id_Ordem}/preencher`, { headers: rscHeaders2 }).then(r => r.ok && cache.put(`/os/${os.Id_Ordem}/preencher?__rscq`, r)).catch(() => {}),
    ]);
    // HTML de TODAS as OS (até 40): sem ela a OS não abre sem internet
    const htmlFetches = osList.slice(0, 40).flatMap(os => [
      fetch(`/os/${os.Id_Ordem}`).then(r => {
        if (r.ok) return cache.put(new Request(`/os/${os.Id_Ordem}`), r);
      }).catch(() => {}),
      fetch(`/os/${os.Id_Ordem}/preencher`).then(r => {
        if (r.ok) return cache.put(new Request(`/os/${os.Id_Ordem}/preencher`), r);
      }).catch(() => {}),
    ]);
    await Promise.allSettled([...rscFetches, ...htmlFetches]);

    // selo "N OS no celular · atualizado às hh:mm" (tela inicial)
    await idbSet('offline-status', { qtd: osList.length, em: Date.now(), por: 'segundo plano' });
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
// Sempre mostra uma notificação: push que não vira notificação faz o iOS cancelar a inscrição, e um
// push que não é JSON antes não mostrava nada (José, 23/10/2026)
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try { data = event.data.json() || {}; }
    catch { try { data = { body: event.data.text() }; } catch { data = {}; } }
  }
  const title = data.title || 'Nova Tratores';
  const options = {
    body: data.body || 'Você tem uma novidade no app.',
    icon: data.icon || '/capa_app.png',
    badge: data.badge || '/capa_app.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: [{ action: 'open', title: 'Abrir' }],
  };

  // Mostrar notificação E baixar dados em background
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      backgroundPrefetch().catch(() => {}),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(url).catch(() => {});
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
