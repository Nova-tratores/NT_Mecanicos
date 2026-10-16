'use client'
import { useEffect, useState } from 'react'
import { supabase, fetchAll } from '@/lib/supabase'
import { STATUS_REQUISICAO } from '@/lib/constants'
import type { MecanicoRequisicao } from '@/lib/types'
import { AlertTriangle, Package, User, Trash2 } from 'lucide-react'
import Link from 'next/link'

export default function RequisicoesPage() {
  const [items, setItems] = useState<MecanicoRequisicao[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<'todas' | 'pendente' | 'aprovada' | 'recusada'>('todas')
  const [tecnicoFiltro, setTecnicoFiltro] = useState<string>('todos')
  const [tecnicos, setTecnicos] = useState<string[]>([])

  useEffect(() => {
    const carregar = async () => {
      try {
        // Paginado (limite de 1000 linhas do PostgREST)
        const list = await fetchAll<MecanicoRequisicao>('mecanico_requisicoes', {
          order: { column: 'created_at', ascending: false },
        })
        setItems(list)

        const nomes = [...new Set(list.map((r) => r.tecnico_nome).filter(Boolean))].sort()
        setTecnicos(nomes)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    carregar()

    const channel = supabase
      .channel('req_list_admin')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'mecanico_requisicoes',
      }, () => carregar())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const filtered = items.filter((i) => {
    if (filtro !== 'todas' && i.status !== filtro) return false
    if (tecnicoFiltro !== 'todos' && i.tecnico_nome !== tecnicoFiltro) return false
    return true
  })

  const pendentesTotal = items.filter((i) => i.status === 'pendente').length
  const cancelamentosTotal = items.filter((i) => i.cancelamento_solicitado && i.cancelamento_status === 'pendente').length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E3A5F' }}>Todas as Requisicoes</h1>
      </div>

      {/* Alert for pending */}
      {pendentesTotal > 0 && (
        <div style={{
          background: '#FEF3C7', borderRadius: 12, padding: 14,
          marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
          border: '1px solid #F59E0B',
        }}>
          <AlertTriangle size={20} color="#D97706" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>
              {pendentesTotal} requisicao(oes) pendente(s) de aprovacao
            </div>
          </div>
        </div>
      )}

      {/* Alert for cancellations */}
      {cancelamentosTotal > 0 && (
        <div style={{
          background: '#FEF2F2', borderRadius: 12, padding: 14,
          marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
          border: '1px solid #FECACA',
        }}>
          <Trash2 size={20} color="#DC2626" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B' }}>
              {cancelamentosTotal} solicitação(ões) de cancelamento pendente(s)
            </div>
          </div>
        </div>
      )}

      {/* Filtro por tecnico */}
      <div style={{ marginBottom: 12 }}>
        <select
          value={tecnicoFiltro}
          onChange={(e) => setTecnicoFiltro(e.target.value)}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 10,
            border: '1.5px solid #E5E7EB', fontSize: 13, background: '#fff',
          }}
        >
          <option value="todos">Todos os tecnicos</option>
          {tecnicos.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto' }} className="no-scrollbar">
        {(['todas', 'pendente', 'aprovada', 'recusada'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            style={{
              padding: '8px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              background: filtro === f ? '#1E3A5F' : '#F3F4F6',
              color: filtro === f ? '#fff' : '#6B7280',
            }}
          >
            {f === 'todas' ? 'Todas' : STATUS_REQUISICAO[f].label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: 14, padding: 40, textAlign: 'center',
          color: '#9CA3AF', fontSize: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          <Package size={32} color="#D1D5DB" style={{ margin: '0 auto 12px' }} />
          Nenhuma requisicao encontrada
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((req) => {
            const st = STATUS_REQUISICAO[req.status as keyof typeof STATUS_REQUISICAO]
            return (
              <Link key={req.id} href={`/admin/requisicoes/${req.id}`} style={{
                background: '#fff', borderRadius: 14, padding: 16,
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                borderLeft: `4px solid ${st?.color || '#9CA3AF'}`,
                textDecoration: 'none', color: 'inherit',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>
                    {req.id_ordem || 'Sem OS'}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                    background: st?.bg, color: st?.color,
                  }}>
                    {st?.label}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{req.material_solicitado}</div>
                <div style={{ fontSize: 12, color: '#1E3A5F', fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <User size={12} /> {req.tecnico_nome}
                </div>
                {req.quantidade && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                    Qtd: {req.quantidade}
                  </div>
                )}
                {req.cancelamento_solicitado && req.cancelamento_status === 'pendente' && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginTop: 6,
                    fontSize: 11, fontWeight: 700, color: '#DC2626',
                    background: '#FEF2F2', borderRadius: 6, padding: '4px 8px',
                  }}>
                    <Trash2 size={11} /> Cancelamento pendente
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#9CA3AF' }}>
                  <span>{req.urgencia === 'urgente' ? 'Urgente' : 'Normal'}</span>
                  <span>{new Date(req.created_at).toLocaleDateString('pt-BR')}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
