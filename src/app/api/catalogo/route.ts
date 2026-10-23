import { NextRequest, NextResponse } from 'next/server'
import { exigirUsuario, supabaseAdmin } from '@/lib/apiAuth'
import { codigoBusca, combina, ordenar, padraoSemAcento, palavrasBusca } from '@/lib/buscaCatalogo'

// Catálogo: só leitura, mas exige login como o resto do app (José, 23/10/2026)
export async function POST(req: NextRequest) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u
  const supabase = supabaseAdmin()
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

    // páginas aleatórias do catálogo para a vitrine da tela inicial (José, 23/10/2026)
    if (action === 'aleatorias') {
      const { count } = await supabase.from('catalogo_figuras').select('id', { count: 'exact', head: true }).not('image_url', 'is', null)
      const total = count || 0
      if (!total) return NextResponse.json([])
      const sorteados = new Set<number>()
      while (sorteados.size < Math.min(6, total)) sorteados.add(Math.floor(Math.random() * total))
      const figs = (await Promise.all([...sorteados].map(async (off) => {
        const { data } = await supabase.from('catalogo_figuras')
          .select('id, name, secao, thumb_url, image_url, catalogo_figura_modelos(modelo)')
          .not('image_url', 'is', null).order('id').range(off, off)
        return (data || [])[0] as Record<string, unknown> | undefined
      }))).filter(Boolean) as Record<string, unknown>[]
      const modelos = [...new Set(figs.map((f) => ((f.catalogo_figura_modelos as { modelo: string }[] | null) || [])[0]?.modelo).filter(Boolean))] as string[]
      const { data: mods } = modelos.length ? await supabase.from('catalogo_modelos').select('nome, marca').in('nome', modelos) : { data: [] }
      const marcaDe = new Map(((mods || []) as { nome: string; marca: string }[]).map((m) => [m.nome, m.marca]))
      return NextResponse.json(figs.map((f) => {
        const modeloF = ((f.catalogo_figura_modelos as { modelo: string }[] | null) || [])[0]?.modelo || ''
        return { id: f.id, nome: f.name, secao: f.secao, imagem: f.image_url || f.thumb_url, miniatura: f.thumb_url || f.image_url, modelo: modeloF, marca: marcaDe.get(modeloF) || '' }
      }))
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
      // código OU nome, sem ligar para acento nem "de/do" (lib/buscaCatalogo.ts)
      const palavras = palavrasBusca(String(busca || ''))
      const codigo = codigoBusca(String(busca || ''))
      if (!palavras.length && codigo.length < 3) return NextResponse.json([])
      const filtros = [
        ...(codigo.length >= 3 ? [`code.ilike.%${codigo}%`] : []),
        ...(palavras.length ? [`and(${palavras.map((t) => `name.ilike.%${padraoSemAcento(t)}%`).join(',')})`] : []),
      ]
      const { data: brutas } = await supabase.from('catalogo_pecas')
        .select('id, code, name, reference, qtd, figura_id')
        .or(filtros.join(','))
        .limit(500)
      const pecas = ordenar((brutas || []).filter((p) => combina(p, palavras, codigo)), palavras, codigo).slice(0, 60)
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
