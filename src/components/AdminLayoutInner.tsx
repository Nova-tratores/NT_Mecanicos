'use client'
import { useAdmin } from '@/hooks/useAdmin'
import HeaderAdmin from '@/components/HeaderAdmin'

export default function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const { admin, loading, logout } = useAdmin()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!admin) return null

  return (
    <div style={{ minHeight: '100vh' }}>
      <HeaderAdmin adminNome={admin.tecnico_nome} onLogout={logout} />
      <main style={{ padding: 16 }}>
        {children}
      </main>
    </div>
  )
}
