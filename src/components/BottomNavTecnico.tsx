'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Home, FileText, ClipboardList, Camera, User } from 'lucide-react'

const tabs = [
  { href: '/', icon: Home, label: 'Início' },
  { href: '/os', icon: FileText, label: 'Ordens' },
  { href: '/fotos', icon: Camera, label: 'Fotos' },
  { href: '/requisicoes', icon: ClipboardList, label: 'Requisições' },
  { href: '/perfil', icon: User, label: 'Perfil' },
]

export default function BottomNavTecnico() {
  const pathname = usePathname()

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 50,
      background: '#fff',
      borderTop: '1px solid #F3F4F6',
      display: 'flex',
      alignItems: 'stretch',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      boxShadow: '0 -2px 10px rgba(0,0,0,0.04)',
    }}>
      {tabs.map((tab) => {
        const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
        const Icon = tab.icon

        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              padding: '8px 0 6px',
              textDecoration: 'none',
              color: isActive ? '#C41E2A' : '#9CA3AF',
              position: 'relative',
              transition: 'color 0.2s',
            }}
          >
            {/* Indicador vermelho no topo */}
            {isActive && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 32,
                height: 3,
                borderRadius: '0 0 3px 3px',
                background: '#C41E2A',
              }} />
            )}
            <Icon size={22} strokeWidth={isActive ? 2.4 : 1.6} />
            <span style={{
              fontSize: 10,
              fontWeight: isActive ? 700 : 500,
              lineHeight: 1,
              letterSpacing: 0.1,
            }}>
              {tab.label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
