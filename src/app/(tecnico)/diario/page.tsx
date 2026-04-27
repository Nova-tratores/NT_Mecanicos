'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import { supabase } from '@/lib/supabase'
import { rotaDaOficina, calcularRota, geocodificar, OFICINA } from '@/lib/ors'
import type { OrdemServico } from '@/lib/types'
import {
  MapPin, Clock, Navigation, Play, CheckCircle, LogOut,
  AlertTriangle, ChevronDown, ChevronUp, ChevronRight, Car, Plus, Minus,
  Unlock, ExternalLink,
} from 'lucide-react'
import Link from 'next/link'

interface Viagem {
  data: string
  horaSaida: string
  horaChegada: string
  horaSaidaCliente: string
  kmTotal: string
}

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
  relatorio_liberado: boolean
  viagens: string | null
}

const HORA_SAIDA_OFICINA = '08:15'

function hoje() {
  return new Date().toISOString().split('T')[0]
}

function horaAtual() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function diffMinutos(h1: string, h2: string) {
  const [a, b] = h1.split(':').map(Number)
  const [c, d] = h2.split(':').map(Number)
  return (c * 60 + d) - (a * 60 + b)
}

function calcTotalHoras(viagens: Viagem[]) {
  let total = 0
  for (const v of viagens) {
    if (v.horaSaida && v.horaSaidaCliente) {
      let diff = diffMinutos(v.horaSaida, v.horaSaidaCliente)
      if (diff < 0) diff += 24 * 60
      total += diff
    }
  }
  if (total <= 0) return ''
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}h${m > 0 ? `${m}m` : ''}`
}

function calcTotalKm(viagens: Viagem[]) {
  let total = 0
  for (const v of viagens) {
    total += parseFloat(v.kmTotal) || 0
  }
  return total > 0 ? String(total) : ''
}

export default function DiarioTecnico() {
  const { user } = useCurrentUser()
  const [ordens, setOrdens] = useState<OrdemServico[]>([])
  const [diarios, setDiarios] = useState<Record<string, DiarioEntry>>({})
  const [cidadeMap, setCidadeMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [justificativa, setJustificativa] = useState('')
  const [pedindoJustificativa, setPedindoJustificativa] = useState<string | null>(null)
  const [viagensLocal, setViagensLocal] = useState<Record<string, Viagem[]>>({})
  const [rotaInfo, setRotaInfo] = useState<Record<string, { km: number; min: number }>>({})
  const [calculandoRota, setCalculandoRota] = useState<string | null>(null)
  const [mensagemDesbloqueio, setMensagemDesbloqueio] = useState<string | null>(null)

  // Backup automático das viagens preenchidas
  const getFormData = useCallback(() => ({
    viagensLocal, justificativa,
  }), [viagensLocal, justificativa])

  const setFormData = useCallback((data: Record<string, unknown>) => {
    if (data.viagensLocal) setViagensLocal(data.viagensLocal as Record<string, Viagem[]>)
    if (data.justificativa) setJustificativa(data.justificativa as string)
  }, [])

  const { clear: clearBackup, restore: restoreBackup } = useFormBackup('diario-campo', getFormData, setFormData)

  const restoredRef = useRef(false)
  useEffect(() => {
    if (!loading && !restoredRef.current) {
      restoredRef.current = true
      restoreBackup()
    }
  }, [loading, restoreBackup])

  const carregar = useCallback(async () => {
    if (!user) return
    const dataHoje = hoje()

    // Buscar OS ativas do técnico (em execução, procurando peças, aguardando...)
    const nome = user.nome_pos || user.tecnico_nome
    const { data: osData } = await supabase
      .from('Ordem_Servico')
      .select('*')
      .in('Status', ['Execução', 'Execução Procurando peças', 'Execução aguardando peças (em transporte)', 'Aguardando ordem Técnico', 'Relatório Concluído', 'Orçamento'])
      .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
      .order('Previsao_Execucao', { ascending: true })
      .order('Id_Ordem', { ascending: true })

    const lista = (osData || []) as OrdemServico[]
    setOrdens(lista)

    // Buscar cidades
    const cnpjs = [...new Set(lista.map(o => o.Cnpj_Cliente).filter(Boolean))]
    if (cnpjs.length > 0) {
      const { data: cliData } = await supabase
        .from('Clientes')
        .select('cnpj_cpf, cidade, endereco, latitude, longitude')
        .in('cnpj_cpf', cnpjs)
      if (cliData) {
        const mapa: Record<string, string> = {}
        cliData.forEach((c: { cnpj_cpf: string; cidade: string | null }) => {
          if (c.cidade) mapa[c.cnpj_cpf] = c.cidade
        })
        setCidadeMap(mapa)
      }
    }

    // Buscar diários existentes para hoje
    const { data: diarioData } = await supabase
      .from('Diario_Tecnico')
      .select('*')
      .eq('tecnico_nome', user.nome_pos || user.tecnico_nome)
      .eq('data', dataHoje)

    const map: Record<string, DiarioEntry> = {}
    const viagensMap: Record<string, Viagem[]> = {}
    if (diarioData) {
      for (const d of diarioData as DiarioEntry[]) {
        map[d.id_ordem] = d
        if (d.viagens) {
          try { viagensMap[d.id_ordem] = JSON.parse(d.viagens) } catch { /* */ }
        }
      }
    }

    // Inicializar viagens padrão para OS sem diário
    for (const os of lista) {
      if (!viagensMap[os.Id_Ordem]) {
        viagensMap[os.Id_Ordem] = [{ data: dataHoje, horaSaida: '', horaChegada: '', horaSaidaCliente: '', kmTotal: '' }]
      }
    }

    setDiarios(map)
    setViagensLocal(viagensMap)
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (!user) { setLoading(false); return }
    carregar()
  }, [user, carregar])

  // Criar/atualizar diário no banco
  const salvarDiario = async (os: OrdemServico, updates: Partial<DiarioEntry>) => {
    const existing = diarios[os.Id_Ordem]
    const cidade = cidadeMap[os.Cnpj_Cliente] || ''

    if (existing) {
      await supabase.from('Diario_Tecnico').update(updates).eq('id', existing.id)
    } else {
      await supabase.from('Diario_Tecnico').insert({
        tecnico_nome: user!.nome_pos || user!.tecnico_nome,
        data: hoje(),
        id_ordem: os.Id_Ordem,
        cliente: os.Os_Cliente,
        endereco_cliente: os.Endereco_Cliente || '',
        cidade_cliente: cidade,
        ordem_visita: ordens.indexOf(os) + 1,
        ...updates,
      })
    }
    await carregar()
  }

  // Calcular rota ao expandir
  const calcularRotaVisita = async (os: OrdemServico, idx: number) => {
    if (rotaInfo[os.Id_Ordem]) return
    setCalculandoRota(os.Id_Ordem)

    const endereco = [os.Endereco_Cliente, cidadeMap[os.Cnpj_Cliente]].filter(Boolean).join(', ')
    if (!endereco) { setCalculandoRota(null); return }

    const coords = await geocodificar(endereco)
    if (!coords) { setCalculandoRota(null); return }

    let rota
    if (idx === 0) {
      rota = await rotaDaOficina(coords.lat, coords.lng)
    } else {
      // Da OS anterior
      const prevOs = ordens[idx - 1]
      const prevEnd = [prevOs.Endereco_Cliente, cidadeMap[prevOs.Cnpj_Cliente]].filter(Boolean).join(', ')
      const prevCoords = prevEnd ? await geocodificar(prevEnd) : null
      if (prevCoords) {
        rota = await calcularRota(prevCoords.lat, prevCoords.lng, coords.lat, coords.lng)
      } else {
        rota = await rotaDaOficina(coords.lat, coords.lng)
      }
    }

    if (rota) {
      setRotaInfo(prev => ({ ...prev, [os.Id_Ordem]: { km: rota.distancia_km, min: rota.tempo_min } }))
      // Salvar no diário
      await salvarDiario(os, {
        lat_cliente: coords.lat,
        lng_cliente: coords.lng,
        distancia_km: rota.distancia_km,
        tempo_estimado_min: rota.tempo_min,
      } as Partial<DiarioEntry>)
    }
    setCalculandoRota(null)
  }

  const toggleExpandir = (os: OrdemServico, idx: number) => {
    if (expandido === os.Id_Ordem) {
      setExpandido(null)
    } else {
      setExpandido(os.Id_Ordem)
      calcularRotaVisita(os, idx)
    }
  }

  // Ações
  const marcarSaindo = async (os: OrdemServico) => {
    setSalvando(os.Id_Ordem)
    const hora = horaAtual()
    const viagens = viagensLocal[os.Id_Ordem] || []
    if (viagens.length > 0 && !viagens[0].horaSaida) {
      viagens[0].horaSaida = hora
    }
    await salvarDiario(os, {
      status: 'em_deslocamento',
      hora_saida_origem: hora,
      viagens: JSON.stringify(viagens),
    } as Partial<DiarioEntry>)
    setSalvando(null)
  }

  const marcarCheguei = async (os: OrdemServico) => {
    setSalvando(os.Id_Ordem)
    const hora = horaAtual()
    const diario = diarios[os.Id_Ordem]
    const viagens = viagensLocal[os.Id_Ordem] || []

    // Marcar hora de chegada na viagem atual (última sem horaChegada)
    const viagemAtual = viagens.find(v => v.horaSaida && !v.horaChegada)
    if (viagemAtual) viagemAtual.horaChegada = hora

    const tempoReal = diario?.hora_saida_origem ? diffMinutos(diario.hora_saida_origem, hora) : 0
    const tempoEstimado = diario?.tempo_estimado_min || rotaInfo[os.Id_Ordem]?.min || 0
    const atraso = tempoEstimado > 0 ? Math.max(0, tempoReal - tempoEstimado) : 0

    await salvarDiario(os, {
      status: 'no_cliente',
      hora_chegada_cliente: hora,
      tempo_real_min: tempoReal,
      atraso_min: atraso,
      viagens: JSON.stringify(viagens),
    } as Partial<DiarioEntry>)

    if (atraso > 0) setPedindoJustificativa(os.Id_Ordem)
    setSalvando(null)
  }

  const salvarJustificativaAtraso = async (os: OrdemServico) => {
    if (!justificativa.trim()) { alert('Informe a justificativa.'); return }
    setSalvando(os.Id_Ordem)
    await salvarDiario(os, { justificativa_atraso: justificativa.trim() } as Partial<DiarioEntry>)
    setPedindoJustificativa(null)
    setJustificativa('')
    setSalvando(null)
  }

  const updateViagem = (osId: string, idx: number, field: keyof Viagem, value: string) => {
    setViagensLocal(prev => {
      const arr = [...(prev[osId] || [])]
      arr[idx] = { ...arr[idx], [field]: value }
      return { ...prev, [osId]: arr }
    })
  }

  const adicionarViagem = (osId: string) => {
    setViagensLocal(prev => {
      const arr = [...(prev[osId] || [])]
      arr.push({ data: hoje(), horaSaida: '', horaChegada: '', horaSaidaCliente: '', kmTotal: '' })
      return { ...prev, [osId]: arr }
    })
  }

  const removerViagem = (osId: string, idx: number) => {
    setViagensLocal(prev => {
      const arr = (prev[osId] || []).filter((_, i) => i !== idx)
      return { ...prev, [osId]: arr }
    })
  }

  const finalizarVisita = async (os: OrdemServico) => {
    const diario = diarios[os.Id_Ordem]
    if (diario?.atraso_min > 0 && !diario?.justificativa_atraso) {
      setPedindoJustificativa(os.Id_Ordem)
      return
    }

    setSalvando(os.Id_Ordem)
    const viagens = viagensLocal[os.Id_Ordem] || []
    const hora = horaAtual()

    // Marcar saída na última viagem se não tiver
    const ultimaViagem = viagens[viagens.length - 1]
    if (ultimaViagem && !ultimaViagem.horaSaidaCliente) {
      ultimaViagem.horaSaidaCliente = hora
    }

    // Salvar diário como finalizado
    await salvarDiario(os, {
      status: 'finalizado',
      hora_saida_cliente: hora,
      relatorio_liberado: true,
      viagens: JSON.stringify(viagens),
    } as Partial<DiarioEntry>)

    // Transferir dados para Ordem_Servico_Tecnicos (pré-preencher relatório)
    const totalHoras = calcTotalHoras(viagens)
    const totalKm = calcTotalKm(viagens)

    const payload: Record<string, unknown> = {
      Ordem_Servico: os.Id_Ordem,
      TecResp1: user!.tecnico_nome,
      DataInicio: viagens[0]?.data || '',
      DataFinal: viagens[viagens.length - 1]?.data || viagens[0]?.data || '',
      InicioHora: viagens[0]?.horaSaida || '',
      FinalHora: viagens[0]?.horaSaidaCliente || '',
      InicioKm: '',
      FinalKm: '',
      AdicionarData2: viagens.length >= 2,
      DataInicio2: viagens[1]?.data || '',
      InicioHora2: viagens[1]?.horaSaida || '',
      FinalHora2: viagens[1]?.horaSaidaCliente || '',
      InicioKm2: '',
      FinalKm2: '',
      AdicionarData3: viagens.length >= 3,
      DataInicio3: viagens[2]?.data || '',
      InicioHora3: viagens[2]?.horaSaida || '',
      FinaHora3: viagens[2]?.horaSaidaCliente || '',
      InicioKm3: '',
      FinalKm3: '',
      TotalHora: totalHoras,
      TotalKm: totalKm,
      Data: hoje(),
      Status: 'rascunho',
      pdf_criado: false,
    }

    // Verificar se já existe OS técnica
    const { data: existing } = await supabase
      .from('Ordem_Servico_Tecnicos')
      .select('IdOs')
      .eq('Ordem_Servico', os.Id_Ordem)
      .maybeSingle()

    if (existing) {
      await supabase.from('Ordem_Servico_Tecnicos').update(payload).eq('IdOs', existing.IdOs)
    } else {
      await supabase.from('Ordem_Servico_Tecnicos').insert(payload)
    }

    setSalvando(null)
    setMensagemDesbloqueio(os.Id_Ordem)
    setTimeout(() => setMensagemDesbloqueio(null), 5000)
    await carregar()
  }

  const salvarViagens = async (os: OrdemServico) => {
    setSalvando(os.Id_Ordem)
    const viagens = viagensLocal[os.Id_Ordem] || []
    await salvarDiario(os, { viagens: JSON.stringify(viagens) } as Partial<DiarioEntry>)
    setSalvando(null)
  }

  const finalizados = Object.values(diarios).filter(d => d.status === 'finalizado').length

  // Separar OS do dia e atrasadas
  const dataHoje = hoje()
  const ordensHoje = ordens.filter(os => {
    const prev = os.Previsao_Execucao || ''
    return prev === dataHoje || prev === '' || prev >= dataHoje
  })
  const ordensAtrasadas = ordens.filter(os => {
    const prev = os.Previsao_Execucao || ''
    return prev !== '' && prev < dataHoje
  })
  const [mostrarAtrasadas, setMostrarAtrasadas] = useState(false)

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 10,
    border: '2px solid #E5E7EB', fontSize: 14, outline: 'none',
    background: '#fff', boxSizing: 'border-box',
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#C41E2A', margin: '0 0 6px' }}>
        Diário de Campo
      </h1>
      <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
        {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>

      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1E3A5F' }}>{ordensHoje.length}</div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>Hoje</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#059669' }}>{finalizados}</div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>Concluídas</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#C41E2A' }}>08:15</div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>Saída</div>
        </div>
      </div>

      {/* Mensagem de desbloqueio */}
      {mensagemDesbloqueio && (
        <div style={{
          background: '#D1FAE5', border: '2px solid #10B981', borderRadius: 14,
          padding: '14px 18px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Unlock size={22} color="#059669" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#059669' }}>Relatório desbloqueado!</div>
            <div style={{ fontSize: 13, color: '#065F46' }}>Os dados da visita já foram transferidos. Você pode preencher o relatório.</div>
          </div>
          <Link href={`/os/${mensagemDesbloqueio}/preencher`} style={{
            padding: '8px 14px', borderRadius: 8, background: '#059669', color: '#fff',
            fontSize: 13, fontWeight: 700, textDecoration: 'none',
          }}>
            Ir
          </Link>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : ordensHoje.length === 0 && ordensAtrasadas.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: 18, padding: 48, textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <Navigation size={36} color="#D1D5DB" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontSize: 16, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>
            Nenhuma visita ativa
          </div>
          <div style={{ fontSize: 14, color: '#9CA3AF' }}>
            Ordens em execução aparecerão aqui
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Atrasadas (colapsável) */}
          {ordensAtrasadas.length > 0 && (
            <div style={{
              background: '#FEF2F2', borderRadius: 14, border: '1.5px solid #FECACA',
              overflow: 'hidden',
            }}>
              <button type="button" onClick={() => setMostrarAtrasadas(!mostrarAtrasadas)} style={{
                width: '100%', padding: '12px 16px', border: 'none', cursor: 'pointer',
                background: 'transparent',
                display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
              }}>
                <AlertTriangle size={18} color="#DC2626" />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: '#DC2626' }}>
                  Atrasadas ({ordensAtrasadas.length})
                </span>
                <span style={{
                  fontSize: 11, color: '#DC2626', fontWeight: 600,
                }}>
                  {mostrarAtrasadas ? 'Ocultar' : 'Ver'}
                </span>
                {mostrarAtrasadas ? <ChevronUp size={16} color="#DC2626" /> : <ChevronDown size={16} color="#DC2626" />}
              </button>

              {mostrarAtrasadas && (
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ordensAtrasadas.map((os, idx) => {
                    const prev = os.Previsao_Execucao
                    const d = prev ? new Date(prev + 'T12:00:00') : null
                    const dataLabel = d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''
                    return (
                      <div key={os.Id_Ordem} style={{
                        background: '#fff', borderRadius: 12, padding: '12px 14px',
                        borderLeft: '4px solid #DC2626',
                        display: 'flex', alignItems: 'center', gap: 12,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#C41E2A' }}>{os.Id_Ordem}</span>
                            {dataLabel && (
                              <span style={{
                                fontSize: 10, fontWeight: 700, color: '#DC2626',
                                background: '#FEE2E2', padding: '2px 8px', borderRadius: 6,
                              }}>
                                Prev: {dataLabel}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {os.Os_Cliente}
                          </div>
                          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                            {cidadeMap[os.Cnpj_Cliente] || ''} {os.Tipo_Servico ? `• ${os.Tipo_Servico}` : ''}
                          </div>
                        </div>
                        <ChevronRight size={18} color="#DC2626" style={{ flexShrink: 0 }} />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Visitas de Hoje */}
          {ordensHoje.length > 0 && (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '4px 0',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#C41E2A' }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: '#C41E2A' }}>
                  Hoje — {new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}
                </span>
                <span style={{
                  fontSize: 12, fontWeight: 600, color: '#9CA3AF',
                  background: '#F3F4F6', padding: '2px 8px', borderRadius: 6,
                }}>
                  {ordensHoje.length} {ordensHoje.length === 1 ? 'ordem' : 'ordens'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {ordensHoje.map((os, idx) => {
            const diario = diarios[os.Id_Ordem]
            const status = diario?.status || 'agendado'
            const isExpanded = expandido === os.Id_Ordem
            const viagens = viagensLocal[os.Id_Ordem] || []
            const rota = rotaInfo[os.Id_Ordem] || (diario ? { km: diario.distancia_km, min: diario.tempo_estimado_min } : null)
            const cidade = cidadeMap[os.Cnpj_Cliente]
            const isAtrasado = (diario?.atraso_min || 0) > 0
            const precisaJustificar = isAtrasado && !diario?.justificativa_atraso
            const isSalvando = salvando === os.Id_Ordem

            const statusColors: Record<string, { bg: string; color: string; label: string }> = {
              agendado: { bg: '#F3F4F6', color: '#6B7280', label: 'Agendado' },
              em_deslocamento: { bg: '#DBEAFE', color: '#2563EB', label: 'Em deslocamento' },
              no_cliente: { bg: '#FEF3C7', color: '#D97706', label: 'No cliente' },
              finalizado: { bg: '#D1FAE5', color: '#059669', label: 'Finalizado' },
            }
            const st = statusColors[status] || statusColors.agendado

            return (
              <div key={os.Id_Ordem} style={{
                background: '#fff', borderRadius: 16, overflow: 'hidden',
                boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
                border: precisaJustificar ? '2px solid #DC2626' : `2px solid ${isExpanded ? st.color : '#E5E7EB'}`,
              }}>
                {/* Header clicável */}
                <button type="button" onClick={() => toggleExpandir(os, idx)} style={{
                  width: '100%', padding: '14px 16px', border: 'none', cursor: 'pointer',
                  background: isExpanded ? st.bg : '#fff',
                  display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, background: st.bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: st.color }}>{idx + 1}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#C41E2A' }}>{os.Id_Ordem}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                        background: st.bg, color: st.color,
                      }}>{st.label}</span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {os.Os_Cliente}
                    </div>
                    <div style={{ fontSize: 12, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      {cidade && <><MapPin size={12} /> {cidade}</>}
                      {rota?.km && <><span style={{ color: '#D1D5DB' }}>•</span> {rota.km} km</>}
                      {rota?.min && <><span style={{ color: '#D1D5DB' }}>•</span> ~{rota.min} min</>}
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={20} color="#6B7280" /> : <ChevronDown size={20} color="#6B7280" />}
                </button>

                {/* Conteúdo expandido */}
                {isExpanded && (
                  <div style={{ padding: '0 16px 16px' }}>
                    {/* Rota */}
                    {calculandoRota === os.Id_Ordem ? (
                      <div style={{ textAlign: 'center', padding: 12 }}>
                        <div className="spinner" style={{ margin: '0 auto', width: 24, height: 24 }} />
                        <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6 }}>Calculando rota...</div>
                      </div>
                    ) : rota?.km ? (
                      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                        <div style={{ flex: 1, background: '#F3F4F6', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Navigation size={16} color="#1E3A5F" />
                          <div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#1E3A5F' }}>{rota.km} km</div>
                            <div style={{ fontSize: 10, color: '#6B7280' }}>Distância</div>
                          </div>
                        </div>
                        <div style={{ flex: 1, background: '#F3F4F6', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Clock size={16} color="#1E3A5F" />
                          <div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#1E3A5F' }}>~{rota.min} min</div>
                            <div style={{ fontSize: 10, color: '#6B7280' }}>Estimativa</div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* Info do serviço */}
                    <div style={{ background: '#F9FAFB', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13 }}>
                      <div><strong>Serviço:</strong> {os.Tipo_Servico || '-'}</div>
                      {os.Serv_Solicitado && <div style={{ marginTop: 4 }}><strong>Descrição:</strong> {os.Serv_Solicitado}</div>}
                      {os.Endereco_Cliente && <div style={{ marginTop: 4 }}><strong>Endereço:</strong> {os.Endereco_Cliente}</div>}
                    </div>

                    {/* Viagens (ida e volta) */}
                    {(status === 'no_cliente' || status === 'em_deslocamento' || status === 'finalizado') && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F', marginBottom: 10 }}>
                          Viagens ({viagens.length})
                        </div>

                        {viagens.map((v, i) => (
                          <div key={i} style={{
                            background: '#F9FAFB', borderRadius: 10, padding: 12, marginBottom: 8,
                            border: '1px solid #E5E7EB',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>
                                {i === 0 ? 'Ida principal' : `Ida/volta ${i + 1}`}
                              </span>
                              {i > 0 && status !== 'finalizado' && (
                                <button type="button" onClick={() => removerViagem(os.Id_Ordem, i)}
                                  style={{ fontSize: 12, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                                  Remover
                                </button>
                              )}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div>
                                <label style={{ fontSize: 11, color: '#6B7280' }}>Data</label>
                                <input type="date" value={v.data}
                                  disabled={status === 'finalizado'}
                                  onChange={(e) => updateViagem(os.Id_Ordem, i, 'data', e.target.value)}
                                  style={inputStyle} />
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                <div>
                                  <label style={{ fontSize: 11, color: '#6B7280' }}>Hora saída</label>
                                  <input type="time" value={v.horaSaida}
                                    disabled={status === 'finalizado'}
                                    onChange={(e) => updateViagem(os.Id_Ordem, i, 'horaSaida', e.target.value)}
                                    style={inputStyle} />
                                </div>
                                <div>
                                  <label style={{ fontSize: 11, color: '#6B7280' }}>Hora chegada</label>
                                  <input type="time" value={v.horaChegada}
                                    disabled={status === 'finalizado'}
                                    onChange={(e) => updateViagem(os.Id_Ordem, i, 'horaChegada', e.target.value)}
                                    style={inputStyle} />
                                </div>
                              </div>
                              <div>
                                <label style={{ fontSize: 11, color: '#6B7280' }}>Total KM</label>
                                <input type="text" inputMode="numeric" value={v.kmTotal}
                                  disabled={status === 'finalizado'}
                                  onChange={(e) => updateViagem(os.Id_Ordem, i, 'kmTotal', e.target.value)}
                                  style={inputStyle} placeholder="0" />
                              </div>
                              {v.horaSaidaCliente && (
                                <div>
                                  <label style={{ fontSize: 11, color: '#6B7280' }}>Saiu do cliente</label>
                                  <input type="time" value={v.horaSaidaCliente} disabled style={{ ...inputStyle, background: '#E5E7EB' }} />
                                </div>
                              )}
                            </div>
                          </div>
                        ))}

                        {status !== 'finalizado' && viagens.length < 3 && (
                          <button type="button" onClick={() => adicionarViagem(os.Id_Ordem)} style={{
                            padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                            border: '2px dashed #E5E7EB', background: '#fff', color: '#6B7280', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 4, width: '100%', justifyContent: 'center',
                          }}>
                            <Plus size={14} /> Adicionar ida/volta
                          </button>
                        )}

                        {/* Totais */}
                        {viagens.some(v => v.horaSaida && v.horaSaidaCliente) && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                            <div style={{ background: '#DBEAFE', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: '#6B7280' }}>Total Horas</div>
                              <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>{calcTotalHoras(viagens) || '—'}</div>
                            </div>
                            <div style={{ background: '#DBEAFE', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: '#6B7280' }}>Total KM</div>
                              <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>{calcTotalKm(viagens) || '—'}</div>
                            </div>
                          </div>
                        )}

                        {/* Salvar viagens */}
                        {status !== 'finalizado' && (
                          <button type="button" onClick={() => salvarViagens(os)} disabled={isSalvando} style={{
                            marginTop: 10, padding: '10px 0', borderRadius: 10, width: '100%',
                            background: '#1E3A5F', color: '#fff', border: 'none',
                            fontSize: 13, fontWeight: 700, cursor: 'pointer',
                          }}>
                            {isSalvando ? 'Salvando...' : 'Salvar horários'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Atraso */}
                    {isAtrasado && (
                      <div style={{
                        background: '#FEF2F2', borderRadius: 10, padding: '10px 12px', marginBottom: 12,
                        border: '1px solid #FECACA', display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                        <AlertTriangle size={16} color="#DC2626" />
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#DC2626' }}>
                            Atraso de {diario?.atraso_min} min
                          </span>
                          {diario?.justificativa_atraso && (
                            <div style={{ fontSize: 12, color: '#991B1B', marginTop: 2 }}>{diario.justificativa_atraso}</div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Justificativa */}
                    {pedindoJustificativa === os.Id_Ordem && (
                      <div style={{ background: '#FEF2F2', borderRadius: 12, padding: 14, marginBottom: 12, border: '2px solid #DC2626' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#DC2626', marginBottom: 8 }}>
                          Justifique o atraso de {diario?.atraso_min} minutos
                        </div>
                        <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)}
                          placeholder="Ex: Trânsito, desvio por obra..." rows={3}
                          style={{ ...inputStyle, resize: 'vertical' }} />
                        <button onClick={() => salvarJustificativaAtraso(os)} disabled={isSalvando} style={{
                          marginTop: 8, width: '100%', padding: '10px 0', borderRadius: 10,
                          background: '#DC2626', color: '#fff', border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                        }}>
                          {isSalvando ? 'Salvando...' : 'Salvar Justificativa'}
                        </button>
                      </div>
                    )}

                    {/* Botões de ação */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {status === 'agendado' && (
                        <button onClick={() => marcarSaindo(os)} disabled={isSalvando} style={{
                          padding: '14px 0', borderRadius: 12, background: '#2563EB', color: '#fff',
                          border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        }}>
                          <Play size={18} />
                          {idx === 0 ? 'Saindo da Oficina (08:15)' : 'Saindo para o cliente'}
                        </button>
                      )}

                      {status === 'em_deslocamento' && (
                        <button onClick={() => marcarCheguei(os)} disabled={isSalvando} style={{
                          padding: '14px 0', borderRadius: 12, background: '#D97706', color: '#fff',
                          border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        }}>
                          <MapPin size={18} />
                          Cheguei no Cliente
                        </button>
                      )}

                      {status === 'no_cliente' && (
                        <button onClick={() => finalizarVisita(os)} disabled={isSalvando || precisaJustificar} style={{
                          padding: '14px 0', borderRadius: 12,
                          background: precisaJustificar ? '#DC2626' : '#059669',
                          color: '#fff', border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        }}>
                          <LogOut size={18} />
                          {precisaJustificar ? 'Justificar atraso primeiro' : 'Finalizar Visita'}
                        </button>
                      )}

                      {status === 'finalizado' && (
                        <Link href={`/os/${os.Id_Ordem}/preencher`} style={{
                          padding: '14px 0', borderRadius: 12, background: '#C41E2A', color: '#fff',
                          fontSize: 15, fontWeight: 700, textDecoration: 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        }}>
                          <CheckCircle size={18} />
                          Preencher Relatório
                        </Link>
                      )}

                      {/* Abrir no Maps */}
                      {os.Endereco_Cliente && status !== 'finalizado' && (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                            [os.Endereco_Cliente, cidadeMap[os.Cnpj_Cliente]].filter(Boolean).join(', ')
                          )}&travelmode=driving`}
                          target="_blank" rel="noopener noreferrer"
                          style={{
                            padding: '10px 0', borderRadius: 10, border: '1.5px solid #E5E7EB',
                            background: '#fff', color: '#374151', fontSize: 13, fontWeight: 600,
                            textDecoration: 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          }}
                        >
                          <ExternalLink size={14} />
                          Abrir rota no Google Maps
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
