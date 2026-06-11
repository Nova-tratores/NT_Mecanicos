'use client'
import { useAdmin } from '@/hooks/useAdmin'
import LousaVirtual from '@/components/LousaVirtual'

export default function AdminAgendaPage() {
  const { admin, loading } = useAdmin()

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!admin) return null

  return (
    <LousaVirtual
      userId={admin.id}
      userName={admin.tecnico_nome}
      isAdmin
    />
  )
}
