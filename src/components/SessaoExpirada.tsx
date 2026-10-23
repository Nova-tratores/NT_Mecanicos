'use client'
// Aviso de sessão expirada (José, 23/10/2026): o app continua abrindo com o perfil guardado, mas sem login
// nada grava no banco. Mostra a faixa e leva ao login SEM apagar o que está no aparelho.
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { EVENTO_SESSAO_EXPIRADA } from '@/lib/sessao'

export default function SessaoExpirada() {
  const [ver, setVer] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const on = () => setVer(true)
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, on)
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, on)
  }, [])

  if (!ver || pathname === '/login') return null
  return (
    <div role="alert" style={{
      position: 'fixed', left: 16, right: 16, zIndex: 9001,
      top: 'calc(72px + env(safe-area-inset-top, 0px))', maxWidth: 420, margin: '0 auto',
      background: '#FEFEFE', border: '1px solid #E2E8F0', borderRadius: 16,
      boxShadow: '0 12px 32px -12px rgba(15,23,42,0.35)', padding: 14, display: 'grid', gap: 10,
    }}>
      <div style={{ fontSize: 15, color: '#0F172A' }}>Sua sessão expirou</div>
      <div style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.5 }}>
        Entre de novo para enviar. Seus dados ficam guardados no aparelho.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setVer(false)} style={{
          flex: 1, minHeight: 44, borderRadius: 12, border: '1px solid #E2E8F0', background: '#FEFEFE', color: '#0F172A', fontSize: 14.5, cursor: 'pointer',
        }}>Depois</button>
        <button type="button" onClick={() => { window.location.href = '/login' }} style={{
          flex: 1, minHeight: 44, borderRadius: 12, border: 'none', background: '#1E3A5F', color: '#FEFEFE', fontSize: 14.5, cursor: 'pointer',
        }}>Entrar de novo</button>
      </div>
    </div>
  )
}
