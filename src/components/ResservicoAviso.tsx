'use client'
// Quadro no topo da OS de RESSERVIÇO (José, 22/10/2026): o técnico volta no cliente para refazer o serviço
// de outra OS. Os dados vêm da própria OS (resservico_de + a descrição que o portal monta) — lib/resservico.ts.
// Estilo POS NewPortal: cor vinho do resserviço (#9F1239) — faixa no topo, fundo clarinho e ícone cheio.
import { RotateCcw } from 'lucide-react'
import { infoResservico } from '@/lib/resservico'
import { colors } from '@/lib/ui'

const VINHO = colors.osResservico
const mix = (pct: number, base = '#FEFEFE') => `color-mix(in srgb, ${VINHO} ${pct}%, ${base})`

export function ResservicoAviso({ os }: { os: { resservico_de?: string | null; Serv_Solicitado?: string | null } }) {
  const rs = infoResservico(os)
  if (!rs) return null
  return (
    <div style={{
      background: mix(5), border: `1px solid ${mix(30, colors.border)}`, borderRadius: 16,
      marginBottom: 20, overflow: 'hidden', color: colors.text, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 14px', background: VINHO, color: '#FEFEFE' }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Resserviço</span>
        <small style={{ fontSize: 12, opacity: 0.9 }}>voltar para refazer</small>
      </div>
      <div style={{ padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, background: VINHO, color: '#FEFEFE', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <RotateCcw size={18} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: colors.text }}>Resserviço da {rs.de}</div>
            <div style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.35 }}>
              Você precisa voltar no cliente para refazer o serviço{rs.motivo ? ` · ${rs.motivo}` : ''}
            </div>
          </div>
        </div>
        {rs.refazer && (
          <div style={{ background: '#FEFEFE', border: `1px solid ${mix(20, colors.border)}`, borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ fontSize: 12.5, color: VINHO, marginBottom: 2 }}>O que precisa refazer</div>
            <div style={{ fontSize: 14, lineHeight: 1.45, color: colors.text, wordBreak: 'break-word' }}>{rs.refazer}</div>
          </div>
        )}
      </div>
    </div>
  )
}
