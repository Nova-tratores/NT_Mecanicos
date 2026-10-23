import { NextRequest, NextResponse } from 'next/server'
import { exigirUsuario } from '@/lib/apiAuth'
import { createClient } from '@supabase/supabase-js'
import { hojeBR } from '@/lib/hoje'

const RAILWAY_API = 'https://mapa-geral-production.up.railway.app'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export async function GET(req: NextRequest) {
  const usu = await exigirUsuario(req); if (usu instanceof NextResponse) return usu // exige login (José, 23/10/2026)
  try {
    // Dia de Brasília (o servidor roda em UTC) (José, 23/10/2026)
    const hoje = hojeBR()

    // Buscar veiculos do Railway (mesma API do portal, posicao em tempo real)
    const [veiculosRes, { data: checkins }] = await Promise.all([
      fetch(`${RAILWAY_API}/api/veiculos`),
      supabase
        .from('checkin_diario')
        .select('tecnico_nome, placa, cliente, id_ordem')
        .eq('data', hoje),
    ])

    if (!veiculosRes.ok) throw new Error(`Railway API: ${veiculosRes.status}`)
    const veiculosRailway = await veiculosRes.json()

    // Mapa de checkins por placa
    const checkinMap = new Map<string, { motorista: string; cliente: string; id_ordem: string }>()
    if (checkins) {
      for (const c of checkins) {
        // Check-in "Oficina" vem com placa vazia: ignora (includes('') casava com todos) (José, 23/10/2026)
        if (!String(c.placa || '').replace(/[^A-Z0-9]/gi, '')) continue
        checkinMap.set(c.placa, {
          motorista: c.tecnico_nome,
          cliente: c.cliente || '',
          id_ordem: c.id_ordem || '',
        })
      }
    }

    // Montar resposta combinando Railway + checkins
    const veiculos = veiculosRailway
      .filter((v: any) => v.lat && v.lng)
      .map((v: any) => {
        const placaLimpa = (v.placa || '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
        const checkinInfo = placaLimpa ? [...checkinMap.entries()].find(
          ([pc]) => pc.replace(/[^A-Z0-9]/gi, '').toUpperCase() === placaLimpa
        ) : undefined
        const info = checkinInfo ? checkinInfo[1] : null

        return {
          id: v.id,
          placa: v.placa,
          descricao: v.modelo || v.placa_display || '',
          modelo: v.modelo || '',
          lat: v.lat,
          lng: v.lng,
          velocidade: v.velocidade || 0,
          ignicao: v.ignicao ? 1 : 0,
          dt_posicao: v.dt_posicao || null,
          motorista: info?.motorista || v.motorista || '',
          cliente: info?.cliente || '',
          id_ordem: info?.id_ordem || '',
        }
      })

    return NextResponse.json(veiculos)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro ao buscar veiculos' }, { status: 500 })
  }
}
