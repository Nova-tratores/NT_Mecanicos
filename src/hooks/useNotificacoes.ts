'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { MecanicoNotificacao } from '@/lib/types'

const LIMPAR_KEY = 'nt-notif-limpa-at'

function getLimpaAt(): string | null {
  try { return localStorage.getItem(LIMPAR_KEY) } catch { return null }
}

export function useNotificacoes(tecnicoNome: string | undefined) {
  const [notificacoes, setNotificacoes] = useState<MecanicoNotificacao[]>([])
  const [naoLidas, setNaoLidas] = useState(0)
  const limpaAtRef = useRef<string | null>(null)

  useEffect(() => {
    if (!tecnicoNome) return
    limpaAtRef.current = getLimpaAt()

    const filtrar = (lista: MecanicoNotificacao[]) => {
      const corte = limpaAtRef.current
      if (!corte) return lista
      return lista.filter(n => n.created_at > corte)
    }

    const carregar = async () => {
      const { data } = await supabase
        .from('mecanico_notificacoes')
        .select('*')
        .eq('tecnico_nome', tecnicoNome)
        .order('created_at', { ascending: false })
        .limit(50)
      if (data) {
        const vis = filtrar(data)
        setNotificacoes(vis)
        setNaoLidas(vis.filter((n) => !n.lida).length)
      }
    }
    carregar()

    const channel = supabase
      .channel('mec_notif_' + tecnicoNome)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'mecanico_notificacoes',
        filter: `tecnico_nome=eq.${tecnicoNome}`,
      }, (payload) => {
        const nova = payload.new as MecanicoNotificacao
        const corte = limpaAtRef.current
        if (corte && nova.created_at <= corte) return
        setNotificacoes((prev) => [nova, ...prev].slice(0, 50))
        setNaoLidas((n) => n + 1)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [tecnicoNome])

  const marcarComoLida = useCallback(async (id: number) => {
    await supabase.from('mecanico_notificacoes').update({ lida: true }).eq('id', id)
    setNotificacoes((prev) => prev.map((n) => n.id === id ? { ...n, lida: true } : n))
    setNaoLidas((n) => Math.max(0, n - 1))
  }, [])

  const marcarTodasComoLidas = useCallback(async () => {
    if (!tecnicoNome) return
    await supabase.from('mecanico_notificacoes').update({ lida: true }).eq('tecnico_nome', tecnicoNome).eq('lida', false)
    setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })))
    setNaoLidas(0)
  }, [tecnicoNome])

  const limparTodas = useCallback(async () => {
    if (!tecnicoNome) return
    const agora = new Date().toISOString()
    limpaAtRef.current = agora
    try { localStorage.setItem(LIMPAR_KEY, agora) } catch {}
    setNotificacoes([])
    setNaoLidas(0)
  }, [tecnicoNome])

  return { notificacoes, naoLidas, marcarComoLida, marcarTodasComoLidas, limparTodas }
}
