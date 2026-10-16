import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

/**
 * Service worker gerado por build.
 *
 * O conteúdo muda a cada deploy (BUILD_ID), então o navegador detecta a versão
 * nova sozinho e o SW novo pré-baixa TODOS os arquivos da versão (JS, CSS e as
 * páginas do técnico) antes de assumir. Assim o app nunca abre uma página nova
 * apontando para um arquivo que não foi baixado (tela branca offline).
 *
 * A lógica do SW fica em /public/sw-core.js.
 */

// Rotas do técnico que devem abrir offline mesmo sem nunca terem sido visitadas
const ROTAS_IGNORADAS = [/^\/_/, /^\/api(\/|$)/, /^\/admin(\/|$)/, /^\/sw\.js$/, /\[/, /\.\w+$/]

let cache: { buildId: string; body: string } | null = null

function listarArquivos(dir: string, base: string): string[] {
  const out: string[] = []
  for (const nome of readdirSync(dir)) {
    const full = path.join(dir, nome)
    if (statSync(full).isDirectory()) out.push(...listarArquivos(full, `${base}/${nome}`))
    else if (!nome.endsWith('.map')) out.push(`${base}/${nome}`)
  }
  return out
}

function gerar(): { buildId: string; body: string } {
  const nextDir = path.join(process.cwd(), '.next')
  let buildId = 'dev'
  try { buildId = readFileSync(path.join(nextDir, 'BUILD_ID'), 'utf-8').trim() } catch {}

  if (cache && cache.buildId === buildId) return cache

  let estaticos: string[] = []
  try { estaticos = listarArquivos(path.join(nextDir, 'static'), '/_next/static') } catch {}

  let paginas: string[] = ['/']
  try {
    const manifest = JSON.parse(readFileSync(path.join(nextDir, 'app-path-routes-manifest.json'), 'utf-8')) as Record<string, string>
    paginas = [...new Set(Object.entries(manifest)
      .filter(([arquivo]) => arquivo.endsWith('/page'))
      .map(([, rota]) => rota)
      .filter((rota) => !ROTAS_IGNORADAS.some((r) => r.test(rota))))]
  } catch {}

  const body = [
    `self.NT_BUILD = ${JSON.stringify(buildId)};`,
    `self.NT_PRECACHE_STATIC = ${JSON.stringify(estaticos)};`,
    `self.NT_PRECACHE_PAGES = ${JSON.stringify(paginas)};`,
    `importScripts('/sw-core.js?v=' + encodeURIComponent(self.NT_BUILD));`,
  ].join('\n')

  cache = { buildId, body }
  return cache
}

export function GET() {
  const { body } = gerar()
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  })
}
