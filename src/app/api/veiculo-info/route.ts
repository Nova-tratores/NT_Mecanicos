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

function cleanCpf(cpf: string): string {
  return cpf.replace(/\D/g, '')
}

// `via` diz COMO o carro foi achado: 'cpf'/'nome' = pelo vínculo de
// responsável do próprio técnico; 'placa' = busca direta (pode ser de outro).
async function findFrotaVeiculo(placaRaw?: string, tecnicoNome?: string, cpf?: string) {
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
      if (data) return { data, via: 'placa' as const }
    }
  }

  // 2. By CPF → frota_motoristas → frota_responsaveis (current) → frota_veiculos
  if (cpf) {
    const cpfLimpo = cleanCpf(cpf)
    const cpfFmt = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    const { data: motoristas } = await supabase
      .from('frota_motoristas')
      .select('id')
      .in('cpf', [cpfLimpo, cpfFmt])
      .limit(1)
    const motorista = motoristas?.[0] || null
    if (motorista) {
      const { data: resp } = await supabase
        .from('frota_responsaveis')
        .select('veiculo_id')
        .eq('motorista_id', motorista.id)
        .is('fim', null)
        .order('inicio', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (resp?.veiculo_id) {
        const { data } = await supabase
          .from('frota_veiculos')
          .select('*')
          .eq('id', resp.veiculo_id)
          .maybeSingle()
        if (data) return { data, via: 'cpf' as const }
      }
    }
  }

  // 3. Fallback: by technician name → frota_responsaveis (current) → frota_veiculos
  if (tecnicoNome) {
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
      if (data) return { data, via: 'nome' as const }
    }
  }

  return null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { placa, tecnico_nome, user_id } = body
    let { cpf } = body

    if (!cpf && user_id) {
      const { data: usu } = await supabase
        .from('financeiro_usu')
        .select('cpf')
        .eq('id', user_id)
        .maybeSingle()
      if (usu?.cpf) cpf = usu.cpf
    }

    const achado = await findFrotaVeiculo(placa, tecnico_nome, cpf)
    if (!achado) return NextResponse.json({ error: 'Veículo não encontrado' }, { status: 404 })
    const { data: veiculo, via } = achado

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

    // Senha do cartão Veloe: SÓ pro responsável do carro (o app pede pelo
    // próprio técnico via cpf/nome; na busca por placa exige o nome casar
    // com o responsável atual — não vaza senha de carro alheio)
    const pal = (s: string): string[] =>
      String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[A-Z0-9]+/g) || []
    const reqPal = pal(String(tecnico_nome || ''))
    const respPal = pal(String(responsavelAtual?.motorista_nome || ''))
    const nomesCasam =
      reqPal.length > 0 && respPal.length > 0 &&
      (reqPal.every((w) => respPal.includes(w)) || respPal.every((w) => reqPal.includes(w)))
    const ehResponsavel = via !== 'placa' || nomesCasam

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
        senha_cartao_veloe: ehResponsavel ? veiculo.senha_cartao_veloe || null : null,
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
