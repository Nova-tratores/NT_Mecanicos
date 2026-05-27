import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

// Cache em memória (5 min — clientes mudam pouco)
let cache: { data: unknown[]; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  try {
    // Busca paginada (tabela pode ter >1000 registros)
    const rows: Record<string, unknown>[] = []
    const PAGE = 1000
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('Clientes')
        .select('id, nome_fantasia, razao_social, cnpj_cpf, cidade, estado, lat, lng, latitude, longitude')
        .range(from, from + PAGE - 1)

      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }

    // Só retorna clientes com coordenadas (para o mapa)
    const clientes = rows
      .map((c) => {
        const lat = c.lat ?? c.latitude
        const lng = c.lng ?? c.longitude
        return {
          id: c.id,
          nome: (c.nome_fantasia || c.razao_social || 'Sem nome') as string,
          cidade: (c.cidade || '') as string,
          estado: (c.estado || '') as string,
          lat: lat != null ? Number(lat) : null,
          lng: lng != null ? Number(lng) : null,
        }
      })
      .filter((c) => c.lat && c.lng)

    cache = { data: clientes, ts: Date.now() }
    return NextResponse.json(clientes)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro' }, { status: 500 })
  }
}
