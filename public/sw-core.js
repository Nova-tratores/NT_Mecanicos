/* eslint-disable */
/**
 * NT Mecânicos — Service Worker (lógica).
 * Carregado por /sw.js, que define antes:
 *   self.NT_BUILD            id do build atual
 *   self.NT_PRECACHE_STATIC  todos os arquivos de /_next/static do build
 *   self.NT_PRECACHE_PAGES   páginas do técnico (rotas sem parâmetro)
 *
 * Estratégia:
 * - Cada build tem o SEU cache (nt-build-<id>) com HTML + JS do mesmo build.
 *   Página e arquivos nunca se misturam entre versões -> sem tela branca.
 * - Páginas: cache primeiro (abre na hora, mesmo sem internet) e atualiza em
 *   segundo plano.
 * - JS/CSS/imagens: cache primeiro (arquivos com hash nunca mudam).
 * - Dados (Supabase, /api): nunca passam pelo SW — ficam no IndexedDB do app.
 */

const BUILD = self.NT_BUILD || 'dev';
const CACHE_PREFIX = 'nt-build-';
const CACHE = CACHE_PREFIX + BUILD;
const META_CACHE = 'nt-meta';
const BUILDS_KEY = '/__nt_builds__';
const BUILDS_MANTIDOS = 2; // build atual + anterior (a aba aberta ainda usa os arquivos dela)

const PRECACHE_STATIC = self.NT_PRECACHE_STATIC || [];
const PRECACHE_PAGES = self.NT_PRECACHE_PAGES || ['/'];
const PRECACHE_EXTRA = ['/manifest.json', '/capa_app.png', '/Logo_Nova.png', '/icon-192.png', '/icon-512.png'];

const STATIC_PATTERNS = [
  /^\/_next\/static\//,
  /\.(?:png|jpg|jpeg|svg|gif|ico|webp|woff2?|ttf)$/,
  /^\/manifest\.json$/,
];

// Rotas com parâmetro: se não estiverem no cache, mostramos aviso (não outra OS)
const ROTAS_DINAMICAS = [
  /^\/os\/[^/]+(\/preencher)?\/?$/,
  /^\/os-enviadas\/[^/]+\/?$/,
  /^\/requisicoes\/[^/]+\/?$/,
  /^\/requisicoes\/atualizar\/[^/]+\/?$/,
];

// ── Utilidades ──────────────────────────────────────────────

function comTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function chavePagina(url) {
  const u = new URL(url, self.location.origin);
  let p = u.pathname;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return self.location.origin + p;
}

function ehHtml(response) {
  return (response.headers.get('Content-Type') || '').includes('text/html');
}

/** Executa tarefas com no máximo `limite` ao mesmo tempo. */
async function emLotes(itens, limite, fn) {
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) {
      const item = itens[i++];
      try { await fn(item); } catch (e) { /* item falhou, segue */ }
    }
  });
  await Promise.all(trabalhadores);
}

async function salvarPagina(cache, url, response) {
  if (!response || !response.ok || response.redirected || !ehHtml(response)) return;
  await cache.put(chavePagina(url), response);
}

async function baixarPagina(cache, url, timeoutMs) {
  const res = await comTimeout(fetch(url, { cache: 'no-store', credentials: 'same-origin' }), timeoutMs);
  await salvarPagina(cache, url, res.clone());
  return res;
}

// ── Instalação: baixa a versão inteira antes de assumir ─────

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // Arquivos com hash: reaproveita o que já existe de builds anteriores
    await emLotes([...PRECACHE_STATIC, ...PRECACHE_EXTRA], 6, async (url) => {
      if (await cache.match(url)) return;
      const antigo = await caches.match(url);
      if (antigo && url.startsWith('/_next/static/')) {
        await cache.put(url, antigo);
        return;
      }
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) await cache.put(url, res);
    });

    // Páginas do técnico (HTML deste build). A página inicial é obrigatória:
    // se falhar, a instalação falha e o SW antigo continua (o navegador tenta depois).
    await baixarPagina(cache, '/', 30000);
    await emLotes(PRECACHE_PAGES.filter((p) => p !== '/'), 4, (p) => baixarPagina(cache, p, 30000));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const meta = await caches.open(META_CACHE);
    let builds = [];
    try {
      const r = await meta.match(BUILDS_KEY);
      if (r) builds = await r.json();
    } catch (e) { builds = []; }
    builds = [...builds.filter((b) => b !== BUILD), BUILD].slice(-BUILDS_MANTIDOS);
    await meta.put(BUILDS_KEY, new Response(JSON.stringify(builds), { headers: { 'Content-Type': 'application/json' } }));

    const manter = new Set([META_CACHE, ...builds.map((b) => CACHE_PREFIX + b)]);
    const chaves = await caches.keys();
    // Remove builds antigos e os caches do SW anterior (nt-assets-*, nt-pages-*)
    await Promise.all(chaves.filter((k) => !manter.has(k)).map((k) => caches.delete(k)));

    await self.clients.claim();
  })());
});

