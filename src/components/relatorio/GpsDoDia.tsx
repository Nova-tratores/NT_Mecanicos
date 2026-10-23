'use client'
// Horários e km do dia pelo GPS do carro (José, 22/10/2026). Só funciona depois que o técnico coloca a DATA
// do dia (senão confunde). O GPS ainda não é 100% confiável: mostra o que achou e ele decide se usa.
import { useState } from 'react'
import { MapPin, Check, X, Loader2 } from 'lucide-react'
import { portalJson } from '@/lib/portal'
import { colors } from '@/lib/ui'

interface Gps { placa: string; carroDe: string; chegada: string | null; saida: string | null; kmDia: number | null; fazenda: { id: string; nome: string } | null; aviso: string | null }

export default function GpsDoDia({ osId, data, onUsar }: {
  osId: string; data: string
  onUsar: (r: { horaInicio?: string; horaFim?: string; kmTotal?: string }) => void
}) {
  const [st, setSt] = useState<{ fase: 'livre' } | { fase: 'buscando' } | { fase: 'achou'; g: Gps } | { fase: 'erro'; msg: string }>({ fase: 'livre' })

  if (!data) return <div style={{ fontSize: 13, color: colors.textSubtle, display: 'flex', gap: 6, alignItems: 'center' }}><MapPin size={14} /> Coloque a data para puxar horários e km do GPS do carro.</div>

  const buscar = async () => {
    setSt({ fase: 'buscando' })
    try { setSt({ fase: 'achou', g: await portalJson<Gps>(`/api/mecanicos/app/gps-dia?os=${encodeURIComponent(osId)}&data=${data}`) }) }
    catch (e) { setSt({ fase: 'erro', msg: e instanceof Error ? e.message : 'Falhou.' }) }
  }

  if (st.fase === 'achou') {
    const g = st.g
    const tem = !!(g.chegada || g.kmDia)
    return (
      <div style={{ border: `1px solid ${colors.primaryBorder}`, background: '#F5FAFE', borderRadius: 12, padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 13, color: colors.textSubtle }}>GPS do carro {g.placa} ({g.carroDe}) — confira</div>
        {g.chegada && <div style={{ fontSize: 15, color: colors.text }}>Chegou <b style={{ fontWeight: 500 }}>{g.chegada}</b>{g.fazenda ? ` na ${g.fazenda.nome}` : ''} · saiu <b style={{ fontWeight: 500 }}>{g.saida || '—'}</b></div>}
        {g.kmDia != null && <div style={{ fontSize: 15, color: colors.text }}>Rodou <b style={{ fontWeight: 500 }}>{g.kmDia} km</b> no dia</div>}
        {g.aviso && <div style={{ fontSize: 13, color: '#92400E' }}>{g.aviso}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setSt({ fase: 'livre' })} style={{ ...btn, background: colors.surface, color: colors.text, border: `1px solid ${colors.borderStrong}` }}><X size={15} /> Não está certo</button>
          {tem && <button type="button" style={btn} onClick={() => {
            onUsar({ ...(g.chegada ? { horaInicio: g.chegada } : {}), ...(g.saida ? { horaFim: g.saida } : {}), ...(g.kmDia != null ? { kmTotal: String(g.kmDia) } : {}) })
            setSt({ fase: 'livre' })
          }}><Check size={15} /> Usar</button>}
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button type="button" onClick={() => void buscar()} disabled={st.fase === 'buscando'}
        style={{ minHeight: 42, borderRadius: 12, border: `1px dashed ${colors.primary}`, background: '#F5FAFE', color: colors.primary, fontSize: 14.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}>
        {st.fase === 'buscando' ? <><Loader2 size={16} className="girar" /> Procurando no GPS…</> : <><MapPin size={16} /> Puxar horários e km do GPS</>}
      </button>
      {st.fase === 'erro' && <div style={{ fontSize: 13, color: '#991B1B' }}>{st.msg}</div>}
      <style>{`.girar { animation: girar 1s linear infinite } @keyframes girar { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const btn: React.CSSProperties = { flex: 1, minHeight: 40, borderRadius: 10, border: 'none', background: colors.primary, color: '#fefefe', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: 'pointer' }
