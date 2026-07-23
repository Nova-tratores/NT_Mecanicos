'use client'
import { useState, useEffect } from 'react'
import { colors } from '@/lib/ui'
import {
  Check, AlertCircle, Shield, Car, Clock, MapPin,
  Camera, ChevronLeft, Share2, FileText,
} from 'lucide-react'
import Link from 'next/link'
import { PageSpinner } from '@/components/ui'
import { useSearchParams } from 'next/navigation'

interface ChecklistData {
  checklist: {
    id: string; tecnico_nome: string; placa: string; mes_referencia: string
    status: string; inicio_em: string; fim_em: string; duracao_total_seg: number
    score_confianca: number; alertas: any; loc_inicio: any; loc_fim: any
  }
  itens: {
    item_key: string; categoria: string; titulo: string; resposta: string
    observacao: string; foto_url: string | null; respondido_em: string
  }[]
  items: { key: string; cat: string; titulo: string; desc: string }[]
}

export default function ChecklistVerPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [data, setData] = useState<ChecklistData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fotoAberta, setFotoAberta] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setError('Token não informado'); setLoading(false); return }
    fetch('/api/checklist-veiculo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'carregar', token }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => setError('Erro ao carregar'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <PageSpinner />

  if (error || !data) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Shield size={48} color={colors.textMuted} style={{ margin: '0 auto 16px' }} />
        <div style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>Checklist não encontrado</div>
        <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 6 }}>{error || 'Token inválido'}</div>
      </div>
    )
  }

  const { checklist, itens, items } = data
  const alertas: string[] = typeof checklist.alertas === 'string' ? JSON.parse(checklist.alertas) : (checklist.alertas || [])
  const score = checklist.score_confianca ?? 0
  const scoreColor = score >= 70 ? colors.success : score >= 50 ? colors.warning : colors.danger
  const scoreLabel = score >= 70 ? 'Confiável' : score >= 50 ? 'Atenção' : 'Suspeito'
  const durMin = Math.floor((checklist.duracao_total_seg || 0) / 60)
  const durSeg = (checklist.duracao_total_seg || 0) % 60

  const itensMap = new Map(itens.map(i => [i.item_key, i]))
  const categorias = [...new Set(items.map(i => i.cat))]
  const problemas = itens.filter(i => i.resposta === 'problema').length
  const respondidos = itens.filter(i => i.resposta).length

  const mesLabel = (() => {
    const [y, m] = checklist.mes_referencia.split('-')
    const d = new Date(Number(y), Number(m) - 1)
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  })()

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', background: colors.surface, minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', background: colors.primary, color: '#fff',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <Shield size={24} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Checklist do Veículo</div>
          <div style={{ fontSize: 12, opacity: 0.8, textTransform: 'capitalize' }}>{mesLabel}</div>
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '4px 10px',
          fontSize: 12, fontWeight: 700,
        }}>
          {checklist.status === 'completo' ? 'Concluído' : checklist.status === 'suspeito' ? 'Suspeito' : checklist.status}
        </div>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Info cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{
            background: colors.surfaceAlt, borderRadius: 12, padding: 14,
            border: `1px solid ${colors.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Car size={14} color={colors.primary} />
              <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600 }}>VEÍCULO</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{checklist.placa}</div>
          </div>
          <div style={{
            background: colors.surfaceAlt, borderRadius: 12, padding: 14,
            border: `1px solid ${colors.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Clock size={14} color={colors.primary} />
              <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600 }}>DURAÇÃO</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{durMin}min {durSeg}s</div>
          </div>
        </div>

        {/* Técnico */}
        <div style={{
          background: colors.surfaceAlt, borderRadius: 12, padding: 14,
          border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: colors.primaryBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileText size={18} color={colors.primary} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{checklist.tecnico_nome}</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>
              {checklist.fim_em ? new Date(checklist.fim_em).toLocaleString('pt-BR') : '—'}
            </div>
          </div>
        </div>

        {/* Score */}
        <div style={{
          background: colors.surfaceAlt, borderRadius: 16, padding: 20,
          border: `1px solid ${colors.border}`, textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, marginBottom: 8, letterSpacing: 0.5 }}>
            ÍNDICE DE CONFIANÇA
          </div>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', margin: '0 auto 12px',
            background: scoreColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{score}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: scoreColor }}>{scoreLabel}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: colors.success }}>{respondidos}</div>
              <div style={{ fontSize: 10, color: colors.textMuted }}>Respondidos</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: colors.danger }}>{problemas}</div>
              <div style={{ fontSize: 10, color: colors.textMuted }}>Problemas</div>
            </div>
          </div>
        </div>

        {/* Alertas */}
        {alertas.length > 0 && (
          <div style={{
            background: colors.warningBg, borderRadius: 12, padding: 14,
            border: `1px solid ${colors.warningBorder}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.warning, marginBottom: 8 }}>
              Alertas da Análise
            </div>
            {alertas.map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: colors.text, padding: '3px 0', display: 'flex', gap: 6 }}>
                <AlertCircle size={13} color={colors.warning} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{a}</span>
              </div>
            ))}
          </div>
        )}

        {/* Items by category */}
        {categorias.map(cat => {
          const catItems = items.filter(i => i.cat === cat)
          return (
            <div key={cat}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: colors.textSubtle,
                textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
              }}>
                {cat}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {catItems.map(item => {
                  const saved = itensMap.get(item.key)
                  const isOk = saved?.resposta === 'ok'
                  const isProblema = saved?.resposta === 'problema'
                  return (
                    <div key={item.key} style={{
                      background: colors.surfaceAlt, borderRadius: 12,
                      border: `1px solid ${isProblema ? colors.dangerBorder : colors.border}`,
                      overflow: 'hidden',
                    }}>
                      {saved?.foto_url && (
                        <div
                          onClick={() => setFotoAberta(saved.foto_url)}
                          style={{ cursor: 'pointer', position: 'relative' }}
                        >
                          <img
                            src={saved.foto_url}
                            alt={item.titulo}
                            style={{ width: '100%', height: 160, objectFit: 'cover' }}
                          />
                          <div style={{
                            position: 'absolute', top: 8, right: 8,
                            background: isOk ? colors.success : colors.danger,
                            color: '#fff', borderRadius: 8, padding: '3px 8px',
                            fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3,
                          }}>
                            {isOk ? <Check size={10} /> : <AlertCircle size={10} />}
                            {isOk ? 'OK' : 'Problema'}
                          </div>
                        </div>
                      )}
                      <div style={{ padding: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {!saved?.foto_url && (
                            <div style={{
                              width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                              background: saved ? (isOk ? colors.successBg : colors.dangerBg) : colors.border,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {saved ? (
                                isOk ? <Check size={12} color={colors.success} /> : <AlertCircle size={12} color={colors.danger} />
                              ) : (
                                <span style={{ fontSize: 9, color: colors.textMuted }}>—</span>
                              )}
                            </div>
                          )}
                          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{item.titulo}</span>
                        </div>
                        {saved?.observacao && (
                          <div style={{
                            fontSize: 12, color: colors.textMuted, marginTop: 6,
                            padding: '6px 8px', background: colors.surface, borderRadius: 6,
                          }}>
                            {saved.observacao}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* GPS info */}
        {(checklist.loc_inicio || checklist.loc_fim) && (
          <div style={{
            background: colors.surfaceAlt, borderRadius: 12, padding: 14,
            border: `1px solid ${colors.border}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, marginBottom: 8, letterSpacing: 0.5 }}>
              LOCALIZAÇÃO
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: colors.textMuted }}>
              {checklist.loc_inicio && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <MapPin size={12} color={colors.success} />
                  Início: {checklist.loc_inicio.lat?.toFixed(4)}, {checklist.loc_inicio.lng?.toFixed(4)}
                </div>
              )}
              {checklist.loc_fim && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <MapPin size={12} color={colors.danger} />
                  Fim: {checklist.loc_fim.lat?.toFixed(4)}, {checklist.loc_fim.lng?.toFixed(4)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {fotoAberta && (
        <div
          onClick={() => setFotoAberta(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, cursor: 'pointer',
          }}
        >
          <img src={fotoAberta} alt="" style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }} />
        </div>
      )}
    </div>
  )
}
