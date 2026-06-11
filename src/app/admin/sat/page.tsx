'use client'
import { useAdmin } from '@/hooks/useAdmin'
import SatDigital from '@/components/SatDigital'

export default function SatAdminPage() {
  const { admin, loading } = useAdmin()
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!admin) return null
  return <SatDigital userId={admin.id} userName={admin.tecnico_nome} />
}
