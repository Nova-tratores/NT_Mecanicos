import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { exigirUsuario, limparBusca, nomeDoUsuario } from '@/lib/apiAuth'

// SAT Digital (José, 23/10/2026): exige login; quem cria vem do token; cancelar só quem criou (ou admin);
// a busca de cliente não entra crua no filtro do banco.
export async function GET(req: NextRequest) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u
  try {
    const sp = req.nextUrl.searchParams
    const busca = limparBusca(sp.get('busca'))

    // Search clients for SAT creation
    if (busca.length >= 2) {
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
    if (sp.get('busca')) return NextResponse.json([])

    // List all SATs (o quadro é da equipe toda)
    const { data, error } = await supabase
      .from('portal_sats')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (error) throw error
    return NextResponse.json(data || [])
  } catch (err: any) {
    console.error('[SAT GET]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u
  try {
    const body = await req.json()
    const { acao } = body

    if (acao === 'criar') {
      const { cliente_nome, cliente_endereco, cliente_cnpj, tipo, descricao, data_limite } = body
      if (!cliente_nome || !tipo) return NextResponse.json({ error: 'cliente e tipo obrigatórios' }, { status: 400 })

      const { data, error } = await supabase.from('portal_sats').insert({
        cliente_nome, cliente_endereco: cliente_endereco || null,
        cliente_cnpj: cliente_cnpj || null, tipo, descricao: descricao || null,
        data_limite: data_limite || null, status: 'aberto',
        criado_por: u.userId, criado_por_nome: nomeDoUsuario(u, body.criado_por_nome) || null,
      }).select().single()

      if (error) throw error
      return NextResponse.json(data)
    }

    if (acao === 'cancelar') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
      const { data: sat } = await supabase.from('portal_sats').select('criado_por').eq('id', id).maybeSingle()
      if (!sat) return NextResponse.json({ error: 'SAT não encontrado' }, { status: 404 })
      if (!u.isAdmin && sat.criado_por !== u.userId) return NextResponse.json({ error: 'Só quem criou o SAT pode cancelar' }, { status: 403 })

      const { error } = await supabase.from('portal_sats').update({
        status: 'cancelado', cancelado_por_nome: nomeDoUsuario(u, body.cancelado_por_nome), cancelado_at: new Date().toISOString(),
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
