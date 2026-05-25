import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const RAILWAY_API = 'https://mapa-geral-production.up.railway.app'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export async function GET() {
  try {
    const hoje = new Date().toISOString().split('T')[0]

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
        const placaLimpa = (v.placa || '').replace(/[^A-Z0-9]/gi, '')
        const checkinInfo = [...checkinMap.entries()].find(
          ([pc]) => {
            const pcLimpa = pc.replace(/[^A-Z0-9]/gi, '')
            return placaLimpa === pcLimpa || placaLimpa.includes(pcLimpa) || pcLimpa.includes(placaLimpa)
          }
        )
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
