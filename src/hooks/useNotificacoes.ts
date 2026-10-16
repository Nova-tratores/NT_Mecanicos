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
  // Derivado da lista: contador separado desincronizava com duplicatas do realtime
  const naoLidas = useMemo(() => notificacoes.filter(n => !n.lida).length, [notificacoes])
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

    let ativo = true
    const carregar = async () => {
      try {
        const { data } = await supabase
          .from('mecanico_notificacoes')
          .select('*')
          .or(nomes.map(n => `tecnico_nome.ilike.${n}`).join(','))
          .order('created_at', { ascending: false })
          .limit(50)
        if (data && ativo) {
          const vis = filtrar(data)
          setNotificacoes(vis)
        }
      } catch { /* sem sinal: tenta de novo quando a rede voltar */ }
    }
    carregar()
    // Abriu sem sinal → busca de novo ao reconectar (o realtime não traz o que perdeu)
    const onOnline = () => { carregar() }
    window.addEventListener('online', onOnline)

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
        // Compara como data: o banco manda "+00:00" e o corte é "Z" (string não ordena igual)
        if (corte && new Date(nova.created_at).getTime() <= new Date(corte).getTime()) return
        // Evita duplicar se o carregar() (ex.: ao reconectar) já trouxe esta notificação
        setNotificacoes((prev) => prev.some(p => p.id === nova.id) ? prev : [nova, ...prev].slice(0, 50))
      })
      .subscribe()

    return () => {
      ativo = false
      window.removeEventListener('online', onOnline)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveNomes])

  const marcarTodasComoLidas = useCallback(async () => {
    const ids = notificacoes.filter((n) => !n.lida).map((n) => n.id)
    setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })))
    if (ids.length) {
      try { await supabase.from('mecanico_notificacoes').update({ lida: true }).in('id', ids) } catch {}
    }
  }, [notificacoes])

  const limparTodas = useCallback(() => {
    const agora = new Date().toISOString()
    limpaAtRef.current = agora
    try { localStorage.setItem(LIMPAR_KEY, agora) } catch {}
    setNotificacoes([])
  }, [])

  const carregarHistorico = useCallback(async () => {
    if (nomesRef.current.length === 0) return
    setHistoricoAberto(true)
    try {
      const { data, error } = await supabase
        .from('mecanico_notificacoes')
        .select('*')
        .or(nomesRef.current.map(n => `tecnico_nome.ilike.${n}`).join(','))
        .order('created_at', { ascending: false })
        .limit(100)
      // Sem sinal: mantém o histórico que já estava carregado
      if (!error) setHistorico(data || [])
    } catch {}
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
