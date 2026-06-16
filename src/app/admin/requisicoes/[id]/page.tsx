'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { STATUS_REQUISICAO } from '@/lib/constants'
import type { MecanicoRequisicao } from '@/lib/types'
import { ArrowLeft, Check, X, User, AlertTriangle, Unlink } from 'lucide-react'
import Link from 'next/link'

export default function RequisicaoDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [req, setReq] = useState<MecanicoRequisicao | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    const carregar = async () => {
      const { data } = await supabase
        .from('mecanico_requisicoes')
        .select('*')
        .eq('id', id)
        .single()
      setReq(data as MecanicoRequisicao)
      setLoading(false)
    }
    carregar()
  }, [id])

  const atualizarStatus = async (novoStatus: 'aprovada' | 'recusada') => {
    if (!req) return
    setSaving(true)
    try {
      await supabase
        .from('mecanico_requisicoes')
        .update({
          status: novoStatus,
          data_aprovacao: novoStatus === 'aprovada' ? new Date().toISOString() : null,
        })
        .eq('id', req.id)

      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: req.tecnico_nome,
        tipo: 'requisicao_' + novoStatus,
        titulo: `Requisição #${req.id} ${novoStatus}`,
        descricao: req.material_solicitado.substring(0, 100),
        link: `/requisicoes/${req.id}`,
        lida: false,
      })

      fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tecnico_nome: req.tecnico_nome,
          titulo: `Requisição #${req.id} ${novoStatus}`,
          descricao: req.material_solicitado.substring(0, 100),
          link: `/requisicoes/${req.id}`,
        }),
      }).catch(() => {})

      alert(novoStatus === 'aprovada' ? 'Requisição aprovada!' : 'Requisição recusada.')
      router.push('/admin/requisicoes')
    } catch (err) {
      alert('Erro ao atualizar.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const aprovarCancelamento = async () => {
    if (!req) return
    setSaving(true)
    try {
      // Atualizar status da requisição para cancelada
      await supabase
        .from('mecanico_requisicoes')
        .update({
          cancelamento_status: 'aprovado',
          status: 'cancelada',
        })
        .eq('id', req.id)

      // Desvincular da tabela Requisicao do POS (limpar ordem_servico)
      if (req.id_ordem) {
        // Buscar requisição no POS que tem obs com referência a esta
        const { data: reqPOS } = await supabase
          .from('Requisicao')
          .select('id, obs')
          .eq('ordem_servico', req.id_ordem)
          .ilike('titulo', `%${req.material_solicitado.substring(0, 30)}%`)

        if (reqPOS && reqPOS.length > 0) {
          await supabase
            .from('Requisicao')
            .update({ ordem_servico: null, status: 'cancelada' })
            .eq('id', reqPOS[0].id)
        }
      }

      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: req.tecnico_nome,
        tipo: 'cancelamento_aprovado',
        titulo: `Cancelamento aprovado - Req #${req.id}`,
        descricao: `Sua solicitação de cancelamento foi aprovada.`,
        link: `/requisicoes/${req.id}`,
        lida: false,
      })

      fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tecnico_nome: req.tecnico_nome,
          titulo: `Cancelamento aprovado - Req #${req.id}`,
          descricao: `Sua solicitação de cancelamento foi aprovada.`,
          link: `/requisicoes/${req.id}`,
        }),
      }).catch(() => {})

      alert('Cancelamento aprovado! Requisição desvinculada do POS.')
      router.push('/admin/requisicoes')
    } catch (err) {
      alert('Erro ao aprovar cancelamento.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const recusarCancelamento = async () => {
    if (!req) return
    setSaving(true)
    try {
      await supabase
        .from('mecanico_requisicoes')
        .update({ cancelamento_status: 'recusado' })
        .eq('id', req.id)

      await supabase.from('mecanico_notificacoes').insert({
        tecnico_nome: req.tecnico_nome,
        tipo: 'cancelamento_recusado',
        titulo: `Cancelamento recusado - Req #${req.id}`,
        descricao: `Sua solicitação de cancelamento foi recusada.`,
        link: `/requisicoes/${req.id}`,
        lida: false,
      })

      fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tecnico_nome: req.tecnico_nome,
          titulo: `Cancelamento recusado - Req #${req.id}`,
          descricao: `Sua solicitação de cancelamento foi recusada.`,
          link: `/requisicoes/${req.id}`,
        }),
      }).catch(() => {})

      alert('Cancelamento recusado.')
      router.push('/admin/requisicoes')
    } catch (err) {
      alert('Erro ao recusar cancelamento.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!req) return <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>Requisição não encontrada</div>

  const st = STATUS_REQUISICAO[req.status as keyof typeof STATUS_REQUISICAO]

  return (
    <div>
      <Link href="/admin/requisicoes" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#1E3A5F', fontSize: 14, fontWeight: 600, textDecoration: 'none', marginBottom: 16 }}>
        <ArrowLeft size={18} /> Voltar
      </Link>

      {/* Header */}
      <div style={{
        background: '#1E3A5F', borderRadius: 16, padding: 16, color: '#fff', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Requisição #{req.id}</span>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
            background: 'rgba(255,255,255,0.2)',
          }}>
            {st?.label}
          </span>
        </div>
        {req.id_ordem && (
          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>OS: {req.id_ordem}</div>
        )}
      </div>

      {/* Alerta de cancelamento pendente */}
      {req.cancelamento_solicitado && req.cancelamento_status === 'pendente' && (
        <div style={{
          background: '#FEF2F2', borderRadius: 14, padding: 16, marginBottom: 16,
          border: '2px solid #FECACA',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <AlertTriangle size={18} color="#DC2626" />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#DC2626' }}>
              Cancelamento Solicitado
            </span>
          </div>
          <div style={{
            background: '#fff', borderRadius: 10, padding: 14, marginBottom: 12,
            fontSize: 14, color: '#991B1B', lineHeight: 1.6, whiteSpace: 'pre-wrap',
          }}>
            {req.cancelamento_justificativa}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => { if (confirm('Aprovar o cancelamento? A requisição será desvinculada do POS.')) aprovarCancelamento() }}
              disabled={saving}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: '#DC2626', color: '#fff', borderRadius: 12,
                padding: '14px 0', fontSize: 14, fontWeight: 700,
                border: 'none', cursor: 'pointer', opacity: saving ? 0.6 : 1,
              }}
            >
              <Check size={16} /> Aprovar Cancelamento
            </button>
            <button
              onClick={() => { if (confirm('Recusar o cancelamento?')) recusarCancelamento() }}
              disabled={saving}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: '#fff', color: '#6B7280', borderRadius: 12,
                padding: '14px 0', fontSize: 14, fontWeight: 700,
                border: '2px solid #E5E7EB', cursor: 'pointer', opacity: saving ? 0.6 : 1,
              }}
            >
              <X size={16} /> Manter Requisição
            </button>
          </div>
        </div>
      )}

      {/* Cancelamento já processado */}
      {req.cancelamento_solicitado && req.cancelamento_status !== 'pendente' && (
        <div style={{
          background: req.cancelamento_status === 'aprovado' ? '#F3F4F6' : '#FEF3C7',
          borderRadius: 14, padding: 14, marginBottom: 16,
          border: `1px solid ${req.cancelamento_status === 'aprovado' ? '#D1D5DB' : '#FDE68A'}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: req.cancelamento_status === 'aprovado' ? '#6B7280' : '#92400E' }}>
            Cancelamento {req.cancelamento_status === 'aprovado' ? 'aprovado' : 'recusado'}
          </div>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
            Justificativa: {req.cancelamento_justificativa}
          </div>
        </div>
      )}

      {/* Tecnico info */}
      <div style={{
        background: '#EFF6FF', borderRadius: 12, padding: 14, marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <User size={18} color="#1E3A5F" />
        <div>
          <div style={{ fontSize: 12, color: '#6B7280' }}>Solicitado por</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{req.tecnico_nome}</div>
        </div>
      </div>

      {/* Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>Material Solicitado</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{req.material_solicitado}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>Quantidade</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{req.quantidade || '-'}</div>
          </div>
          <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>Urgência</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {req.urgencia === 'urgente' ? 'Urgente' : 'Normal'}
            </div>
          </div>
        </div>

        {req.motivo && (
          <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>Motivo</div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>{req.motivo}</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>Criada em</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {new Date(req.created_at).toLocaleDateString('pt-BR')}
            </div>
          </div>
          {req.data_aprovacao && (
            <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>Aprovada em</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {new Date(req.data_aprovacao).toLocaleDateString('pt-BR')}
              </div>
            </div>
          )}
        </div>

        {/* Admin actions - aprovar/recusar (requisição normal) */}
        {req.status === 'pendente' && !req.cancelamento_solicitado && (
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              onClick={() => {
                if (confirm('Aprovar esta requisição?')) atualizarStatus('aprovada')
              }}
              disabled={saving}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: '#10B981', color: '#fff', borderRadius: 14,
                padding: '16px 0', fontSize: 15, fontWeight: 700,
                border: 'none', cursor: 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              <Check size={18} /> Aprovar
            </button>
            <button
              onClick={() => {
                if (confirm('Recusar esta requisição?')) atualizarStatus('recusada')
              }}
              disabled={saving}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: '#EF4444', color: '#fff', borderRadius: 14,
                padding: '16px 0', fontSize: 15, fontWeight: 700,
                border: 'none', cursor: 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              <X size={18} /> Recusar
            </button>
          </div>
        )}
      </div>

      <div style={{ height: 20 }} />
    </div>
  )
}
