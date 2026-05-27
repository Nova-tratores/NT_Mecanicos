import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { InfracaoItem } from '@/lib/types'
import { cleanName } from '@/lib/relatorios'

// O campo "motorista" em rastreio_pontos_relatorio vem do RotaExata como JSON
// stringificado: {"id":64570,"nome":"DANILO SOUZA","email":"...","cnh":"..."}.
// Esta função extrai SÓ o nome — sem isso, o cleanName aplicado no JSON inteiro
// gera uma colcha de palavras (id, email, CNH, datas) que polui o fuzzy match
// e fica impossível bater com "DANILO SOUZA" puro.
function extrairNomeMotorista(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = String(raw).trim()
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s) as { nome?: string; name?: string }
      return String(obj.nome || obj.name || '').trim()
    } catch {
      // Fallback se o JSON estiver malformado: regex direto
      const m = /"nome"\s*:\s*"([^"]+)"/i.exec(s)
      return m ? m[1] : ''
    }
  }
  return s
}

// Match canônico bidirecional palavra-a-palavra (mesma lógica do relatorios.ts).
// Exige no mínimo 2 palavras significativas em cada lado — evita que "Danilo"
// sozinho case com qualquer "Danilo X". "PEDRO MOTTA" continua casando com
// "PEDRO HENRIQUE MOTTA" porque ambos têm >= 2 palavras e um é subset do outro.
function canonicoBate(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const palA = a.split(' ').filter(w => w.length >= 3)
  const palB = b.split(' ').filter(w => w.length >= 3)
  if (palA.length < 2 || palB.length < 2) return false
  return palA.every(w => palB.includes(w)) || palB.every(w => palA.includes(w))
}

// Cliente Supabase server-side (anon key — tabelas têm allow_all RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const TILE_TTL_DAYS = 30
const TILE_TTL_MS = TILE_TTL_DAYS * 24 * 60 * 60 * 1000
const TILE_SIZE_DEG = 0.01  // ~1.1km na latitude de Botucatu/Botucatu/Avaré
// Filtra pontos > 60 km/h (raramente há infração abaixo disso em vias urbanas/rodovias).
// Subir o threshold reduz pontos pra processar — crítico enquanto o cache de tiles
// não está cheio (cada tile novo = ~5s no Overpass, e meses cheios geram 200+ tiles).
const MIN_VEL_PARA_CHECAR = 60
const MAX_PONTOS_POR_REQ = 2000
const PAGE_SIZE = 1000
const RAIO_MATCHING_M = 200

// Heurística de maxspeed por tipo de via quando OSM não tem o campo "maxspeed"
// (cobre o caso comum no Brasil onde poucas vias têm maxspeed mapeado)
const MAXSPEED_POR_TIPO: Record<string, number> = {
  motorway: 110,
  motorway_link: 80,
  trunk: 100,
  trunk_link: 70,
  primary: 80,
  primary_link: 60,
  secondary: 60,
  secondary_link: 50,
  tertiary: 50,
  tertiary_link: 40,
  unclassified: 40,
  residential: 40,
  living_street: 30,
  service: 30,
  road: 50,
}

interface Ponto {
  id: number
  placa: string
  dt_posicao: string
  latitude: number
  longitude: number
  velocidade: number
}

interface ViaCache {
  maxspeed: number | null
  highway: string | null
  name: string | null
  geometry: { lat: number; lon: number }[]
}

// =========================================================
// Tile helpers (~1.1km × 1.1km, chave "lat.XX,lng.XX")
// =========================================================

function tileKeyOf(lat: number, lng: number): string {
  const latF = Math.floor(lat / TILE_SIZE_DEG) * TILE_SIZE_DEG
  const lngF = Math.floor(lng / TILE_SIZE_DEG) * TILE_SIZE_DEG
  return `${latF.toFixed(2)},${lngF.toFixed(2)}`
}

