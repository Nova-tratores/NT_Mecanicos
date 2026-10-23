'use client'
// Atalhos num BOTÃO CENTRAL (José, 23/10/2026: "deixar os atalhos em um botão central, que quando clicar abre as
// opções no meio da tela"). Botão redondo fixo embaixo, no centro (respeita a borda do iPhone); o número em cima
// soma o que está pendente nos atalhos. Toque abre a grade no meio da tela; toque fora, no X ou Esc fecha.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LayoutGrid, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { colors } from '@/lib/ui'

export interface Atalho { t: string; ic: LucideIcon; cor: string; h?: string; onClick?: () => void; badge?: number; sub?: string; subCor?: string }

const tinta = (cor: string, pct: number) => `color-mix(in srgb, ${cor} ${pct}%, #FEFEFE)`

export default function BotaoAtalhos({ itens }: { itens: Atalho[] }) {
  const [aberto, setAberto] = useState(false)
  const pendentes = itens.reduce((t, a) => t + (a.badge || 0), 0)

  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [aberto])

  return (
    <>
      <style>{CSS}</style>
      <button type="button" className="bat-botao" aria-label="Atalhos" aria-expanded={aberto} onClick={() => setAberto(true)}>
        <LayoutGrid size={24} />
        {pendentes > 0 && <span className="bat-selo">{pendentes}</span>}
      </button>

      {aberto && (
        <div className="bat-fundo" onClick={(e) => { if (e.target === e.currentTarget) setAberto(false) }}>
          <div className="bat-janela" role="dialog" aria-label="Atalhos">
            <div className="bat-topo">
              <span>Atalhos</span>
              <button type="button" className="bat-x" aria-label="Fechar" onClick={() => setAberto(false)}><X size={18} /></button>
            </div>
            <div className="bat-grade">
              {itens.map((a, i) => {
                const dentro = (
                  <>
                    <span className="bat-ic" style={{ color: a.cor, background: tinta(a.cor, 11), borderColor: tinta(a.cor, 22) }}>
                      <a.ic size={22} />
                      {!!a.badge && <span className="bat-mini">{a.badge}</span>}
                    </span>
                    <span className="bat-rot">{a.t}</span>
                    {a.sub && <span className="bat-sub" style={{ color: a.subCor || colors.textSubtle }}>{a.sub}</span>}
                  </>
                )
                const estilo = { animationDelay: `${i * 22}ms` }
                return a.h
                  ? <Link key={a.t} href={a.h} className="bat-item" style={estilo} onClick={() => setAberto(false)}>{dentro}</Link>
                  : <button key={a.t} type="button" className="bat-item" style={estilo} onClick={() => { setAberto(false); a.onClick?.() }}>{dentro}</button>
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const CSS = `
.bat-botao { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(18px + env(safe-area-inset-bottom, 0px)); z-index: 60;
  width: 62px; height: 62px; border-radius: 999px; border: none; cursor: pointer; display: grid; place-items: center;
  background: ${colors.primary}; color: #FEFEFE; box-shadow: 0 12px 26px -10px rgba(3,105,161,.75), 0 2px 6px rgba(15,23,42,.18); }
.bat-botao:active { transform: translateX(-50%) scale(.94); }
.bat-selo { position: absolute; top: -3px; right: -3px; min-width: 21px; height: 21px; padding: 0 5px; border-radius: 11px;
  background: ${colors.danger}; color: #FEFEFE; font-size: 11.5px; display: grid; place-items: center; border: 2px solid #FEFEFE; }
.bat-fundo { position: fixed; inset: 0; z-index: 1000; background: rgba(15,23,42,.42); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  display: grid; place-items: center; padding: 16px; animation: batFundo .18s ease-out; }
.bat-janela { width: min(380px, 100%); background: ${colors.surface}; border-radius: 22px; padding: 14px 14px 16px;
  box-shadow: 0 24px 50px -20px rgba(15,23,42,.55); animation: batAbre .22s cubic-bezier(.16,1,.3,1); }
.bat-topo { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 10px; font-size: 16px; color: ${colors.text}; }
.bat-x { width: 34px; height: 34px; border-radius: 10px; border: 1px solid ${colors.border}; background: ${colors.surface}; color: ${colors.textMuted}; display: grid; place-items: center; cursor: pointer; }
.bat-grade { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.bat-item { display: grid; justify-items: center; align-content: start; gap: 6px; padding: 12px 4px 10px; border-radius: 16px; border: none;
  background: transparent; color: ${colors.text}; text-decoration: none; cursor: pointer; font: inherit; min-width: 0; animation: batItem .26s cubic-bezier(.16,1,.3,1) backwards; }
.bat-item:active { background: ${colors.surfaceAlt}; }
.bat-ic { position: relative; width: 52px; height: 52px; border-radius: 16px; border: 1px solid; display: grid; place-items: center; }
.bat-mini { position: absolute; top: -6px; right: -6px; min-width: 19px; height: 19px; padding: 0 5px; border-radius: 10px; background: ${colors.danger}; color: #FEFEFE; font-size: 11px; display: grid; place-items: center; border: 2px solid ${colors.surface}; }
.bat-rot { font-size: 13px; text-align: center; line-height: 1.2; }
.bat-sub { font-size: 11px; text-align: center; line-height: 1.2; margin-top: -3px; }
@keyframes batFundo { from { opacity: 0 } }
@keyframes batAbre { from { opacity: 0; transform: scale(.92) } }
@keyframes batItem { from { opacity: 0; transform: translateY(6px) } }
@media (prefers-reduced-motion: reduce) { .bat-fundo, .bat-janela, .bat-item { animation: none } }
`
