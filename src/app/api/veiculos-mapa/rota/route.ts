import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.ROTAEXATA_API_URL || 'https://api.rotaexata.com.br'
const EMAIL = process.env.ROTAEXATA_EMAIL || ''
const PASSWORD = process.env.ROTAEXATA_PASSWORD || ''
// O gateway da Rota Exata responde 502 sem User-Agent (o fetch do Node não envia um por padrão)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

let tokenCache: { token: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token
  const res = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`Login falhou: ${res.status}`)
  const data = await res.json()
  if (!data.token) throw new Error('Token nao retornado')
  tokenCache = { token: data.token, expiresAt: Date.now() + 50 * 60 * 1000 }
  return data.token
}

export async function GET(request: NextRequest) {
  const adesaoId = request.nextUrl.searchParams.get('adesaoId')
  if (!adesaoId) {
    return NextResponse.json({ error: 'adesaoId obrigatorio' }, { status: 400 })
  }

  try {
    const token = await getToken()
    const hoje = new Date().toISOString().split('T')[0]

    const where = encodeURIComponent(JSON.stringify({
      adesao_id: adesaoId,
      dt_posicao: { $gte: `${hoje}T00:00:00.000-03:00`, $lte: `${hoje}T23:59:59.999-03:00` },
    }))

    // Buscar todas as posicoes do dia (ate 500)
    const posRes = await fetch(
      `${API_URL}/posicoes?where=${where}&limit=500&page=0&sort=dt_posicao`,
      { headers: { Authorization: token, 'User-Agent': UA } },
    )
    if (!posRes.ok) return NextResponse.json([])

    const posData = await posRes.json()
    const posArr = Array.isArray(posData.data) ? posData.data : []

    const pontos = posArr
      .filter((p: any) => p.latitude && p.longitude)
      .map((p: any) => ({
        lat: p.latitude,
        lng: p.longitude,
        velocidade: p.velocidade || 0,
        ignicao: p.ignicao || 0,
        dt_posicao: p.dt_posicao,
      }))

    return NextResponse.json(pontos)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
