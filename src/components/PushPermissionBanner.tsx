'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, BellOff, Share, X } from 'lucide-react'
import { garantirInscricaoPush, pushStatusInicial, type PushStatus } from '@/lib/push'

const DISMISSED_KEY = 'nt-push-banner-dismissed'

function dispensadoRecentemente() {
  try {
    const ts = Number(localStorage.getItem(DISMISSED_KEY) || 0)
    return Date.now() - ts < 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

export default function PushPermissionBanner({ tecnicoNome }: { tecnicoNome: string }) {
  const [status, setStatus] = useState<PushStatus>('indisponivel')
  const [show, setShow] = useState(false)
  const [activating, setActivating] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    const inicial = pushStatusInicial()
    setStatus(inicial)

    if (inicial === 'ativo') {
      // Permissão já dada: confere a inscrição (chave certa, nome certo) sem incomodar
      if (navigator.onLine) {
        garantirInscricaoPush(tecnicoNome).catch((err) => console.warn('Push sync failed:', err))
      }
      return
    }
    if (inicial === 'indisponivel') return
    if (!dispensadoRecentemente()) setShow(true)
  }, [tecnicoNome])

  const ativar = useCallback(async () => {
    setActivating(true)
    setErro('')
    try {
      const novo = await garantirInscricaoPush(tecnicoNome, { pedirPermissao: true })
      setStatus(novo)
      if (novo === 'ativo') {
        setMsg('Notificações ativadas!')
        setTimeout(() => setShow(false), 3000)
      }
    } catch (err) {
      console.warn('Push activation failed:', err)
      setErro(navigator.onLine
        ? 'Não foi possível ativar. Tente novamente.'
        : 'Sem internet. Conecte-se para ativar as notificações.')
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
        position: 'sticky', top: 'calc(64px + env(safe-area-inset-top, 0px))', zIndex: 30,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        background: '#16A34A', color: '#fff',
        padding: '11px 16px', fontSize: 13, fontWeight: 600,
      }}>
        <Bell size={16} /> {msg}
      </div>
    )
  }

  const bloqueado = status === 'bloqueado'
  const instalar = status === 'precisa-instalar'
  const texto = erro
    || (bloqueado
      ? 'Notificações bloqueadas. Toque no cadeado ao lado do endereço (ou em Configurações > Apps > Chrome > Notificações) e permita.'
      : instalar
        ? 'Para receber avisos de OS no iPhone, toque em Compartilhar e depois em "Adicionar à Tela de Início". Abra o app por lá.'
        : 'Ative as notificações para receber as OS novas mesmo com o app fechado.')
  const Icone = bloqueado ? BellOff : instalar ? Share : Bell

  return (
    <div role="status" style={{
      position: 'sticky', top: 'calc(64px + env(safe-area-inset-top, 0px))', zIndex: 30,
      display: 'flex', alignItems: 'center', gap: 10,
      background: bloqueado || erro ? '#B45309' : '#2563EB', color: '#fff',
      padding: '11px 12px 11px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }}>
      <Icone size={18} color="#fff" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{texto}</span>
      {status === 'pendente' && (
        <button
          onClick={ativar}
          disabled={activating}
          style={{
            flexShrink: 0, background: '#fff', color: '#2563EB',
            border: 'none', borderRadius: 10, padding: '0 16px', minHeight: 40,
            fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: activating ? 0.7 : 1,
          }}
        >
          {activating ? 'Ativando...' : 'Ativar'}
        </button>
      )}
      <button onClick={dismiss} aria-label="Fechar aviso" style={{
        flexShrink: 0, background: 'none', border: 'none',
        color: '#fff', cursor: 'pointer', width: 40, height: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <X size={18} />
      </button>
    </div>
  )
}
