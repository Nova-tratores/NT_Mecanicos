'use client'
// Ditado do relatório (José, 22/10/2026): o técnico fala, o portal transcreve e a IA separa em
// "diagnóstico" e "serviço realizado". Ele revisa a proposta antes de usar — nada é escrito sozinho.
import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Check, X, Loader2 } from 'lucide-react'
import { portalJson } from '@/lib/portal'
import { colors } from '@/lib/ui'

type Estado = { fase: 'parado' } | { fase: 'gravando'; inicio: number } | { fase: 'enviando' } | { fase: 'proposta'; diagnostico: string; servico: string } | { fase: 'erro'; msg: string }

export default function DitadoRelatorio({ diagnostico, servico, onUsar }: {
  diagnostico: string; servico: string
  onUsar: (r: { diagnostico: string; servico: string }) => void
}) {
  const [st, setSt] = useState<Estado>({ fase: 'parado' })
  const [seg, setSeg] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const pedacos = useRef<Blob[]>([])

  useEffect(() => {
    if (st.fase !== 'gravando') return
    const t = setInterval(() => setSeg(Math.floor((Date.now() - st.inicio) / 1000)), 500)
    return () => clearInterval(t)
  }, [st])
  useEffect(() => () => { rec.current?.stream.getTracks().forEach((t) => t.stop()) }, [])

  const gravar = async () => {
    if (!navigator.onLine) { setSt({ fase: 'erro', msg: 'Sem internet — o ditado precisa de sinal. Escreva ou tente quando tiver sinal.' }); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) || ''
      const r = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined)
      pedacos.current = []
      r.ondataavailable = (e) => { if (e.data.size) pedacos.current.push(e.data) }
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); void enviar(r.mimeType) }
      r.start()
      rec.current = r
      setSeg(0)
      // eslint-disable-next-line react-hooks/purity -- é o clique de gravar, não o render
      setSt({ fase: 'gravando', inicio: Date.now() })
    } catch {
      setSt({ fase: 'erro', msg: 'Não consegui usar o microfone. Libere o microfone para o app nas configurações do celular.' })
    }
  }

  const enviar = async (mime: string) => {
    setSt({ fase: 'enviando' })
    try {
      const blob = new Blob(pedacos.current, { type: mime || 'audio/webm' })
      const fd = new FormData()
      fd.append('audio', blob, /mp4/.test(mime) ? 'ditado.m4a' : 'ditado.webm')
      fd.append('diagnostico', diagnostico)
      fd.append('servico', servico)
      const j = await portalJson<{ diagnostico: string; servico: string }>('/api/mecanicos/app/ditado', { method: 'POST', body: fd })
      setSt({ fase: 'proposta', diagnostico: j.diagnostico, servico: j.servico })
    } catch (e) {
      setSt({ fase: 'erro', msg: e instanceof Error ? e.message : 'Falhou — tente de novo.' })
    }
  }

  const mmss = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`

  return (
    <div style={{ border: `1px solid ${colors.primaryBorder}`, background: '#F5FAFE', borderRadius: 14, padding: 12, display: 'grid', gap: 10 }}>
      {st.fase !== 'proposta' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {st.fase === 'gravando' ? (
            <button type="button" onClick={() => rec.current?.stop()} style={{ ...botao, background: colors.danger }} aria-label="Parar">
              <Square size={20} fill="#fefefe" />
            </button>
          ) : (
            <button type="button" onClick={() => void gravar()} disabled={st.fase === 'enviando'} style={botao} aria-label="Falar">
              {st.fase === 'enviando' ? <Loader2 size={22} className="girar" /> : <Mic size={22} />}
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, color: colors.text }}>
              {st.fase === 'gravando' ? <>Gravando… <span style={{ color: colors.danger }}>{mmss}</span></> : st.fase === 'enviando' ? 'Escrevendo o que você falou…' : 'Falar em vez de escrever'}
            </div>
            <div style={{ fontSize: 13, color: colors.textSubtle, lineHeight: 1.35 }}>
              {st.fase === 'gravando' ? 'Toque no quadrado quando terminar.' : 'Conte o que o equipamento tinha e o que você fez. Você confere antes de usar.'}
            </div>
          </div>
        </div>
      )}
      {st.fase === 'erro' && <div style={{ fontSize: 13.5, color: '#991B1B', background: colors.dangerBg, borderRadius: 10, padding: '8px 10px' }}>{st.msg}</div>}
      {st.fase === 'proposta' && (
        <>
          <div style={{ fontSize: 15, color: colors.text }}>Confira o que eu entendi</div>
          {[['Diagnóstico', st.diagnostico], ['Serviço realizado', st.servico]].map(([t, v]) => (
            <div key={t} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: '10px 12px' }}>
              <div style={{ fontSize: 12.5, color: colors.textSubtle, marginBottom: 2 }}>{t}</div>
              <div style={{ fontSize: 14.5, color: v ? colors.text : colors.textGhost, whiteSpace: 'pre-wrap' }}>{v || '(não falou nada disso)'}</div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setSt({ fase: 'parado' })} style={{ ...acao, background: colors.surface, color: colors.text, border: `1px solid ${colors.borderStrong}` }}><X size={16} /> Descartar</button>
            <button type="button" onClick={() => { onUsar({ diagnostico: st.diagnostico, servico: st.servico }); setSt({ fase: 'parado' }) }} style={acao}><Check size={16} /> Usar no relatório</button>
          </div>
        </>
      )}
      <style>{`.girar { animation: girar 1s linear infinite } @keyframes girar { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const botao: React.CSSProperties = { width: 52, height: 52, borderRadius: 99, border: 'none', background: colors.primary, color: '#fefefe', display: 'grid', placeItems: 'center', flexShrink: 0, cursor: 'pointer' }
const acao: React.CSSProperties = { flex: 1, minHeight: 44, borderRadius: 12, border: 'none', background: colors.primary, color: '#fefefe', fontSize: 14.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }
