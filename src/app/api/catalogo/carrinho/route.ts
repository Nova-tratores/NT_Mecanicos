import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    // ── Listar carrinhos ──
    if (action === 'listar') {
      const { status } = body
      const { data } = await supabase
        .from('catalogo_carrinhos')
        .select('*, catalogo_carrinho_itens(count)')
        .eq('status', status || 'aberto')
        .order('updated_at', { ascending: false })
      return NextResponse.json(data || [])
    }

    // ── Criar carrinho ──
    if (action === 'criar') {
      const { nome, criado_por } = body
      if (!nome || !criado_por) return NextResponse.json({ error: 'Nome e criado_por obrigatórios' }, { status: 400 })
      const token = randomUUID().replace(/-/g, '')
      const { data, error } = await supabase
        .from('catalogo_carrinhos')
        .insert({ nome, criado_por, share_token: token })
        .select()
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await supabase.from('catalogo_carrinho_historico').insert({
        carrinho_id: data.id, acao: 'criou', descricao: `Carrinho "${nome}" criado`, quem: criado_por,
      })
      return NextResponse.json(data)
    }

    // ── Carregar carrinho (por id ou token) ──
    if (action === 'carregar') {
      const { id, token } = body
      let query = supabase.from('catalogo_carrinhos').select('*')
      if (token) query = query.eq('share_token', token)
      else query = query.eq('id', id)
      const { data: carrinho } = await query.maybeSingle()
      if (!carrinho) return NextResponse.json({ error: 'Carrinho não encontrado' }, { status: 404 })
      const { data: itens } = await supabase
        .from('catalogo_carrinho_itens')
        .select('*')
        .eq('carrinho_id', carrinho.id)
        .order('created_at', { ascending: true })
      const { data: historico } = await supabase
        .from('catalogo_carrinho_historico')
        .select('*')
        .eq('carrinho_id', carrinho.id)
        .order('created_at', { ascending: false })
        .limit(50)
      return NextResponse.json({ carrinho, itens: itens || [], historico: historico || [] })
    }

    // ── Adicionar item ──
    if (action === 'adicionar_item') {
      const { carrinho_id, peca, figura, qtd, quem } = body
      const existente = await supabase
        .from('catalogo_carrinho_itens')
        .select('id, qtd')
        .eq('carrinho_id', carrinho_id)
        .eq('peca_id', peca.id)
        .maybeSingle()
      if (existente.data) {
        const novaQtd = existente.data.qtd + (qtd || 1)
        await supabase.from('catalogo_carrinho_itens').update({ qtd: novaQtd }).eq('id', existente.data.id)
        await supabase.from('catalogo_carrinho_historico').insert({
          carrinho_id, acao: 'alterou', descricao: `${peca.code} — qtd ${existente.data.qtd} → ${novaQtd}`, quem: quem || 'Sistema',
        })
      } else {
        await supabase.from('catalogo_carrinho_itens').insert({
          carrinho_id, peca_id: peca.id, peca_code: peca.code, peca_name: peca.name,
          peca_reference: peca.reference || '', qtd: qtd || 1,
          figura_code: figura?.code || '', figura_name: figura?.name || '',
        })
        await supabase.from('catalogo_carrinho_historico').insert({
          carrinho_id, acao: 'adicionou', descricao: `${peca.code} — ${peca.name} (x${qtd || 1})`, quem: quem || 'Sistema',
        })
      }
      await supabase.from('catalogo_carrinhos').update({ updated_at: new Date().toISOString() }).eq('id', carrinho_id)
      return NextResponse.json({ ok: true })
    }

    // ── Remover item ──
    if (action === 'remover_item') {
      const { carrinho_id, item_id, quem } = body
      const { data: item } = await supabase.from('catalogo_carrinho_itens').select('*').eq('id', item_id).maybeSingle()
      if (item) {
        await supabase.from('catalogo_carrinho_itens').delete().eq('id', item_id)
        await supabase.from('catalogo_carrinho_historico').insert({
          carrinho_id, acao: 'removeu', descricao: `${item.peca_code} — ${item.peca_name}`, quem: quem || 'Sistema',
        })
        await supabase.from('catalogo_carrinhos').update({ updated_at: new Date().toISOString() }).eq('id', carrinho_id)
      }
      return NextResponse.json({ ok: true })
    }

    // ── Alterar quantidade ──
    if (action === 'alterar_qtd') {
      const { carrinho_id, item_id, qtd, quem } = body
      const { data: item } = await supabase.from('catalogo_carrinho_itens').select('*').eq('id', item_id).maybeSingle()
      if (item) {
        await supabase.from('catalogo_carrinho_itens').update({ qtd: Math.max(1, qtd) }).eq('id', item_id)
        await supabase.from('catalogo_carrinho_historico').insert({
          carrinho_id, acao: 'alterou', descricao: `${item.peca_code} — qtd ${item.qtd} → ${qtd}`, quem: quem || 'Sistema',
        })
        await supabase.from('catalogo_carrinhos').update({ updated_at: new Date().toISOString() }).eq('id', carrinho_id)
      }
      return NextResponse.json({ ok: true })
    }

    // ── Mudar status ──
    if (action === 'mudar_status') {
      const { id, status, quem } = body
      await supabase.from('catalogo_carrinhos').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
      const label = status === 'fechado' ? 'Fechou' : status === 'lixeira' ? 'Moveu para lixeira' : 'Reabriu'
      await supabase.from('catalogo_carrinho_historico').insert({
        carrinho_id: id, acao: 'status', descricao: `${label} o carrinho`, quem: quem || 'Sistema',
      })
      return NextResponse.json({ ok: true })
    }

    // ── Excluir permanente ──
    if (action === 'excluir') {
      const { id } = body
      await supabase.from('catalogo_carrinhos').delete().eq('id', id)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
