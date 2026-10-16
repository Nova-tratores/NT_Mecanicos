'use client'
import { useEffect, useState, useRef } from 'react'
import { use } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase } from '@/lib/supabase'
import { STATUS_REQUISICAO } from '@/lib/constants'
import type { MecanicoRequisicao } from '@/lib/types'
import { ArrowLeft, RefreshCw, Trash2, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

export default function RequisicaoDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user } = useCurrentUser()
  const [req, setReq] = useState<MecanicoRequisicao | null>(null)
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState(false)
  const [novoMaterial, setNovoMaterial] = useState('')
  const [novaQtd, setNovaQtd] = useState('')
  const [saving, setSaving] = useState(false)
  const [showCancelar, setShowCancelar] = useState(false)
  const [justificativaCancelamento, setJustificativaCancelamento] = useState('')
  const [savingCancel, setSavingCancel] = useState(false)
  const [erroCarga, setErroCarga] = useState(false)
  // Guardas síncronas contra toque duplo (o disabled só vale após o re-render)
  const savingRef = useRef(false)
  const savingCancelRef = useRef(false)

  useEffect(() => {
    if (!id) return
    let vivo = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const carregar = async () => {
      try {
        // Com sinal fraco a consulta podia ficar pendurada e o spinner nunca saía
        const { data, error } = await Promise.race([
          supabase.from('mecanico_requisicoes').select('*').eq('id', id).maybeSingle(),
          new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), 10000) }),
        ])
        if (error) throw error
        if (!vivo) return
        const r = (data as MecanicoRequisicao | null) || null
        setReq(r)
        if (r) {
          setNovoMaterial(r.material_solicitado || '')
          setNovaQtd(r.quantidade || '')
        }
      } catch (err) {
        console.error('[requisicao] carregar:', err)
        if (vivo) setErroCarga(true)
      } finally {
        clearTimeout(timer)
        if (vivo) setLoading(false)
      }
    }
    carregar()
    return () => { vivo = false }
  }, [id])

  const handleAtualizar = async () => {
    if (savingRef.current) return
    if (!req || !novoMaterial.trim()) return
    savingRef.current = true
    setSaving(true)
    try {
      const { error } = await supabase
        .from('mecanico_requisicoes')
        .update({
          material_solicitado: novoMaterial.trim(),
          quantidade: novaQtd.trim() || null,
          atualizada_pelo_tecnico: true,
          status: 'atualizada',
        })
        .eq('id', req.id)
      // Antes o erro era ignorado e a tela mostrava "atualizada" mesmo sem salvar
      if (error) throw error
      setReq({ ...req, material_solicitado: novoMaterial.trim(), quantidade: novaQtd.trim() || null, status: 'atualizada', atualizada_pelo_tecnico: true })
      setEditando(false)
    } catch (err) {
      console.error('[requisicao] atualizar:', err)
      alert('Não foi possível salvar a atualização. Verifique o sinal e tente novamente.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const handleSolicitarCancelamento = async () => {
    if (savingCancelRef.current) return
    if (!req || !justificativaCancelamento.trim()) return
    savingCancelRef.current = true
    setSavingCancel(true)
    try {
      const { error: updErr } = await supabase
        .from('mecanico_requisicoes')
        .update({
          cancelamento_solicitado: true,
          cancelamento_justificativa: justificativaCancelamento.trim(),
          cancelamento_status: 'pendente',
        })
        .eq('id', req.id)
      // supabase-js não lança: sem isso a falha virava "pendente" falso na tela
      if (updErr) throw updErr

      // Notificar admins
      const { data: admins } = await supabase
        .from('mecanico_usuarios')
        .select('tecnico_nome')
        .eq('role', 'admin')

      if (admins && admins.length > 0) {
        const notificacoes = admins.map((admin) => ({
          tecnico_nome: admin.tecnico_nome,
          tipo: 'cancelamento_requisicao',
          titulo: `Solicitação de cancelamento - Req #${req.id}`,
          descricao: `${req.tecnico_nome} solicitou cancelamento: ${justificativaCancelamento.trim().substring(0, 100)}`,
          link: `/admin/requisicoes/${req.id}`,
          lida: false,
        }))
        await supabase.from('mecanico_notificacoes').insert(notificacoes)
      }

      setReq({
        ...req,
        cancelamento_solicitado: true,
        cancelamento_justificativa: justificativaCancelamento.trim(),
        cancelamento_status: 'pendente',
      })
      setShowCancelar(false)
      setJustificativaCancelamento('')
    } catch (err) {
      console.error(err)
      alert('Erro ao solicitar cancelamento. Verifique o sinal e tente novamente.')
    } finally {
      savingCancelRef.current = false
      setSavingCancel(false)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!req) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>
        {erroCarga
          ? 'Não foi possível carregar a requisição. Verifique o sinal e tente novamente.'
          : 'Requisição não encontrada'}
        <div style={{ marginTop: 16 }}>
          <Link href="/requisicoes" style={{ color: '#1E3A5F', fontWeight: 600, textDecoration: 'none' }}>
            Voltar às Requisições
          </Link>
        </div>
      </div>
    )
  }

  const st = STATUS_REQUISICAO[req.status as keyof typeof STATUS_REQUISICAO]
  const podeEditar = req.status === 'pendente' || req.status === 'recusada'
  const podeCancelar = req.status !== 'cancelada' && !req.cancelamento_solicitado

  return (
    <div>
      <Link href="/requisicoes" style={{
        display: 'flex', alignItems: 'center', gap: 6,
        color: '#1E3A5F', fontSize: 14, fontWeight: 600,
        textDecoration: 'none', marginBottom: 16, minHeight: 44,
      }}>
        <ArrowLeft size={18} /> Voltar
      </Link>

      {/* Header */}
      <div style={{
        background: '#1E3A5F', borderRadius: 16, padding: 16, color: '#fff', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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

      {/* Status visual */}
      <div style={{
        background: st?.bg, borderRadius: 12, padding: 14, marginBottom: 16,
        border: `1px solid ${st?.color}`, textAlign: 'center',
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: st?.color }}>
          Status: {st?.label}
        </span>
        {req.status === 'aprovada' && req.data_aprovacao && (
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
            Aprovada em {new Date(req.data_aprovacao).toLocaleDateString('pt-BR')}
          </div>
        )}
      </div>

      {/* Detalhes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>Material Solicitado</div>
          <div style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{req.material_solicitado}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>Quantidade</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{req.quantidade || '-'}</div>
          </div>
          <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>Urgência</div>
            <div style={{
              fontSize: 14, fontWeight: 600,
              color: req.urgencia === 'urgente' ? '#DC2626' : '#1F2937',
            }}>
              {req.urgencia === 'urgente' ? 'Urgente' : 'Normal'}
            </div>
          </div>
        </div>

        {req.motivo && (
          <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>Motivo</div>
            <div style={{ fontSize: 14, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{req.motivo}</div>
          </div>
        )}

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>Criada em</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {new Date(req.created_at).toLocaleString('pt-BR')}
          </div>
        </div>

        {/* Editar (se pendente ou recusada) */}
        {podeEditar && !editando && (
          <button
            onClick={() => setEditando(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: '#EFF6FF', color: '#1E3A5F', borderRadius: 14,
              padding: '14px 0', fontSize: 14, fontWeight: 700,
              border: '2px solid #1E3A5F', cursor: 'pointer', marginTop: 8,
            }}
          >
            <RefreshCw size={16} /> Atualizar Requisição
          </button>
        )}

        {/* Form de edicao */}
        {editando && (
          <div style={{
            background: '#F0F7FF', borderRadius: 14, padding: 16,
            border: '1px solid #3B82F6', marginTop: 8,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F', marginBottom: 12 }}>
              Atualizar Requisição
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                Material
              </label>
              <textarea
                value={novoMaterial}
                onChange={(e) => setNovoMaterial(e.target.value)}
                rows={3}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                  border: '1.5px solid #E5E7EB', fontSize: 16, outline: 'none', resize: 'vertical',
                }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                Quantidade
              </label>
              <input
                type="text"
                value={novaQtd}
                onChange={(e) => setNovaQtd(e.target.value)}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                  border: '1.5px solid #E5E7EB', fontSize: 16, outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleAtualizar}
                disabled={saving}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12,
                  background: '#1E3A5F', color: '#fff', fontSize: 14,
                  fontWeight: 700, border: 'none', cursor: 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
              <button
                onClick={() => setEditando(false)}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12,
                  background: '#F3F4F6', color: '#6B7280', fontSize: 14,
                  fontWeight: 700, border: 'none', cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Status do cancelamento */}
        {req.cancelamento_solicitado && (
          <div style={{
            background: req.cancelamento_status === 'aprovado' ? '#F3F4F6'
              : req.cancelamento_status === 'recusado' ? '#FEF2F2'
              : '#FEF3C7',
            borderRadius: 14, padding: 16, marginTop: 8,
            border: `1.5px solid ${
              req.cancelamento_status === 'aprovado' ? '#D1D5DB'
              : req.cancelamento_status === 'recusado' ? '#FECACA'
              : '#FDE68A'
            }`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <AlertTriangle size={16} color={
                req.cancelamento_status === 'aprovado' ? '#6B7280'
                : req.cancelamento_status === 'recusado' ? '#DC2626'
                : '#D97706'
              } />
              <span style={{ fontSize: 14, fontWeight: 700, color:
                req.cancelamento_status === 'aprovado' ? '#6B7280'
                : req.cancelamento_status === 'recusado' ? '#DC2626'
                : '#92400E'
              }}>
                {req.cancelamento_status === 'aprovado' ? 'Cancelamento aprovado'
                  : req.cancelamento_status === 'recusado' ? 'Cancelamento recusado'
                  : 'Cancelamento pendente de aprovação'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
              <strong>Justificativa:</strong> {req.cancelamento_justificativa}
            </div>
          </div>
        )}

        {/* Botão solicitar cancelamento */}
        {podeCancelar && !showCancelar && (
          <button
            onClick={() => setShowCancelar(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: '#fff', color: '#DC2626', borderRadius: 14,
              padding: '14px 0', fontSize: 14, fontWeight: 700,
              border: '2px solid #DC2626', cursor: 'pointer', marginTop: 8,
              width: '100%',
            }}
          >
            <Trash2 size={16} /> Solicitar Cancelamento
          </button>
        )}

        {/* Form de cancelamento */}
        {showCancelar && (
          <div style={{
            background: '#FEF2F2', borderRadius: 14, padding: 16,
            border: '1.5px solid #FECACA', marginTop: 8,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#DC2626', marginBottom: 12 }}>
              Solicitar Cancelamento
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#991B1B', display: 'block', marginBottom: 4 }}>
                Justificativa *
              </label>
              <textarea
                value={justificativaCancelamento}
                onChange={(e) => setJustificativaCancelamento(e.target.value)}
                placeholder="Explique o motivo do cancelamento..."
                rows={3}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  border: '1.5px solid #FECACA', fontSize: 16, outline: 'none',
                  resize: 'vertical', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleSolicitarCancelamento}
                disabled={savingCancel || !justificativaCancelamento.trim()}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12,
                  background: !justificativaCancelamento.trim() ? '#D1D5DB' : '#DC2626',
                  color: '#fff', fontSize: 14,
                  fontWeight: 700, border: 'none', cursor: savingCancel ? 'wait' : 'pointer',
                  opacity: savingCancel ? 0.6 : 1,
                }}
              >
                {savingCancel ? 'Enviando...' : 'Confirmar Cancelamento'}
              </button>
              <button
                onClick={() => { setShowCancelar(false); setJustificativaCancelamento('') }}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12,
                  background: '#F3F4F6', color: '#6B7280', fontSize: 14,
                  fontWeight: 700, border: 'none', cursor: 'pointer',
                }}
              >
                Voltar
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ height: 20 }} />
    </div>
  )
}
