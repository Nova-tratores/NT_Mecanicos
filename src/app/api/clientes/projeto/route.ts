import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
)

function extractChassis(servicos: any): string[] {
  const servs = typeof servicos === 'string' ? JSON.parse(servicos) : (servicos || [])
  const r: string[] = []
  for (const s of servs) { const m = (s.desc || '').match(/Chassis:\s*([^|]+)/i); if (m && m[1].trim()) r.push(m[1].trim()) }
  return r
}

function extractModelo(servicos: any): string {
  const servs = typeof servicos === 'string' ? JSON.parse(servicos) : (servicos || [])
  for (const s of servs) { const m = (s.desc || '').match(/Modelo:\s*([^|]+)/i); if (m && m[1].trim()) return m[1].trim() }
  return ''
}

export async function GET(req: NextRequest) {
  const nome = req.nextUrl.searchParams.get('nome')
  const empresa = req.nextUrl.searchParams.get('empresa') || 'Nova Tratores'

  if (!nome) return NextResponse.json({ error: 'Passe ?nome=PROJETO&empresa=X' }, { status: 400 })

  try {
    const PAGE = 1000
    let from = 0, hasMore = true
    const osDoProj: any[] = []
    while (hasMore) {
      const { data } = await supabase.from('portal_nt_clientes_os')
        .select('num_os, cod_os, cod_cli, empresa, data_previsao, data_inclusao, data_faturamento, valor_total, status, faturada, cancelada, num_nf, link_nf, pdf_anexo, num_pedido_cli, vendedor, cidade, descricao, servicos')
        .eq('empresa', empresa).eq('projeto', nome)
        .order('data_previsao', { ascending: false })
        .range(from, from + PAGE - 1)
      if (data && data.length > 0) { osDoProj.push(...data); if (data.length < PAGE) hasMore = false; else from += PAGE }
      else hasMore = false
    }

    const { data: chassisDB } = await supabase.from('portal_nt_projetos_chassis')
      .select('chassis, modelo, cod_cli_ultimo, cnpj_cpf_ultimo, cliente_nome_ultimo')
      .eq('projeto', nome).eq('empresa', empresa)

    let chassisList: any[] = (chassisDB || []).map(c => ({
      chassis: c.chassis, modelo: c.modelo,
      cod_cli: c.cod_cli_ultimo, cliente_nome: c.cliente_nome_ultimo || '', cnpj_cpf: c.cnpj_cpf_ultimo || '',
    }))

    if (chassisList.length === 0) {
      const chassisMap = new Map<string, { modelo: string; cod_cli: number; data: string }>()
      for (const os of osDoProj) {
        const chs = extractChassis(os.servicos)
        const mod = extractModelo(os.servicos)
        for (const ch of chs) {
          const ex = chassisMap.get(ch)
          const dt = os.data_previsao || '0000-00-00'
          if (!ex || dt > ex.data) chassisMap.set(ch, { modelo: mod, cod_cli: os.cod_cli, data: dt })
        }
      }
      chassisList = Array.from(chassisMap.entries()).map(([ch, info]) => ({
        chassis: ch, modelo: info.modelo, cod_cli: info.cod_cli, cliente_nome: '', cnpj_cpf: '',
      }))
    }

    const numPedidos = [...new Set(osDoProj.map(o => o.num_pedido_cli).filter((v: string) => v && /^\d+$/.test(v)))]
    let pvs: any[] = []
    if (numPedidos.length > 0) {
      const { data } = await supabase.from('portal_nt_clientes_pv').select('*').in('num_pedido', numPedidos)
      pvs = data || []
    }

    const codClis = [...new Set([...osDoProj.map(o => o.cod_cli), ...pvs.map(p => p.cod_cli)].filter(Boolean))]
    const clienteMap = new Map<number, any>()
    for (let i = 0; i < codClis.length; i += 200) {
      const batch = codClis.slice(i, i + 200)
      const { data } = await supabase.from('portal_nt_clientes_cadastro_omie')
        .select('cod_cli, razao_social, nome_fantasia, cnpj_cpf, cidade, estado')
        .eq('empresa', empresa).in('cod_cli', batch)
      for (const c of data || []) clienteMap.set(c.cod_cli, c)
    }

    for (const ch of chassisList) {
      if (!ch.cliente_nome && ch.cod_cli) {
        const cli = clienteMap.get(ch.cod_cli)
        if (cli) { ch.cliente_nome = cli.nome_fantasia || cli.razao_social || ''; ch.cnpj_cpf = cli.cnpj_cpf || '' }
      }
    }

    // Donos
    const donosMap = new Map<number, any>()
    for (const os of osDoProj) {
      const cli = clienteMap.get(os.cod_cli)
      const existing = donosMap.get(os.cod_cli)
      const dt = os.data_previsao || os.data_inclusao || '9999-99-99'
      if (existing) {
        existing.total_os++
        existing.total_valor += (os.valor_total || 0)
        if (dt < existing.primeira_os) existing.primeira_os = dt
        if (dt > existing.ultima_os) existing.ultima_os = dt
      } else {
        donosMap.set(os.cod_cli, {
          cod_cli: os.cod_cli,
          nome: cli?.nome_fantasia || cli?.razao_social || '',
          cnpj_cpf: cli?.cnpj_cpf || '',
          cidade: cli?.cidade || '', estado: cli?.estado || '',
          primeira_os: dt, ultima_os: dt,
          total_os: 1, total_valor: os.valor_total || 0,
        })
      }
    }
    const donos = Array.from(donosMap.values()).sort((a, b) => b.ultima_os.localeCompare(a.ultima_os))

    // Servicos
    const servicosLista: any[] = []
    for (const os of osDoProj) {
      const servs = typeof os.servicos === 'string' ? JSON.parse(os.servicos) : (os.servicos || [])
      for (const s of servs) {
        servicosLista.push({
          num_os: os.num_os, data: os.data_previsao || os.data_inclusao || '',
          desc: s.desc || s.descricao || s.nome || '', valor: s.valor || s.valor_unitario || 0,
          quantidade: s.quantidade || 1,
          cliente: clienteMap.get(os.cod_cli)?.nome_fantasia || clienteMap.get(os.cod_cli)?.razao_social || '',
          status: os.status,
        })
      }
    }

    // Pecas
    const pecasLista: any[] = []
    for (const pv of pvs) {
      const itens = typeof pv.itens === 'string' ? JSON.parse(pv.itens) : (pv.itens || [])
      for (const it of itens) {
        pecasLista.push({
          num_pv: pv.num_pedido, data: pv.data_previsao || pv.data_inclusao || '',
          desc: it.descricao || it.desc || it.nome || '', codigo: it.codigo || it.cod || '',
          quantidade: it.quantidade || 1,
          valor_unitario: it.valor_unitario || it.preco || 0,
          valor_total: it.valor_total || (it.quantidade || 1) * (it.valor_unitario || it.preco || 0),
          cliente: clienteMap.get(pv.cod_cli)?.nome_fantasia || clienteMap.get(pv.cod_cli)?.razao_social || '',
        })
      }
    }

    const valorTotalOS = osDoProj.reduce((s, o) => s + (o.valor_total || 0), 0)
    const valorTotalPV = pvs.reduce((s: number, p: any) => s + (p.valor_total || 0), 0)

    return NextResponse.json({
      projeto: nome, empresa,
      chassis: chassisList,
      donos,
      servicos: servicosLista,
      pecas: pecasLista,
      resumo: {
        total_os: osDoProj.length,
        os_faturadas: osDoProj.filter(o => o.faturada).length,
        valor_total_os: valorTotalOS,
        total_pv: pvs.length,
        valor_total_pv: valorTotalPV,
      },
      ordens: osDoProj.map(os => ({
        ...os,
        cliente_nome: clienteMap.get(os.cod_cli)?.nome_fantasia || clienteMap.get(os.cod_cli)?.razao_social || '',
      })),
      pedidos_venda: pvs.map(pv => ({
        ...pv,
        cliente_nome: clienteMap.get(pv.cod_cli)?.nome_fantasia || clienteMap.get(pv.cod_cli)?.razao_social || '',
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