// Distância haversine em metros
function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Distância ponto P a SEGMENTO AB (em metros). Em escala de centenas de metros
// e baixa latitude variação, projetamos pra plano local (equirectangular) — erro
// < 1% nessas distâncias, e muito mais fiel que medir só pros vértices.
function distPontoSegmentoM(
  plat: number, plng: number,
  alat: number, alng: number,
  blat: number, blng: number,
): number {
  const cosLat = Math.cos((plat * Math.PI) / 180)
  const m_per_deg_lat = 111320
  const m_per_deg_lng = 111320 * cosLat
  const px = plng * m_per_deg_lng, py = plat * m_per_deg_lat
  const ax = alng * m_per_deg_lng, ay = alat * m_per_deg_lat
  const bx = blng * m_per_deg_lng, by = blat * m_per_deg_lat
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx, cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

// =========================================================
// Cache de tiles: Supabase persistente + memória do processo
// =========================================================

const memCache = new Map<string, { vias: ViaCache[]; expiry: number }>()

// Flag pra evitar tentar usar a tabela de cache se ela não existir (SQL não rodado).
// Reseta a cada cold start; uma vez detectada como ausente, pula pra Overpass direto.
let supabaseCacheDisponivel: boolean | null = null

async function getViasNoTile(tileKey: string): Promise<ViaCache[]> {
  // 1. Memória do processo
  const mem = memCache.get(tileKey)
  if (mem && mem.expiry > Date.now()) return mem.vias

  // 2. Cache persistente no Supabase (se a tabela existir)
  if (supabaseCacheDisponivel !== false) {
    const { data: cacheRow, error } = await supabase
      .from('maxspeed_tile_cache')
      .select('vias, updated_at')
      .eq('tile_key', tileKey)
      .maybeSingle()

    if (error && error.code === '42P01') {
      // relation does not exist — sinaliza pra não tentar de novo neste processo
      supabaseCacheDisponivel = false
      console.warn('[infracoes] Tabela maxspeed_tile_cache não existe; pulando cache persistente. Rode sql/maxspeed_tile_cache.sql no Supabase.')
    } else if (cacheRow) {
      supabaseCacheDisponivel = true
      const idade = Date.now() - new Date(cacheRow.updated_at).getTime()
      if (idade < TILE_TTL_MS) {
        const vias = cacheRow.vias as ViaCache[]
        memCache.set(tileKey, { vias, expiry: Date.now() + TILE_TTL_MS })
        return vias
      }
    }
  }

  // 3. Query Overpass
  const vias = await queryOverpassTile(tileKey)

  // 4. Persiste (se cache disponível)
  if (supabaseCacheDisponivel !== false) {
    const { error: upsertErr } = await supabase
      .from('maxspeed_tile_cache')
      .upsert({ tile_key: tileKey, vias, updated_at: new Date().toISOString() })
    if (upsertErr && upsertErr.code === '42P01') supabaseCacheDisponivel = false
  }

  memCache.set(tileKey, { vias, expiry: Date.now() + TILE_TTL_MS })
  return vias
}

async function queryOverpassTile(tileKey: string): Promise<ViaCache[]> {
  const [latStr, lngStr] = tileKey.split(',')
  const latMin = parseFloat(latStr)
  const lngMin = parseFloat(lngStr)
  const latMax = latMin + TILE_SIZE_DEG
  const lngMax = lngMin + TILE_SIZE_DEG

  // Pega todas as vias trafegáveis (com ou sem maxspeed); a heurística completa
  const query = `[out:json][timeout:15];
way["highway"](${latMin},${lngMin},${latMax},${lngMax});
out tags geom;`

  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query,
    })
    if (!res.ok) {
      console.warn('[infracoes] Overpass falhou', res.status, tileKey)
      return []
    }
    type OverpassWay = {
      tags?: { maxspeed?: string; highway?: string; name?: string }
      geometry?: { lat: number; lon: number }[]
    }
    const data = (await res.json()) as { elements?: OverpassWay[] }
    return (data.elements || []).map(w => {
      const maxRaw = w.tags?.maxspeed
      const maxNum = maxRaw ? parseInt(String(maxRaw).replace(/[^\d]/g, ''), 10) : null
      return {
        maxspeed: maxNum && !Number.isNaN(maxNum) ? maxNum : null,
        highway: w.tags?.highway || null,
        name: w.tags?.name || null,
        geometry: w.geometry || [],
      }
    })
  } catch (e) {
    console.warn('[infracoes] Erro Overpass', tileKey, e)
    return []
  }
}

// =========================================================
// Matching ponto GPS → via mais próxima (com maxspeed)
// =========================================================

interface MatchVia {
  maxspeed: number
  via: string
  dist: number
}

