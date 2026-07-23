'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase } from '@/lib/supabase'
import { colors, shadow } from '@/lib/ui'
import {
  Camera, ChevronRight, ChevronLeft, Check, AlertCircle,
  Share2, Download, X, Car, Shield, Clock,
} from 'lucide-react'
import Link from 'next/link'
import { PageSpinner } from '@/components/ui'

interface CheckItem {
  key: string; cat: string; titulo: string; desc: string
}
interface SavedItem {
  item_key: string; resposta: string; observacao: string; foto_url: string | null
}

export default function ChecklistVeiculoPage() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const [veiculo, setVeiculo] = useState<{ placa: string } | null>(null)
  const [checklistId, setChecklistId] = useState<string | null>(null)
  const [items, setItems] = useState<CheckItem[]>([])
  const [savedItems, setSavedItems] = useState<Map<string, SavedItem>>(new Map())
  const [step, setStep] = useState(-1) // -1 = intro, 0..N = items, N+1 = resumo
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resultado, setResultado] = useState<{ status: string; score: number; alertas: string[]; shareToken?: string } | null>(null)

  // Item state
  const [foto, setFoto] = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const [resposta, setResposta] = useState<string>('')
  const [obs, setObs] = useState('')
  const fotoRef = useRef<HTMLInputElement>(null)

  // Load vehicle + existing checklist
  useEffect(() => {
    if (!nome) return
    ;(async () => {
      const { data: v } = await supabase
        .from('tecnico_veiculos')
        .select('placa')
        .eq('tecnico_nome', nome)
        .maybeSingle()
      if (v) setVeiculo(v)
      setLoading(false)
    })()
  }, [nome])

  const iniciar = useCallback(async () => {
    if (!veiculo || !nome) return
    setLoading(true)
    let loc: { lat: number; lng: number } | null = null
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }),
      )
      loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
    } catch {}

    const res = await fetch('/api/checklist-veiculo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'iniciar', tecnico_nome: nome, placa: veiculo.placa, loc }),
    })
    const data = await res.json()
    setChecklistId(data.id)
    setItems(data.items || [])
    const map = new Map<string, SavedItem>()
    for (const it of data.itens || []) map.set(it.item_key, it)
    setSavedItems(map)
    // Resume from first unanswered item
    const firstUnanswered = (data.items || []).findIndex((i: CheckItem) => !map.has(i.key))
    setStep(firstUnanswered >= 0 ? firstUnanswered : 0)
    setLoading(false)
  }, [nome, veiculo])

  const salvarItem = useCallback(async () => {
    if (!checklistId || step < 0 || step >= items.length) return
    const item = items[step]
    if (!foto && !savedItems.get(item.key)?.foto_url) return
    if (!resposta) return
    setSaving(true)

    const fd = new FormData()
    fd.append('action', 'salvar_item')
    fd.append('checklist_id', checklistId)
    fd.append('item_key', item.key)
    fd.append('categoria', item.cat)
    fd.append('titulo', item.titulo)
    fd.append('resposta', resposta)
    fd.append('observacao', obs)
    if (foto) fd.append('foto', foto)

    const res = await fetch('/api/checklist-veiculo', { method: 'POST', body: fd })
    const json = await res.json()

    setSavedItems(prev => {
      const next = new Map(prev)
      next.set(item.key, {
        item_key: item.key, resposta, observacao: obs,
        foto_url: json.foto_url || prev.get(item.key)?.foto_url || null,
      })
      return next
    })

    // Move to next
    setFoto(null)
    setFotoPreview(null)
    setResposta('')
    setObs('')
    if (step < items.length - 1) {
      setStep(step + 1)
    } else {
      setStep(items.length) // summary
    }
    setSaving(false)
  }, [checklistId, step, items, foto, resposta, obs, savedItems])

  const concluir = useCallback(async () => {
    if (!checklistId) return
    setSaving(true)
    let loc: { lat: number; lng: number } | null = null
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }),
      )
      loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
    } catch {}

    const res = await fetch('/api/checklist-veiculo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'concluir', checklist_id: checklistId, loc }),
    })
    const data = await res.json()

    // Get share token
    const { data: cl } = await supabase
      .from('veiculo_checklist')
      .select('share_token')
      .eq('id', checklistId)
      .single()

    setResultado({ ...data, shareToken: cl?.share_token })
    setSaving(false)
  }, [checklistId])

  // Load saved data when step changes
  useEffect(() => {
    if (step < 0 || step >= items.length) return
    const item = items[step]
    const saved = savedItems.get(item.key)
    if (saved) {
      setResposta(saved.resposta || '')
      setObs(saved.observacao || '')
      setFotoPreview(saved.foto_url || null)
    } else {
      setResposta('')
      setObs('')
      setFotoPreview(null)
    }
    setFoto(null)
  }, [step, items, savedItems])

  const handleFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFoto(file)
    setFotoPreview(URL.createObjectURL(file))
    e.target.value = ''
  }

  const compartilhar = () => {
    if (!resultado?.shareToken) return
    const url = `${window.location.origin}/checklist-veiculo/ver?token=${resultado.shareToken}`
    if (navigator.share) {
      navigator.share({ title: 'Checklist do Veículo', url })
    } else {
      navigator.clipboard.writeText(url)
      alert('Link copiado!')
    }
  }

  if (loading) return <PageSpinner />

  if (!veiculo) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Car size={48} color={colors.textMuted} style={{ margin: '40px auto 16px' }} />
        <div style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>Sem veículo atribuído</div>
        <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 6 }}>
          Você precisa ter um veículo atribuído para realizar o checklist
        </div>
        <Link href="/" style={{
          display: 'inline-block', marginTop: 20, padding: '10px 20px', borderRadius: 12,
          background: colors.primary, color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 600,
        }}>Voltar</Link>
      </div>
    )
  }

  // Resultado final
  if (resultado) {
    const scoreColor = resultado.score >= 70 ? colors.success : resultado.score >= 50 ? colors.warning : colors.danger
    const scoreLabel = resultado.score >= 70 ? 'Confiável' : resultado.score >= 50 ? 'Atenção' : 'Suspeito'
    return (
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', margin: '0 auto 16px',
            background: scoreColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {resultado.score >= 70 ? <Check size={40} color="#fff" /> : <AlertCircle size={40} color="#fff" />}
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: colors.text }}>Checklist {resultado.status === 'completo' ? 'Concluído' : 'Enviado'}</div>
          <div style={{ fontSize: 14, color: colors.textMuted, marginTop: 4 }}>
            {Math.floor((resultado as any).duracao / 60)}min {(resultado as any).duracao % 60}s de duração
          </div>
        </div>

        <div style={{
          background: colors.surfaceAlt, borderRadius: 16, padding: 20,
          border: `1px solid ${colors.border}`, textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, marginBottom: 8 }}>ÍNDICE DE CONFIANÇA</div>
          <div style={{ fontSize: 48, fontWeight: 800, color: scoreColor }}>{resultado.score}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: scoreColor }}>{scoreLabel}</div>
        </div>

        {resultado.alertas.length > 0 && (
          <div style={{
            background: colors.warningBg, borderRadius: 12, padding: 14,
            border: `1px solid ${colors.warningBorder}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.warning, marginBottom: 6 }}>Observações da análise</div>
            {resultado.alertas.map((a, i) => (
              <div key={i} style={{ fontSize: 11, color: colors.text, padding: '3px 0' }}>• {a}</div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={compartilhar} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 14, border: `1px solid ${colors.border}`,
            background: colors.surface, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: colors.text,
          }}>
            <Share2 size={16} /> Compartilhar
          </button>
          <Link href="/" style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 14, background: colors.primary,
            color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 600,
          }}>
            <Check size={16} /> Voltar
          </Link>
        </div>
      </div>
    )
  }

  // Intro screen
  if (step === -1) {
    const partes = veiculo.placa.split(' - ')
    const modelo = partes.length > 1 ? partes.slice(0, -1).join(' - ') : ''
    const placaNum = partes[partes.length - 1]
    const hoje = new Date()
    const mesLabel = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    return (
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Link href="/" style={{ color: colors.textMuted, textDecoration: 'none', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChevronLeft size={16} /> Voltar
        </Link>

        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', margin: '0 auto 16px',
            background: colors.primaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield size={36} color={colors.primary} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: colors.text }}>Checklist do Veículo</div>
          <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 4, textTransform: 'capitalize' }}>{mesLabel}</div>
        </div>

        <div style={{
          background: colors.surfaceAlt, borderRadius: 16, padding: 16,
          border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Car size={24} color={colors.primary} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{modelo || veiculo.placa}</div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>{placaNum}</div>
          </div>
        </div>

        <div style={{
          background: colors.surfaceAlt, borderRadius: 16, padding: 16,
          border: `1px solid ${colors.border}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 8 }}>Como funciona:</div>
          <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.8 }}>
            • São 20 itens para inspecionar{'\n'}
            • Cada item exige uma foto{'\n'}
            • Marque como OK ou Problema{'\n'}
            • Adicione observações quando necessário{'\n'}
            • Tempo estimado: 15-20 minutos
          </div>
        </div>

        <button onClick={iniciar} disabled={loading} style={{
          width: '100%', padding: '14px 20px', borderRadius: 14,
          background: colors.primary, color: '#fff', border: 'none',
          fontSize: 16, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Camera size={20} /> Iniciar Checklist
        </button>
      </div>
    )
  }

  // Summary screen
  if (step === items.length) {
    const total = items.length
    const respondidos = items.filter(i => savedItems.has(i.key)).length
    const problemas = items.filter(i => savedItems.get(i.key)?.resposta === 'problema').length
    const faltam = total - respondidos

    return (
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>Resumo</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[
            { label: 'Respondidos', value: respondidos, color: colors.success },
            { label: 'Problemas', value: problemas, color: colors.danger },
            { label: 'Faltam', value: faltam, color: colors.warning },
          ].map(s => (
            <div key={s.label} style={{
              background: colors.surfaceAlt, borderRadius: 12, padding: 14, textAlign: 'center',
              border: `1px solid ${colors.border}`,
            }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((item, i) => {
            const saved = savedItems.get(item.key)
            return (
              <button
                key={item.key}
                onClick={() => setStep(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 10, border: `1px solid ${colors.border}`,
                  background: saved ? colors.surface : colors.warningBg,
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: saved
                    ? (saved.resposta === 'ok' ? colors.successBg : colors.dangerBg)
                    : colors.warningBg,
                }}>
                  {saved ? (
                    saved.resposta === 'ok'
                      ? <Check size={14} color={colors.success} />
                      : <AlertCircle size={14} color={colors.danger} />
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, color: colors.warning }}>{i + 1}</span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: colors.text, flex: 1 }}>{item.titulo}</span>
                <ChevronRight size={14} color={colors.textSubtle} />
              </button>
            )
          })}
        </div>

        {faltam > 0 ? (
          <div style={{
            background: colors.warningBg, borderRadius: 12, padding: 12, textAlign: 'center',
            fontSize: 13, color: colors.warning, fontWeight: 600,
          }}>
            Faltam {faltam} {faltam === 1 ? 'item' : 'itens'} para concluir
          </div>
        ) : (
          <button onClick={concluir} disabled={saving} style={{
            width: '100%', padding: '14px 20px', borderRadius: 14,
            background: colors.success, color: '#fff', border: 'none',
            fontSize: 16, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: saving ? 0.6 : 1,
          }}>
            {saving ? (
              <><div className="spinner" style={{ width: 18, height: 18 }} /> Finalizando...</>
            ) : (
              <><Check size={20} /> Concluir Checklist</>
            )}
          </button>
        )}
      </div>
    )
  }

  // Item step
  const item = items[step]
  if (!item) return <PageSpinner />
  const progresso = Math.round(((step + 1) / items.length) * 100)
  const saved = savedItems.get(item.key)
  const podeAvancar = (foto || fotoPreview) && resposta

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <button onClick={() => step > 0 ? setStep(step - 1) : setStep(-1)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 13, color: colors.textMuted,
          }}>
            <ChevronLeft size={16} /> {step > 0 ? 'Anterior' : 'Voltar'}
          </button>
          <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle }}>{step + 1} / {items.length}</span>
          <button onClick={() => setStep(items.length)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            fontSize: 13, color: colors.primary, fontWeight: 600,
          }}>
            Resumo
          </button>
        </div>
        {/* Progress bar */}
        <div style={{ height: 4, background: colors.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progresso}%`, background: colors.primary, borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
        {/* Category badge */}
        <div>
          <span style={{
            fontSize: 10, fontWeight: 700, color: colors.primary, background: colors.primaryBg,
            padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>{item.cat}</span>
        </div>

        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>{item.titulo}</div>
          <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 1.5 }}>{item.desc}</div>
        </div>

        {/* Photo */}
        <input ref={fotoRef} type="file" accept="image/*" capture="environment" onChange={handleFoto} style={{ display: 'none' }} />
        {fotoPreview ? (
          <div style={{ position: 'relative' }}>
            <img src={fotoPreview} alt="" style={{
              width: '100%', borderRadius: 16, maxHeight: 260, objectFit: 'cover',
              border: `2px solid ${colors.border}`,
            }} />
            <button
              onClick={() => fotoRef.current?.click()}
              style={{
                position: 'absolute', bottom: 10, right: 10, background: 'rgba(0,0,0,0.6)',
                color: '#fff', border: 'none', borderRadius: 10, padding: '6px 12px',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <Camera size={12} /> Refazer
            </button>
          </div>
        ) : (
          <button
            onClick={() => fotoRef.current?.click()}
            style={{
              width: '100%', padding: '40px 20px', borderRadius: 16,
              border: `2px dashed ${colors.border}`, background: colors.surfaceAlt,
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}
          >
            <Camera size={32} color={colors.textMuted} />
            <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Tirar foto</span>
            <span style={{ fontSize: 11, color: colors.textMuted }}>Obrigatório</span>
          </button>
        )}

        {/* Resposta */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, marginBottom: 8 }}>Estado:</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { val: 'ok', label: 'OK', icon: <Check size={18} />, bg: colors.successBg, color: colors.success, border: colors.successBorder || '#BBF7D0' },
              { val: 'problema', label: 'Problema', icon: <AlertCircle size={18} />, bg: colors.dangerBg, color: colors.danger, border: colors.dangerBorder || '#FECACA' },
            ].map(r => (
              <button
                key={r.val}
                onClick={() => setResposta(r.val)}
                style={{
                  flex: 1, padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  border: resposta === r.val ? `2px solid ${r.color}` : `1px solid ${colors.border}`,
                  background: resposta === r.val ? r.bg : colors.surface,
                  fontSize: 14, fontWeight: 600, color: resposta === r.val ? r.color : colors.textMuted,
                }}
              >
                {r.icon} {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Observacao */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, marginBottom: 8 }}>
            Observação {resposta === 'problema' ? '' : '(opcional)'}:
          </div>
          <textarea
            value={obs}
            onChange={e => setObs(e.target.value)}
            placeholder="Descreva o estado ou problema encontrado..."
            rows={3}
            style={{
              width: '100%', padding: 12, borderRadius: 12, border: `1px solid ${colors.border}`,
              background: colors.surfaceAlt, fontSize: 13, color: colors.text, resize: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <button
          onClick={salvarItem}
          disabled={!podeAvancar || saving}
          style={{
            width: '100%', padding: '14px 20px', borderRadius: 14,
            background: podeAvancar ? colors.primary : colors.border,
            color: podeAvancar ? '#fff' : colors.textMuted,
            border: 'none', fontSize: 15, fontWeight: 700, cursor: podeAvancar ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? (
            <><div className="spinner" style={{ width: 16, height: 16 }} /> Salvando...</>
          ) : step < items.length - 1 ? (
            <>Próximo <ChevronRight size={18} /></>
          ) : (
            <>Ver Resumo <Check size={18} /></>
          )}
        </button>
      </div>
    </div>
  )
}
