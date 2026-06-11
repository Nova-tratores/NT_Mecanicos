'use client'
import { useState, useEffect } from 'react'
import { useAdmin } from '@/hooks/useAdmin'
import {
  Calendar, Megaphone, Users, UserCircle, Star, ChevronRight, AlertCircle, Car, Building2, Headset,
} from 'lucide-react'
import Link from 'next/link'

const FAVORITES_KEY = 'nt-admin-favorites'

const ADMIN_SECTIONS = [
  { href: '/admin/agenda', icon: Calendar, label: 'Lousa Virtual', color: '#3B82F6' },
  { href: '/admin/opa', icon: AlertCircle, label: 'Opa', color: '#EF4444' },
  { href: '/admin/avisos', icon: Megaphone, label: 'Avisos', color: '#8B5CF6' },
  { href: '/admin/tecnicos', icon: Users, label: 'Mecânicos', color: '#6366F1' },
  { href: '/admin/mapeamento', icon: Car, label: 'Mapeamento', color: '#0EA5E9' },
  { href: '/admin/clientes', icon: Building2, label: 'Clientes', color: '#F97316' },
  { href: '/admin/sat', icon: Headset, label: 'SAT Digital', color: '#D97706' },
  { href: '/admin/perfil', icon: UserCircle, label: 'Perfil', color: '#64748B' },
]

export default function AdminHome() {
  const { admin } = useAdmin()
  const [favorites, setFavorites] = useState<string[]>([])

  useEffect(() => {
    try { setFavorites(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')) } catch { /* */ }
  }, [])

  const toggleFavorite = (href: string) => {
    setFavorites(prev => {
      const next = prev.includes(href) ? prev.filter(f => f !== href) : [...prev, href]
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
      return next
    })
  }

  const sortedSections = [
    ...ADMIN_SECTIONS.filter(s => favorites.includes(s.href)),
    ...ADMIN_SECTIONS.filter(s => !favorites.includes(s.href)),
  ]
  const favCount = ADMIN_SECTIONS.filter(s => favorites.includes(s.href)).length

  const saudacao = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E3A5F', margin: 0 }}>
          {saudacao()}, {admin?.tecnico_nome || 'Administrador'}
        </h1>
      </div>

      <div style={{
        background: '#fff', borderRadius: 14, overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        {sortedSections.map((section, i) => {
          const Icon = section.icon
          const isFav = favorites.includes(section.href)
          const isLastFav = isFav && i === favCount - 1 && favCount > 0 && favCount < sortedSections.length

          return (
            <div key={section.href}>
              <div style={{
                display: 'flex', alignItems: 'center',
                borderBottom: i < sortedSections.length - 1 && !isLastFav ? '1px solid #F3F4F6' : 'none',
              }}>
                <button
                  onClick={() => toggleFavorite(section.href)}
                  style={{
                    background: 'none', border: 'none', padding: '14px 12px 14px 16px',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                  }}
                >
                  <Star size={16} color={isFav ? '#F59E0B' : '#D1D5DB'} fill={isFav ? '#F59E0B' : 'none'} />
                </button>
                <Link href={section.href} style={{
                  display: 'flex', alignItems: 'center', gap: 12, flex: 1,
                  padding: '14px 16px 14px 0', textDecoration: 'none',
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: `${section.color}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={20} color={section.color} />
                  </div>
                  <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: '#1F2937' }}>
                    {section.label}
                  </span>
                  <ChevronRight size={18} color="#D1D5DB" />
                </Link>
              </div>
              {isLastFav && (
                <div style={{ height: 2, background: '#E5E7EB' }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
