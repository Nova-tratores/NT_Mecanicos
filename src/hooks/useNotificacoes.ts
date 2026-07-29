'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { MecanicoNotificacao } from '@/lib/types'

const LIMPAR_KEY = 'nt-notif-limpa-at'

function getLimpaAt(): string | null {
  try { return localStorage.getItem(LIMPAR_KEY) } catch { return null }
}

const VINTE_QUATRO_HORAS = 24 * 60 * 60 * 1000

export function useNotificacoes(tecnicoNome: string | undefined, nomePos?: string | null) {
  const [notificacoes, setNotificacoes] = useState<MecanicoNotificacao[]>([])
  const [historico, setHistorico] = useState<MecanicoNotificacao[]>([])
  const [historicoAberto, setHistoricoAberto] = useState(false)
  const [naoLidas, setNaoLidas] = useState(0)
  const limpaAtRef = useRef<string | null>(null)

  const nomes = useMemo(
    () => Array.from(new Set([tecnicoNome, nomePos].map(n => (n || '').trim()).filter(Boolean))),
    [tecnicoNome, nomePos],
  )
  const chaveNomes = nomes.map(n => n.toLowerCase()).sort().join('|')
  const nomesRef = useRef(nomes)
  nomesRef.current = nomes

  const ehMinha = useCallback((n: { tecnico_nome?: string | null }) => {
    const alvo = (n.tecnico_nome || '').trim().toLowerCase()
    return nomesRef.current.some(x => x.toLowerCase() === alvo)
  }, [])

  useEffect(() => {
    if (nomes.length === 0) return
    limpaAtRef.current = getLimpaAt()

    const filtrar = (lista: MecanicoNotificacao[]) => {
      const corte = limpaAtRef.current
      const agora = Date.now()
      return lista.filter(n => {
        const ts = new Date(n.created_at).getTime()
        if (agora - ts > VINTE_QUATRO_HORAS) return false
        if (corte && ts <= new Date(corte).getTime()) return false
        return true
      })
    }

    const carregar = async () => {
      const { data } = await supabase
        .from('mecanico_notificacoes')
        .select('*')
        .or(nomes.map(n => `tecnico_nome.ilike.${n}`).join(','))
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
      .channel('mec_notif_' + chaveNomes.replace(/[^a-z0-9|]/g, '_'))
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'mecanico_notificacoes',
      }, (payload) => {
        const nova = payload.new as MecanicoNotificacao
        if (!ehMinha(nova)) return
        const corte = limpaAtRef.current
        if (corte && nova.created_at <= corte) return
        setNotificacoes((prev) => [nova, ...prev].slice(0, 50))
        setNaoLidas((n) => n + 1)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveNomes])

  const marcarTodasComoLidas = useCallback(async () => {
    const ids = notificacoes.filter((n) => !n.lida).map((n) => n.id)
    setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })))
    setNaoLidas(0)
    if (ids.length) await supabase.from('mecanico_notificacoes').update({ lida: true }).in('id', ids)
  }, [notificacoes])

  const limparTodas = useCallback(() => {
    const agora = new Date().toISOString()
    limpaAtRef.current = agora
    try { localStorage.setItem(LIMPAR_KEY, agora) } catch {}
    setNotificacoes([])
    setNaoLidas(0)
  }, [])

  const carregarHistorico = useCallback(async () => {
    if (nomesRef.current.length === 0) return
    const { data } = await supabase
      .from('mecanico_notificacoes')
      .select('*')
      .or(nomesRef.current.map(n => `tecnico_nome.ilike.${n}`).join(','))
      .order('created_at', { ascending: false })
      .limit(100)
    setHistorico(data || [])
    setHistoricoAberto(true)
  }, [])

  const fecharHistorico = useCallback(() => {
    setHistoricoAberto(false)
  }, [])

  return {
    notificacoes, naoLidas, historico, historicoAberto,
    marcarTodasComoLidas, limparTodas,
    carregarHistorico, fecharHistorico,
  }
}
