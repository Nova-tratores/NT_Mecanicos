'use client'
// "Ordens em aberto" da tela inicial (José, 22/10/2026): no lugar do carrossel, uma FAIXA com as ordens passando de
// lado sozinhas; tocando nela abre a LISTA só com os cartões, da OS mais antiga para a mais recente, com o cartão do
// CENTRO em foco e os outros borrados (vão entrando em foco ao rolar). Tocar no cartão em foco abre a OS; tocar num
// borrado traz ele para o centro.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { ChevronRight, ClipboardEdit, Cog, X, MapPin, CalendarClock } from 'lucide-react'
import { colors } from '@/lib/ui'
import { hojeBR } from '@/lib/hoje'
import { situacaoOS, SITUACAO, nomeBonito, numeroOS, clarinho, pedidoLimpo, maquinaDaOS, cidadeCurta, type Situacao } from '@/components/OsCardTecnico'

export interface OrdemNaFaixa {
  Id_Ordem: string
  Os_Cliente: string | null
  Status: string
  Tipo_Servico: string | null
  Serv_Solicitado: string | null
  Previsao_Execucao: string | null
  Data?: string | null
  Projeto?: string | null
  Cidade_Cliente?: string | null
  _classe: 'pendente' | 'aberta'
}

const dataBR = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '')
const diasDesde = (d?: string | null) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null
  return Math.round((new Date(hojeBR() + 'T12:00:00Z').getTime() - new Date(d.slice(0, 10) + 'T12:00:00Z').getTime()) / 86_400_000)
}

function situacaoDe(o: OrdemNaFaixa): Situacao {
  const prev = o.Previsao_Execucao?.trim?.() || ''
  return situacaoOS(o.Status, !!prev && prev.slice(0, 10) < hojeBR(), false)
}

/** cartão usado na faixa (compacto) e na lista (grande) */
function Cartao({ o, grande }: { o: OrdemNaFaixa; grande?: boolean }) {
  const sit = situacaoDe(o)
  const alerta = sit === SITUACAO.atrasada
  const maquina = maquinaDaOS(o as unknown as Record<string, unknown>)
  const pedido = pedidoLimpo(o.Serv_Solicitado) || o.Tipo_Servico || '—'
  const idade = diasDesde(o.Data)
  return (
    <div style={{
      display: 'grid', gap: grande ? 10 : 7, alignContent: 'start', minWidth: 0, height: '100%',
      padding: grande ? '16px 16px 14px' : '11px 12px', borderRadius: grande ? 20 : 16,
      background: alerta ? clarinho(sit.cor, 4) : '#FEFEFE',
      border: `1px solid ${alerta ? clarinho(sit.cor, 35, colors.border) : colors.border}`,
      boxShadow: grande ? '0 18px 40px -24px rgba(15,23,42,.45)' : '0 1px 2px rgba(15,23,42,.05)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, fontSize: grande ? 13 : 12, padding: '3px 10px 3px 8px', borderRadius: 999, color: sit.cor, background: clarinho(sit.cor, 11) }}>
          <i style={{ width: 7, height: 7, borderRadius: '50%', background: sit.cor }} />{sit.rot}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: colors.textSubtle, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>OS {numeroOS(o.Id_Ordem)}</span>
      </div>
      <span style={{
        fontSize: grande ? 19 : 15, fontWeight: 500, lineHeight: 1.25, color: colors.text,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word',
      }}>
        {nomeBonito(o.Os_Cliente) || 'Sem cliente'}
      </span>
      <span style={{
        fontSize: grande ? 15 : 13, lineHeight: 1.4, color: '#334155',
        display: '-webkit-box', WebkitLineClamp: grande ? 3 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word',
      }}>
        {pedido}
      </span>
      {grande && (
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 14, rowGap: 4, fontSize: 13, color: colors.textMuted }}>
          {maquina && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}><Cog size={13} />{maquina}</span>}
          {o.Cidade_Cliente && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MapPin size={13} />{cidadeCurta(o.Cidade_Cliente)}</span>}
          {o.Data && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CalendarClock size={13} />aberta em {dataBR(o.Data)}{idade != null && idade > 0 ? ` · há ${idade} dia${idade > 1 ? 's' : ''}` : ''}</span>}
        </div>
      )}
      {!grande && maquina && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: colors.textMuted, minWidth: 0 }}>
          <Cog size={12} style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{maquina}</span>
        </span>
      )}
      {grande && (
        <span style={{ marginTop: 2, paddingTop: 10, borderTop: '1px solid #F1F5F9', fontSize: 14.5, color: colors.primary, display: 'flex', alignItems: 'center', gap: 6 }}>
          {o._classe === 'pendente' ? <><ClipboardEdit size={16} /> Preencher relatório</> : <>Ver a OS</>}
          <ChevronRight size={16} style={{ marginLeft: 'auto' }} />
        </span>
      )}
    </div>
  )
}

