'use client'
import { useState } from 'react'
import {
  Bell, X, Trash2, CheckCheck, FileText, ClipboardList,
  ShieldCheck, Megaphone, Package, AlertCircle,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { MecanicoNotificacao } from '@/lib/types'
import { colors } from '@/lib/ui'

interface HeaderMobileProps {
  notificacoes: MecanicoNotificacao[]
  naoLidas: number
  onMarcarLida: (id: number) => void
  onMarcarTodasLidas: () => void
  onRemover: (id: number) => void
  onLimparTodas: () => void
  avatarUrl?: string | null
  userName?: string | null
}

/* Icone + cor por tipo de notificacao */
function estiloTipo(tipo: string): { icon: typeof Bell; color: string } {
  const t = (tipo || '').toLowerCase()
  if (t.includes('os') || t.includes('ordem') || t.includes('relat')) return { icon: FileText, color: colors.primary }
  if (t.includes('requis')) return { icon: ClipboardList, color: colors.info }
  if (t.includes('garant')) return { icon: ShieldCheck, color: colors.success }
  if (t.includes('aviso')) return { icon: Megaphone, color: colors.warning }
  if (t.includes('nf') || t.includes('peca') || t.includes('peça')) return { icon: Package, color: colors.accent }
  if (t.includes('opa') || t.includes('alert')) return { icon: AlertCircle, color: colors.danger }
  return { icon: Bell, color: colors.textMuted }
}

function tempoRelativo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `há ${d} dia${d > 1 ? 's' : ''}`
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export default function HeaderMobile({ notificacoes, naoLidas, onMarcarLida, onMarcarTodasLidas, onRemover, onLimparTodas, avatarUrl, userName }: HeaderMobileProps) {
  const [showNotifs, setShowNotifs] = useState(false)

  return (
    <>
      <header style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: '#C41E2A', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', height: 64,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
            background: avatarUrl ? 'transparent' : 'rgba(255,255,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid rgba(255,255,255,0.4)',
          }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>
                {userName?.charAt(0)?.toUpperCase() || 'T'}
              </span>
            )}
          </div>
          <Link href="/">
            <Image src="/Logo_Nova.png" alt="Nova Tratores" width={120} height={42} style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
          </Link>
        </div>

        <button onClick={() => setShowNotifs(!showNotifs)} style={{
          position: 'relative', background: 'none', border: 'none',
          color: '#fff', cursor: 'pointer', padding: 8,
        }}>
          <Bell size={22} />
          {naoLidas > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 2,
              background: '#EF4444', color: '#fff', fontSize: 9,
              fontWeight: 700, borderRadius: 10, minWidth: 16,
              height: 16, display: 'flex', alignItems: 'center',
              justifyContent: 'center', padding: '0 4px',
              border: '1.5px solid #C41E2A',
            }}>
              {naoLidas}
            </span>
          )}
        </button>
      </header>

      {/* Painel de notificacoes */}
      {showNotifs && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)',
        }} onClick={() => setShowNotifs(false)}>
          <div
            className="notif-panel"
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0,
              width: '88%', maxWidth: 380, background: '#F5F6F8',
              borderRadius: '20px 0 0 20px', overflow: 'hidden',
              boxShadow: '-8px 0 30px rgba(0,0,0,0.2)',
              display: 'flex', flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              padding: '18px 18px 14px', background: '#fff',
              borderBottom: `1px solid ${colors.border}`, flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 12, background: colors.primary,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 3px 8px rgba(196,30,42,0.3)',
                  }}>
                    <Bell size={19} color="#fff" strokeWidth={2.2} />
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>Notificações</div>
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
                      {naoLidas > 0 ? `${naoLidas} não lida${naoLidas > 1 ? 's' : ''}` : 'Tudo em dia'}
                    </div>
                  </div>
                </div>
                <button onClick={() => setShowNotifs(false)} style={{
                  width: 32, height: 32, borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: colors.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <X size={18} color={colors.textMuted} />
                </button>
              </div>

              {notificacoes.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  {naoLidas > 0 && (
                    <button onClick={onMarcarTodasLidas} style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: colors.surfaceAlt, border: `1px solid ${colors.border}`, color: colors.textMuted,
                      fontSize: 12, fontWeight: 600, padding: '9px 10px', borderRadius: 10, cursor: 'pointer',
                    }}>
                      <CheckCheck size={14} /> Marcar lidas
                    </button>
                  )}
                  <button onClick={() => { onLimparTodas(); setShowNotifs(false) }} style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    background: colors.dangerBg, border: `1px solid ${colors.dangerBorder}`, color: colors.danger,
                    fontSize: 12, fontWeight: 600, padding: '9px 10px', borderRadius: 10, cursor: 'pointer',
                  }}>
                    <Trash2 size={14} /> Limpar tudo
                  </button>
                </div>
              )}
            </div>

            {/* Lista */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notificacoes.length === 0 ? (
                <div style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  color: colors.textSubtle, gap: 10, padding: 40,
                }}>
                  <div style={{
                    width: 60, height: 60, borderRadius: 18, background: colors.surfaceAlt,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Bell size={26} color={colors.textGhost} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>Nenhuma notificação</div>
                </div>
              ) : notificacoes.map((n) => {
                const { icon: Icon, color } = estiloTipo(n.tipo)
                return (
                  <div
                    key={n.id}
                    onClick={() => { onMarcarLida(n.id); if (n.link) window.location.href = n.link }}
                    style={{
                      position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 12,
                      padding: 14, borderRadius: 16, cursor: 'pointer',
                      background: colors.surface,
                      border: `1px solid ${n.lida ? colors.border : color + '55'}`,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 3px 8px rgba(0,0,0,0.12)',
                    }}>
                      <Icon size={19} color="#fff" strokeWidth={2.2} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, paddingRight: 18 }}>
                      <div style={{ fontSize: 13, fontWeight: n.lida ? 500 : 600, color: colors.text }}>{n.titulo}</div>
                      {n.descricao && (
                        <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 1.4 }}>{n.descricao}</div>
                      )}
                      <div style={{ fontSize: 10, color: colors.textSubtle, marginTop: 5 }}>{tempoRelativo(n.created_at)}</div>
                    </div>
                    {!n.lida && (
                      <span style={{
                        position: 'absolute', top: 14, right: 34,
                        width: 8, height: 8, borderRadius: '50%', background: color,
                      }} />
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemover(n.id) }}
                      style={{
                        position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 8,
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <X size={15} color={colors.textSubtle} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
