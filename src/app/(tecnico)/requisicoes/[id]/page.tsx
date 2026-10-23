'use client'
// Esta tela lia a tabela antiga mecanico_requisicoes (só o admin, que está sendo desligado, linkava para cá).
// Agora (José, 23/10/2026): se o número é de uma Requisicao pendente DO técnico, abre a tela atual dela; senão, a lista.
import { use, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getCachedRequisicoes } from '@/lib/prefetch'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { nomeIgual } from '../_util'

type ReqMin = { id: number; status: string; recibo_fornecedor: string | null; solicitante: string | null }

export default function RequisicaoDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { user, loading } = useCurrentUser()

  useEffect(() => {
    if (loading) return
    let vivo = true
    const ir = async () => {
      let req: ReqMin | null = null
      if (/^\d+$/.test(id) && user) {
        try {
          if (navigator.onLine) {
            const { data } = await supabase.from('Requisicao').select('id, status, recibo_fornecedor, solicitante').eq('id', id).maybeSingle()
            req = data as ReqMin | null
          }
        } catch { /* cai no cache */ }
        if (!req) {
          const cache = await getCachedRequisicoes()
          const r = (cache || []).find((x) => String(x.id) === id)
          if (r) req = r as unknown as ReqMin
        }
      }
      if (!vivo) return
      const minha = !!req && !!user && nomeIgual(req.solicitante, user.nome_pos, user.tecnico_nome)
      const pendente = minha && String(req!.status).toLowerCase() === 'pedido' && !req!.recibo_fornecedor
      router.replace(pendente ? `/requisicoes/atualizar/${id}` : '/requisicoes')
    }
    ir()
    return () => { vivo = false }
  }, [id, router, user, loading])

  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div className="spinner" style={{ margin: '0 auto' }} />
    </div>
  )
}
