'use client'
// XP e Liga do técnico na tela inicial (José, 22/10/2026: "troca esse bloco de informações para o XP e liga dele que
// tá no portal"). Vem do portal (/api/mecanicos/liga/eu, com o token do mesmo Supabase): cada OS fechada sem
// problema dá XP, ocorrência tira, 100 XP = 1 degrau (Ferro 5 → Diamante). Guarda o último no aparelho para
// abrir sem internet.
import { useEffect, useState } from 'react'
import { Shield, Gem, TrendingUp, TrendingDown, Trophy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { colors } from '@/lib/ui'

interface Liga {
  semLiga?: boolean
  motivo?: string
  tecnico?: string
  nivel: number
  patente: { nome: string; divisao: string; cor: string; fundo: string }
  saldo: number
  proximo: { nome: string; cor: string } | null
  faltam: number
  progresso: number
  mes: { ganhos: number; osLimpas: number; descontos: number; ocorrencias: number }
  ranking: number
  total: number
  regra: { porOS: number; porDegrau: number }
}

// guardado POR USUÁRIO: celular compartilhado não mostra a Liga do técnico anterior (José, 23/10/2026)
const CHAVE = (uid: string) => `nt-liga-xp:${uid}`
function uidGuardado(): string {
  try { return (JSON.parse(localStorage.getItem('nt-mecanicos-profile') || 'null') as { id?: string } | null)?.id || '' } catch { return '' }
}
const PORTAL = (process.env.NEXT_PUBLIC_PORTAL_URL || (process.env.NODE_ENV === 'production' ? 'https://portal.novatratores.com' : 'http://localhost:3000')).replace(/\/$/, '')

function lerGuardado(uid: string): Liga | null {
  if (!uid) return null
  try { const r = localStorage.getItem(CHAVE(uid)); return r ? (JSON.parse(r) as Liga) : null } catch { return null }
}

export default function LigaXP() {
  const [liga, setLiga] = useState<Liga | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true
    try { localStorage.removeItem('nt-liga-xp') } catch { /* chave antiga, sem dono */ }
    const guardado = lerGuardado(uidGuardado())
    if (guardado) Promise.resolve().then(() => { if (vivo) { setLiga(guardado); setCarregando(false) } })
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        const uid = data.session?.user?.id || ''
        if (!token) return
        const r = await fetch(`${PORTAL}/api/mecanicos/liga/eu`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
        if (!r.ok) return
        const j = (await r.json()) as Liga
        if (!vivo) return
        setLiga(j)
        try { if (uid) localStorage.setItem(CHAVE(uid), JSON.stringify(j)) } catch { /* sem espaço: segue sem guardar */ }
      } catch { /* sem internet: fica o guardado */ }
      finally { if (vivo) setCarregando(false) }
    })()
    return () => { vivo = false }
  }, [])

  const cartao: React.CSSProperties = { background: '#FEFEFE', border: `1px solid ${colors.border}`, borderRadius: 18, padding: 14, display: 'grid', gap: 12, minWidth: 0 }

  if (!liga) {
    return (
      <div style={{ ...cartao, gridTemplateColumns: '52px minmax(0, 1fr)', alignItems: 'center' }}>
        <span style={{ width: 52, height: 52, borderRadius: 14, background: colors.surfaceAlt, display: 'grid', placeItems: 'center', color: colors.textSubtle }}><Shield size={24} /></span>
        <span style={{ fontSize: 14, color: colors.textMuted }}>{carregando ? 'carregando sua liga…' : 'Sua liga aparece aqui quando a internet voltar.'}</span>
      </div>
    )
  }
  if (liga.semLiga) {
    return (
      <div style={{ ...cartao, gridTemplateColumns: '52px minmax(0, 1fr)', alignItems: 'center' }}>
        <span style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, #e2e8f0, #94a3b8)', display: 'grid', placeItems: 'center', color: '#FEFEFE' }}><Shield size={24} /></span>
        <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 500 }}>Liga começando</span>
          <span style={{ fontSize: 13.5, color: colors.textMuted, lineHeight: 1.4 }}>Cada OS fechada sem problema vale 5 XP. Com 100 XP você sobe de degrau.</span>
        </div>
      </div>
    )
  }

  const p = liga.patente
  const diamante = !liga.proximo
  const pct = Math.round(liga.progresso * 100)
  return (
    <div style={cartao}>
      <style>{`@keyframes xpEnche { from { width: 0 } } @media (prefers-reduced-motion: reduce) { .xp-barra > i { animation: none !important } }`}</style>
      <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr) auto', gap: 12, alignItems: 'center' }}>
        {/* escudo da liga */}
        <span style={{ width: 64, height: 64, borderRadius: 18, background: p.fundo, display: 'grid', placeItems: 'center', color: '#FEFEFE', boxShadow: `0 10px 22px -14px ${p.cor}` }}>
          {diamante ? <Gem size={30} /> : <Shield size={30} />}
        </span>
        <div style={{ display: 'grid', minWidth: 0, lineHeight: 1.2 }}>
          <small style={{ fontSize: 12.5, color: colors.textMuted }}>Sua liga</small>
          <span style={{ fontSize: 22, fontWeight: 500, color: p.cor }}>{p.nome}</span>
          {liga.ranking > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: colors.textMuted, marginTop: 2 }}>
              <Trophy size={13} color="#CA8A04" /> {liga.ranking}º de {liga.total} na equipe
            </span>
          )}
        </div>
        <div style={{ textAlign: 'right', display: 'grid', lineHeight: 1.1 }}>
          <span style={{ fontSize: 30, fontWeight: 500, color: colors.text, fontVariantNumeric: 'tabular-nums' }}>{liga.saldo}</span>
          <small style={{ fontSize: 12.5, color: colors.textMuted }}>XP</small>
        </div>
      </div>

      {/* caminho até o próximo degrau */}
      <div style={{ display: 'grid', gap: 6 }}>
        <div className="xp-barra" style={{ height: 10, borderRadius: 99, background: '#EEF2F6', overflow: 'hidden' }}>
          <i style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 99, background: `linear-gradient(90deg, ${p.cor}, ${liga.proximo?.cor || p.cor})`, animation: 'xpEnche .9s ease-out' }} />
        </div>
        <span style={{ fontSize: 13, color: colors.textMuted }}>
          {diamante ? 'Você está no topo: Diamante.' : <>Faltam <b style={{ fontWeight: 500, color: colors.text }}>{liga.faltam} XP</b> para <b style={{ fontWeight: 500, color: liga.proximo!.cor }}>{liga.proximo!.nome}</b> · {Math.ceil(liga.faltam / liga.regra.porOS)} OS sem problema</>}
        </span>
      </div>

      {/* este mês */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 10, borderTop: '1px solid #F1F5F9' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 10px', borderRadius: 999, color: '#15803D', background: '#DCFCE7' }}>
          <TrendingUp size={14} /> +{liga.mes.ganhos} XP este mês · {liga.mes.osLimpas} OS sem problema
        </span>
        {liga.mes.descontos > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 10px', borderRadius: 999, color: '#B91C1C', background: '#FEE2E2' }}>
            <TrendingDown size={14} /> −{liga.mes.descontos} de {liga.mes.ocorrencias} ocorrência{liga.mes.ocorrencias === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  )
}
