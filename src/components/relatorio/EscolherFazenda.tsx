'use client'
// "Onde foi o serviço" (José, 22/10/2026): as fazendas já cadastradas do cliente aparecem para tocar; a que o
// GPS do carro indica vem marcada como sugestão. Os campos continuam editáveis — ele pode corrigir.
import { useEffect, useState } from 'react'
import { MapPin, Check } from 'lucide-react'
import { portalJson } from '@/lib/portal'
import { colors } from '@/lib/ui'

interface Resp { cidade: string; fazendas: { id: string; nome: string }[] }

export default function EscolherFazenda({ osId, fazenda, cidade, primeiroDia, onEscolher }: {
  osId: string; fazenda: string; cidade: string; primeiroDia?: string
  onEscolher: (r: { fazenda: string; cidade?: string }) => void
}) {
  const [r, setR] = useState<Resp | null>(null)
  const [gps, setGps] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    portalJson<Resp>(`/api/mecanicos/app/fazendas?os=${encodeURIComponent(osId)}`).then((j) => { if (vivo) setR(j) }).catch(() => {})
    return () => { vivo = false }
  }, [osId])
  // o GPS do 1º dia diz em qual fazenda o carro parou
  useEffect(() => {
    if (!primeiroDia || !r?.fazendas.length) return
    let vivo = true
    portalJson<{ fazenda: { id: string; nome: string } | null }>(`/api/mecanicos/app/gps-dia?os=${encodeURIComponent(osId)}&data=${primeiroDia}`)
      .then((g) => { if (vivo) setGps(g.fazenda?.id || null) }).catch(() => {})
    return () => { vivo = false }
  }, [osId, primeiroDia, r])

  if (!r?.fazendas.length) return null
  const cidadeOS = r.cidade.replace(/\s*\([A-Z]{2}\)\s*$/, '')
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      <div style={{ fontSize: 13.5, color: colors.textMuted }}>Fazendas deste cliente — toque para usar</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {r.fazendas.map((f) => {
          const sel = fazenda.trim().toLowerCase() === f.nome.toLowerCase()
          const sugerida = gps === f.id
          return (
            <button key={f.id} type="button" onClick={() => onEscolher({ fazenda: f.nome, ...(!cidade.trim() && cidadeOS ? { cidade: cidadeOS } : {}) })}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 99, fontSize: 14.5, cursor: 'pointer',
                border: `1px solid ${sel ? colors.primary : sugerida ? colors.successBorder : colors.border}`,
                background: sel ? colors.primary : sugerida ? colors.successBg : colors.surface, color: sel ? '#fefefe' : colors.text,
              }}>
              {sel ? <Check size={15} /> : <MapPin size={15} color={sugerida ? colors.success : colors.primary} />} {f.nome}
              {sugerida && !sel && <span style={{ fontSize: 12, color: colors.success }}>· o carro esteve aqui</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
