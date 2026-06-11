import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const API_URL = process.env.ROTAEXATA_API_URL || 'https://api.rotaexata.com.br'
const EMAIL = process.env.ROTAEXATA_EMAIL || ''
const PASSWORD = process.env.ROTAEXATA_PASSWORD || ''

const BASE_LAT = -23.2085
const BASE_LNG = -49.3710
const RAIO_LOJA_KM = 0.8

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
  if (!data.token) throw new Error('Token não retornado')
  tokenCache = { token: data.token, expiresAt: Date.now() + 50 * 60 * 1000 }
  return data.token
}

async function fetchRota(endpoint: string, params?: Record<string, string>): Promise<any> {
  const token = await getToken()
  let url = `${API_URL}${endpoint}`
  if (params) url += '?' + Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  const res = await fetch(url, { headers: { Authorization: token } })
  if (res.status === 404) return { data: [] }
  if (!res.ok) throw new Error(`Rota Exata ${endpoint}: ${res.status}`)
  return res.json()
}

function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function naLoja(lat: number, lng: number): boolean {
  return distanciaKm(lat, lng, BASE_LAT, BASE_LNG) < RAIO_LOJA_KM
}

// ---------- GET ----------
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const acao = sp.get('acao') || 'veiculos'

    if (acao === 'veiculos') {
      const data = await fetchRota('/adesoes', { limit: '200', page: '0' })
      const veiculos = (data.data || []).map((a: any) => ({
        id: a.id, placa: a.vei_placa || '', descricao: a.vei_descricao || '',
        modelo: a.vei_modelo || '', cor: a.vei_cor || '', ano: a.vei_ano || '',
      }))
      return NextResponse.json(veiculos)
    }

    if (acao === 'motoristas') {
      const data = await fetchRota('/motoristas', { limit: '200', page: '0' })
      const motoristas = (data.data || []).map((m: any) => ({
        _id: m._id, adesao_id: m.adesao_id,
        motorista_id: m.motorista_id || m.motorista?.id,
        nome: m.motorista?.nome || '', modo: m.modo || '',
        dt_inicio: m.dt_inicio, final: m.final,
      }))
      return NextResponse.json(motoristas)
    }

    if (acao === 'usuarios_motoristas') {
      const data = await fetchRota('/usuarios', { limit: '200', page: '0' })
      const motoristas = (data.data || []).filter((u: any) => u.motorista === 1).map((u: any) => ({
        id: u.id, nome: u.nome || '', cargo: u.cargo || '',
      }))
      return NextResponse.json(motoristas)
    }

    if (acao === 'vinculos_supabase') {
      const { data } = await supabase.from('tecnico_veiculos').select('*').order('tecnico_nome')
      return NextResponse.json(data || [])
    }

    // ---- MAPA: posições em tempo real de todos os veículos ----
    if (acao === 'veiculos_mapa') {
      const veicData = await fetchRota('/adesoes', { limit: '200', page: '0' })
      const adesoes: any[] = veicData.data || []
      const motData = await fetchRota('/motoristas', { limit: '200', page: '0' })
      const motoristas: any[] = motData.data || []

      const { data: vinculos } = await supabase.from('tecnico_veiculos').select('*')
      const vinculoMap: Record<number, any> = {}
      for (const v of (vinculos || [])) vinculoMap[v.adesao_id] = v

      const hoje = new Date().toISOString().slice(0, 10)
      const results: any[] = []

      // Batch de 10 para não sobrecarregar
      for (let i = 0; i < adesoes.length; i += 10) {
        const batch = adesoes.slice(i, i + 10)
        const promises = batch.map(async (ad: any) => {
          try {
            const posData = await fetchRota('/posicoes', {
              adesao_id: String(ad.id), limit: '2000',
              dt_posicao_inicial: `${hoje} 00:00:00`,
              dt_posicao_final: `${hoje} 23:59:59`,
            })
            const posicoes: any[] = (posData.data || []).sort((a: any, b: any) =>
              (a.dt_posicao || '').localeCompare(b.dt_posicao || ''))

            const ultima = posicoes[posicoes.length - 1]
            if (!ultima) return null

            // Status baseado na última posição
            const dtUlt = new Date(ultima.dt_posicao).getTime()
            const diffMin = (Date.now() - dtUlt) / 60000
            let status = 'Offline'
            if (diffMin < 5) status = 'Online'
            else if (diffMin < 30) status = `${Math.round(diffMin)}min atrás`

            // Detectar paradas (ignição=0, velocidade=0, >5min)
            const paradas: any[] = []
            let paradaInicio: any = null
            for (const p of posicoes) {
              const ign = p.ignicao === true || p.ignicao === 1
              const vel = p.velocidade || 0
              if (!ign && vel === 0) {
                if (!paradaInicio) paradaInicio = p
              } else {
                if (paradaInicio) {
                  const durMin = (new Date(p.dt_posicao).getTime() - new Date(paradaInicio.dt_posicao).getTime()) / 60000
                  if (durMin >= 5) {
                    paradas.push({
                      lat: paradaInicio.latitude, lng: paradaInicio.longitude,
                      inicio: paradaInicio.dt_posicao, fim: p.dt_posicao,
                      duracao_min: Math.round(durMin),
                    })
                  }
                  paradaInicio = null
                }
              }
            }
            // Parada em andamento
            if (paradaInicio) {
              const durMin = (Date.now() - new Date(paradaInicio.dt_posicao).getTime()) / 60000
              if (durMin >= 5) {
                paradas.push({
                  lat: paradaInicio.latitude, lng: paradaInicio.longitude,
                  inicio: paradaInicio.dt_posicao, fim: null,
                  duracao_min: Math.round(durMin),
                })
              }
            }

            // Tempo ligado
            let tempoLigado = 0
            for (let j = 1; j < posicoes.length; j++) {
              const prev = posicoes[j - 1]
              if (prev.ignicao === true || prev.ignicao === 1) {
                const diff = (new Date(posicoes[j].dt_posicao).getTime() - new Date(prev.dt_posicao).getTime()) / 60000
                if (diff < 30) tempoLigado += diff
              }
            }

            // Motorista atual
            const motAtual = motoristas.filter((m: any) => m.adesao_id === ad.id && m.final !== 1)
              .sort((a: any, b: any) => (b.dt_inicio || '').localeCompare(a.dt_inicio || ''))[0]
            const vinculo = vinculoMap[ad.id]

            return {
              id: ad.id, placa: ad.vei_placa || '', descricao: ad.vei_descricao || '',
              modelo: ad.vei_modelo || '',
              lat: ultima.latitude, lng: ultima.longitude,
              velocidade: ultima.velocidade || 0,
              ignicao: ultima.ignicao === true || ultima.ignicao === 1,
              status,
              motorista: motAtual?.motorista?.nome || vinculo?.tecnico_nome || '',
              paradas_hoje: paradas,
              tempo_ligado_min: Math.round(tempoLigado),
              pontos_hoje: posicoes.length,
              na_loja: naLoja(ultima.latitude, ultima.longitude),
            }
          } catch { return null }
        })
        const batchRes = await Promise.all(promises)
        results.push(...batchRes.filter(Boolean))
      }

      return NextResponse.json(results)
    }

    // ---- Posições brutas de um veículo (para rota) ----
    if (acao === 'posicoes') {
      const adesaoId = sp.get('adesao_id')
      const data = sp.get('data') || new Date().toISOString().slice(0, 10)
      const limit = sp.get('limit') || '2000'
      if (!adesaoId) return NextResponse.json({ error: 'adesao_id obrigatório' }, { status: 400 })

      const posData = await fetchRota('/posicoes', {
        adesao_id: adesaoId, limit,
        dt_posicao_inicial: `${data} 00:00:00`,
        dt_posicao_final: `${data} 23:59:59`,
      })
      const posicoes = (posData.data || []).sort((a: any, b: any) =>
        (a.dt_posicao || '').localeCompare(b.dt_posicao || ''))
        .map((p: any) => ({
          lat: p.latitude, lng: p.longitude,
          velocidade: p.velocidade || 0,
          ignicao: p.ignicao === true || p.ignicao === 1,
          dt: p.dt_posicao,
        }))

      // Calcular km total
      let kmTotal = 0
      for (let i = 1; i < posicoes.length; i++) {
        const d = distanciaKm(posicoes[i - 1].lat, posicoes[i - 1].lng, posicoes[i].lat, posicoes[i].lng)
        if (d < 5) kmTotal += d
      }

      return NextResponse.json({ posicoes, km_total: Math.round(kmTotal * 10) / 10 })
    }

    // ---- Clientes com coordenadas ----
    if (acao === 'clientes') {
      const { data } = await supabase
        .from('portal_nt_clientes_PRINCIPAL')
        .select('id, nome_fantasia, razao_social, cnpj_cpf, cidade, estado, lat, lng, latitude, longitude')
        .order('nome_fantasia')

      const clientes = (data || [])
        .map((c: any) => ({
          id: c.id,
          nome: c.nome_fantasia || c.razao_social || '',
          cnpj: c.cnpj_cpf || '',
          cidade: c.cidade || '',
          estado: c.estado || '',
          lat: c.lat ?? c.latitude ?? null,
          lng: c.lng ?? c.longitude ?? null,
        }))
        .filter((c: any) => c.lat && c.lng)

      return NextResponse.json(clientes)
    }

    return NextResponse.json({ error: 'acao desconhecida' }, { status: 400 })
  } catch (err: any) {
    console.error('[Rastreamento GET]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ---------- POST ----------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { acao } = body

    if (acao === 'vincular_motorista') {
      const { adesao_id, motorista_id } = body
      if (!adesao_id || !motorista_id) return NextResponse.json({ error: 'campos obrigatórios' }, { status: 400 })
      const token = await getToken()
      const res = await fetch(`${API_URL}/motoristas`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ adesao_id, motorista_id }),
      })
      if (!res.ok) { const t = await res.text(); return NextResponse.json({ error: t }, { status: res.status }) }
      return NextResponse.json(await res.json())
    }

    if (acao === 'desvincular_motorista') {
      const { vinculo_id } = body
      if (!vinculo_id) return NextResponse.json({ error: 'vinculo_id obrigatório' }, { status: 400 })
      const token = await getToken()
      const res = await fetch(`${API_URL}/motoristas/${vinculo_id}`, { method: 'DELETE', headers: { Authorization: token } })
      if (!res.ok) { const t = await res.text(); return NextResponse.json({ error: t }, { status: res.status }) }
      return NextResponse.json(await res.json())
    }

    if (acao === 'salvar_vinculo_supabase') {
      const { tecnico_nome, adesao_id, placa, descricao } = body
      if (!tecnico_nome || !adesao_id) return NextResponse.json({ error: 'campos obrigatórios' }, { status: 400 })
      const { error } = await supabase.from('tecnico_veiculos').upsert(
        { tecnico_nome, adesao_id, placa: placa || '', descricao: descricao || '' },
        { onConflict: 'tecnico_nome' }
      )
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (acao === 'remover_vinculo_supabase') {
      const { adesao_id } = body
      if (!adesao_id) return NextResponse.json({ error: 'adesao_id obrigatório' }, { status: 400 })
      await supabase.from('tecnico_veiculos').delete().eq('adesao_id', adesao_id)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'acao desconhecida' }, { status: 400 })
  } catch (err: any) {
    console.error('[Rastreamento POST]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
