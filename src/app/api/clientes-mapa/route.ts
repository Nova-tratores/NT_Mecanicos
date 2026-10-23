// Clientes no mapa do técnico. Lia a tabela 'Clientes', que não existe; agora lê o cadastro do Omie do portal
// (portal_nt_clientes_cadastro_omie: cnpj_cpf, nome_fantasia, razao_social, cidade, estado, lat, lng) e exige
// login (José, 23/10/2026). O mesmo cliente nas duas empresas aparece uma vez (por CNPJ/CPF).
import { NextRequest, NextResponse } from 'next/server'
import { exigirUsuario, supabaseAdmin } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

// Cache em memória (5 min — clientes mudam pouco)
let cache: { data: unknown[]; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

export async function GET(req: NextRequest) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  try {
    const supabase = supabaseAdmin()
    const rows: Record<string, unknown>[] = []
    const PAGE = 1000
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('portal_nt_clientes_cadastro_omie')
        .select('cnpj_cpf, nome_fantasia, razao_social, cidade, estado, lat, lng')
        .not('lat', 'is', null)
        .not('lng', 'is', null)
        .range(from, from + PAGE - 1)

      if (error) throw error
      if (!data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }

    const vistos = new Set<string>()
    const clientes = rows
      .map((c) => ({
        id: String(c.cnpj_cpf || ''),
        nome: String(c.nome_fantasia || c.razao_social || 'Sem nome'),
        cidade: String(c.cidade || ''),
        estado: String(c.estado || ''),
        lat: c.lat != null ? Number(c.lat) : null,
        lng: c.lng != null ? Number(c.lng) : null,
      }))
      .filter((c) => {
        if (!c.lat || !c.lng) return false
        const k = c.id.replace(/\D/g, '') || `${c.nome}|${c.lat}|${c.lng}`
        if (vistos.has(k)) return false
        vistos.add(k)
        return true
      })

    cache = { data: clientes, ts: Date.now() }
    return NextResponse.json(clientes)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro' }, { status: 500 })
  }
}
