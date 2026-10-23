'use client'
// "Requisições enviadas" repetia o hub e pedia cancelamento sem avisar o portal (José, 23/10/2026):
// agora leva para a aba "Em aberto" das Requisições, que avisa o escritório.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RequisicoesEnviadas() {
  const router = useRouter()
  useEffect(() => { router.replace('/requisicoes?aba=aberto') }, [router])
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div className="spinner" style={{ margin: '0 auto' }} />
    </div>
  )
}