export default function OrdensEmAberto({ ordens }: { ordens: OrdemNaFaixa[] }) {
  const [aberta, setAberta] = useState(false)
  // da mais antiga para a mais recente (data de abertura; sem data, pelo número)
  const ordenadas = useMemo(() => [...ordens].sort((a, b) =>
    String(a.Data || '9999').localeCompare(String(b.Data || '9999')) || String(a.Id_Ordem).localeCompare(String(b.Id_Ordem), 'pt-BR', { numeric: true })), [ordens])
  if (!ordens.length) return null
  // faixa: a lista repetida duas vezes anda até a metade e recomeça (sem emenda)
  const anda = ordenadas.length > 1
  const seg = Math.max(18, ordenadas.length * 6)
  return (
    <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
      <style>{`
        @keyframes ordensAndam { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        .oa-faixa { position: relative; overflow: hidden; border-radius: 18px; cursor: pointer;
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent); mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent); }
        .oa-trilho { display: flex; gap: 10px; width: max-content; padding: 2px 0 4px; }
        .oa-trilho.anda { animation: ordensAndam var(--seg) linear infinite; }
        .oa-faixa:hover .oa-trilho, .oa-faixa:active .oa-trilho { animation-play-state: paused; }
        .oa-trilho > div { width: 228px; flex: none; }
        @media (prefers-reduced-motion: reduce) { .oa-trilho.anda { animation: none; } .oa-faixa { overflow-x: auto; } }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '4px 2px 0' }}>
        <span style={{ fontSize: 18, fontWeight: 500 }}>Ordens em aberto <small style={{ fontSize: 13, color: colors.textMuted }}>· {ordens.length}</small></span>
        <button type="button" onClick={() => setAberta(true)} style={{ border: 0, background: 'none', padding: 0, fontFamily: 'inherit', fontSize: 13.5, color: colors.primary, display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
          ver todas <ChevronRight size={15} />
        </button>
      </div>
      <div className="oa-faixa" role="button" tabIndex={0} aria-label="Abrir a lista das ordens em aberto" onClick={() => setAberta(true)} onKeyDown={(e) => { if (e.key === 'Enter') setAberta(true) }}>
        <div className={`oa-trilho ${anda ? 'anda' : ''}`} style={{ ['--seg' as string]: `${seg}s` }}>
          {(anda ? [...ordenadas, ...ordenadas] : ordenadas).map((o, i) => (
            <div key={`${o.Id_Ordem}-${i}`} aria-hidden={i >= ordenadas.length || undefined}><Cartao o={o} /></div>
          ))}
        </div>
      </div>
      {aberta && typeof document !== 'undefined' && createPortal(<ListaEmFoco ordens={ordenadas} onFechar={() => setAberta(false)} />, document.body)}
    </div>
  )
}

/** Lista em tela cheia: o cartão do centro em foco, os outros borrados. */
function ListaEmFoco({ ordens, onFechar }: { ordens: OrdemNaFaixa[]; onFechar: () => void }) {
  const router = useRouter()
  const caixa = useRef<HTMLDivElement>(null)
  const itens = useRef<(HTMLDivElement | null)[]>([])
  const [foco, setFoco] = useState(0)

  // a cada rolagem: distância de cada cartão ao centro → desfoque, transparência e tamanho
  useEffect(() => {
    const el = caixa.current
    if (!el) return
    const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const pintar = () => {
      raf = 0
      const meio = el.getBoundingClientRect().top + el.clientHeight / 2
      let melhor = 0, menor = Infinity
      itens.current.forEach((it, i) => {
        if (!it) return
        const r = it.getBoundingClientRect()
        const d = Math.abs(r.top + r.height / 2 - meio)
        if (d < menor) { menor = d; melhor = i }
        const t = Math.min(1, d / (el.clientHeight * 0.45))
        it.style.filter = reduzir ? '' : `blur(${(t * 5).toFixed(2)}px)`
        it.style.opacity = String(1 - t * 0.55)
        it.style.transform = reduzir ? '' : `scale(${(1 - t * 0.08).toFixed(3)})`
      })
      setFoco(melhor)
    }
    const rolou = () => { if (!raf) raf = requestAnimationFrame(pintar) }
    pintar()
    el.addEventListener('scroll', rolou, { passive: true })
    window.addEventListener('resize', rolou)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      el.removeEventListener('scroll', rolou); window.removeEventListener('resize', rolou); window.removeEventListener('keydown', esc)
      if (raf) cancelAnimationFrame(raf)
      document.body.style.overflow = ''
    }
  }, [onFechar])

  const tocar = (i: number, o: OrdemNaFaixa) => {
    if (i === foco) { router.push(`/os/${o.Id_Ordem}`); return }
    itens.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Ordens em aberto" style={{
      position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', flexDirection: 'column',
      background: 'rgba(238,242,246,.94)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      animation: 'oaEntra .22s ease-out',
    }}>
      <style>{`@keyframes oaEntra { from { opacity: 0 } } @media (prefers-reduced-motion: reduce) { [aria-label="Ordens em aberto"] { animation: none !important } }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 10px', maxWidth: 520, width: '100%', margin: '0 auto' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 500, color: colors.text }}>Ordens em aberto · {ordens.length}</div>
          <div style={{ fontSize: 13, color: colors.textMuted }}>da mais antiga para a mais recente · {foco + 1} de {ordens.length}</div>
        </div>
        <button type="button" onClick={onFechar} aria-label="Fechar" style={{ width: 44, height: 44, borderRadius: '50%', border: `1px solid ${colors.border}`, background: '#FEFEFE', display: 'grid', placeItems: 'center', cursor: 'pointer', color: colors.text }}>
          <X size={20} />
        </button>
      </div>
      <div ref={caixa} className="no-scrollbar" style={{
        flex: 1, overflowY: 'auto', scrollSnapType: 'y mandatory', WebkitOverflowScrolling: 'touch',
        padding: '38vh 16px 42vh', display: 'grid', gap: 16, alignContent: 'start',
      }}>
        {ordens.map((o, i) => (
          <div
            key={o.Id_Ordem}
            ref={(el) => { itens.current[i] = el }}
            onClick={() => tocar(i, o)}
            style={{ maxWidth: 488, width: '100%', margin: '0 auto', scrollSnapAlign: 'center', cursor: 'pointer', transition: 'filter .15s, opacity .15s, transform .15s', willChange: 'filter, opacity, transform' }}
          >
            <Cartao o={o} grande />
          </div>
        ))}
      </div>
    </div>
  )
}
