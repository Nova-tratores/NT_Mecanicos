import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

async function fetchAll<T>(table: string, select: string, filters?: (q: any) => any): Promise<T[]> {
  const all: T[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + PAGE - 1)
    if (filters) q = filters(q)
    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as T[]))
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const codCli = sp.get('codCli')
    const empresa = sp.get('empresa')
    const checkSync = sp.get('checkSync')

    // Check last sync
    if (checkSync) {
      const { data } = await supabase
        .from('portal_nt_clientes_cadastro_omie')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
      return NextResponse.json({ lastSync: data?.[0]?.updated_at || null })
    }

    // Detail: single client with OS and PV
    if (codCli && empresa) {
      const { data: cliente } = await supabase
        .from('portal_nt_clientes_cadastro_omie')
        .select('*')
        .eq('cod_cli', codCli)
        .eq('empresa', empresa)
        .single()

      const ordens = await fetchAll<any>('portal_nt_clientes_os',
        'num_os,cod_os,empresa,cod_cli,cliente_nome,etapa,data_previsao,data_inclusao,data_faturamento,valor_total,status,cancelada,faturada,num_pedido_cli,vendedor,cidade,contrato,projeto,num_nf,link_nf,servicos,obs,dados_adic',
        q => q.eq('cod_cli', codCli).eq('empresa', empresa))

      // Extract PV numbers from OS
      const numsPV = new Set<number>()
      for (const os of ordens) {
        const n = parseInt(os.num_pedido_cli)
        if (!isNaN(n) && n > 0) numsPV.add(n)
      }

      // Fetch PVs linked to OS
      let pedidos: any[] = []
      if (numsPV.size > 0) {
        const { data: pvData } = await supabase
          .from('portal_nt_clientes_pv')
          .select('*')
          .in('num_pedido', Array.from(numsPV))
          .eq('empresa', empresa)
        pedidos = pvData || []
      }

      // Also fetch PVs directly by client
      const { data: pvDirect } = await supabase
        .from('portal_nt_clientes_pv')
        .select('*')
        .eq('cod_cli', codCli)

      // Merge and deduplicate
      const seen = new Set(pedidos.map((p: any) => `${p.num_pedido}|${p.empresa}`))
      for (const p of (pvDirect || [])) {
        const key = `${p.num_pedido}|${p.empresa}`
        if (!seen.has(key)) { pedidos.push(p); seen.add(key) }
      }

      return NextResponse.json({ cliente, ordens, pedidos })
    }

    // List all clients with OS stats
    const allOS = await fetchAll<any>('portal_nt_clientes_os',
      'cod_cli,empresa,valor_total,cancelada,faturada')

    const ranking: Record<string, { total_os: number; total_valor: number; os_ativas: number }> = {}
    for (const os of allOS) {
      const key = `${os.cod_cli}|${os.empresa}`
      if (!ranking[key]) ranking[key] = { total_os: 0, total_valor: 0, os_ativas: 0 }
      ranking[key].total_os++
      ranking[key].total_valor += (os.valor_total || 0)
      if (!os.cancelada) ranking[key].os_ativas++
    }

    // Projects
    const { data: projetos } = await supabase
      .from('portal_nt_projetos_PRINCIPAL')
      .select('codigo,empresa,nome,cod_cli_ultimo,cliente_nome_ultimo')
      .not('cod_cli_ultimo', 'is', null)

    const projMap: Record<string, any[]> = {}
    for (const p of (projetos || [])) {
      const key = `${p.cod_cli_ultimo}|${p.empresa}`
      if (!projMap[key]) projMap[key] = []
      projMap[key].push({ codigo: p.codigo, nome: p.nome })
    }

    // Clients
    const clientes = await fetchAll<any>('portal_nt_clientes_cadastro_omie',
      'cod_cli,empresa,razao_social,nome_fantasia,cnpj_cpf,cidade,estado,telefone,email,inativo')

    const result = clientes.map(c => {
      const key = `${c.cod_cli}|${c.empresa}`
      const r = ranking[key] || { total_os: 0, total_valor: 0, os_ativas: 0 }
      return {
        ...c,
        total_os: r.total_os,
        total_valor: r.total_valor,
        os_ativas: r.os_ativas,
        projetos: projMap[key] || [],
      }
    })

    result.sort((a, b) => b.total_os - a.total_os)

    // Tags
    const { data: etiquetas } = await supabase.from('cliente_etiquetas').select('*')
    const { data: etiquetasMapa } = await supabase.from('cliente_etiqueta_map').select('*')

    return NextResponse.json({ clientes: result, etiquetas: etiquetas || [], etiquetasMapa: etiquetasMapa || [] })
  } catch (err: any) {
    console.error('[Clientes GET]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { acao } = body

    if (acao === 'salvar_etiqueta') {
      const { cnpj_cpf, etiqueta_id } = body
      const { error } = await supabase.from('cliente_etiqueta_map').insert({ cnpj_cpf, etiqueta_id })
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (acao === 'remover_etiqueta') {
      const { cnpj_cpf, etiqueta_id } = body
      const { error } = await supabase.from('cliente_etiqueta_map')
        .delete().eq('cnpj_cpf', cnpj_cpf).eq('etiqueta_id', etiqueta_id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (acao === 'criar_etiqueta') {
      const { nome, cor } = body
      const { data, error } = await supabase.from('cliente_etiquetas')
        .insert({ nome: (nome || '').toUpperCase(), cor: cor || '#3b82f6' }).select().single()
      if (error) throw error
      return NextResponse.json(data)
    }

    if (acao === 'salvar_descricao') {
      const { cnpj_cpf, descricao } = body
      const { error } = await supabase.from('cliente_extras')
        .upsert({ cnpj_cpf, descricao }, { onConflict: 'cnpj_cpf' })
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'acao desconhecida' }, { status: 400 })
  } catch (err: any) {
    console.error('[Clientes POST]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
