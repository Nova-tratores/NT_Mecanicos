'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAdmin } from '@/hooks/useAdmin'
import HeaderAdmin from '@/components/HeaderAdmin'
import BottomNav from '@/components/BottomNav'

export default function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const { admin, loading, logout } = useAdmin()
  const [reqPendentes, setReqPendentes] = useState(0)
  const [alertasPendentes, setAlertasPendentes] = useState(0)

  useEffect(() => {
    if (!admin) return

    const contar = async () => {
      const [{ count: reqCount }, { count: alertaCount }] = await Promise.all([
        supabase.from('mecanico_requisicoes').select('id', { count: 'exact', head: true }).eq('status', 'pendente'),
        supabase.from('mecanico_alertas').select('id', { count: 'exact', head: true }).eq('status', 'pendente'),
      ])
      setReqPendentes(reqCount || 0)
      setAlertasPendentes(alertaCount || 0)
    }
    contar()

    const channel = supabase
      .channel('req_badge_admin')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'mecanico_requisicoes',
      }, () => contar())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'mecanico_alertas',
      }, () => contar())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [admin])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!admin) return null

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
      <HeaderAdmin adminNome={admin.tecnico_nome} onLogout={logout} />
      <main style={{ padding: 16 }}>
        {children}
      </main>
      <BottomNav reqPendentes={reqPendentes} alertasPendentes={alertasPendentes} />
    </div>
  )
}
