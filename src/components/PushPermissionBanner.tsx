'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { Bell, X } from 'lucide-react'
import { pushSuportado, pedirPermissaoEInscrever } from '@/lib/push-cliente'

const DISMISSED_KEY = 'nt-push-banner-dismissed'

export default function PushPermissionBanner({ tecnicoNome }: { tecnicoNome: string }) {
  const [show, setShow] = useState(false)
  const [denied, setDenied] = useState(false)
  const [activating, setActivating] = useState(false)
  const [msg, setMsg] = useState('')
  const pathname = usePathname()

  useEffect(() => {
    if (!pushSuportado()) return

    const check = async () => {
      const perm = Notification.permission

      if (perm === 'denied') {
        setDenied(true)
        setShow(true)
        return
      }

      // permissão dada: a inscrição é feita pelo ServiceWorkerRegister (lib/push-cliente) (José, 23/10/2026)
      if (perm === 'granted') return

      // permission === 'default' — nunca perguntou
      try {
        const dismissed = localStorage.getItem(DISMISSED_KEY)
        if (dismissed) {
          const ts = Number(dismissed)
          if (Date.now() - ts < 24 * 60 * 60 * 1000) return
        }
      } catch {}
      setShow(true)
    }

    check()
  }, [tecnicoNome])

  const ativar = useCallback(async () => {
    setActivating(true)
    try {
      const permission = await pedirPermissaoEInscrever(tecnicoNome)
      if (permission === 'granted') {
        setMsg('Notificações ativadas!')
        setTimeout(() => setShow(false), 3000)
      } else if (permission === 'denied') {
        setDenied(true)
      }
    } catch (err) {
      console.warn('Push activation failed:', err)
    } finally {
      setActivating(false)
    }
  }, [tecnicoNome])

  const dismiss = useCallback(() => {
    setShow(false)
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch {}
  }, [])

  // no preencher a NotificacaoObrigatoria já mostra o cartão grande: a faixa duplicava (José, 23/10/2026)
  if (!show || /^\/os\/[^/]+\/preencher/.test(pathname || '')) return null

  if (msg) {
    return (
      <div style={{
        position: 'sticky', top: 'calc(64px + env(safe-area-inset-top, 0px))', zIndex: 30,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        background: '#16A34A', color: '#fff',
        padding: '11px 16px', fontSize: 13,
      }}>
        <Bell size={16} /> {msg}
      </div>
    )
  }

  return (
    <div style={{
      position: 'sticky', top: 'calc(64px + env(safe-area-inset-top, 0px))', zIndex: 30,
      display: 'flex', alignItems: 'center', gap: 10,
      background: denied ? '#F59E0B' : '#2563EB', color: '#fff',
      padding: '11px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }}>
      <Bell size={18} color="#fff" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
        {denied
          ? 'Notificações bloqueadas. Vá em Configurações do navegador > Site > Notificações > Permitir.'
          : 'Ative as notificações para receber alertas mesmo com o app fechado.'
        }
      </span>
      {!denied && (
        <button
          onClick={ativar}
          disabled={activating}
          style={{
            flexShrink: 0, background: '#fff', color: '#2563EB',
            border: 'none', borderRadius: 8, padding: '6px 14px',
            fontSize: 12, cursor: 'pointer',
          }}
        >
          {activating ? 'Ativando...' : 'Ativar'}
        </button>
      )}
      <button onClick={dismiss} style={{
        flexShrink: 0, background: 'none', border: 'none',
        color: '#fff', cursor: 'pointer', padding: 4,
      }}>
        <X size={16} />
      </button>
    </div>
  )
}
