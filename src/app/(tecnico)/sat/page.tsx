'use client'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import SatDigital from '@/components/SatDigital'

export default function SatTecnicoPage() {
  const { user, loading } = useCurrentUser()
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!user) return null
  return <SatDigital userId={user.id} userName={user.tecnico_nome} />
}
