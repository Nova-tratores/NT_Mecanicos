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

async function fetchRotaExata(endpoint: string, params?: Record<string, string>) {
  const token = await getToken()
  let url = `${API_URL}${endpoint}`
  if (params) {
    url += '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  }
  const res = await fetch(url, { headers: { Authorization: token } })
  if (!res.ok) throw new Error(`Rota Exata ${endpoint}: ${res.status}`)
  return res.json()
}

export async function GET() {
  if (!EMAIL || !PASSWORD) {
    return NextResponse.json({ error: 'Credenciais Rota Exata nao configuradas' }, { status: 500 })
  }

  try {
    // Buscar adesoes (veiculos cadastrados)
    const adesoes = await fetchRotaExata('/adesoes')
    const lista = Array.isArray(adesoes.data) ? adesoes.data : (Array.isArray(adesoes) ? adesoes : [])

    // Buscar ultima posicao de cada veiculo
    const veiculos = await Promise.all(
      lista.map(async (a: any) => {
        try {
          const hoje = new Date().toISOString().split('T')[0]
          const pos = await fetchRotaExata('/posicoes', {
            adesao_id: String(a.id || a._id),
            data_inicial: `${hoje}T00:00:00`,
            data_final: `${hoje}T23:59:59`,
            limit: '1',
          })
          const posArr = Array.isArray(pos.data) ? pos.data : (Array.isArray(pos) ? pos : [])
          const ultima = posArr[0] || null

          return {
            id: a.id || a._id,
            placa: a.vei_placa || a.placa || '',
            descricao: a.vei_descricao || a.descricao || '',
            modelo: a.vei_modelo || a.modelo || '',
            lat: ultima?.latitude || null,
            lng: ultima?.longitude || null,
            velocidade: ultima?.velocidade || 0,
            ignicao: ultima?.ignicao || 0,
            dt_posicao: ultima?.dt_posicao || null,
          }
        } catch {
          return {
            id: a.id || a._id,
            placa: a.vei_placa || a.placa || '',
            descricao: a.vei_descricao || a.descricao || '',
            modelo: a.vei_modelo || a.modelo || '',
            lat: null, lng: null, velocidade: 0, ignicao: 0, dt_posicao: null,
          }
        }
      }),
    )

    return NextResponse.json(veiculos.filter((v) => v.lat && v.lng))
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro ao buscar veiculos' }, { status: 500 })
  }
}
