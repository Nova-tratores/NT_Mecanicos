import { NextResponse } from 'next/server'

const API_URL = process.env.ROTAEXATA_API_URL || 'https://api.rotaexata.com.br'
const EMAIL = process.env.ROTAEXATA_EMAIL || ''
const PASSWORD = process.env.ROTAEXATA_PASSWORD || ''

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

    // 1. Buscar lista de veiculos (adesoes)
    const adesRes = await fetch(`${API_URL}/adesoes?limit=200&page=0`, {
      headers: { Authorization: token },
    })
    if (!adesRes.ok) throw new Error(`Adesoes: ${adesRes.status}`)
    const adesData = await adesRes.json()
    const adesoes = Array.isArray(adesData.data) ? adesData.data : (Array.isArray(adesData) ? adesData : [])

    if (adesoes.length === 0) return NextResponse.json([])

    // 2. Buscar ultima posicao de cada veiculo (em paralelo, max 5 simultaneos)
    const hoje = new Date().toISOString().split('T')[0]
    const veiculos: any[] = []

    // Processar em lotes de 5 para nao sobrecarregar
    const BATCH = 5
    for (let i = 0; i < adesoes.length; i += BATCH) {
      const batch = adesoes.slice(i, i + BATCH)
      const results = await Promise.all(
        batch.map(async (a: any) => {
          const id = a.id || a._id
          try {
            const where = encodeURIComponent(JSON.stringify({
              adesao_id: id,
              dt_posicao: { $gte: `${hoje}T00:00:00.000-03:00`, $lte: `${hoje}T23:59:59.999-03:00` },
            }))
            const posRes = await fetch(
              `${API_URL}/posicoes?where=${where}&limit=1&page=0`,
              { headers: { Authorization: token } },
            )
            if (!posRes.ok || posRes.status === 404) return null
            const posData = await posRes.json()
            const posArr = Array.isArray(posData.data) ? posData.data : []
            const p = posArr[0]
            if (!p || !p.latitude || !p.longitude) return null

            return {
              id,
              placa: a.vei_placa || '',
              descricao: a.vei_descricao || '',
              modelo: a.vei_modelo || '',
              lat: p.latitude,
              lng: p.longitude,
              velocidade: p.velocidade || 0,
              ignicao: p.ignicao || 0,
              dt_posicao: p.dt_posicao || null,
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
