'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { MecanicoNotificacao } from '@/lib/types'

const LIMPAR_KEY = 'nt-notif-limpa-at'

function getLimpaAt(): string | null {
  try { return localStorage.getItem(LIMPAR_KEY) } catch { return null }
}

// O portal e o POS escrevem o nome do técnico com caixas diferentes
// ("DANILO DE SOUZA" da OS vs "Danilo de Souza" do perfil) — o match exato
// fazia notificação de garantia/B.O. NUNCA chegar. Regra: casar SEM diferenciar
// caixa, contra o nome do portal E o nome do POS (nome_pos).
export function useNotificacoes(tecnicoNome: string | undefined, nomePos?: string | null) {
  const [notificacoes, setNotificacoes] = useState<MecanicoNotificacao[]>([])
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
      if (!corte) return lista
      // Comparar por timestamp real (parse), nunca por string — os formatos do
      // Postgres (com espaço/offset) vs ISO local quebram a comparacao textual.
      const corteMs = new Date(corte).getTime()
      return lista.filter(n => new Date(n.created_at).getTime() > corteMs)
    }

    const carregar = async () => {
      // ilike sem % = igualdade sem diferenciar caixa; OR entre os nomes
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

    // Realtime sem filtro no servidor (o filtro `eq` não cobre variação de
    // caixa) — o volume é baixo e o descarte é feito aqui no cliente.
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

  const marcarComoLida = useCallback(async (id: number) => {
    await supabase.from('mecanico_notificacoes').update({ lida: true }).eq('id', id)
    setNotificacoes((prev) => prev.map((n) => n.id === id ? { ...n, lida: true } : n))
    setNaoLidas((n) => Math.max(0, n - 1))
  }, [])

  const marcarTodasComoLidas = useCallback(async () => {
    // pelas IDs do estado (cobre qualquer variação de caixa do nome)
    const ids = notificacoes.filter((n) => !n.lida).map((n) => n.id)
    setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })))
    setNaoLidas(0)
    if (ids.length) await supabase.from('mecanico_notificacoes').update({ lida: true }).in('id', ids)
  }, [notificacoes])

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
    if (nomesRef.current.length === 0) return
    // Cutoff local (fallback imediato, caso o delete no banco falhe)
    const agora = new Date().toISOString()
    limpaAtRef.current = agora
    try { localStorage.setItem(LIMPAR_KEY, agora) } catch {}
    setNotificacoes([])
    setNaoLidas(0)
    // Apaga de vez do banco — sao notificacoes pessoais do tecnico, entao
    // limpar = remover para nao voltarem no proximo carregamento.
    await supabase
      .from('mecanico_notificacoes')
      .delete()
      .or(nomesRef.current.map(n => `tecnico_nome.ilike.${n}`).join(','))
  }, [])

  return { notificacoes, naoLidas, marcarComoLida, marcarTodasComoLidas, remover, limparTodas }
}
