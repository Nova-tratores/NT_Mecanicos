'use client'
// "Confira antes de enviar" (José, 22/10/2026): tudo do relatório numa tela só, para o técnico e o cliente
// baterem o olho antes de mandar.
import { createPortal } from 'react-dom'
import { Send, ArrowLeft } from 'lucide-react'
import { colors } from '@/lib/ui'

// 23/10/2026: mostra também as assinaturas (miniatura) e respeita a barra de baixo do iPhone (safe-area).
export default function ResumoEnvio({ itens, enviando, onVoltar, onConfirmar, assinaturas = [] }: {
  itens: [string, string][]; enviando: boolean; onVoltar: () => void; onConfirmar: () => void
  assinaturas?: { rotulo: string; src: string }[]
}) {
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', background: colors.surfaceAlt, borderRadius: '20px 20px 0 0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 16px 10px' }}>
          <div style={{ fontSize: 18, color: colors.text }}>Confira antes de enviar</div>
          <div style={{ fontSize: 13.5, color: colors.textSubtle }}>Está tudo certo? Depois de enviado vai para o portal.</div>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px' }}>
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16 }}>
            {itens.filter(([, v]) => String(v || '').trim()).map(([k, v], i) => (
              <div key={k} style={{ padding: '11px 14px', borderTop: i ? `1px solid ${colors.border}` : 'none' }}>
                <div style={{ fontSize: 12.5, color: colors.textSubtle }}>{k}</div>
                <div style={{ fontSize: 15, color: colors.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{v}</div>
              </div>
            ))}
          </div>
          {assinaturas.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${assinaturas.length}, minmax(0, 1fr))`, gap: 8, marginTop: 10 }}>
              {assinaturas.map((a) => (
                <div key={a.rotulo} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: 10, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: colors.textSubtle, marginBottom: 6 }}>{a.rotulo}</div>
                  {a.src
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={a.src} alt={a.rotulo} style={{ width: '100%', height: 70, objectFit: 'contain', background: '#fefefe', borderRadius: 8, display: 'block' }} />
                    : <div style={{ fontSize: 14, color: colors.danger }}>Falta</div>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '16px 16px calc(16px + env(safe-area-inset-bottom, 0px))' }}>
          <button type="button" onClick={onVoltar} disabled={enviando}
            style={{ flex: 1, minHeight: 50, borderRadius: 12, border: `1px solid ${colors.borderStrong}`, background: colors.surface, color: colors.text, fontSize: 15.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <ArrowLeft size={17} /> Corrigir
          </button>
          <button type="button" onClick={onConfirmar} disabled={enviando}
            style={{ flex: 1.4, minHeight: 50, borderRadius: 12, border: 'none', background: colors.primary, color: '#fefefe', fontSize: 15.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Send size={17} /> {enviando ? 'Enviando…' : 'Confirmar e enviar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
