'use client'
import { useState, useEffect, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useNotificacoes } from '@/hooks/useNotificacoes'
import { supabase } from '@/lib/supabase'
import HeaderMobile from '@/components/HeaderMobile'
import BottomNavTecnico from '@/components/BottomNavTecnico'
import OfflineSync from '@/components/OfflineSync'
import { Megaphone, X } from 'lucide-react'

export default function TecnicoLayoutInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useCurrentUser()
  const { notificacoes, naoLidas, marcarComoLida, marcarTodasComoLidas } = useNotificacoes(user?.tecnico_nome ?? '')
  const [avisoPopup, setAvisoPopup] = useState<{ id: number; titulo: string; mensagem: string; prioridade: string } | null>(null)
  const shownRef = useRef<Set<number>>(new Set())

  // Realtime: popup quando novo aviso chega
  useEffect(() => {
    const ch = supabase.channel('aviso_popup_tec')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'avisos_gerais' }, (payload) => {
        const novo = payload.new as { id: number; titulo: string; mensagem: string; prioridade: string; ativo: boolean }
        if (!novo.ativo) return
        if (shownRef.current.has(novo.id)) return
        shownRef.current.add(novo.id)
        setAvisoPopup(novo)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return null

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 100 }}>
      <OfflineSync />
      <HeaderMobile
        notificacoes={notificacoes}
        naoLidas={naoLidas}
        onMarcarLida={marcarComoLida}
        onMarcarTodasLidas={marcarTodasComoLidas}
        avatarUrl={user.avatar_url}
        userName={user.tecnico_nome}
      />
      <main style={{ padding: 16 }}>
        {children}
      </main>
      <BottomNavTecnico />

      {/* Popup de aviso */}
      {avisoPopup && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
          padding: 16,
        }} onClick={() => setAvisoPopup(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 20, width: '100%', maxWidth: 400,
            overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
          }}>
            <div style={{
              height: 4,
              background: avisoPopup.prioridade === 'urgente' ? '#DC2626' : '#1E3A5F',
            }} />
            <div style={{ padding: '24px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: avisoPopup.prioridade === 'urgente' ? '#FEE2E2' : '#DBEAFE',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Megaphone size={22} color={avisoPopup.prioridade === 'urgente' ? '#DC2626' : '#1E3A5F'} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: 1, textTransform: 'uppercase' }}>
                    Novo Aviso
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>{avisoPopup.titulo}</div>
                </div>
                <button onClick={() => setAvisoPopup(null)} style={{
                  background: '#F3F4F6', border: 'none', borderRadius: 8,
                  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}>
                  <X size={16} color="#6B7280" />
                </button>
              </div>
              <div style={{
                fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap',
                maxHeight: 250, overflow: 'auto',
                background: '#F9FAFB', borderRadius: 12, padding: '14px 16px',
                border: '1px solid #F3F4F6',
              }}>
                {avisoPopup.mensagem}
              </div>
              <button onClick={() => setAvisoPopup(null)} style={{
                width: '100%', marginTop: 18, padding: 13, borderRadius: 12,
                background: '#1E3A5F', color: '#fff', border: 'none',
                fontSize: 15, fontWeight: 700, cursor: 'pointer',
              }}>
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
