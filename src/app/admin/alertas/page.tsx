'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAdmin } from '@/hooks/useAdmin'
import { varrerAlertas, getLabelTipo } from '@/lib/alertas'
import type { MecanicoAlerta, MecanicoOcorrencia, AlertaSeveridade } from '@/lib/types'
import {
  AlertTriangle, Shield, Clock, Search, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Plus, RefreshCw, Filter, User, Star,
} from 'lucide-react'

type Aba = 'alertas' | 'ocorrencias' | 'historico'

const SEV_STYLE: Record<AlertaSeveridade, { bg: string; color: string; label: string }> = {
  critica: { bg: '#FEE2E2', color: '#991B1B', label: 'Critica' },
  alta: { bg: '#FEF3C7', color: '#92400E', label: 'Alta' },
  media: { bg: '#DBEAFE', color: '#1E40AF', label: 'Media' },
  baixa: { bg: '#F3F4F6', color: '#374151', label: 'Baixa' },
}

export default function AlertasPage() {
  const { admin } = useAdmin()
  const [aba, setAba] = useState<Aba>('alertas')
  const [alertas, setAlertas] = useState<MecanicoAlerta[]>([])
  const [ocorrencias, setOcorrencias] = useState<MecanicoOcorrencia[]>([])
  const [historico, setHistorico] = useState<MecanicoAlerta[]>([])
  const [loading, setLoading] = useState(true)
  const [varrendo, setVarrendo] = useState(false)
  const [expandido, setExpandido] = useState<number | null>(null)
  const [comentario, setComentario] = useState('')
  const [filtroTecnico, setFiltroTecnico] = useState('')
  const [filtroMes, setFiltroMes] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [tecnicos, setTecnicos] = useState<string[]>([])

  // Form manual
  const [mostrarFormManual, setMostrarFormManual] = useState(false)
  const [manual, setManual] = useState({
    tecnico_nome: '', descricao: '', pontos: 3, data_referencia: new Date().toISOString().split('T')[0], id_ordem: '',
  })

  const carregar = useCallback(async () => {
    setLoading(true)
    const [{ data: alertaData }, { data: histData }, { data: tecData }] = await Promise.all([
      supabase.from('mecanico_alertas').select('*').eq('status', 'pendente').order('created_at', { ascending: false }),
      supabase.from('mecanico_alertas').select('*').eq('status', 'ignorado').order('resolvido_em', { ascending: false }).limit(200),
      supabase.from('mecanico_usuarios').select('tecnico_nome').eq('ativo', true).order('tecnico_nome'),
    ])
    setAlertas((alertaData || []) as MecanicoAlerta[])
    setHistorico((histData || []) as MecanicoAlerta[])
    setTecnicos((tecData || []).map(t => t.tecnico_nome))
    setLoading(false)
  }, [])

  const carregarOcorrencias = useCallback(async () => {
    const [ano, mes] = filtroMes.split('-').map(Number)
    const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`
    const fim = `${ano}-${String(mes + 1 > 12 ? 1 : mes + 1).padStart(2, '0')}-01`
    let q = supabase.from('mecanico_ocorrencias').select('*')
      .gte('data_referencia', inicio).lt('data_referencia', fim)
      .order('created_at', { ascending: false })
    if (filtroTecnico) q = q.eq('tecnico_nome', filtroTecnico)
    const { data } = await q
    setOcorrencias((data || []) as MecanicoOcorrencia[])
  }, [filtroMes, filtroTecnico])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { if (aba === 'ocorrencias') carregarOcorrencias() }, [aba, carregarOcorrencias])

  const executarVarredura = async () => {
    setVarrendo(true)
    const hoje = new Date()
    const inicio = new Date(hoje)
    inicio.setDate(inicio.getDate() - 7)
    const novos = await varrerAlertas(
      inicio.toISOString().split('T')[0],
      hoje.toISOString().split('T')[0]
    )
    await carregar()
    setVarrendo(false)
    alert(`Varredura concluída: ${novos} novo(s) alerta(s) encontrado(s)`)
  }

  const resolverAlerta = async (alerta: MecanicoAlerta, virarOcorrencia: boolean) => {
    const novoStatus = virarOcorrencia ? 'ocorrencia' : 'ignorado'
    await supabase.from('mecanico_alertas').update({
      status: novoStatus,
      admin_nome: admin?.tecnico_nome || 'Admin',
      admin_comentario: comentario || null,
      resolvido_em: new Date().toISOString(),
    }).eq('id', alerta.id)

    if (virarOcorrencia) {
      await supabase.from('mecanico_ocorrencias').insert({
        tecnico_nome: alerta.tecnico_nome,
        tipo: alerta.tipo,
        descricao: alerta.descricao + (comentario ? ` | Admin: ${comentario}` : ''),
        pontos: alerta.pontos,
        data_referencia: alerta.data_referencia,
        id_ordem: alerta.id_ordem,
        id_alerta: alerta.id,
        admin_nome: admin?.tecnico_nome || 'Admin',
      })
    }

    setExpandido(null)
    setComentario('')
    await carregar()
    if (aba === 'ocorrencias') await carregarOcorrencias()
  }

  const criarManual = async () => {
    if (!manual.tecnico_nome || !manual.descricao.trim()) {
      alert('Preencha técnico e descrição')
      return
    }
    await supabase.from('mecanico_ocorrencias').insert({
      tecnico_nome: manual.tecnico_nome,
      tipo: 'manual',
      descricao: manual.descricao,
      pontos: manual.pontos,
      data_referencia: manual.data_referencia,
      id_ordem: manual.id_ordem || null,
      id_alerta: null,
      admin_nome: admin?.tecnico_nome || 'Admin',
    })
    setManual({ tecnico_nome: '', descricao: '', pontos: 3, data_referencia: new Date().toISOString().split('T')[0], id_ordem: '' })
    setMostrarFormManual(false)
    await carregarOcorrencias()
  }

  // Agrupar ocorrências por técnico para ranking
  const ranking = (() => {
    const map = new Map<string, { pontos: number; qtd: number }>()
    for (const o of ocorrencias) {
      const r = map.get(o.tecnico_nome) || { pontos: 0, qtd: 0 }
      r.pontos += o.pontos
      r.qtd++
      map.set(o.tecnico_nome, r)
    }
    return Array.from(map.entries())
      .map(([nome, { pontos, qtd }]) => ({ nome, pontos, qtd }))
      .sort((a, b) => b.pontos - a.pontos)
  })()

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 10,
    border: '1.5px solid #E5E7EB', fontSize: 14, outline: 'none',
    background: '#fff', boxSizing: 'border-box',
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E3A5F', margin: 0 }}>Alertas e Ocorrencias</h1>
        <button onClick={executarVarredura} disabled={varrendo} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: varrendo ? '#9CA3AF' : '#1E3A5F', color: '#fff',
          border: 'none', borderRadius: 10, padding: '8px 14px',
          fontSize: 12, fontWeight: 700, cursor: varrendo ? 'default' : 'pointer',
        }}>
          <RefreshCw size={14} className={varrendo ? 'spin' : ''} />
          {varrendo ? 'Varrendo...' : 'Varrer 7 dias'}
        </button>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#F3F4F6', borderRadius: 12, padding: 4 }}>
        {([
          { key: 'alertas' as Aba, label: 'Alertas', icon: AlertTriangle, count: alertas.length },
          { key: 'ocorrencias' as Aba, label: 'Ocorrencias', icon: Shield, count: null },
          { key: 'historico' as Aba, label: 'Historico', icon: Clock, count: null },
        ]).map((t) => {
          const Icon = t.icon
          const active = aba === t.key
          return (
            <button key={t.key} onClick={() => setAba(t.key)} style={{
              flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
              background: active ? '#fff' : 'transparent',
              color: active ? '#1E3A5F' : '#6B7280',
              fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
            }}>
              <Icon size={14} />
              {t.label}
              {t.count != null && t.count > 0 && (
                <span style={{
                  background: '#EF4444', color: '#fff', fontSize: 10, fontWeight: 700,
                  borderRadius: 8, minWidth: 18, height: 18, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                }}>{t.count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ===== ABA ALERTAS ===== */}
      {aba === 'alertas' && (
        <div>
          {alertas.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: 48, background: '#fff', borderRadius: 16,
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }}>
              <CheckCircle size={40} color="#10B981" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontSize: 16, fontWeight: 600, color: '#059669' }}>Nenhum alerta pendente</div>
              <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 4 }}>Clique em "Varrer 7 dias" para buscar irregularidades</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {alertas.map((a) => {
                const sev = SEV_STYLE[a.severidade]
                const isExp = expandido === a.id
                return (
                  <div key={a.id} style={{
                    background: '#fff', borderRadius: 14, overflow: 'hidden',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                    border: isExp ? `2px solid ${sev.color}` : '1px solid #E5E7EB',
                  }}>
                    <button type="button" onClick={() => { setExpandido(isExp ? null : a.id); setComentario('') }} style={{
                      width: '100%', padding: '12px 14px', border: 'none', cursor: 'pointer',
                      background: isExp ? sev.bg : '#fff', textAlign: 'left',
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                    }}>
                      <div style={{
                        padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                        background: sev.bg, color: sev.color, flexShrink: 0, marginTop: 2,
                      }}>{sev.label}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1F2937' }}>{getLabelTipo(a.tipo)}</div>
                        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{a.tecnico_nome} — {a.descricao}</div>
                        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>
                          {new Date(a.data_referencia + 'T12:00:00').toLocaleDateString('pt-BR')}
                          {a.id_ordem && ` | OS ${a.id_ordem}`}
                          {` | -${a.pontos} pts`}
                        </div>
                      </div>
                      {isExp ? <ChevronUp size={18} color="#6B7280" /> : <ChevronDown size={18} color="#6B7280" />}
                    </button>

                    {isExp && (
                      <div style={{ padding: '0 14px 14px' }}>
                        {a.detalhes && (
                          <div style={{
                            background: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 10,
                            fontSize: 12, color: '#374151',
                          }}>
                            {Object.entries(a.detalhes).map(([k, v]) => (
                              <div key={k}><strong>{k}:</strong> {JSON.stringify(v)}</div>
                            ))}
                          </div>
                        )}

                        <textarea
                          value={comentario}
                          onChange={(e) => setComentario(e.target.value)}
                          placeholder="Comentário do admin (opcional)..."
                          rows={2}
                          style={{ ...inputStyle, marginBottom: 10, resize: 'vertical' }}
                        />

                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => resolverAlerta(a, true)} style={{
                            flex: 1, padding: '10px 0', borderRadius: 10,
                            background: '#DC2626', color: '#fff', border: 'none',
                            fontSize: 13, fontWeight: 700, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          }}>
                            <Shield size={14} /> Virar Ocorrencia (-{a.pontos} pts)
                          </button>
                          <button onClick={() => resolverAlerta(a, false)} style={{
                            flex: 1, padding: '10px 0', borderRadius: 10,
                            background: '#6B7280', color: '#fff', border: 'none',
                            fontSize: 13, fontWeight: 700, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          }}>
                            <XCircle size={14} /> Ignorar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ===== ABA OCORRÊNCIAS ===== */}
      {aba === 'ocorrencias' && (
        <div>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <input type="month" value={filtroMes} onChange={(e) => setFiltroMes(e.target.value)}
                style={{ ...inputStyle, fontSize: 13 }} />
            </div>
            <div style={{ flex: 1 }}>
              <select value={filtroTecnico} onChange={(e) => setFiltroTecnico(e.target.value)}
                style={{ ...inputStyle, fontSize: 13 }}>
                <option value="">Todos</option>
                {tecnicos.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Botão manual */}
          <button onClick={() => setMostrarFormManual(!mostrarFormManual)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            width: '100%', padding: '10px 0', borderRadius: 10, marginBottom: 16,
            background: mostrarFormManual ? '#6B7280' : '#C41E2A', color: '#fff',
            border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            {mostrarFormManual ? <><XCircle size={14} /> Cancelar</> : <><Plus size={14} /> Nova Ocorrencia Manual</>}
          </button>

          {/* Form manual */}
          {mostrarFormManual && (
            <div style={{
              background: '#fff', borderRadius: 14, padding: 16, marginBottom: 16,
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '2px solid #C41E2A',
            }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#C41E2A', margin: '0 0 12px' }}>Ocorrencia Manual</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <select value={manual.tecnico_nome} onChange={(e) => setManual(p => ({ ...p, tecnico_nome: e.target.value }))}
                  style={inputStyle}>
                  <option value="">Selecione o tecnico...</option>
                  {tecnicos.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <textarea value={manual.descricao} onChange={(e) => setManual(p => ({ ...p, descricao: e.target.value }))}
                  placeholder="Descreva a ocorrencia..." rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#6B7280' }}>Pontos</label>
                    <select value={manual.pontos} onChange={(e) => setManual(p => ({ ...p, pontos: Number(e.target.value) }))}
                      style={inputStyle}>
                      <option value={1}>-1 (Baixa)</option>
                      <option value={3}>-3 (Media)</option>
                      <option value={5}>-5 (Alta)</option>
                      <option value={10}>-10 (Critica)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#6B7280' }}>Data</label>
                    <input type="date" value={manual.data_referencia}
                      onChange={(e) => setManual(p => ({ ...p, data_referencia: e.target.value }))}
                      style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#6B7280' }}>OS (opc.)</label>
                    <input type="text" value={manual.id_ordem}
                      onChange={(e) => setManual(p => ({ ...p, id_ordem: e.target.value }))}
                      placeholder="OS-001" style={inputStyle} />
                  </div>
                </div>
                <button onClick={criarManual} style={{
                  padding: '12px 0', borderRadius: 10, background: '#C41E2A', color: '#fff',
                  border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>
                  Registrar Ocorrencia
                </button>
              </div>
            </div>
          )}

          {/* Ranking de pontos por técnico */}
          {ranking.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1F2937', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Star size={14} color="#F59E0B" /> Pontuacao do mes
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ranking.map((r, i) => (
                  <div key={r.nome} style={{
                    background: '#fff', borderRadius: 10, padding: '10px 14px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                    borderLeft: `4px solid ${i === 0 && r.pontos > 0 ? '#DC2626' : '#E5E7EB'}`,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', background: '#1E3A5F', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700,
                    }}>{r.nome.charAt(0)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F' }}>{r.nome}</div>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>{r.qtd} ocorrencia(s)</div>
                    </div>
                    <div style={{
                      fontSize: 18, fontWeight: 700, color: r.pontos > 0 ? '#DC2626' : '#10B981',
                    }}>
                      -{r.pontos}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lista de ocorrências */}
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1F2937', marginBottom: 8 }}>
            Detalhes ({ocorrencias.length})
          </h3>
          {ocorrencias.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#9CA3AF', fontSize: 13 }}>
              Nenhuma ocorrencia neste periodo
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ocorrencias.map((o) => (
                <div key={o.id} style={{
                  background: '#fff', borderRadius: 12, padding: '12px 14px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  borderLeft: '3px solid #DC2626',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F' }}>{o.tecnico_nome}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626' }}>-{o.pontos} pts</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>{o.descricao}</div>
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4, display: 'flex', gap: 10 }}>
                    <span>{getLabelTipo(o.tipo)}</span>
                    <span>{new Date(o.data_referencia + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                    {o.id_ordem && <span>OS {o.id_ordem}</span>}
                    {o.admin_nome && <span>por {o.admin_nome}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== ABA HISTÓRICO (ignorados) ===== */}
      {aba === 'historico' && (
        <div>
          <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 12 }}>
            Alertas que foram analisados e nao viraram ocorrencia
          </p>
          {historico.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#9CA3AF', fontSize: 13 }}>
              Nenhum alerta ignorado
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {historico.map((a) => {
                const sev = SEV_STYLE[a.severidade]
                return (
                  <div key={a.id} style={{
                    background: '#fff', borderRadius: 12, padding: '10px 14px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)', opacity: 0.75,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: sev.bg, color: sev.color,
                      }}>{sev.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1F2937', flex: 1 }}>{getLabelTipo(a.tipo)}</span>
                      <span style={{ fontSize: 10, color: '#9CA3AF' }}>
                        {new Date(a.data_referencia + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 3 }}>
                      {a.tecnico_nome}: {a.descricao}
                    </div>
                    {a.admin_comentario && (
                      <div style={{ fontSize: 11, color: '#3B82F6', marginTop: 3 }}>
                        Admin: {a.admin_comentario}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                      Ignorado por {a.admin_nome} em {a.resolvido_em ? new Date(a.resolvido_em).toLocaleDateString('pt-BR') : '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
