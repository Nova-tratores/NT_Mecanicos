'use client'
import dynamic from 'next/dynamic'

const TecnicoLayoutInner = dynamic(
  () => import('@/components/TecnicoLayoutInner'),
  {
    ssr: false,
    loading: () => (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    ),
  },
)

export default function TecnicoLayout({ children }: { children: React.ReactNode }) {
  return <TecnicoLayoutInner>{children}</TecnicoLayoutInner>
}
