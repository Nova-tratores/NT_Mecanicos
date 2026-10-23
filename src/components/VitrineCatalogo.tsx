'use client'
// "Do catálogo" na tela inicial (José, 23/10/2026: no lugar da faixa de ordens passando, "umas páginas aleatórias do
// catálogo"). Sorteia 6 figuras, mostra uma de cada vez com zoom lento e troca sozinha; tocar abre a página no
// Catálogo. Guarda o último sorteio no aparelho para abrir sem internet.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen, Shuffle } from 'lucide-react'
import { colors } from '@/lib/ui'

interface Pagina { id: string; nome: string; secao: string; imagem: string; miniatura: string; modelo: string; marca: string }
const CHAVE = 'nt-vitrine-catalogo'
const TROCA_MS = 5000

const linkDe = (p: Pagina) => p.marca && p.modelo
  ? `/catalogos?marca=${encodeURIComponent(p.marca)}&modelo=${encodeURIComponent(p.modelo)}&secao=${encodeURIComponent(p.secao)}&figura=${p.id}`
  : '/catalogos'
const bonito = (s: string) => s.toLowerCase().replace(/(^|\s)(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase())

async function sortear(): Promise<Pagina[]> {
  const r = await fetch('/api/catalogo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'aleatorias' }) })
  if (!r.ok) throw new Error(String(r.status))
  return (await r.json()) as Pagina[]
}

export default function VitrineCatalogo() {
  const [paginas, setPaginas] = useState<Pagina[]>([])
  const [atual, setAtual] = useState(0)
  const [girando, setGirando] = useState(false)

  const carregar = useCallback(async () => {
    setGirando(true)
    try {
      const novas = await sortear()
      if (novas.length) { setPaginas(novas); setAtual(0); try { localStorage.setItem(CHAVE, JSON.stringify(novas)) } catch { /* cheio */ } }
    } catch { /* offline: fica o último sorteio */ }
    setGirando(false)
  }, [])

  useEffect(() => {
    let vivo = true
    try { const g = localStorage.getItem(CHAVE); if (g) { const p = JSON.parse(g) as Pagina[]; queueMicrotask(() => { if (vivo) setPaginas(p) }) } } catch { /* sem guardado */ }
    sortear().then((novas) => { if (vivo && novas.length) { setPaginas(novas); setAtual(0); try { localStorage.setItem(CHAVE, JSON.stringify(novas)) } catch { /* cheio */ } } }).catch(() => {})
    return () => { vivo = false }
  }, [])

  // troca sozinha (para quem pediu menos movimento, não troca)
  useEffect(() => {
    if (paginas.length < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setAtual((i) => (i + 1) % paginas.length), TROCA_MS)
    return () => clearInterval(t)
  }, [paginas.length])

  if (!paginas.length) return null
  const p = paginas[atual]
  return (
    <section style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 12, display: 'grid', gap: 10, minWidth: 0 }}>
      <style>{CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', color: '#7C3AED', background: 'color-mix(in srgb, #7C3AED 10%, #FEFEFE)', flexShrink: 0 }}><BookOpen size={17} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, color: colors.text }}>Do catálogo</div>
          <div style={{ fontSize: 12.5, color: colors.textSubtle }}>páginas sorteadas · toque para abrir</div>
        </div>
        <button type="button" onClick={() => void carregar()} disabled={girando} className="vc-outras" aria-label="Sortear outras páginas">
          <Shuffle size={14} className={girando ? 'vc-gira' : ''} /> Outras
        </button>
      </div>

      <Link href={linkDe(p)} className="vc-quadro" aria-label={`Abrir ${p.nome} no catálogo`}>
        {paginas.map((q, i) => (
          // miniatura (leve, gasta menos dados); a grande só se a miniatura faltar ou não abrir (José, 23/10/2026)
          // eslint-disable-next-line @next/next/no-img-element
          <img key={q.id} src={q.miniatura || q.imagem} alt="" loading={i === 0 ? 'eager' : 'lazy'} className={`vc-img${i === atual ? ' vc-on' : ''}`}
            onError={(e) => { const el = e.currentTarget; if (q.imagem && el.src !== q.imagem && !el.dataset.tentou) { el.dataset.tentou = '1'; el.src = q.imagem } }} />
        ))}
        <span className="vc-legenda">
          <span className="vc-nome">{bonito(p.nome)}</span>
          <span className="vc-info">{[p.modelo, bonito(p.secao)].filter(Boolean).join(' · ')}</span>
        </span>
      </Link>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
        {paginas.map((q, i) => (
          <button key={q.id} type="button" aria-label={`Página ${i + 1}`} onClick={() => setAtual(i)} className={`vc-ponto${i === atual ? ' vc-ponto-on' : ''}`} />
        ))}
      </div>
    </section>
  )
}

const CSS = `
.vc-quadro { position: relative; display: block; aspect-ratio: 4 / 3; max-width: 100%; border-radius: 12px; overflow: hidden; background: #F4F6F9; border: 1px solid ${colors.border}; }
.vc-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0; transform: scale(1); transition: opacity .9s ease; }
.vc-img.vc-on { opacity: 1; animation: vcZoom ${TROCA_MS + 1000}ms ease-out forwards; }
@keyframes vcZoom { from { transform: scale(1) } to { transform: scale(1.08) } }
.vc-legenda { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 12px 10px; display: grid; gap: 1px;
  background: linear-gradient(to top, rgba(15,23,42,.72), rgba(15,23,42,0)); color: #FEFEFE; }
.vc-nome { font-size: 15px; line-height: 1.25; }
.vc-info { font-size: 12px; opacity: .85; }
.vc-outras { display: inline-flex; align-items: center; gap: 5px; border: 1px solid ${colors.border}; background: ${colors.surface}; color: ${colors.text};
  border-radius: 999px; padding: 6px 11px; font: inherit; font-size: 12.5px; cursor: pointer; }
.vc-gira { animation: vcGira .8s linear infinite; }
@keyframes vcGira { to { transform: rotate(360deg) } }
.vc-ponto { width: 7px; height: 7px; border-radius: 99px; border: none; padding: 0; background: ${colors.borderStrong}; cursor: pointer; transition: width .25s, background .25s; }
.vc-ponto-on { width: 20px; background: #7C3AED; }
@media (prefers-reduced-motion: reduce) { .vc-img.vc-on { animation: none } .vc-img { transition: none } }
`
