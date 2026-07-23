import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
)

export async function POST(req: NextRequest) {
  try {
    const { action, marca, modelo, secao, figuraId, busca } = await req.json()

    if (action === 'marcas') {
      const { data: mods } = await supabase.from('catalogo_modelos').select('marca, tipo, slug')
      const porMarca = new Map<string, { modelos: number; tipos: Set<string> }>()
      for (const m of mods || []) {
        const nome = String(m.marca || '').trim()
        if (!nome) continue
        if (!porMarca.has(nome)) porMarca.set(nome, { modelos: 0, tipos: new Set() })
        const o = porMarca.get(nome)!
        o.modelos++
        if (m.tipo) o.tipos.add(String(m.tipo))
      }
      const { data: marcasDb } = await supabase.from('catalogo_marcas').select('nome, slug, logo_url, ordem')
      const logoPor: Record<string, { slug: string; logo_url: string | null }> = {}
      for (const m of marcasDb || []) {
        logoPor[String(m.nome || '').trim().toLowerCase()] = { slug: m.slug, logo_url: m.logo_url }
      }
      const result = [...porMarca.entries()].map(([nome, o]) => {
        const info = logoPor[nome.toLowerCase()]
        return { nome, slug: info?.slug || nome.toLowerCase(), logo_url: info?.logo_url || null, modelos: o.modelos, tipos: [...o.tipos].sort() }
      }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      return NextResponse.json(result)
    }

    if (action === 'modelos') {
      const { data } = await supabase
        .from('catalogo_modelos')
        .select('*')
        .eq('marca', marca)
        .order('ordem', { ascending: true })
      const { data: agg } = await supabase.from('vw_catalogo_modelo_figuras').select('modelo, figuras')
      const porModelo = new Map<string, number>()
      for (const r of (agg || []) as { modelo: string; figuras: number }[]) porModelo.set(r.modelo, r.figuras)
      return NextResponse.json((data || []).map((m: Record<string, unknown>) => ({ ...m, figuras: porModelo.get(m.nome as string) || 0 })))
    }

    if (action === 'secoes') {
      const { data: vs } = await supabase
        .from('vw_catalogo_secoes')
        .select('secao, ordem, figuras, thumb')
        .eq('modelo', modelo)
        .order('ordem', { ascending: true })
      if (vs && vs.length > 0) {
        return NextResponse.json(vs.map((r: Record<string, unknown>) => ({
          secao: r.secao || 'Outros', ordem: (r.ordem as number) ?? 99, figuras: r.figuras, thumb: r.thumb,
        })))
      }
      const { data } = await supabase
        .from('catalogo_figuras')
        .select('secao, secao_ordem, thumb_url, image_url, catalogo_figura_modelos!inner(modelo)')
        .eq('catalogo_figura_modelos.modelo', modelo)
        .order('secao_ordem', { ascending: true })
      const map = new Map<string, { secao: string; ordem: number; figuras: number; thumb: string | null }>()
      for (const f of (data || []) as Record<string, unknown>[]) {
        const s = String(f.secao || 'Outros')
        if (!map.has(s)) map.set(s, { secao: s, ordem: (f.secao_ordem as number) ?? 99, figuras: 0, thumb: null })
        const o = map.get(s)!
        o.figuras++
        if (!o.thumb) o.thumb = (f.thumb_url || f.image_url || null) as string | null
      }
      return NextResponse.json([...map.values()].sort((a, b) => a.ordem - b.ordem))
    }

    if (action === 'figuras') {
      const { data } = await supabase
        .from('catalogo_figuras')
        .select('id, code, name, secao, thumb_url, image_url, ordem, catalogo_figura_modelos!inner(modelo)')
        .eq('catalogo_figura_modelos.modelo', modelo)
        .eq('secao', secao)
        .order('ordem', { ascending: true })
      const result = (data || []).map((f: Record<string, unknown>) => {
        const { catalogo_figura_modelos: _, ...resto } = f
        return resto
      })
      return NextResponse.json(result)
    }

    if (action === 'figura') {
      const { data: fig } = await supabase.from('catalogo_figuras').select('*').eq('id', figuraId).maybeSingle()
      if (!fig) return NextResponse.json(null)
      const { data: pecas } = await supabase
        .from('catalogo_pecas')
        .select('id, code, name, reference, qtd, unit, compravel')
        .eq('figura_id', figuraId)
      const norm = (v: unknown) => String(v ?? '').trim()
      const melhor = new Map<string, Record<string, unknown>>()
      for (const p of pecas || []) {
        const key = `${norm(p.reference)}||${norm(p.code)}`
        const atual = melhor.get(key)
        if (!atual || (p.qtd != null && atual.qtd == null)) melhor.set(key, p)
      }
      let unicas = [...melhor.values()]
      const codigosComRef = new Set(unicas.filter(p => norm(p.reference) !== '').map(p => norm(p.code)))
      unicas = unicas.filter(p => !(norm(p.reference) === '' && codigosComRef.has(norm(p.code))))
      unicas.sort((a, b) => {
        const na = parseInt(String(a.reference || '0'), 10) || 0
        const nb = parseInt(String(b.reference || '0'), 10) || 0
        return na - nb
      })
      return NextResponse.json({ ...fig, pecas: unicas })
    }

    if (action === 'busca') {
      const safe = String(busca || '').replace(/[%,()*]/g, ' ').trim()
      const tokens = safe.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2)
      let query = supabase.from('catalogo_pecas').select('id, code, name, reference, qtd, figura_id').limit(60)
      if (tokens.length === 0) {
        query = query.or(`name.ilike.%${safe}%,code.ilike.%${safe}%`)
      } else {
        for (const t of tokens) query = query.ilike('name', `%${t}%`)
      }
      let { data: pecas } = await query
      if ((!pecas || pecas.length === 0) && tokens.length > 1) {
        const { data } = await supabase.from('catalogo_pecas')
          .select('id, code, name, reference, qtd, figura_id')
          .or(tokens.map((t: string) => `name.ilike.%${t}%`).join(',') + `,code.ilike.%${safe}%`)
          .limit(60)
        pecas = data
      }
      const figIds = [...new Set((pecas || []).map((p: Record<string, unknown>) => p.figura_id))]
      let figMap: Record<string, unknown> = {}
      if (figIds.length) {
        const { data: figs } = await supabase.from('catalogo_figuras').select('id, code, name, secao, thumb_url').in('id', figIds)
        figMap = Object.fromEntries((figs || []).map((f: Record<string, unknown>) => [f.id, f]))
      }
      return NextResponse.json((pecas || []).map((p: Record<string, unknown>) => ({
        ...p,
        figura: (figMap as Record<string, unknown>)[p.figura_id as string] || null,
      })))
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
