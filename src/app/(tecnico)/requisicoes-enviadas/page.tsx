'use client'
import { useState, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import { cacheInvalidate } from '@/lib/cache'
import { fmtData } from '@/lib/garantias/format'
import { ChevronRight, ClipboardList, XCircle } from 'lucide-react'
import Link from 'next/link'

interface Requisicao {
  id: number
  titulo: string
  tipo: string
  solicitante: string
  data: string
  status: string
  obs: string | null
}

const statusConfig: Record<string, { label: string; bg: string; color: string }> = {
  pedido: { label: 'Pedido', bg: '#FEF3C7', color: '#D97706' },
  completa: { label: 'Completa', bg: '#D1FAE5', color: '#059669' },
  cancelada: { label: 'Cancelada', bg: '#FEE2E2', color: '#DC2626' },
  cancelar: { label: 'Cancelamento solicitado', bg: '#FEE2E2', color: '#DC2626' },
}

async function fetchReqEnviadas(nome: string, tecnicoNome: string): Promise<Requisicao[]> {
  const { data, error } = await supabase
    .from('Requisicao')
    .select('*')
    .or(`solicitante.ilike.%${nome}%,solicitante.eq.${tecnicoNome}`)
    .eq('status', 'pedido')
    .order('data', { ascending: false })
  // Lança em falha de rede: o useCached cai no cache em vez de gravar lista vazia
  if (error) throw new Error(error.message)
  return (data || []) as Requisicao[]
}

export default function RequisicoesEnviadas() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''
  const cacheKey = `req-enviadas:${nome}`

  const { data: requisicoes, loading, refreshing, refresh } = useCached<Requisicao[]>(
    cacheKey,
    () => fetchReqEnviadas(nome, user?.tecnico_nome || ''),
    { skip: !user },
  )

  const [cancelando, setCancelando] = useState<number | null>(null)
  const cancelandoRef = useRef(false)

  const solicitarCancelamento = async (id: number) => {
    // Guarda síncrona contra toque duplo (o disabled só vale após o re-render)
    if (cancelandoRef.current) return
    const confirmar = window.confirm('Tem certeza que deseja solicitar o cancelamento desta requisição?')
    if (!confirmar) return

    cancelandoRef.current = true
    setCancelando(id)
    try {
      // offlineWrite: sem sinal, enfileira e envia quando a conexão voltar
      const res = await offlineWrite({
        table: 'Requisicao', action: 'update', data: { status: 'cancelar' }, match: { id },
      })
      if (!res.ok) {
        alert('Erro ao solicitar cancelamento. Tente novamente.')
      } else {
        if (res.queued) alert('Sem sinal agora — o pedido de cancelamento será enviado assim que a conexão voltar.')
        cacheInvalidate(cacheKey)
        refresh()
      }
    } catch (err) {
      console.error('[req-enviadas] cancelar:', err)
      alert('Erro ao solicitar cancelamento. Verifique o sinal e tente novamente.')
    } finally {
      cancelandoRef.current = false
      setCancelando(null)
    }
  }

  const getStatus = (status: string) => {
    return statusConfig[status] || { label: status, bg: '#F3F4F6', color: '#6B7280' }
  }

  return (
    <div>
      {refreshing && <div className="refresh-bar" />}

      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#C41E2A', margin: '0 0 20px' }}>
        Requisições Enviadas
      </h1>

      <div style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12 }}>
        Minhas Requisições ({requisicoes?.length || 0})
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : !requisicoes || requisicoes.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: 18, padding: 48, textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, background: '#F3F4F6',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <ClipboardList size={36} color="#D1D5DB" />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>
            Nenhuma requisição enviada
          </div>
          <div style={{ fontSize: 14, color: '#9CA3AF' }}>
            Suas requisições aparecerão aqui
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {requisicoes.map((req) => {
            const st = getStatus(req.status)
            const podeCancelar = req.status === 'pedido'

            return (
              <div key={req.id} style={{
                background: '#fff', borderRadius: 16, padding: '18px 16px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
                borderLeft: `5px solid ${st.color}`,
              }}>
                <Link href={`/requisicoes/atualizar/${req.id}`} style={{
                  textDecoration: 'none', color: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#C41E2A' }}>
                        #{req.id}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
                        background: st.bg, color: st.color,
                      }}>
                        {st.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {req.titulo}
                    </div>
                    <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
                      {req.tipo} {req.data ? ` - ${fmtData(req.data)}` : ''}
                    </div>
                    {req.obs && (
                      <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4, overflowWrap: 'anywhere' }}>
                        {req.obs}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={20} color="#D1D5DB" style={{ flexShrink: 0 }} />
                </Link>

                {podeCancelar && (
                  <button
                    onClick={() => solicitarCancelamento(req.id)}
                    disabled={cancelando === req.id}
                    style={{
                      marginTop: 12, width: '100%', padding: '10px 0', minHeight: 44,
                      borderRadius: 10, border: '1.5px solid #DC2626',
                      background: cancelando === req.id ? '#FEE2E2' : '#fff',
                      color: '#DC2626', fontSize: 14, fontWeight: 700,
                      cursor: cancelando === req.id ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                  >
                    <XCircle size={16} />
                    {cancelando === req.id ? 'Cancelando...' : 'Solicitar Cancelamento'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
