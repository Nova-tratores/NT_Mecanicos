'use client'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import LousaVirtual from '@/components/LousaVirtual'

export default function TecnicoAgendaPage() {
  const { user, loading } = useCurrentUser()

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!user) return null

  return (
    <LousaVirtual
      userId={user.id}
      userName={user.tecnico_nome}
      defaultTecnico={user.nome_pos || user.tecnico_nome}
    />
  )
}