function matchViaMaisProxima(
  lat: number,
  lng: number,
  vias: ViaCache[],
): MatchVia | null {
  let melhor: MatchVia | null = null
  for (const v of vias) {
    const max = v.maxspeed || (v.highway ? MAXSPEED_POR_TIPO[v.highway] : null)
    if (!max) continue
    // Distância pra cada segmento (entre vértices consecutivos), não pros vértices.
    // Isso pega o caso onde o ponto GPS está na reta entre 2 vértices muito espaçados.
    for (let i = 0; i < v.geometry.length - 1; i++) {
      const a = v.geometry[i]
      const b = v.geometry[i + 1]
      const d = distPontoSegmentoM(lat, lng, a.lat, a.lon, b.lat, b.lon)
      if (d < RAIO_MATCHING_M && (!melhor || d < melhor.dist)) {
        melhor = { maxspeed: max, via: v.name || v.highway || 'via', dist: d }
      }
    }
  }
  return melhor
}

// =========================================================
// Handler
// =========================================================

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const motorista = (sp.get('motorista') || '').trim()
  const dataInicio = sp.get('dataInicio') || ''
  const dataFim = sp.get('dataFim') || ''
  const placa = sp.get('placa') || ''

  if (!dataInicio || !dataFim || (!motorista && !placa)) {
    return NextResponse.json({ error: 'Parâmetros: motorista|placa, dataInicio, dataFim' }, { status: 400 })
  }

  // ---- 1. Busca pontos GPS do período ----
  const baseSelect = 'id, placa, dt_posicao, latitude, longitude, velocidade'
  // Sem .order() — coluna dt_posicao não tem índice, força sort completo na
  // tabela (~95k linhas/mês) e causa statement_timeout. Ordem não importa pro
  // algoritmo de detecção (cada ponto é avaliado independentemente).
  const baseQuery = () => supabase
    .from('rastreio_pontos_relatorio')
    .select(baseSelect)
    .gte('data', dataInicio)
    .lte('data', dataFim)
    .gt('velocidade', MIN_VEL_PARA_CHECAR)

  // Pagina até pegar MAX_PONTOS_POR_REQ ou esgotar.
  // PostgREST default cap por request é 1000; precisamos paginar manualmente
  // com Range pra cobrir meses com muitos pontos.
  // Recebe FACTORY (não instância) porque cada chamada precisa de builder fresh
  // — o cliente Supabase JS muta o estado do builder a cada operação encadeada.
  type QB = ReturnType<typeof baseQuery>
  async function paginarTudo(factory: () => QB): Promise<Ponto[]> {
    const all: Ponto[] = []
    for (let from = 0; from < MAX_PONTOS_POR_REQ; from += PAGE_SIZE) {
      const to = Math.min(from + PAGE_SIZE - 1, MAX_PONTOS_POR_REQ - 1)
      const { data, error } = await factory().range(from, to)
      if (error) {
        console.warn('[infracoes] pagina', from, 'erro:', error.message)
        break
      }
      const lote = (data || []) as Ponto[]
      all.push(...lote)
      if (lote.length < PAGE_SIZE) break
    }
    return all
  }

  let pontos: Ponto[] = []
  let estrategia = ''

  if (placa) {
    pontos = await paginarTudo(() => baseQuery().eq('placa', placa))
    estrategia = `placa=${placa}`
  } else {
    const tecnicoCanon = cleanName(motorista)
    const normPlaca = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

    // 1ª passada: via frota_donos_relatorio (placa → dono).
    // PRIORITARIA porque o filtro por placa usa o índice idx_rastreio_placa_data.
    if (tecnicoCanon) {
      const { data: donosRows } = await supabase
        .from('frota_donos_relatorio')
        .select('chave, dono')
        .not('dono', 'is', null)

      const placasNorm = (donosRows || [])
        .filter(d => canonicoBate(tecnicoCanon, cleanName((d as { dono: string }).dono)))
        .map(d => normPlaca(String((d as { chave: string }).chave || '')))
        .filter(Boolean)

      if (placasNorm.length > 0) {
        const variantes: string[] = []
        for (const n of placasNorm) {
          variantes.push(n)
          if (n.length === 7) variantes.push(`${n.slice(0, 3)}-${n.slice(3)}`)
        }

        pontos = await paginarTudo(() => baseQuery().in('placa', variantes))
        estrategia = `via frota_donos: placas=[${variantes.join(', ')}]`

        if (pontos.length === 0) {
          const orClause = placasNorm
            .map(n => `placa.ilike.${n.slice(0, 3)}%${n.slice(3)}`)
            .join(',')
          pontos = await paginarTudo(() => baseQuery().or(orClause))
          estrategia = `via frota_donos ILIKE: ${orClause}`
        }
      }
    }

    // 2ª passada: ILIKE direto no campo motorista (fallback pra técnicos
    // sem cadastro em frota_donos — pode dar timeout em tabela grande).
    if (pontos.length === 0) {
      pontos = await paginarTudo(() => baseQuery().ilike('motorista', `%${motorista}%`))
      estrategia = `motorista ilike %${motorista}%`
    }
  }

  if (pontos.length === 0) {
    // Diagnóstico: quantos pontos existem no período (qualquer motorista)?
    // count=exact dá HTTP 500 nessa tabela (~100k linhas, timeout no Postgres),
    // então usamos count=planned (estimativa do planner — basta pra distinguir
    // "vazio" de "tem dados").
    const { count: totalPeriodo } = await supabase
      .from('rastreio_pontos_relatorio')
      .select('id', { count: 'planned', head: true })
      .gte('data', dataInicio)
      .lte('data', dataFim)

    let motivo: string
    if (!totalPeriodo || totalPeriodo === 0) {
      motivo = 'A tabela rastreio_pontos_relatorio está vazia para este período. ' +
        'O cron do OMIE provavelmente não rodou ou ainda não sincronizou os dados de GPS.'
    } else {
      const { data: amostra } = await supabase
        .from('rastreio_pontos_relatorio')
        .select('motorista')
        .gte('data', dataInicio)
        .lte('data', dataFim)
        .not('motorista', 'is', null)
        .limit(2000)
      const distintos = new Set<string>()
      for (const r of (amostra || []) as { motorista: string | null }[]) {
        const nome = extrairNomeMotorista(r.motorista)
        if (nome) distintos.add(nome)
      }

      // Verifica também se o técnico tem placa vinculada em frota_donos_relatorio
      const { data: donosRows } = await supabase
        .from('frota_donos_relatorio')
        .select('dono')
      const tecCanon = cleanName(motorista)
      const temVinculoFrota = tecCanon && (donosRows || []).some(d =>
        canonicoBate(tecCanon, cleanName((d as { dono: string }).dono)),
      )

      motivo = `O período tem ${totalPeriodo.toLocaleString('pt-BR')} pontos GPS de ${distintos.size} motoristas distintos, ` +
        `mas nenhum bateu com seu nome ("${motorista}"). ` +
        (temVinculoFrota
          ? 'Há um vínculo em frota_donos_relatorio, mas as placas dele não têm pontos no período.'
          : 'Você não tem placa vinculada em frota_donos_relatorio — peça ao admin pra cadastrar a placa do seu veículo no projeto OMIE.')
    }

    return NextResponse.json({
      infracoes: [],
      stats: {
        totalPontos: 0,
        totalPontosNoPeriodo: totalPeriodo || 0,
        tilesConsultados: 0,
        infracoesDetectadas: 0,
        motivo,
        estrategia,
      },
    })
  }

  // ---- 2. Agrupa por tile (1 query Overpass por tile, não por ponto) ----
  const pontosPorTile = new Map<string, Ponto[]>()
  for (const p of pontos as Ponto[]) {
    const k = tileKeyOf(p.latitude, p.longitude)
    const arr = pontosPorTile.get(k) || []
    arr.push(p)
    pontosPorTile.set(k, arr)
  }

  // ---- 3. Para cada tile: busca vias, depois checa cada ponto ----
  const infracoes: InfracaoItem[] = []
  let pontosMatched = 0     // pontos atribuídos a alguma via com maxspeed
  let pontosSemVia = 0      // pontos onde Overpass retornou vias mas nada bate
  let tilesSemVias = 0      // tiles onde Overpass não trouxe nenhuma via
  for (const [tile, pontosNoTile] of pontosPorTile) {
    const vias = await getViasNoTile(tile)
    if (vias.length === 0) { tilesSemVias++; continue }
    for (const p of pontosNoTile) {
      const match = matchViaMaisProxima(p.latitude, p.longitude, vias)
      if (!match) { pontosSemVia++; continue }
      pontosMatched++
      if (p.velocidade > match.maxspeed) {
        const dt = new Date(p.dt_posicao)
        infracoes.push({
          id: p.id,
          placa: p.placa,
          dtPosicao: p.dt_posicao,
          data: dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          hora: dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          lat: p.latitude,
          lng: p.longitude,
          velocidade: p.velocidade,
          maxspeed: match.maxspeed,
          excesso: p.velocidade - match.maxspeed,
          via: match.via,
        })
      }
    }
  }

  return NextResponse.json({
    infracoes,
    stats: {
      totalPontos: pontos.length,
      tilesConsultados: pontosPorTile.size,
      tilesSemVias,
      pontosMatched,
      pontosSemVia,
      infracoesDetectadas: infracoes.length,
      estrategia,
    },
  })
}
