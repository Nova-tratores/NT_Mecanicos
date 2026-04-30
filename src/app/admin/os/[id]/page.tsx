'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { OrdemServico, Execucao } from '@/lib/types'
import { ArrowLeft, MapPin, Wrench, Clock, FileText, User, AlertTriangle, Package, ShoppingCart, Unlink } from 'lucide-react'
import Link from 'next/link'

interface RequisicaoOS {
  id: number
  titulo: string
  tipo: string
  solicitante: string
  data: string
  status: string
  valor_despeza: string | null
  Chassis_Modelo: string | null
  ordem_servico: string | null
}

interface MovimentacaoPPV {
  Id: number
  CodProduto: string
  Descricao: string
  Qtde: string
  Preco: number
  TipoMovimento: string
}

export default function OSDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [os, setOs] = useState<OrdemServico | null>(null)
  const [execucoes, setExecucoes] = useState<Execucao[]>([])
  const [osTecnica, setOsTecnica] = useState<Record<string, unknown> | null>(null)
  const [requisicoes, setRequisicoes] = useState<RequisicaoOS[]>([])
  const [pecasPPV, setPecasPPV] = useState<MovimentacaoPPV[]>([])
  const [loading, setLoading] = useState(true)
  const [desvinculando, setDesvinculando] = useState<number | null>(null)

  useEffect(() => {
    if (!id) return
    const carregar = async () => {
      const [{ data: osData }, { data: execData }, { data: osTec }, { data: reqData }] = await Promise.all([
        supabase.from('Ordem_Servico').select('*').eq('Id_Ordem', id).single(),
        supabase.from('os_tecnico_execucao').select('*').eq('id_ordem', id).order('created_at', { ascending: false }),
        supabase.from('Ordem_Servico_Tecnicos').select('JustificativaAtraso, Status, TemAlmoco, ValorAlmoco, FotoAlmoco').eq('Ordem_Servico', id).maybeSingle(),
        supabase.from('Requisicao').select('id, titulo, tipo, solicitante, data, status, valor_despeza, Chassis_Modelo, ordem_servico').eq('ordem_servico', id).order('data', { ascending: false }),
      ])
      setOs(osData)
      setExecucoes(execData || [])
      if (osTec) setOsTecnica(osTec)
      setRequisicoes((reqData || []) as RequisicaoOS[])

      // Buscar peças do PPV
      if (osData?.ID_PPV) {
        const { data: movs } = await supabase
          .from('movimentacoes')
          .select('*')
          .eq('Id_PPV', osData.ID_PPV)
        setPecasPPV((movs || []) as MovimentacaoPPV[])
      }

      setLoading(false)
    }
    carregar()
  }, [id])

  const desvincularRequisicao = async (reqId: number) => {
    if (!confirm('Desvincular esta requisição da OS? Ela será removida do POS também.')) return
    setDesvinculando(reqId)
    try {
      // Desvincular no POS
      await supabase
        .from('Requisicao')
        .update({ ordem_servico: null })
        .eq('id', reqId)

      // Remover da lista local
      setRequisicoes(prev => prev.filter(r => r.id !== reqId))
    } catch (err) {
      console.error(err)
      alert('Erro ao desvincular.')
    } finally {
      setDesvinculando(null)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!os) return <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>OS nao encontrada</div>

  return (
    <div>
      <Link href="/admin/os" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#1E3A5F', fontSize: 14, fontWeight: 600, textDecoration: 'none', marginBottom: 16 }}>
        <ArrowLeft size={18} /> Voltar
      </Link>

      {/* Header card */}
      <div style={{
        background: '#1E3A5F', borderRadius: 16, padding: 20, color: '#fff', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{os.Id_Ordem}</span>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
            background: 'rgba(255,255,255,0.2)',
          }}>
            {os.Status}
          </span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{os.Os_Cliente}</div>
        {os.Endereco_Cliente && (
          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={13} /> {os.Endereco_Cliente}
          </div>
        )}
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <User size={13} /> {os.Os_Tecnico}{os.Os_Tecnico2 ? ` / ${os.Os_Tecnico2}` : ''}
        </div>
      </div>

      {/* Info cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        {[
          { icon: Wrench, label: 'Tipo', value: os.Tipo_Servico },
          { icon: Clock, label: 'Horas', value: `${os.Qtd_HR || 0}h` },
          { icon: FileText, label: 'Projeto', value: os.Projeto || '-' },
          { icon: MapPin, label: 'KM', value: `${os.Qtd_KM || 0} km` },
        ].map((item, i) => (
          <div key={i} style={{
            background: '#fff', borderRadius: 12, padding: 14,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <item.icon size={14} color="#6B7280" />
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>{item.label}</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Service description */}
      {os.Serv_Solicitado && (
        <div style={{
          background: '#fff', borderRadius: 14, padding: 16, marginBottom: 16,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F', marginBottom: 8 }}>Servico Solicitado</div>
          <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {os.Serv_Solicitado}
          </div>
        </div>
      )}

      {/* Previsoes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        {os.Previsao_Execucao && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, color: '#9CA3AF' }}>Previsao Execucao</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{os.Previsao_Execucao}</div>
          </div>
        )}
        {os.Previsao_Faturamento && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, color: '#9CA3AF' }}>Previsao Faturamento</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{os.Previsao_Faturamento}</div>
          </div>
        )}
      </div>

      {/* Valor Total Consolidado */}
      {(() => {
        const valorOS = Number(os.Valor_Total || 0)
        const valorPPV = pecasPPV.reduce((acc, p) => acc + (Number(p.Preco) || 0) * (Number(p.Qtde) || 1), 0)
        const valorReq = requisicoes.reduce((acc, r) => acc + (Number(r.valor_despeza) || 0), 0)
        const valorTotal = valorOS + valorPPV + valorReq
        return (
          <div style={{
            background: '#fff', borderRadius: 14, padding: 16, marginBottom: 16,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 8 }}>Valor Consolidado</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1E3A5F' }}>
              R$ {valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 11, color: '#6B7280' }}>
                OS: <strong style={{ color: '#1E3A5F' }}>R$ {valorOS.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
              </div>
              {valorPPV > 0 && (
                <div style={{ fontSize: 11, color: '#6B7280' }}>
                  PPV: <strong style={{ color: '#C2410C' }}>R$ {valorPPV.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                </div>
              )}
              {valorReq > 0 && (
                <div style={{ fontSize: 11, color: '#6B7280' }}>
                  Requisições: <strong style={{ color: '#7C3AED' }}>R$ {valorReq.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Peças / PPV */}
      {pecasPPV.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Package size={16} color="#C2410C" />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#C2410C', margin: 0 }}>
              Peças / PPV ({pecasPPV.length})
            </h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pecasPPV.map((p) => (
              <div key={p.Id} style={{
                background: '#FFF7ED', borderRadius: 12, padding: 14,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                border: '1px solid #FED7AA',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1F2937' }}>
                    {p.Descricao || p.CodProduto}
                  </div>
                  {p.CodProduto && p.Descricao && (
                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>Cód: {p.CodProduto}</div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#C2410C' }}>Qtd: {p.Qtde}</div>
                  {p.Preco > 0 && (
                    <div style={{ fontSize: 11, color: '#6B7280' }}>
                      R$ {(Number(p.Preco) * (Number(p.Qtde) || 1)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Requisições vinculadas */}
      {requisicoes.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <ShoppingCart size={16} color="#7C3AED" />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#7C3AED', margin: 0 }}>
              Requisições ({requisicoes.length})
            </h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {requisicoes.map((r) => (
              <div key={r.id} style={{
                background: r.status === 'cancelada' ? '#F9FAFB' : '#FAF5FF', borderRadius: 12, padding: 14,
                border: `1px solid ${r.status === 'cancelada' ? '#E5E7EB' : '#E9D5FF'}`,
                opacity: r.status === 'cancelada' ? 0.6 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#7C3AED' }}>#{r.id}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                      background: r.status === 'completa' ? '#D1FAE5' : r.status === 'pedido' ? '#FEF3C7' : r.status === 'cancelada' ? '#F3F4F6' : '#F3F4F6',
                      color: r.status === 'completa' ? '#065F46' : r.status === 'pedido' ? '#92400E' : '#6B7280',
                    }}>
                      {r.status}
                    </span>
                    {r.status !== 'cancelada' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); desvincularRequisicao(r.id) }}
                        disabled={desvinculando === r.id}
                        title="Desvincular da OS"
                        style={{
                          background: 'none', border: '1px solid #FECACA', borderRadius: 6,
                          padding: '3px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                          opacity: desvinculando === r.id ? 0.5 : 1,
                        }}
                      >
                        <Unlink size={12} color="#DC2626" />
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1F2937' }}>{r.titulo}</div>
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                  {r.tipo} • {r.solicitante} • {new Date(r.data).toLocaleDateString('pt-BR')}
                </div>
                {r.Chassis_Modelo && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                    Chassis/Modelo: {r.Chassis_Modelo}
                  </div>
                )}
                {r.valor_despeza && Number(r.valor_despeza) > 0 && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#7C3AED', marginTop: 4 }}>
                    R$ {Number(r.valor_despeza).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execucoes dos tecnicos */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12 }}>Execucoes</h2>
      {execucoes.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: 14, padding: 32, textAlign: 'center',
          color: '#9CA3AF', fontSize: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          Nenhuma execucao registrada
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {execucoes.map((ex) => (
            <div key={ex.id} style={{
              background: ex.status === 'enviado' ? '#D1FAE5' : '#FEF3C7',
              borderRadius: 14, padding: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: ex.status === 'enviado' ? '#065F46' : '#92400E' }}>
                  {ex.tecnico_nome}
                </span>
                <span style={{ fontSize: 11, color: '#6B7280' }}>
                  {new Date(ex.data_execucao).toLocaleDateString('pt-BR')}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#374151' }}>
                {ex.status === 'enviado' ? 'Enviada' : 'Rascunho'}
                {ex.horas_trabalhadas ? ` - ${ex.horas_trabalhadas}h trabalhadas` : ''}
                {ex.km_percorrido ? ` - ${ex.km_percorrido}km` : ''}
              </div>
              {ex.servico_realizado && (
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                  {ex.servico_realizado.substring(0, 150)}{ex.servico_realizado.length > 150 ? '...' : ''}
                </div>
              )}
              {ex.hora_chegada && (
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                  Chegada: {ex.hora_chegada}{ex.hora_saida ? ` | Saida: ${ex.hora_saida}` : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Almoço */}
      {osTecnica && (osTecnica.TemAlmoco as boolean) && (
        <div style={{
          background: '#fff', borderRadius: 14, padding: 16, marginBottom: 16,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          border: '1.5px solid #FDE68A',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>🍽️</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#92400E' }}>Almoço</span>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: '#9CA3AF' }}>Valor</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>
                R$ {Number(osTecnica.ValorAlmoco || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
            </div>
            {(osTecnica.FotoAlmoco as string) && (
              <a
                href={osTecnica.FotoAlmoco as string}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block' }}
              >
                <img
                  src={osTecnica.FotoAlmoco as string}
                  alt="Nota do almoço"
                  style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 10, border: '1px solid #E5E7EB' }}
                />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Justificativa de Atraso */}
      {osTecnica && (osTecnica.JustificativaAtraso as string) && (
        <div style={{
          background: '#FEF2F2', borderRadius: 14, padding: 16, marginBottom: 20,
          border: '1.5px solid #FECACA',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <AlertTriangle size={18} color="#DC2626" />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#DC2626' }}>Justificativa de Atraso</span>
          </div>
          <div style={{
            background: '#fff', borderRadius: 10, padding: 14,
            fontSize: 14, color: '#991B1B', lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}>
            {osTecnica.JustificativaAtraso as string}
          </div>
        </div>
      )}
    </div>
  )
}
