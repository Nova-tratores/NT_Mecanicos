import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const API_URL = process.env.ROTAEXATA_API_URL || 'https://api.rotaexata.com.br'
const EMAIL = process.env.ROTAEXATA_EMAIL || ''
const PASSWORD = process.env.ROTAEXATA_PASSWORD || ''
// O gateway da Rota Exata responde 502 sem User-Agent (o fetch do Node não envia um por padrão)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

let tokenCache: { token: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token
  const res = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`Login Rota Exata falhou: ${res.status}`)
  const data = await res.json()
  if (!data.token) throw new Error('Token nao retornado')
  tokenCache = { token: data.token, expiresAt: Date.now() + 50 * 60 * 1000 }
  return data.token
}

/**
 * POST /api/sync-veiculo
 * Quando tecnico faz checkin com um veiculo, sincroniza:
 * 1. Vincula motorista ao veiculo no Rota Exata
 * 2. Atualiza tecnico_veiculos no Supabase
 *
 * body: { tecnico_nome, placa }
 * placa vem no formato "MONTANA - FHY8D25" ou "FHY8D25"
 */
export async function POST(req: NextRequest) {
  try {
    const { tecnico_nome, placa: placaRaw } = await req.json()
    if (!tecnico_nome || !placaRaw) {
      return NextResponse.json({ error: 'tecnico_nome e placa obrigatorios' }, { status: 400 })
    }

    // Extrair placa limpa (ex: "MONTANA - FHY8D25" -> "FHY8D25")
    const parts = placaRaw.split(' - ')
    const placaLimpa = (parts[parts.length - 1] || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!placaLimpa) {
      return NextResponse.json({ error: 'Placa invalida' }, { status: 400 })
    }

    // Buscar adesao_id da placa no tecnico_veiculos
    const { data: vinculos } = await supabase
      .from('tecnico_veiculos')
      .select('adesao_id, placa, tecnico_nome')

    // Encontrar adesao_id pela placa
    const vinculoPlaca = (vinculos || []).find(v => {
      const vPlaca = (v.placa || '').replace(/[^A-Z0-9]/g, '').toUpperCase()
      return vPlaca === placaLimpa
    })

    if (!vinculoPlaca || !vinculoPlaca.adesao_id) {
      // Sem adesao_id, nao da pra sincronizar com Rota Exata
      // Mas ainda salva o vinculo no Supabase
      return NextResponse.json({ ok: true, rota_exata: false, msg: 'Sem adesao_id para essa placa' })
    }

    const adesaoId = vinculoPlaca.adesao_id

    // Se o tecnico ja esta vinculado a esse mesmo veiculo, nao precisa alterar
    if (vinculoPlaca.tecnico_nome === tecnico_nome) {
      return NextResponse.json({ ok: true, rota_exata: false, msg: 'Ja vinculado' })
    }

    // Buscar motorista_id do tecnico no Rota Exata (usuarios com motorista=1)
    const token = await getToken()
    const usrRes = await fetch(`${API_URL}/usuarios?limit=200&page=0`, {
      headers: { Authorization: token, 'User-Agent': UA },
    })
    if (!usrRes.ok) throw new Error(`Rota Exata usuarios: ${usrRes.status}`)
    const usrData = await usrRes.json()
    const usuarios = usrData.data || []

    // Match por nome (case insensitive, primeiro nome)
    const tecNorm = tecnico_nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const motorista = usuarios.find((u: any) => {
      if (u.motorista !== 1) return false
      const uNorm = (u.nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      return uNorm === tecNorm || uNorm.split(/\s+/)[0] === tecNorm.split(/\s+/)[0]
    })

    if (!motorista) {
      return NextResponse.json({ ok: true, rota_exata: false, msg: `Motorista "${tecnico_nome}" nao encontrado no Rota Exata` })
    }

    // Desvincular motorista atual desse veiculo no Rota Exata (se houver)
    const where = JSON.stringify({ adesao_id: adesaoId })
    const motRes = await fetch(`${API_URL}/motoristas?where=${encodeURIComponent(where)}&limit=10&page=0`, {
      headers: { Authorization: token, 'User-Agent': UA },
    })
    if (motRes.ok) {
      const motData = await motRes.json()
      const ativos = (motData.data || []).filter((m: any) => m.final !== 1)
      for (const ativo of ativos) {
        if (ativo._id) {
          await fetch(`${API_URL}/motoristas/${ativo._id}`, {
            method: 'DELETE',
            headers: { Authorization: token, 'User-Agent': UA },
          })
        }
      }
    }

    // Vincular novo motorista ao veiculo no Rota Exata
    const vincRes = await fetch(`${API_URL}/motoristas`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ adesao_id: adesaoId, motorista_id: motorista.id }),
    })

    const rotaOk = vincRes.ok

    // Atualizar tecnico_veiculos no Supabase (vinculo fixo)
    await supabase.from('tecnico_veiculos').upsert({
      tecnico_nome,
      adesao_id: adesaoId,
      placa: vinculoPlaca.placa,
      descricao: '',
    }, { onConflict: 'tecnico_nome' })

    return NextResponse.json({
      ok: true,
      rota_exata: rotaOk,
      motorista_id: motorista.id,
      adesao_id: adesaoId,
    })
  } catch (err: any) {
    console.error('[sync-veiculo]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
