import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Lê pontos GPS de UM dia de UMA placa, ordenados temporalmente.
// Diferente de /api/veiculos-mapa/rota (que puxa direto do RotaExata,
// só dia atual), este lê do Supabase (rastreio_pontos_relatorio populado
// pelo cron do OMIE) — funciona pra qualquer data histórica.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

const PAGE_SIZE = 1000
const MAX_PONTOS = 5000

interface PontoRota {
  lat: number
  lng: number
  velocidade: number
  ignicao: number
  dt_posicao: string
}

interface RowGps {
  latitude: number
  longitude: number
  velocidade: number
  ignicao: number
  dt_posicao: string
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const placa = (sp.get('placa') || '').trim()
  const data = (sp.get('data') || '').trim()

  if (!placa || !data) {
    return NextResponse.json({ error: 'Parâmetros obrigatórios: placa, data (YYYY-MM-DD)' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: 'data deve ser YYYY-MM-DD' }, { status: 400 })
  }

  // Variantes da placa: o GPS pode salvar com ou sem hífen.
  const placaNorm = placa.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const variantes = [placaNorm]
  if (placaNorm.length === 7) variantes.push(`${placaNorm.slice(0, 3)}-${placaNorm.slice(3)}`)

  // Pagina (PostgREST cap default é 1000).
  const todos: RowGps[] = []
  for (let from = 0; from < MAX_PONTOS; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, MAX_PONTOS - 1)
    const { data: lote, error } = await supabase
      .from('rastreio_pontos_relatorio')
      .select('latitude, longitude, velocidade, ignicao, dt_posicao')
      .in('placa', variantes)
      .eq('data', data)
      .range(from, to)

    if (error) {
      console.warn('[rota-historica] página', from, 'erro:', error.message)
      break
    }
    const linhas = (lote || []) as RowGps[]
    todos.push(...linhas)
    if (linhas.length < PAGE_SIZE) break
  }

  if (todos.length === 0) {
    return NextResponse.json({ pontos: [], total: 0 })
  }

  // Ordena temporalmente (a query sai sem order pra evitar timeout em colunas
  // sem índice, mas com poucos milhares de pontos o sort em memória é trivial).
  todos.sort((a, b) => a.dt_posicao.localeCompare(b.dt_posicao))

  const pontos: PontoRota[] = todos.map(r => ({
    lat: r.latitude,
    lng: r.longitude,
    velocidade: r.velocidade,
    ignicao: r.ignicao,
    dt_posicao: r.dt_posicao,
  }))

  return NextResponse.json({ pontos, total: pontos.length })
}
