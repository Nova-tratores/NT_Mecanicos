'use client'
import Image from 'next/image'
import { LogOut } from 'lucide-react'

interface HeaderAdminProps {
  adminNome?: string
  onLogout?: () => void
}

export default function HeaderAdmin({ adminNome, onLogout }: HeaderAdminProps) {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 40,
      background: '#1E3A5F', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: 'env(safe-area-inset-top, 0px) 16px 0', boxSizing: 'border-box',
      height: 'calc(56px + env(safe-area-inset-top, 0px))', gap: 12,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }}>
      <Image src="/Logo_Nova.png" alt="Nova Tratores" width={100} height={36} style={{ objectFit: 'contain' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {adminNome && (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {adminNome}
          </span>
        )}
        <span style={{
          fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
          background: 'rgba(255,255,255,0.15)', color: '#fff',
        }}>
          ADMIN
        </span>
        {onLogout && (
          <button
            onClick={onLogout}
            aria-label="Sair"
            style={{
              background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, flexShrink: 0,
              width: 40, height: 40, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <LogOut size={18} color="#fff" />
          </button>
        )}
      </div>
    </header>
  )
}
