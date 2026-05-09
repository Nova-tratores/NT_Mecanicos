'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Home, Calendar, Wrench, ClipboardList, Users, ShieldAlert, Megaphone } from 'lucide-react'

const tabs = [
  { href: '/admin', icon: Home, label: 'Painel' },
  { href: '/admin/agenda', icon: Calendar, label: 'Agenda' },
  { href: '/admin/os', icon: Wrench, label: 'Ordens' },
  { href: '/admin/alertas', icon: ShieldAlert, label: 'Alertas' },
  { href: '/admin/avisos', icon: Megaphone, label: 'Avisos' },
  { href: '/admin/requisicoes', icon: ClipboardList, label: 'Requisições' },
  { href: '/admin/tecnicos', icon: Users, label: 'Técnicos' },
]

interface BottomNavProps {
  reqPendentes?: number
  alertasPendentes?: number
}

export default function BottomNav({ reqPendentes = 0, alertasPendentes = 0 }: BottomNavProps) {
  const pathname = usePathname()

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
      background: '#fff', borderTop: '1px solid #E5E7EB',
      display: 'flex', alignItems: 'center', justifyContent: 'space-around',
      height: 64, paddingBottom: 'env(safe-area-inset-bottom, 0)',
      boxShadow: '0 -2px 10px rgba(0,0,0,0.06)',
    }}>
      {tabs.map((tab) => {
        const isActive = tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href)
        const Icon = tab.icon
        const showBadge = (tab.href === '/admin/requisicoes' && reqPendentes > 0) || (tab.href === '/admin/alertas' && alertasPendentes > 0)
        const badgeCount = tab.href === '/admin/alertas' ? alertasPendentes : reqPendentes

        return (
          <Link key={tab.href} href={tab.href} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 2, textDecoration: 'none', padding: '6px 6px',
            color: isActive ? '#1E3A5F' : '#9CA3AF',
            position: 'relative',
          }}>
            <div style={{ position: 'relative' }}>
              <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
              {showBadge && (
                <span style={{
                  position: 'absolute', top: -4, right: -8,
                  background: '#EF4444', color: '#fff', fontSize: 10,
                  fontWeight: 700, borderRadius: 10, minWidth: 16,
                  height: 16, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', padding: '0 4px',
                  animation: 'pulse-alert 2s ease-in-out infinite',
                }}>
                  {badgeCount}
                </span>
              )}
            </div>
            <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500 }}>{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
