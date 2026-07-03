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
      // Comparar por timestamp real (parse), nunca por string — os formatos do
      // Postgres (com espaço/offset) vs ISO local quebram a comparacao textual.
      const corteMs = new Date(corte).getTime()
      return lista.filter(n => new Date(n.created_at).getTime() > corteMs)
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

  // Remove uma notificacao de vez (some do banco, nao volta ao recarregar)
  const remover = useCallback(async (id: number) => {
    setNotificacoes((prev) => {
      const alvo = prev.find(n => n.id === id)
      if (alvo && !alvo.lida) setNaoLidas((c) => Math.max(0, c - 1))
      return prev.filter((n) => n.id !== id)
    })
    await supabase.from('mecanico_notificacoes').delete().eq('id', id)
  }, [])

  const limparTodas = useCallback(async () => {
    if (!tecnicoNome) return
    // Cutoff local (fallback imediato, caso o delete no banco falhe)
    const agora = new Date().toISOString()
    limpaAtRef.current = agora
    try { localStorage.setItem(LIMPAR_KEY, agora) } catch {}
    setNotificacoes([])
    setNaoLidas(0)
    // Apaga de vez do banco — sao notificacoes pessoais do tecnico, entao
    // limpar = remover para nao voltarem no proximo carregamento.
    await supabase.from('mecanico_notificacoes').delete().eq('tecnico_nome', tecnicoNome)
  }, [tecnicoNome])

  return { notificacoes, naoLidas, marcarComoLida, marcarTodasComoLidas, remover, limparTodas }
}
