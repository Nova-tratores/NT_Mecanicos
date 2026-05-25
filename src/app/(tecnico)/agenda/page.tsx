'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { STATUS_AGENDA, TURNOS } from '@/lib/constants'
import type { AgendaItem } from '@/lib/types'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MapPin,
  Plus,
  X,
  Clock,
  AlertTriangle,
  CheckCircle,
  Send,
  Wrench,
  Package,
  StickyNote,
} from 'lucide-react'

interface MovimentacaoPPV {
  Id: number
  Id_PPV: string
  CodProduto: string
  Descricao: string
  Qtde: string
  Preco: number
  TipoMovimento: string
}

interface RequisicaoOS {
  id: number
  material_solicitado: string
  quantidade: string | null
  urgencia: string
  status: string
}

interface OsDetalhes {
  Tipo_Servico?: string | null
  Projeto?: string | null
  Revisao?: string | null
  ID_PPV?: string | null
  Qtd_HR?: number | null
  Qtd_KM?: number | null
  Serv_Solicitado?: string | null
  Status?: string | null
}

export default function AgendaTecnicoPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [items, setItems] = useState<AgendaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [semanaOffset, setSemanaOffset] = useState(0)
  const [diaSelecionado, setDiaSelecionado] = useState<string>('')
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [osCache, setOsCache] = useState<Record<string, OsDetalhes>>({})
  const [pecasCache, setPecasCache] = useState<Record<string, MovimentacaoPPV[]>>({})
  const [reqCache, setReqCache] = useState<Record<string, RequisicaoOS[]>>({})
  const [loadingDetails, setLoadingDetails] = useState<number | null>(null)

  // Form state
  const [cliente, setCliente] = useState('')
  const [descricao, setDescricao] = useState('')
  const [dataSugerida, setDataSugerida] = useState('')
  const [turno, setTurno] = useState<'manha' | 'tarde' | 'integral'>('manha')
  const [urgencia, setUrgencia] = useState<'normal' | 'urgente'>('normal')

  const hojeStr = new Date().toISOString().split('T')[0]

  // Semana de segunda a sábado
  const semana = useMemo(() => {
    const hoje = new Date()
    const day = hoje.getDay()
    const diff = hoje.getDate() - day + (day === 0 ? -6 : 1) + semanaOffset * 7
    const seg = new Date(hoje.getFullYear(), hoje.getMonth(), diff)
    seg.setHours(0, 0, 0, 0)
    const dias: Date[] = []
    for (let i = 0; i < 6; i++) {
      const d = new Date(seg)
      d.setDate(seg.getDate() + i)
      dias.push(d)
    }
    return dias
  }, [semanaOffset])

  // Selecionar "hoje" por padrão ao mudar de semana
  useEffect(() => {
    const hojeNaSemana = semana.find(d => d.toISOString().split('T')[0] === hojeStr)
    if (hojeNaSemana) {
      setDiaSelecionado(hojeStr)
    } else {
      setDiaSelecionado(semana[0].toISOString().split('T')[0])
    }
  }, [semana, hojeStr])

  useEffect(() => {
    if (!user) return
    const nome = user.nome_pos || user.tecnico_nome
    if (!nome) return

    const carregar = async () => {
      setLoading(true)
      const inicio = semana[0].toISOString().split('T')[0]
      const fim = semana[semana.length - 1].toISOString().split('T')[0]

      const { data: agendaData } = await supabase
        .from('agenda_tecnico')
        .select('*')
        .eq('tecnico_nome', nome)
        .gte('data_agendada', inicio)
        .lte('data_agendada', fim)
        .order('data_agendada')
        .order('hora_inicio')

      setItems((agendaData || []) as AgendaItem[])
      setLoading(false)
    }
    carregar()

    // Realtime: atualizar quando admin mudar a agenda
    const ch = supabase.channel('agenda_tec_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_tecnico' }, () => carregar())
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [semana, user])

  const toggleExpand = useCallback(async (item: AgendaItem) => {
    if (expandedId === item.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(item.id)

    if (!item.id_ordem) return
    setLoadingDetails(item.id)

    if (!osCache[item.id_ordem]) {
      const { data: os } = await supabase
        .from('Ordem_Servico')
        .select('Tipo_Servico, Projeto, Revisao, ID_PPV, Qtd_HR, Qtd_KM, Serv_Solicitado, Status')
        .eq('Id_Ordem', item.id_ordem)
        .single()
      if (os) {
        setOsCache(prev => ({ ...prev, [item.id_ordem!]: os as OsDetalhes }))
        if (os.ID_PPV && !pecasCache[os.ID_PPV]) {
          const { data: movs } = await supabase
            .from('movimentacoes')
            .select('*')
            .eq('Id_PPV', os.ID_PPV)
          setPecasCache(prev => ({ ...prev, [os.ID_PPV as string]: (movs || []) as MovimentacaoPPV[] }))
        }
      }
    }

    if (!reqCache[item.id_ordem]) {
      const { data: reqs } = await supabase
        .from('mecanico_requisicoes')
        .select('id, material_solicitado, quantidade, urgencia, status')
        .eq('id_ordem', item.id_ordem)
      setReqCache(prev => ({ ...prev, [item.id_ordem!]: (reqs || []) as RequisicaoOS[] }))
    }

    setLoadingDetails(null)
  }, [expandedId, osCache, pecasCache, reqCache])

  const resetForm = () => {
    setCliente('')
    setDescricao('')
    setDataSugerida('')
    setTurno('manha')
    setUrgencia('normal')
  }

  const handleSubmit = async () => {
    if (!user || !cliente.trim() || !descricao.trim() || !dataSugerida) return

    setSubmitting(true)
    const tecnicoNome = user.nome_pos || user.tecnico_nome

    try {
      const { error: insertError } = await supabase
        .from('solicitacao_agendamento')
        .insert({
          tecnico_nome: tecnicoNome,
          cliente: cliente.trim(),
          descricao: descricao.trim(),
          data_sugerida: dataSugerida,
          turno,
          urgencia,
          status: 'pendente',
        })

      if (insertError) {
        console.error('Erro ao solicitar agendamento:', insertError)
        alert('Erro ao enviar solicitação. Tente novamente.')
        setSubmitting(false)
        return
      }

      const { data: admins } = await supabase
        .from('mecanico_usuarios')
        .select('tecnico_nome')
        .eq('role', 'admin')

      if (admins && admins.length > 0) {
        const notificacoes = admins.map((admin) => ({
          tecnico_nome: admin.tecnico_nome,
          tipo: 'solicitacao_agendamento',
          titulo: `${tecnicoNome} solicitou agendamento`,
          descricao: `Cliente: ${cliente.trim()} - ${descricao.trim()}`,
          link: '/admin/agenda',
          lida: false,
        }))
        await supabase.from('mecanico_notificacoes').insert(notificacoes)
      }

      setSuccessMsg('Solicitação enviada!')
      resetForm()
      setShowForm(false)
      setTimeout(() => setSuccessMsg(''), 4000)
    } catch (err) {
      console.error('Erro:', err)
      alert('Erro ao enviar solicitação.')
    } finally {
      setSubmitting(false)
    }
  }

  const diasNomes = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']

  const itensDoDia = useMemo(() => {
    if (!diaSelecionado) return []
    return items.filter(i => i.data_agendada === diaSelecionado)
  }, [items, diaSelecionado])

  const contagemPorDia = useMemo(() => {
    const map: Record<string, number> = {}
    for (const item of items) {
      map[item.data_agendada] = (map[item.data_agendada] || 0) + 1
    }
    return map
  }, [items])

  if (userLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1F2937', margin: 0 }}>Agenda</h1>
        <button
          onClick={() => { setShowForm(true); setSuccessMsg('') }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#C41E2A', color: '#fff', border: 'none',
            borderRadius: 10, padding: '8px 14px', fontSize: 13,
            fontWeight: 700, cursor: 'pointer',
          }}
        >
          <Plus size={16} /> Solicitar
        </button>
      </div>

      {successMsg && (
        <div style={{
          background: '#D1FAE5', color: '#065F46', borderRadius: 12,
          padding: '10px 14px', fontSize: 13, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <CheckCircle size={16} /> {successMsg}
        </div>
      )}

      {/* Navegacao da semana */}
      <div style={{
        background: '#fff', borderRadius: 16, padding: '12px 8px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 12, padding: '0 8px',
        }}>
          <button onClick={() => setSemanaOffset(s => s - 1)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 6,
            borderRadius: 8, display: 'flex',
          }}>
            <ChevronLeft size={20} color="#6B7280" />
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1F2937', textTransform: 'capitalize' }}>
              {semana[2].toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </div>
            {semanaOffset !== 0 && (
              <button
                onClick={() => setSemanaOffset(0)}
                style={{
                  fontSize: 11, color: '#C41E2A', fontWeight: 600,
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  marginTop: 2,
                }}
              >
                Voltar para hoje
              </button>
            )}
          </div>
          <button onClick={() => setSemanaOffset(s => s + 1)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 6,
            borderRadius: 8, display: 'flex',
          }}>
            <ChevronRight size={20} color="#6B7280" />
          </button>
        </div>

        {/* Dias da semana */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
          {semana.map((d) => {
            const dStr = d.toISOString().split('T')[0]
            const isHoje = dStr === hojeStr
            const isSelecionado = dStr === diaSelecionado
            const qtd = contagemPorDia[dStr] || 0

            return (
              <button
                key={dStr}
                onClick={() => setDiaSelecionado(dStr)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '8px 4px', borderRadius: 12, border: 'none',
                  cursor: 'pointer', transition: 'all 0.15s',
                  background: isSelecionado ? '#C41E2A' : isHoje ? '#FEF2F2' : 'transparent',
                  position: 'relative',
                }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 600, marginBottom: 4,
                  color: isSelecionado ? 'rgba(255,255,255,0.7)' : '#9CA3AF',
                }}>
                  {diasNomes[d.getDay()]}
                </span>
                <span style={{
                  fontSize: 18, fontWeight: 700,
                  color: isSelecionado ? '#fff' : isHoje ? '#C41E2A' : '#1F2937',
                }}>
                  {d.getDate()}
                </span>
                {qtd > 0 && (
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%', marginTop: 4,
                    background: isSelecionado ? '#fff' : '#C41E2A',
                  }} />
                )}
                {qtd === 0 && <div style={{ width: 6, height: 6, marginTop: 4 }} />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Itens do dia selecionado */}
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 10,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
            {diaSelecionado === hojeStr ? 'Hoje' : diaSelecionado ? new Date(diaSelecionado + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }) : ''}
          </span>
          <span style={{
            fontSize: 12, fontWeight: 700, color: '#9CA3AF',
          }}>
            {itensDoDia.length} {itensDoDia.length === 1 ? 'item' : 'itens'}
          </span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : itensDoDia.length === 0 ? (
          <div style={{
            background: '#fff', borderRadius: 16, padding: '40px 20px',
            textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>📅</div>
            <div style={{ fontSize: 14, color: '#9CA3AF', fontWeight: 500 }}>
              Nada agendado para este dia
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {itensDoDia.map((item, idx) => {
              const isExpanded = expandedId === item.id
              const isLoadingThis = loadingDetails === item.id
              const os = item.id_ordem ? osCache[item.id_ordem] : undefined
              const pecas = os?.ID_PPV ? (pecasCache[os.ID_PPV] || []) : []
              const requisicoes = item.id_ordem ? (reqCache[item.id_ordem] || []) : []
              const st = STATUS_AGENDA[item.status as keyof typeof STATUS_AGENDA]
              const turnoInfo = TURNOS[item.turno as keyof typeof TURNOS]

              return (
                <div
                  key={item.id}
                  style={{
                    background: '#fff', borderRadius: 16, overflow: 'hidden',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                    borderLeft: `4px solid ${st?.color || '#9CA3AF'}`,
                  }}
                >
                  {/* Card principal */}
                  <div
                    onClick={() => toggleExpand(item)}
                    style={{
                      padding: '14px 16px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}
                  >
                    {/* Badge de sequencia */}
                    <div style={{
                      width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                      background: '#FEF2F2', color: '#C41E2A',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 15, fontWeight: 800,
                    }}>
                      {idx + 1}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                        {item.id_ordem && (
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#C41E2A' }}>
                            {item.id_ordem}
                          </span>
                        )}
                        {st && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                            background: st.bg, color: st.color,
                          }}>
                            {st.label}
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: 14, fontWeight: 600, color: '#1F2937',
                        marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {item.cliente || 'Servico'}
                      </div>
                      {item.descricao && (
                        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.descricao}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        {item.endereco && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <MapPin size={11} /> {item.endereco}
                          </span>
                        )}
                        {turnoInfo && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Clock size={11} /> {turnoInfo.label}
                            {item.hora_inicio ? ` ${item.hora_inicio}` : ''}
                            {item.hora_fim ? ` - ${item.hora_fim}` : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expand arrow */}
                    <div style={{ flexShrink: 0 }}>
                      {isExpanded
                        ? <ChevronUp size={18} color="#9CA3AF" />
                        : <ChevronDown size={18} color="#9CA3AF" />
                      }
                    </div>
                  </div>

                  {/* Expandido */}
                  {isExpanded && (
                    <div style={{
                      padding: '0 16px 16px',
                      borderTop: '1px solid #F3F4F6',
                    }}>
                      {isLoadingThis && (
                        <div style={{ textAlign: 'center', padding: 12 }}>
                          <div className="spinner" style={{ margin: '0 auto', width: 20, height: 20 }} />
                        </div>
                      )}

                      {/* Grid de info da OS */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px',
                        padding: '14px 0', fontSize: 13,
                      }}>
                        {os?.Tipo_Servico && (
                          <div>
                            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>Tipo</div>
                            <div style={{ fontWeight: 600, color: '#1F2937' }}>{os.Tipo_Servico}</div>
                          </div>
                        )}
                        {os?.Projeto && (
                          <div>
                            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>Projeto</div>
                            <div style={{ fontWeight: 600, color: '#1F2937' }}>{os.Projeto}</div>
                          </div>
                        )}
                        {os?.Revisao && (
                          <div>
                            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>Revisão</div>
                            <div style={{ fontWeight: 600, color: '#1F2937' }}>{os.Revisao}</div>
                          </div>
                        )}
                        {os?.ID_PPV && (
                          <div>
                            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>PPV</div>
                            <div style={{ fontWeight: 600, color: '#1E3A5F' }}>{os.ID_PPV}</div>
                          </div>
                        )}
                        {os?.Qtd_HR != null && os.Qtd_HR > 0 && (
                          <div>
                            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>Horas OS</div>
                            <div style={{ fontWeight: 600, color: '#1F2937' }}>{os.Qtd_HR}h</div>
                          </div>
                        )}
                        {os?.Qtd_KM != null && os.Qtd_KM > 0 && (
                          <div>
                            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>KM prev.</div>
                            <div style={{ fontWeight: 600, color: '#1F2937' }}>{os.Qtd_KM} km</div>
                          </div>
                        )}
                        {item.endereco && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>Endereço</div>
                            <div style={{ fontWeight: 500, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <MapPin size={12} /> {item.endereco}
                            </div>
                          </div>
                        )}
                        {os?.Serv_Solicitado && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>Serviço solicitado</div>
                            <div style={{ fontWeight: 500, color: '#374151', lineHeight: 1.4 }}>
                              {os.Serv_Solicitado}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Pecas */}
                      {pecas.length > 0 && (
                        <div style={{
                          background: '#FFF7ED', borderRadius: 12, padding: 14, marginTop: 8,
                        }}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
                            fontSize: 11, fontWeight: 700, color: '#C2410C', textTransform: 'uppercase',
                          }}>
                            <Package size={13} /> Pecas ({pecas.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {pecas.map((p, pidx) => (
                              <div key={pidx} style={{
                                background: '#fff', borderRadius: 8, padding: '8px 10px',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                border: '1px solid #FED7AA', fontSize: 13,
                              }}>
                                <div>
                                  <div style={{ fontWeight: 600, color: '#1F2937' }}>{p.Descricao || p.CodProduto}</div>
                                  {p.CodProduto && p.Descricao && (
                                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>Cod: {p.CodProduto}</div>
                                  )}
                                </div>
                                <span style={{ fontWeight: 700, color: '#C2410C' }}>x{p.Qtde}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Requisicoes */}
                      {requisicoes.length > 0 && (
                        <div style={{
                          background: '#F0F9FF', borderRadius: 12, padding: 14, marginTop: 8,
                        }}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
                            fontSize: 11, fontWeight: 700, color: '#0369A1', textTransform: 'uppercase',
                          }}>
                            <Wrench size={13} /> Requisicoes ({requisicoes.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {requisicoes.map((r) => (
                              <div key={r.id} style={{
                                background: '#fff', borderRadius: 8, padding: '8px 10px',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                border: '1px solid #BAE6FD', fontSize: 13,
                              }}>
                                <div>
                                  <div style={{ fontWeight: 600, color: '#1F2937' }}>{r.material_solicitado}</div>
                                  {r.quantidade && <div style={{ fontSize: 11, color: '#9CA3AF' }}>Qtd: {r.quantidade}</div>}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {r.urgencia === 'urgente' && <AlertTriangle size={12} color="#DC2626" />}
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                    background: r.status === 'aprovada' ? '#D1FAE5' : r.status === 'recusada' ? '#FEE2E2' : '#FEF3C7',
                                    color: r.status === 'aprovada' ? '#065F46' : r.status === 'recusada' ? '#DC2626' : '#92400E',
                                  }}>
                                    {r.status}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal Solicitar Agendamento */}
      {showForm && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
          onClick={() => { setShowForm(false); resetForm() }}
        >
          <div
            style={{
              background: '#fff', borderRadius: '20px 20px 0 0', padding: '20px 20px 32px',
              width: '100%', maxWidth: 500, maxHeight: '85vh', overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              width: 40, height: 4, borderRadius: 2, background: '#D1D5DB',
              margin: '0 auto 16px',
            }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1F2937', margin: 0 }}>
                Solicitar Agendamento
              </h2>
              <button
                onClick={() => { setShowForm(false); resetForm() }}
                style={{
                  width: 32, height: 32, borderRadius: 8, border: 'none',
                  background: '#F3F4F6', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <X size={16} color="#6B7280" />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>Cliente *</label>
                <input type="text" value={cliente} onChange={(e) => setCliente(e.target.value)}
                  placeholder="Nome do cliente"
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 12,
                    border: '2px solid #E5E7EB', fontSize: 15, outline: 'none',
                    background: '#FAFAFA', boxSizing: 'border-box',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#C41E2A'}
                  onBlur={(e) => e.target.style.borderColor = '#E5E7EB'}
                />
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>Descricao do servico *</label>
                <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Descreva o servico a ser realizado" rows={2}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 12,
                    border: '2px solid #E5E7EB', fontSize: 15, outline: 'none',
                    background: '#FAFAFA', boxSizing: 'border-box', resize: 'none',
                    fontFamily: 'inherit',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#C41E2A'}
                  onBlur={(e) => e.target.style.borderColor = '#E5E7EB'}
                />
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>Data sugerida *</label>
                <input type="date" value={dataSugerida} onChange={(e) => setDataSugerida(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 12,
                    border: '2px solid #E5E7EB', fontSize: 15, outline: 'none',
                    background: '#FAFAFA', boxSizing: 'border-box',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#C41E2A'}
                  onBlur={(e) => e.target.style.borderColor = '#E5E7EB'}
                />
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>Turno</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[
                    { value: 'manha', label: 'Manha' },
                    { value: 'tarde', label: 'Tarde' },
                    { value: 'integral', label: 'Integral' },
                  ].map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTurno(t.value as 'manha' | 'tarde' | 'integral')}
                      style={{
                        padding: '10px 8px', borderRadius: 10, fontSize: 13,
                        fontWeight: 600, cursor: 'pointer', border: 'none',
                        background: turno === t.value ? '#1E3A5F' : '#F3F4F6',
                        color: turno === t.value ? '#fff' : '#6B7280',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>Urgencia</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button type="button" onClick={() => setUrgencia('normal')}
                    style={{
                      padding: '10px', borderRadius: 10, fontSize: 13,
                      fontWeight: 600, cursor: 'pointer', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: urgencia === 'normal' ? '#1E3A5F' : '#F3F4F6',
                      color: urgencia === 'normal' ? '#fff' : '#6B7280',
                    }}
                  >
                    <Clock size={14} /> Normal
                  </button>
                  <button type="button" onClick={() => setUrgencia('urgente')}
                    style={{
                      padding: '10px', borderRadius: 10, fontSize: 13,
                      fontWeight: 600, cursor: 'pointer', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: urgencia === 'urgente' ? '#C41E2A' : '#F3F4F6',
                      color: urgencia === 'urgente' ? '#fff' : '#6B7280',
                    }}
                  >
                    <AlertTriangle size={14} /> Urgente
                  </button>
                </div>
              </div>

              <button onClick={handleSubmit}
                disabled={submitting || !cliente.trim() || !descricao.trim() || !dataSugerida}
                style={{
                  width: '100%', padding: '14px 0', borderRadius: 14, marginTop: 4,
                  background: submitting || !cliente.trim() || !descricao.trim() || !dataSugerida ? '#D1D5DB' : '#C41E2A',
                  color: '#fff', border: 'none', fontSize: 16, fontWeight: 700,
                  cursor: submitting || !cliente.trim() || !descricao.trim() || !dataSugerida ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {submitting ? (
                  <><div className="spinner" style={{ width: 18, height: 18 }} /> Enviando...</>
                ) : (
                  <><Send size={16} /> Enviar Solicitacao</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
