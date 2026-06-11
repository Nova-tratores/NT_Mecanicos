import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const busca = sp.get('busca')

    // Search clients for SAT creation
    if (busca && busca.length >= 2) {
      const term = `%${busca}%`
      const { data } = await supabase
        .from('portal_nt_clientes_PRINCIPAL')
        .select('id, nome_fantasia, razao_social, cnpj_cpf, cidade, estado, endereco, bairro')
        .or(`nome_fantasia.ilike.${term},razao_social.ilike.${term},cnpj_cpf.ilike.${term}`)
        .limit(20)

      const clientes = (data || []).map((c: any) => {
        const partes = [c.endereco, c.bairro, c.cidade ? `${c.cidade}/${c.estado || ''}` : ''].filter(Boolean)
        return {
          id: c.id,
          nome: c.nome_fantasia || c.razao_social || '',
          cnpj: c.cnpj_cpf || '',
          endereco: partes.join(', '),
          cidade: c.cidade || '',
        }
      })
      return NextResponse.json(clientes)
    }

    // List all SATs
    const { data, error } = await supabase
      .from('portal_sats')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json(data || [])
  } catch (err: any) {
    console.error('[SAT GET]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { acao } = body

    if (acao === 'criar') {
      const { cliente_nome, cliente_endereco, cliente_cnpj, tipo, descricao, data_limite, criado_por, criado_por_nome } = body
      if (!cliente_nome || !tipo) return NextResponse.json({ error: 'cliente e tipo obrigatórios' }, { status: 400 })

      const { data, error } = await supabase.from('portal_sats').insert({
        cliente_nome, cliente_endereco: cliente_endereco || null,
        cliente_cnpj: cliente_cnpj || null, tipo, descricao: descricao || null,
        data_limite: data_limite || null, status: 'aberto',
        criado_por: criado_por || null, criado_por_nome: criado_por_nome || null,
      }).select().single()

      if (error) throw error
      return NextResponse.json(data)
    }

    if (acao === 'cancelar') {
      const { id, cancelado_por_nome } = body
      if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

      const { error } = await supabase.from('portal_sats').update({
        status: 'cancelado', cancelado_por_nome, cancelado_at: new Date().toISOString(),
      }).eq('id', id)

      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'acao desconhecida' }, { status: 400 })
  } catch (err: any) {
    console.error('[SAT POST]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
