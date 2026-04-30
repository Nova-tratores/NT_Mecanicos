'use client'
import dynamic from 'next/dynamic'

const AdminLayoutInner = dynamic(
  () => import('@/components/AdminLayoutInner'),
  {
    ssr: false,
    loading: () => (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    ),
  },
)

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutInner>{children}</AdminLayoutInner>
}
