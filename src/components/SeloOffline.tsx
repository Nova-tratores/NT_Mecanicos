'use client'
// Selo da tela inicial (José, 22/10/2026): "12 OS no celular para usar sem internet · atualizado às 06:31".
// Gravado pelo prefetch (app aberto) e pelo service worker quando o push chega (app fechado).
import { useEffect, useState } from 'react'
import { CloudDownload, CloudOff } from 'lucide-react'
import { offlineGet } from '@/lib/offlineCache'
import { colors } from '@/lib/ui'

interface Status { qtd: number; em: number }

const quando = (ms: number) => {
  const d = new Date(ms), hoje = new Date()
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === hoje.toDateString()) return `hoje às ${hora}`
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1)
  if (d.toDateString() === ontem.toDateString()) return `ontem às ${hora}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`
}

export default function SeloOffline() {
  const [st, setSt] = useState<Status | null>(null)
  const [agora, setAgora] = useState(0)
  useEffect(() => {
    let vivo = true
    const ler = () => offlineGet<Status>('offline-status').then((s) => { if (vivo) { setSt(s); setAgora(Date.now()) } }).catch(() => {})
    void ler()
    const t = setInterval(ler, 10_000)
    document.addEventListener('visibilitychange', ler)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', ler) }
  }, [])
  if (!st) return null
  const velho = agora - st.em > 20 * 3600_000
  const cor = velho ? colors.warning : colors.success
  const Icone = velho ? CloudOff : CloudDownload
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 14, margin: '0 0 12px',
      background: velho ? colors.warningBg : colors.successBg, border: `1px solid ${velho ? colors.warningBorder : colors.successBorder}` }}>
      <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: '#fefefe', color: cor, flexShrink: 0 }}><Icone size={18} /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, color: colors.text }}>{st.qtd} OS no celular para usar sem internet</div>
        <div style={{ fontSize: 12.5, color: velho ? '#92400E' : '#166534' }}>
          atualizado {quando(st.em)}{velho ? ' — conecte na internet para atualizar' : ''}
        </div>
      </div>
    </div>
  )
}
