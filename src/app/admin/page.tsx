'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { STATUS_AGENDA } from '@/lib/constants'
import { useAdmin } from '@/hooks/useAdmin'
import type { AgendaItem, OrdemServico } from '@/lib/types'
import {
  Calendar, Wrench, ClipboardList, AlertTriangle, UserPlus, CheckCircle,
  ChevronLeft, ChevronRight, Navigation, Clock, MapPin, Car,
} from 'lucide-react'
import Link from 'next/link'

interface DiarioEntry {
  id: number
  tecnico_nome: string
  data: string
  id_ordem: string
  cliente: string
  endereco_cliente: string
  cidade_cliente: string
  ordem_visita: number
  lat_cliente: number | null
  lng_cliente: number | null
  distancia_km: number | null
  tempo_estimado_min: number | null
  hora_saida_origem: string | null
  hora_chegada_cliente: string | null
  hora_saida_cliente: string | null
  tempo_real_min: number | null
  atraso_min: number
  justificativa_atraso: string | null
  status: string
  viagens: string | null
}

interface Viagem {
  data: string
  horaSaida: string
  horaChegada: string
  horaSaidaCliente: string
  kmTotal: string
}

interface TecnicoResumo {
  nome: string
  agendaHoje: AgendaItem[]
  osAbertas: number
  reqPendentes: number
  atrasados: number
  concluidos: number
  diarios: DiarioEntry[]
  placa: string | null
  totalKm: number
  totalTempoReal: number
  visitasFinalizadas: number
  visitasTotal: number
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function isToday(dateStr: string) {
  return dateStr === new Date().toISOString().split('T')[0]
}

export default function DashboardAdmin() {
  const { admin } = useAdmin()
  const [dataSelecionada, setDataSelecionada] = useState(() => new Date().toISOString().split('T')[0])
  const [resumos, setResumos] = useState<TecnicoResumo[]>([])
  const [totais, setTotais] = useState({ agenda: 0, os: 0, req: 0, atrasos: 0 })
  const [loading, setLoading] = useState(true)

  const mudarDia = (delta: number) => {
    setDataSelecionada(prev => {
      const d = new Date(prev + 'T12:00:00')
      d.setDate(d.getDate() + delta)
      return d.toISOString().split('T')[0]
    })
  }

  const carregar = useCallback(async () => {
    setLoading(true)
    const dia = dataSelecionada

    const limiteAtraso = new Date(dia + 'T12:00:00')
    limiteAtraso.setDate(limiteAtraso.getDate() - 1)
    const limiteStr = limiteAtraso.toISOString().split('T')[0]

    const [
      { data: agenda },
      { data: os },
      { data: req },
      { data: tecnicos },
      { data: atrasados },
      { data: concluidos },
      { data: diarioData },
    ] = await Promise.all([
      supabase.from('agenda_tecnico').select('*').eq('data_agendada', dia).order('hora_inicio'),
      supabase.from('Ordem_Servico').select('*').not('Status', 'in', '("Concluida","Cancelada")'),
      supabase.from('mecanico_requisicoes').select('*').eq('status', 'pendente'),
      supabase.from('mecanico_usuarios').select('tecnico_nome').eq('ativo', true).order('tecnico_nome'),
      supabase.from('agenda_tecnico').select('*').lt('data_agendada', limiteStr).in('status', ['agendado', 'em_andamento']),
      supabase.from('agenda_tecnico').select('tecnico_nome').eq('data_agendada', dia).eq('status', 'concluido'),
      supabase.from('Diario_Tecnico').select('*').eq('data', dia).order('ordem_visita'),
    ])

    const agendaList = agenda || []
    const osList = os || []
    const reqList = req || []
    const tecnicosList = tecnicos || []
    const atrasosList = atrasados || []
    const diarioList = (diarioData || []) as DiarioEntry[]

    // Buscar placas usadas no dia (da Ordem_Servico_Tecnicos)
    const ordemIds = [...new Set(diarioList.map(d => d.id_ordem).filter(Boolean))]
    let placaMap: Record<string, string> = {}
    if (ordemIds.length > 0) {
      const { data: ostData } = await supabase
        .from('Ordem_Servico_Tecnicos')
        .select('TecResp1, NumPlaca')
        .in('Ordem_Servico', ordemIds)
        .not('NumPlaca', 'is', null)
      if (ostData) {
        for (const ost of ostData) {
          if (ost.NumPlaca && ost.TecResp1) {
            placaMap[ost.TecResp1] = ost.NumPlaca
          }
        }
      }
    }

    const map = new Map<string, TecnicoResumo>()
    for (const t of tecnicosList) {
      map.set(t.tecnico_nome, {
        nome: t.tecnico_nome,
        agendaHoje: [],
        osAbertas: 0,
        reqPendentes: 0,
        atrasados: 0,
        concluidos: 0,
        diarios: [],
        placa: placaMap[t.tecnico_nome] || null,
        totalKm: 0,
        totalTempoReal: 0,
        visitasFinalizadas: 0,
        visitasTotal: 0,
      })
    }

    for (const a of agendaList) {
      const r = map.get(a.tecnico_nome)
      if (r) r.agendaHoje.push(a)
    }

    for (const o of osList) {
      const r1 = map.get(o.Os_Tecnico)
      if (r1) r1.osAbertas++
      if (o.Os_Tecnico2) {
        const r2 = map.get(o.Os_Tecnico2)
        if (r2) r2.osAbertas++
      }
    }

    for (const rq of reqList) {
      const r = map.get(rq.tecnico_nome)
      if (r) r.reqPendentes++
    }

    for (const a of atrasosList) {
      const r = map.get(a.tecnico_nome)
      if (r) r.atrasados++
    }

    for (const c of (concluidos || [])) {
      const r = map.get(c.tecnico_nome)
      if (r) r.concluidos++
    }

    // Processar diários GPS
    for (const d of diarioList) {
      const r = map.get(d.tecnico_nome)
      if (!r) continue
      r.diarios.push(d)
      r.visitasTotal++
      if (d.status === 'finalizado') r.visitasFinalizadas++
      if (d.distancia_km) r.totalKm += d.distancia_km
      if (d.tempo_real_min) r.totalTempoReal += d.tempo_real_min

      // Somar km das viagens
      if (d.viagens) {
        try {
          const viagens: Viagem[] = JSON.parse(d.viagens)
          let kmViagens = 0
          for (const v of viagens) {
            kmViagens += parseFloat(v.kmTotal) || 0
          }
          if (kmViagens > 0 && !d.distancia_km) {
            r.totalKm += kmViagens
          }
        } catch { /* */ }
      }
    }

    const lista = Array.from(map.values()).sort((a, b) =>
      b.diarios.length - a.diarios.length || b.atrasados - a.atrasados || b.agendaHoje.length - a.agendaHoje.length
    )

    setResumos(lista)
    setTotais({
      agenda: agendaList.length,
      os: osList.length,
      req: reqList.length,
      atrasos: atrasosList.length,
    })
    setLoading(false)
  }, [dataSelecionada])

  useEffect(() => { carregar() }, [carregar])

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const saudacao = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  const ehHoje = isToday(dataSelecionada)

  const statusColors: Record<string, { bg: string; color: string; label: string }> = {
    agendado: { bg: '#F3F4F6', color: '#6B7280', label: 'Agendado' },
    em_deslocamento: { bg: '#DBEAFE', color: '#2563EB', label: 'Em deslocamento' },
    no_cliente: { bg: '#FEF3C7', color: '#D97706', label: 'No cliente' },
    finalizado: { bg: '#D1FAE5', color: '#059669', label: 'Finalizado' },
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E3A5F', margin: 0 }}>
          {ehHoje ? `${saudacao()}, ${admin?.tecnico_nome || 'Administrador'}` : 'Historico'}
        </h1>
      </div>

      {/* Seletor de data */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        marginBottom: 20, background: '#fff', borderRadius: 14, padding: '10px 16px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <button onClick={() => mudarDia(-1)} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 6,
          display: 'flex', alignItems: 'center',
        }}>
          <ChevronLeft size={22} color="#1E3A5F" />
        </button>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <input
            type="date"
            value={dataSelecionada}
            onChange={(e) => setDataSelecionada(e.target.value)}
            max={new Date().toISOString().split('T')[0]}
            style={{
              border: 'none', fontSize: 15, fontWeight: 700, color: '#1E3A5F',
              textAlign: 'center', background: 'transparent', cursor: 'pointer',
            }}
          />
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
            {ehHoje ? 'Hoje' : formatDate(dataSelecionada)}
          </div>
        </div>
        <button onClick={() => mudarDia(1)} disabled={ehHoje} style={{
          background: 'none', border: 'none', cursor: ehHoje ? 'default' : 'pointer',
          padding: 6, display: 'flex', alignItems: 'center', opacity: ehHoje ? 0.3 : 1,
        }}>
          <ChevronRight size={22} color="#1E3A5F" />
        </button>
      </div>

      {ehHoje && (
        <Link href="/admin/tecnicos" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: '#1E3A5F', color: '#fff', borderRadius: 12, padding: '14px 0',
          textDecoration: 'none', fontSize: 14, fontWeight: 700, marginBottom: 16,
          boxShadow: '0 2px 8px rgba(30,58,95,0.3)',
        }}>
          <UserPlus size={18} />
          Cadastrar Tecnico
        </Link>
      )}

      {/* Totais */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <Link href="/admin/agenda" style={{
          background: '#fff', borderRadius: 14, padding: 16,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)', textDecoration: 'none',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <Calendar size={20} color="#3B82F6" />
          <span style={{ fontSize: 24, fontWeight: 700, color: '#1F2937' }}>{totais.agenda}</span>
          <span style={{ fontSize: 12, color: '#6B7280' }}>Agendados {ehHoje ? 'hoje' : 'no dia'}</span>
        </Link>

        <Link href="/admin/os" style={{
          background: '#fff', borderRadius: 14, padding: 16,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)', textDecoration: 'none',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <Wrench size={20} color="#F59E0B" />
          <span style={{ fontSize: 24, fontWeight: 700, color: '#1F2937' }}>{totais.os}</span>
          <span style={{ fontSize: 12, color: '#6B7280' }}>OS abertas</span>
        </Link>

        <Link href="/admin/requisicoes" style={{
          background: '#fff', borderRadius: 14, padding: 16,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)', textDecoration: 'none',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <ClipboardList size={20} color="#8B5CF6" />
          <span style={{ fontSize: 24, fontWeight: 700, color: '#1F2937' }}>{totais.req}</span>
          <span style={{ fontSize: 12, color: '#6B7280' }}>Requisicoes pendentes</span>
        </Link>

        <div style={{
          background: totais.atrasos > 0 ? '#FEF2F2' : '#fff', borderRadius: 14, padding: 16,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          display: 'flex', flexDirection: 'column', gap: 8,
          border: totais.atrasos > 0 ? '1px solid #FCA5A5' : 'none',
        }}>
          <AlertTriangle size={20} color={totais.atrasos > 0 ? '#EF4444' : '#9CA3AF'} />
          <span style={{ fontSize: 24, fontWeight: 700, color: totais.atrasos > 0 ? '#DC2626' : '#1F2937' }}>{totais.atrasos}</span>
          <span style={{ fontSize: 12, color: '#6B7280' }}>Atrasos</span>
        </div>
      </div>

      {/* Resumo por tecnico */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12 }}>
        Tecnicos — {ehHoje ? 'Visao de Hoje' : formatDate(dataSelecionada)}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {resumos.map((t) => (
          <div key={t.nome} style={{
            background: '#fff', borderRadius: 14, padding: 16,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            borderLeft: `4px solid ${t.atrasados > 0 ? '#EF4444' : t.diarios.length > 0 ? '#3B82F6' : t.agendaHoje.length > 0 ? '#3B82F6' : '#D1D5DB'}`,
          }}>
            {/* Header do tecnico */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: '#1E3A5F', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700,
                }}>
                  {t.nome.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{t.nome}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                    {t.agendaHoje.length} agendado(s) {ehHoje ? 'hoje' : 'no dia'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {t.placa && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                    background: '#DBEAFE', color: '#2563EB',
                    display: 'flex', alignItems: 'center', gap: 3,
                  }}>
                    <Car size={10} /> {t.placa}
                  </span>
                )}
                {t.atrasados > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                    background: '#FEE2E2', color: '#DC2626',
                  }}>
                    {t.atrasados} atraso(s)
                  </span>
                )}
              </div>
            </div>

            {/* Resumo numeros */}
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Wrench size={12} /> {t.osAbertas} OS
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle size={12} color="#10B981" /> {t.concluidos} feito(s)
              </span>
              {t.reqPendentes > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ClipboardList size={12} color="#F59E0B" /> {t.reqPendentes} req
                </span>
              )}
            </div>

            {/* Jornada GPS */}
            {t.diarios.length > 0 && (
              <div style={{
                background: '#F0F9FF', borderRadius: 10, padding: 12, marginBottom: 10,
                border: '1px solid #BAE6FD',
              }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: '#0369A1', marginBottom: 8,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Navigation size={14} /> Jornada GPS
                </div>

                {/* Totais da jornada */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <div style={{
                    flex: 1, background: '#fff', borderRadius: 8, padding: '8px 10px',
                    textAlign: 'center', border: '1px solid #E0F2FE',
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>
                      {t.totalKm > 0 ? `${Math.round(t.totalKm)} km` : '—'}
                    </div>
                    <div style={{ fontSize: 10, color: '#6B7280' }}>Distancia</div>
                  </div>
                  <div style={{
                    flex: 1, background: '#fff', borderRadius: 8, padding: '8px 10px',
                    textAlign: 'center', border: '1px solid #E0F2FE',
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>
                      {t.totalTempoReal > 0 ? `${t.totalTempoReal} min` : '—'}
                    </div>
                    <div style={{ fontSize: 10, color: '#6B7280' }}>Tempo real</div>
                  </div>
                  <div style={{
                    flex: 1, background: '#fff', borderRadius: 8, padding: '8px 10px',
                    textAlign: 'center', border: '1px solid #E0F2FE',
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>
                      {t.visitasFinalizadas}/{t.visitasTotal}
                    </div>
                    <div style={{ fontSize: 10, color: '#6B7280' }}>Visitas</div>
                  </div>
                </div>

                {/* Detalhes por visita */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {t.diarios.map((d) => {
                    const st = statusColors[d.status] || statusColors.agendado
                    let kmViagem = 0
                    if (d.viagens) {
                      try {
                        const vs: Viagem[] = JSON.parse(d.viagens)
                        for (const v of vs) kmViagem += parseFloat(v.kmTotal) || 0
                      } catch { /* */ }
                    }
                    const kmExibir = kmViagem > 0 ? kmViagem : d.distancia_km

                    return (
                      <div key={d.id} style={{
                        background: '#fff', borderRadius: 8, padding: '8px 12px',
                        border: '1px solid #E0F2FE',
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                        <div style={{
                          width: 24, height: 24, borderRadius: 6, background: st.bg,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: st.color, flexShrink: 0,
                        }}>
                          {d.ordem_visita}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#1E3A5F' }}>
                              {d.id_ordem}
                            </span>
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                              background: st.bg, color: st.color,
                            }}>
                              {st.label}
                            </span>
                          </div>
                          <div style={{
                            fontSize: 11, color: '#374151', overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {d.cliente}
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 10, color: '#6B7280' }}>
                            {d.cidade_cliente && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <MapPin size={9} /> {d.cidade_cliente}
                              </span>
                            )}
                            {kmExibir != null && kmExibir > 0 && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Navigation size={9} /> {Math.round(kmExibir)} km
                              </span>
                            )}
                            {d.hora_saida_origem && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Clock size={9} /> {d.hora_saida_origem}
                                {d.hora_chegada_cliente ? ` - ${d.hora_chegada_cliente}` : ''}
                              </span>
                            )}
                            {d.atraso_min > 0 && (
                              <span style={{ color: '#DC2626', fontWeight: 700 }}>
                                +{d.atraso_min}min
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Agenda items */}
            {t.agendaHoje.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {t.agendaHoje.map((item) => {
                  const st = STATUS_AGENDA[item.status as keyof typeof STATUS_AGENDA]
                  return (
                    <Link key={item.id} href={item.id_ordem ? `/admin/os/${item.id_ordem}` : '/admin/agenda'} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: '#F9FAFB', borderRadius: 8, padding: '8px 12px',
                      textDecoration: 'none', color: 'inherit',
                    }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#1E3A5F' }}>
                          {item.id_ordem || 'Servico'}
                        </span>
                        {item.cliente && (
                          <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 8 }}>{item.cliente}</span>
                        )}
                      </div>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: st?.bg, color: st?.color,
                      }}>
                        {st?.label}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}

            {/* Sem dados */}
            {t.diarios.length === 0 && t.agendaHoje.length === 0 && (
              <div style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', padding: '8px 0' }}>
                Sem registros {ehHoje ? 'hoje' : 'neste dia'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
