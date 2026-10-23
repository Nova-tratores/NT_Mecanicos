'use client'
// Lê o horímetro / chassi da foto que o técnico tirou (José, 22/10/2026) e PERGUNTA antes de usar.
// Chassi diferente do da OS = aviso. Só lê foto já enviada (http) — offline não lê.
import { useEffect, useRef, useState } from 'react'
import { Check, X, ScanLine, AlertTriangle } from 'lucide-react'
import { portalJson } from '@/lib/portal'
import { colors } from '@/lib/ui'

/** a foto vai como data URL reduzida (o bucket pode não ser público para a IA) */
async function paraDataUrl(url: string): Promise<string> {
  const blob = await fetch(url).then((r) => r.blob())
  const bmp = await createImageBitmap(blob)
  const max = 1400, k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.85)
}

const final = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

export default function LeituraFoto({ foto, tipo, atual, chassiOS, onUsar }: {
  foto: string; tipo: 'horimetro' | 'chassi'; atual: string; chassiOS?: string
  onUsar: (valor: string) => void
}) {
  const [lido, setLido] = useState<{ valor: string; certeza: string } | null>(null)
  const [fechado, setFechado] = useState(false)
  const ultima = useRef('')

  useEffect(() => {
    if (!/^https?:\/\//.test(foto) || ultima.current === foto) return
    ultima.current = foto
    let vivo = true
    ;(async () => {
      try {
        const imagem = await paraDataUrl(foto)
        const r = await portalJson<{ valor: string; certeza: string }>('/api/mecanicos/app/ler-foto', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagem, tipo }),
        })
        if (vivo && r.valor) { setLido(r); setFechado(false) }
      } catch { /* sem leitura: ele digita */ }
    })()
    return () => { vivo = false }
  }, [foto, tipo])

  if (!lido || fechado) return null
  const igual = tipo === 'chassi' ? final(atual) === lido.valor || (!!atual && lido.valor.endsWith(final(atual))) : atual.replace(',', '.') === lido.valor
  if (igual) return null
  const difOS = tipo === 'chassi' && chassiOS && final(chassiOS).length >= 5 && !lido.valor.endsWith(final(chassiOS).slice(-6)) && !final(chassiOS).endsWith(lido.valor.slice(-6))
  const mostrar = tipo === 'horimetro' ? `${lido.valor.replace('.', ',')} h` : lido.valor

  return (
    <div style={{ border: `1px solid ${difOS ? colors.warningBorder : colors.primaryBorder}`, background: difOS ? colors.warningBg : '#F5FAFE', borderRadius: 12, padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14.5, color: colors.text }}>
        <ScanLine size={17} color={colors.primary} />
        <span>Li na foto do {tipo === 'horimetro' ? 'horímetro' : 'chassi'}: <span style={{ fontWeight: 500 }}>{mostrar}</span>{lido.certeza !== 'alta' ? ' (não tenho certeza)' : ''}</span>
      </div>
      {difOS && <div style={{ display: 'flex', gap: 6, fontSize: 13, color: '#92400E' }}><AlertTriangle size={15} style={{ flexShrink: 0 }} /> Diferente do chassi da OS ({chassiOS}). Confira se é a máquina certa.</div>}
      <div style={{ fontSize: 13, color: colors.textSubtle }}>Usar no campo {tipo === 'horimetro' ? 'Horímetro' : 'Chassis'}?</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setFechado(true)} style={{ ...btn, background: colors.surface, color: colors.text, border: `1px solid ${colors.borderStrong}` }}><X size={15} /> Não</button>
        <button type="button" onClick={() => { onUsar(tipo === 'horimetro' ? lido.valor.replace('.', ',') : lido.valor); setFechado(true) }} style={btn}><Check size={15} /> Usar</button>
      </div>
    </div>
  )
}

const btn: React.CSSProperties = { flex: 1, minHeight: 40, borderRadius: 10, border: 'none', background: colors.primary, color: '#fefefe', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: 'pointer' }
