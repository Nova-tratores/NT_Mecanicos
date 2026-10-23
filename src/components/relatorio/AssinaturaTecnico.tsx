'use client'
// Assinatura FIXA do técnico (José, 22/10/2026): ele assina uma vez e o app usa sempre a mesma em todos os
// relatórios — para não ficar mudando. Guardada no celular (funciona offline) e no storage do Supabase
// (assinaturas-tecnicos/<id do usuário>.png), para valer também em outro aparelho. "Trocar" grava a nova.
import { useEffect, useState } from 'react'
import { PenLine, Check } from 'lucide-react'
import SignaturePad from '@/components/SignaturePad'
import { supabase } from '@/lib/supabase'
import { colors } from '@/lib/ui'

const BUCKET = 'requisicoes'
const caminho = (uid: string) => `assinaturas-tecnicos/${uid}.png`
const chaveLocal = (uid: string) => `nt-assinatura-tecnico:${uid}`

async function paraDataUrl(blob: Blob): Promise<string> {
  return await new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = erro; r.readAsDataURL(blob) })
}

export default function AssinaturaTecnico({ userId, value, onChange }: { userId?: string; value: string; onChange: (v: string) => void }) {
  const [salva, setSalva] = useState<string | null>(null)
  const [trocando, setTrocando] = useState(false)
  const [gravando, setGravando] = useState(false)

  // carrega a salva (celular → storage) e já usa no relatório se ainda estiver vazio
  useEffect(() => {
    if (!userId) return
    let vivo = true
    ;(async () => {
      let v: string | null = null
      try { v = localStorage.getItem(chaveLocal(userId)) } catch { /* sem localStorage */ }
      if (!v && navigator.onLine) {
        const { data } = await supabase.storage.from(BUCKET).download(caminho(userId)).catch(() => ({ data: null }))
        if (data && data.size > 100) { v = await paraDataUrl(new Blob([data], { type: 'image/png' })); try { localStorage.setItem(chaveLocal(userId), v) } catch { /* cheio */ } }
      }
      if (!vivo || !v) return
      setSalva(v)
    })()
    return () => { vivo = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // a salva vale sempre que o relatório estiver sem assinatura do técnico (também depois de restaurar um
  // rascunho antigo vazio) — a tela mostrava "assinatura salva" e o envio dizia que faltava (23/10/2026)
  useEffect(() => {
    if (salva && !value && !trocando) onChange(salva)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salva, value, trocando])

  const guardar = async (v: string) => {
    onChange(v)
    if (!userId || !v.startsWith('data:image/png')) return
    setGravando(true)
    setSalva(v)
    try { localStorage.setItem(chaveLocal(userId), v) } catch { /* cheio */ }
    try {
      const blob = await fetch(v).then((r) => r.blob())
      await supabase.storage.from(BUCKET).upload(caminho(userId), blob, { upsert: true, contentType: 'image/png' })
    } catch { /* fica no celular; sobe na próxima vez */ }
    setGravando(false)
    setTrocando(false)
  }

  if (salva && !trocando) {
    return (
      <div>
        <div style={{ fontSize: 14, color: colors.textMuted, marginBottom: 6 }}>Assinatura do técnico</div>
        <div style={{ border: `1px solid ${colors.successBorder}`, background: colors.successBg, borderRadius: 14, padding: 12, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13.5, color: '#166534' }}><Check size={16} /> Sua assinatura salva — vai em todos os relatórios</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={salva} alt="Sua assinatura" style={{ width: '100%', maxHeight: 120, objectFit: 'contain', background: '#fefefe', borderRadius: 10 }} />
          <button type="button" onClick={() => setTrocando(true)} style={{ justifySelf: 'start', border: 'none', background: 'none', padding: 0, color: colors.primary, fontSize: 13.5, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <PenLine size={15} /> Trocar minha assinatura
          </button>
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SignaturePad label="Assinatura do técnico" value={trocando ? '' : value} onSave={(v) => void guardar(v)} />
      <div style={{ fontSize: 12.5, color: colors.textSubtle }}>
        {gravando ? 'Guardando sua assinatura…' : 'Assine uma vez: ela fica salva e vai sozinha nos próximos relatórios.'}
        {trocando && <button type="button" onClick={() => setTrocando(false)} style={{ marginLeft: 8, border: 'none', background: 'none', color: colors.primary, fontSize: 12.5, cursor: 'pointer' }}>cancelar</button>}
      </div>
    </div>
  )
}
