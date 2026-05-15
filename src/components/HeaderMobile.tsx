'use client'
import { useState } from 'react'
import { Bell, X, Trash2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import type { MecanicoNotificacao } from '@/lib/types'

interface HeaderMobileProps {
  notificacoes: MecanicoNotificacao[]
  naoLidas: number
  onMarcarLida: (id: number) => void
  onMarcarTodasLidas: () => void
  onLimparTodas: () => void
  avatarUrl?: string | null
  userName?: string | null
}

export default function HeaderMobile({ notificacoes, naoLidas, onMarcarLida, onMarcarTodasLidas, onLimparTodas, avatarUrl, userName }: HeaderMobileProps) {
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
            }}>
              {naoLidas}
            </span>
          )}
        </button>
      </header>

      {/* Notification panel */}
      {showNotifs && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 100, background: 'rgba(0,0,0,0.5)',
        }} onClick={() => setShowNotifs(false)}>
          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: '85%', maxWidth: 340, background: '#fff',
            boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
            display: 'flex', flexDirection: 'column',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              padding: '16px 20px', background: '#C41E2A', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Notificações</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {naoLidas > 0 && (
                  <button onClick={onMarcarTodasLidas} style={{
                    background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
                    fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                  }}>
                    Marcar todas
                  </button>
                )}
                {notificacoes.length > 0 && (
                  <button onClick={() => { onLimparTodas(); setShowNotifs(false) }} style={{
                    background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
                    fontSize: 11, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <Trash2 size={12} /> Limpar
                  </button>
                )}
                <button onClick={() => setShowNotifs(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                  <X size={20} />
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {notificacoes.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>
                  Nenhuma notificação
                </div>
              ) : notificacoes.map((n) => (
                <div
                  key={n.id}
                  onClick={() => { onMarcarLida(n.id); if (n.link) window.location.href = n.link }}
                  style={{
                    padding: '14px 20px', borderBottom: '1px solid #F3F4F6',
                    background: n.lida ? '#fff' : '#F0F7FF', cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1F2937' }}>{n.titulo}</div>
                  {n.descricao && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{n.descricao}</div>}
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>
                    {new Date(n.created_at).toLocaleString('pt-BR')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
