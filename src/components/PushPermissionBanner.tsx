'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, X } from 'lucide-react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BMKJOMgDI2my4D-ZyeEYa4eUaAhXVh9wR0CvMqAnkivEojf4ychFmeH0nu_pWP4seKFTJUqSz35OEaguFU5Tcd0'
const DISMISSED_KEY = 'nt-push-banner-dismissed'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

async function registrarSubscription(tecnicoNome: string) {
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tecnico_nome: tecnicoNome, subscription: sub.toJSON() }),
  })
}

export default function PushPermissionBanner({ tecnicoNome }: { tecnicoNome: string }) {
  const [show, setShow] = useState(false)
  const [denied, setDenied] = useState(false)
  const [activating, setActivating] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return
    if (!VAPID_PUBLIC_KEY) return

    const check = async () => {
      const perm = Notification.permission

      if (perm === 'denied') {
        setDenied(true)
        setShow(true)
        return
      }

      if (perm === 'granted') {
        // Permissão dada mas pode não ter subscription registrada
        try {
          const reg = await navigator.serviceWorker.ready
          const sub = await reg.pushManager.getSubscription()
          if (!sub) {
            // Tem permissão mas sem subscription — registra automaticamente
            await registrarSubscription(tecnicoNome)
            setMsg('Notificações ativadas!')
            setShow(true)
            setTimeout(() => setShow(false), 3000)
            return
          }
          // Tem permissão E subscription — garante que está no banco
          await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tecnico_nome: tecnicoNome, subscription: sub.toJSON() }),
          })
        } catch (err) {
          console.warn('Push check failed:', err)
        }
        return
      }

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
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        await registrarSubscription(tecnicoNome)
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

  if (!show) return null

  if (msg) {
    return (
      <div style={{
        position: 'sticky', top: 64, zIndex: 30,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        background: '#16A34A', color: '#fff',
        padding: '11px 16px', fontSize: 13, fontWeight: 600,
      }}>
        <Bell size={16} /> {msg}
      </div>
    )
  }

  return (
    <div style={{
      position: 'sticky', top: 64, zIndex: 30,
      display: 'flex', alignItems: 'center', gap: 10,
      background: denied ? '#F59E0B' : '#2563EB', color: '#fff',
      padding: '11px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }}>
      <Bell size={18} color="#fff" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
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
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
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