// ── Requisições ─────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, mapas etc.
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/sw.js' || url.pathname === '/sw-core.js') return;

  // Payload RSC (navegação interna do Next)
  if (req.headers.get('RSC') === '1') {
    event.respondWith(tratarRsc(req, url));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(tratarNavegacao(event, req, url));
    return;
  }

  if (STATIC_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(tratarEstatico(req));
    return;
  }

  // Outros GET do próprio app (ex.: pré-carregamento de páginas via fetch)
  event.respondWith(tratarOutros(req));
});

/**
 * RSC. O Next 16 faz vários pedidos diferentes na MESMA URL (prefetch de cada
 * segmento, navegação completa). A chave do cache inclui esses cabeçalhos para
 * não entregar o pedaço errado. Navegação completa sem rede -> erro, e o Next
 * faz navegação normal, que é servida pelo HTML do cache.
 */
function chaveRsc(req, url) {
  const prefetch = req.headers.get('Next-Router-Prefetch') || '';
  const segmento = req.headers.get('Next-Router-Segment-Prefetch') || '';
  return self.location.origin + url.pathname
    + '?__rsc=' + encodeURIComponent(prefetch) + '&__seg=' + encodeURIComponent(segmento);
}

async function tratarRsc(req, url) {
  const ehPrefetch = !!req.headers.get('Next-Router-Prefetch');
  if (!ehPrefetch) {
    try {
      return await comTimeout(fetch(req), 8000);
    } catch (e) {
      return Response.error();
    }
  }

  const chave = chaveRsc(req, url);
  const cache = await caches.open(CACHE);
  try {
    const res = await comTimeout(fetch(req), 5000);
    if (res.ok) cache.put(chave, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const cached = await cache.match(chave, { ignoreVary: true });
    return cached || Response.error();
  }
}

async function tratarNavegacao(event, req, url) {
  const cache = await caches.open(CACHE);
  const chave = chavePagina(url.href);
  const cached = await cache.match(chave, { ignoreVary: true });

  if (cached) {
    // Abre na hora e atualiza em segundo plano para a próxima vez
    event.waitUntil(baixarPagina(cache, url.pathname, 20000).catch(() => {}));
    return cached;
  }

  try {
    const res = await comTimeout(fetch(req), 10000);
    if (res.ok) await salvarPagina(cache, url.href, res.clone());
    return res;
  } catch (e) {
    return paginaOffline(ROTAS_DINAMICAS.some((r) => r.test(url.pathname)));
  }
}

async function tratarEstatico(req) {
  const cached = await caches.match(req, { ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function tratarOutros(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await comTimeout(fetch(req), 10000);
    if (res.ok && ehHtml(res)) await salvarPagina(cache, req.url, res.clone());
    return res;
  } catch (e) {
    const cached = (await cache.match(chavePagina(req.url))) || (await caches.match(req, { ignoreVary: true }));
    return cached || new Response('', { status: 504, statusText: 'Offline' });
  }
}

function paginaOffline(dinamica) {
  const titulo = dinamica ? 'Esta tela ainda não foi baixada' : 'Sem conexão';
  const texto = dinamica
    ? 'Ela será baixada automaticamente na próxima vez que o celular tiver internet. As outras telas do app continuam funcionando.'
    : 'Conecte-se à internet e tente novamente.';
  const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<meta name="theme-color" content="#1E3A5F"><title>NT Mecânicos</title><style>'
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + 'body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif;'
    + 'background:linear-gradient(180deg,#1E3A5F 0%,#0F1F33 100%);color:#fff;padding:32px}'
    + '.c{text-align:center;max-width:340px}.i{width:72px;height:72px;border-radius:20px;background:rgba(255,255,255,.1);'
    + 'display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:34px}'
    + 'h2{font-size:20px;font-weight:800;margin-bottom:8px}p{font-size:14px;color:rgba(255,255,255,.75);line-height:1.6}'
    + '.b{display:block;margin-top:20px;padding:14px 20px;border-radius:14px;border:0;font-size:15px;font-weight:700;text-decoration:none;cursor:pointer;width:100%}'
    + '.p{background:#F59E0B;color:#1E293B}.s{background:rgba(255,255,255,.12);color:#fff;margin-top:10px}'
    + '</style></head><body><div class="c"><div class="i">📶</div>'
    + '<h2>' + titulo + '</h2><p>' + texto + '</p>'
    + '<a class="b p" href="/">Ir para o início</a>'
    + '<button class="b s" onclick="location.reload()">Tentar novamente</button>'
    + '</div></body></html>';
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ── Download em segundo plano (com o app fechado) ───────────

const IDB_NAME = 'nt-mecanicos-offline';
const IDB_STORE = 'cache';

function abrirIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await abrirIdb();
    return await new Promise((resolve) => {
      const get = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      get.onsuccess = () => resolve(get.result ? get.result.data : null);
      get.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function idbSet(key, data) {
  try {
    const db = await abrirIdb();
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ key, data, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch (e) { /* sem espaço etc. */ }
}

async function buscarJson(url, headers) {
  const res = await comTimeout(fetch(url, { headers }), 20000);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

let prefetchEmAndamento = null;

function backgroundPrefetch() {
  if (!prefetchEmAndamento) {
    prefetchEmAndamento = executarPrefetch().finally(() => { prefetchEmAndamento = null; });
  }
  return prefetchEmAndamento;
}

async function executarPrefetch() {
  const config = await idbGet('sw-config');
  if (!config || !config.supabaseUrl || !config.tecnicoNome) return;

  const { supabaseUrl, supabaseKey, tecnicoNome } = config;
  const headers = { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey };
  const base = supabaseUrl + '/rest/v1';

  try {
    // 1. OS abertas do técnico
    const nome = encodeURIComponent(tecnicoNome);
    const osList = await buscarJson(
      base + '/Ordem_Servico?select=*&Status=not.in.("Concluida","Cancelada","Concluída","cancelada")'
        + '&or=(Os_Tecnico.ilike.%25' + nome + '%25,Os_Tecnico2.ilike.%25' + nome + '%25)&order=Id_Ordem.desc',
      headers,
    );

    await idbSet('prefetch:os-list', osList);
    for (const os of osList) await idbSet('prefetch:os:' + os.Id_Ordem, os);

    // 2. Relatórios já iniciados dessas OS
    const ids = osList.map((o) => '"' + o.Id_Ordem + '"').join(',');
    if (ids) {
      try {
        const tec = await buscarJson(base + '/Ordem_Servico_Tecnicos?select=*&Ordem_Servico=in.(' + ids + ')', headers);
        for (const e of tec) await idbSet('prefetch:os-tec:' + e.Ordem_Servico, e);
      } catch (e) { /* segue */ }
    }

    // 3. Peças (PPV) de cada OS
    await emLotes(osList.filter((o) => o.ID_PPV), 3, async (os) => {
      const ppv = await buscarJson(base + '/movimentacoes?select=*&Id_PPV=eq.' + encodeURIComponent(os.ID_PPV), headers);
      await idbSet('prefetch:ppv:' + os.ID_PPV, ppv);
    });

    // 4. Telas de cada OS (para abrir offline)
    const cache = await caches.open(CACHE);
    const paginas = osList.flatMap((os) => ['/os/' + os.Id_Ordem, '/os/' + os.Id_Ordem + '/preencher']);
    await emLotes(paginas, 3, (p) => baixarPagina(cache, p, 20000));
  } catch (err) {
    console.warn('[SW] Download em segundo plano falhou:', err);
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'bg-prefetch') event.waitUntil(backgroundPrefetch());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PREFETCH') event.waitUntil(backgroundPrefetch());
});

// ── Notificações ────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Nova Tratores';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    tag: data.tag || undefined,
    renotify: !!data.tag,
  };

  // Mostra a notificação e já baixa os dados novos para usar offline
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    backgroundPrefetch().catch(() => {}),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const janela of janelas) {
      if (new URL(janela.url).origin !== self.location.origin) continue;
      try {
        await janela.focus();
        if (janela.url !== destino && 'navigate' in janela) await janela.navigate(destino);
        return;
      } catch (e) { /* tenta abrir nova janela */ }
    }
    await self.clients.openWindow(destino);
  })());
});
