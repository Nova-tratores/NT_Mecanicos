import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const API_URL = process.env.ROTAEXATA_API_URL || 'https://api.rotaexata.com.br'
const EMAIL = process.env.ROTAEXATA_EMAIL || ''
const PASSWORD = process.env.ROTAEXATA_PASSWORD || ''

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

let tokenCache: { token: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token
  const res = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`Login Rota Exata falhou: ${res.status}`)
  const data = await res.json()
  if (!data.token) throw new Error('Token nao retornado')
  tokenCache = { token: data.token, expiresAt: Date.now() + 50 * 60 * 1000 }
  return data.token
}

export async function GET() {
  if (!EMAIL || !PASSWORD) {
    return NextResponse.json({ error: 'Credenciais Rota Exata nao configuradas' }, { status: 500 })
  }

  try {
    const token = await getToken()
    const hoje = new Date().toISOString().split('T')[0]

    // Buscar checkins de hoje (para enriquecer com motorista/cliente)
    const { data: checkins } = await supabase
      .from('checkin_diario')
      .select('tecnico_nome, placa, cliente, id_ordem')
      .eq('data', hoje)

    const checkinMap = new Map<string, { motorista: string; cliente: string; id_ordem: string }>()
    if (checkins) {
      for (const c of checkins) {
        checkinMap.set(c.placa, {
          motorista: c.tecnico_nome,
          cliente: c.cliente || '',
          id_ordem: c.id_ordem || '',
        })
      }
    }

    // Buscar todos os veiculos (adesoes)
    const adesRes = await fetch(`${API_URL}/adesoes?limit=200&page=0`, {
      headers: { Authorization: token },
    })
    if (!adesRes.ok) throw new Error(`Adesoes: ${adesRes.status}`)
    const adesData = await adesRes.json()
    const adesoes = Array.isArray(adesData.data) ? adesData.data : (Array.isArray(adesData) ? adesData : [])

    if (adesoes.length === 0) return NextResponse.json([])

    // Buscar ultima posicao de cada veiculo (ultimos 30min para pegar a mais recente)
    const agora = new Date()
    const trintaAtras = new Date(agora.getTime() - 30 * 60 * 1000)

    const veiculos: any[] = []
    const BATCH = 5
    for (let i = 0; i < adesoes.length; i += BATCH) {
      const batch = adesoes.slice(i, i + BATCH)
      const results = await Promise.all(
        batch.map(async (a: any) => {
          const id = a.id || a._id
          const placaRota = a.vei_placa || ''
          try {
            // Buscar ultimos 30min primeiro (posicao mais recente)
            let where = encodeURIComponent(JSON.stringify({
              adesao_id: id,
              dt_posicao: { $gte: trintaAtras.toISOString(), $lte: agora.toISOString() },
            }))
            let posRes = await fetch(
              `${API_URL}/posicoes?where=${where}&limit=1&page=0`,
              { headers: { Authorization: token } },
            )
            let posData = posRes.ok ? await posRes.json() : { data: [] }
            let posArr = Array.isArray(posData.data) ? posData.data : []

            // Se nao achou nos ultimos 30min, tenta o dia todo
            if (posArr.length === 0 || (posArr.length === 1 && typeof posArr[0]?.data === 'string')) {
              where = encodeURIComponent(JSON.stringify({
                adesao_id: id,
                dt_posicao: { $gte: `${hoje}T00:00:00.000-03:00`, $lte: `${hoje}T23:59:59.999-03:00` },
              }))
              posRes = await fetch(
                `${API_URL}/posicoes?where=${where}&limit=1&page=0`,
                { headers: { Authorization: token } },
              )
              if (!posRes.ok) return null
              posData = await posRes.json()
              posArr = Array.isArray(posData.data) ? posData.data : []
            }

            // Checar resultado vazio da API
            if (posArr.length === 0 || (posArr.length === 1 && typeof posArr[0]?.data === 'string')) return null
            const p = posArr[0]
            if (!p || !p.latitude || !p.longitude) return null

            // Buscar info de checkin pela placa
            const checkinInfo = [...checkinMap.entries()].find(
              ([pc]) => placaRota.includes(pc) || pc.includes(placaRota)
            )
            const info = checkinInfo ? checkinInfo[1] : null

            return {
              id,
              placa: placaRota,
              descricao: a.vei_descricao || '',
              modelo: a.vei_modelo || '',
              lat: p.latitude,
              lng: p.longitude,
              velocidade: p.velocidade || 0,
              ignicao: p.ignicao || 0,
              dt_posicao: p.dt_posicao || null,
              motorista: info?.motorista || '',
              cliente: info?.cliente || '',
              id_ordem: info?.id_ordem || '',
            }
          } catch {
            return null
          }
        }),
      )
      veiculos.push(...results.filter(Boolean))
    }

    return NextResponse.json(veiculos)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro ao buscar veiculos' }, { status: 500 })
  }
}
