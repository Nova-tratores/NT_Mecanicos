import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
)

function extractPlaca(raw: string): string | null {
  const m = String(raw).match(/[A-Z]{3}\d[A-Z\d]\d{2}/i)
  return m ? m[0].toUpperCase() : null
}

async function findFrotaVeiculo(placaRaw?: string, tecnicoNome?: string) {
  // 1. By placa directly
  if (placaRaw) {
    const clean = extractPlaca(placaRaw)
    if (clean) {
      const withDash = clean.slice(0, 3) + '-' + clean.slice(3)
      const { data } = await supabase
        .from('frota_veiculos')
        .select('*')
        .or(`placa.eq.${clean},placa.eq.${withDash}`)
        .maybeSingle()
      if (data) return data
    }
  }

  // 2. By technician name → tecnico_veiculos → placa → frota_veiculos
  if (tecnicoNome) {
    const { data: tv } = await supabase
      .from('tecnico_veiculos')
      .select('placa')
      .eq('tecnico_nome', tecnicoNome)
      .maybeSingle()
    if (tv?.placa) {
      const clean = extractPlaca(tv.placa)
      if (clean) {
        const withDash = clean.slice(0, 3) + '-' + clean.slice(3)
        const { data } = await supabase
          .from('frota_veiculos')
          .select('*')
          .or(`placa.eq.${clean},placa.eq.${withDash}`)
          .maybeSingle()
        if (data) return data
      }
    }

    // 3. By technician name → frota_responsaveis (current) → frota_veiculos
    const { data: resp } = await supabase
      .from('frota_responsaveis')
      .select('veiculo_id')
      .ilike('motorista_nome', `%${tecnicoNome}%`)
      .is('fim', null)
      .limit(1)
      .maybeSingle()
    if (resp?.veiculo_id) {
      const { data } = await supabase
        .from('frota_veiculos')
        .select('*')
        .eq('id', resp.veiculo_id)
        .maybeSingle()
      if (data) return data
    }
  }

  return null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { placa, tecnico_nome } = body

    const veiculo = await findFrotaVeiculo(placa, tecnico_nome)
    if (!veiculo) return NextResponse.json({ error: 'Veículo não encontrado' }, { status: 404 })

    // Image from Placas
    let imagemUrl: string | null = null
    if (veiculo.id_placa) {
      const { data: placaRow } = await supabase
        .from('Placas')
        .select('imagem_url')
        .eq('IdPlaca', veiculo.id_placa)
        .maybeSingle()
      if (placaRow) imagemUrl = placaRow.imagem_url || null
    }

    const [respRes, custosRes, multasRes] = await Promise.all([
      supabase
        .from('frota_responsaveis')
        .select('motorista_nome, inicio, fim, origem, obs')
        .eq('veiculo_id', veiculo.id)
        .order('inicio', { ascending: false }),
      supabase
        .from('frota_custos')
        .select('tipo, valor')
        .eq('veiculo_id', veiculo.id)
        .gte('data', new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0]),
      supabase
        .from('frota_multas')
        .select('valor')
        .eq('veiculo_id', veiculo.id)
        .is('pago_em', null),
    ])

    const responsaveis = respRes.data || []
    const responsavelAtual = responsaveis.find((r: any) => !r.fim)

    const custosPorTipo: Record<string, number> = {}
    for (const c of custosRes.data || []) {
      const tipo = c.tipo || 'Outros'
      custosPorTipo[tipo] = (custosPorTipo[tipo] || 0) + (c.valor || 0)
    }

    const multasList = multasRes.data || []
    const valorMultas = multasList.reduce((s: number, m: any) => s + (m.valor || 0), 0)

    let hodometro: number | null = null
    if (veiculo.adesao_id) {
      const { data: odo } = await supabase
        .from('frota_odometro')
        .select('km')
        .eq('veiculo_id', veiculo.id)
        .order('data', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (odo) hodometro = odo.km
    }

    // Documents from frota_documentos table
    const { data: docsRows } = await supabase
      .from('frota_documentos')
      .select('id, tipo, numero, emissor, vigencia_fim, arquivo_url, nome_arquivo')
      .eq('veiculo_id', veiculo.id)
      .order('vigencia_fim', { ascending: true, nullsFirst: false })
    const documentos = (docsRows || []).map((d: any) => ({
      id: d.id,
      tipo: (d.tipo || 'outros').toUpperCase(),
      numero: d.numero,
      emissor: d.emissor,
      vigencia_fim: d.vigencia_fim,
      url: d.arquivo_url,
      nome_arquivo: d.nome_arquivo,
    }))

    // Also get SupaPlacas display name for the tecnico_veiculos lookup
    let placaDisplay = veiculo.placa_exibicao || veiculo.placa
    if (veiculo.supa_placa_id) {
      const { data: sp } = await supabase
        .from('SupaPlacas')
        .select('NumPlaca')
        .eq('IdPlaca', veiculo.supa_placa_id)
        .maybeSingle()
      if (sp?.NumPlaca) placaDisplay = sp.NumPlaca
    }

    return NextResponse.json({
      veiculo: {
        id: veiculo.id,
        placa: placaDisplay,
        placa_fmt: veiculo.placa_exibicao || veiculo.placa,
        marca: veiculo.marca,
        modelo: veiculo.modelo,
        ano: veiculo.ano,
        ano_modelo: veiculo.ano_modelo,
        cor: veiculo.cor,
        combustivel: veiculo.combustivel,
        chassi: veiculo.chassi,
        renavam: veiculo.renavam,
        tipo_veiculo: veiculo.tipo_veiculo,
        categoria: veiculo.categoria,
        status: veiculo.status,
        proprietario: veiculo.proprietario,
        equipamentos: veiculo.equipamentos,
        exercicio_crlv: veiculo.exercicio_crlv,
        capacidade_tanque: veiculo.capacidade_tanque,
        tem_rastreador: veiculo.tem_rastreador,
        hodometro,
        imagem_url: imagemUrl,
      },
      responsavel: responsavelAtual
        ? { nome: responsavelAtual.motorista_nome, inicio: responsavelAtual.inicio, origem: responsavelAtual.origem }
        : null,
      historico: responsaveis.map((r: any) => ({
        nome: r.motorista_nome || '—',
        inicio: r.inicio,
        fim: r.fim,
      })),
      custos: custosPorTipo,
      multas: { abertas: multasList.length, valor: valorMultas },
      documentos,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
