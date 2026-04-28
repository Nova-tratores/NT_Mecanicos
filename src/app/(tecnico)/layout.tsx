'use client'
import { useState, useEffect } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useNotificacoes } from '@/hooks/useNotificacoes'
import HeaderMobile from '@/components/HeaderMobile'
import BottomNavTecnico from '@/components/BottomNavTecnico'
import OfflineSync from '@/components/OfflineSync'

export default function TecnicoLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const { user, loading } = useCurrentUser()
  const { notificacoes, naoLidas, marcarComoLida, marcarTodasComoLidas } = useNotificacoes(user?.tecnico_nome ?? '')

  useEffect(() => { setMounted(true) }, [])

  if (!mounted || loading) {
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
    </div>
  )
}
