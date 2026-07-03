'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { use } from 'react'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import type { OrdemServico } from '@/lib/types'
import { getCachedOS, getCachedOSTec, getCachedCliente } from '@/lib/prefetch'
import { offlineSet } from '@/lib/offlineCache'
import {
  ArrowLeft, ClipboardEdit, CheckCircle, MapPin, User, Wrench,
  Briefcase, Clock, Navigation, FileText, Hash, Plus, AlertTriangle, Save,
} from 'lucide-react'
import Link from 'next/link'

interface DiaVisita {
  data: string
  horaChegada: string
  horaSaida: string
  kmTotal: string
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 18,
  padding: 18,
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  border: '1px solid #F3F4F6',
}

/* Cabeçalho de seção com tile de ícone sólido (estilo remap) */
function SecHeader({
  icon: Icon, color, label,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  color: string
  label: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 11, background: color, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 3px 8px rgba(0,0,0,0.12)',
      }}>
        <Icon size={18} color="#fff" strokeWidth={2.2} />
      </div>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{label}</span>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#9CA3AF',
  marginBottom: 4,
}

const valueStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#1F2937',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  border: '2px solid #E5E7EB', fontSize: 14, outline: 'none',
  background: '#fff', boxSizing: 'border-box',
}

function hoje() {
  return new Date().toISOString().split('T')[0]
}

export default function OSDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user } = useCurrentUser()
  const [os, setOs] = useState<OrdemServico | null>(null)
  const [jaPreenchida, setJaPreenchida] = useState(false)
  const [statusPreench, setStatusPreench] = useState('')
  const [dataEnvio, setDataEnvio] = useState('')
  const [existingId, setExistingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [cidade, setCidade] = useState('')

  // Registro de visita (horários)
  const [dias, setDias] = useState<DiaVisita[]>([{ data: hoje(), horaChegada: '', horaSaida: '', kmTotal: '' }])
  const [horariosRegistrados, setHorariosRegistrados] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [justificativa, setJustificativa] = useState('')
  const [precisaJustificar, setPrecisaJustificar] = useState(false)

  // Backup automático dos horários
  const getFormData = useCallback(() => ({
    dias, justificativa,
  }), [dias, justificativa])

  const setFormData = useCallback((data: Record<string, unknown>) => {
    if (data.dias) setDias(data.dias as DiaVisita[])
    if (data.justificativa) setJustificativa(data.justificativa as string)
  }, [])

  const { clear: clearBackup, restore: restoreBackup } = useFormBackup(`os-horarios-${id}`, getFormData, setFormData)

  const restoredRef = useRef(false)
  useEffect(() => {
    if (!loading && !restoredRef.current) {
      restoredRef.current = true
      restoreBackup()
    }
  }, [loading, restoreBackup])

  useEffect(() => {
    // Helper para carregar dados do cache offline (IndexedDB/prefetch)
    const carregarDoCache = async () => {
      const cachedOs = await getCachedOS(id)
      const cachedTec = await getCachedOSTec(id)
      if (cachedOs) {
        setOs(cachedOs as unknown as OrdemServico)
        if (cachedOs.Cnpj_Cliente) {
          const cachedCli = await getCachedCliente(cachedOs.Cnpj_Cliente as string)
          if (cachedCli?.cidade) setCidade(cachedCli.cidade)
        }
      }
      if (cachedTec) {
        setExistingId(cachedTec.IdOs as number)
        setJaPreenchida(true)
        setStatusPreench((cachedTec.Status as string) || '')
        if (cachedTec.Data) setDataEnvio(cachedTec.Data as string)
      }
      setLoading(false)
    }

    const carregar = async () => {
      // Se offline, usar dados do prefetch direto
      if (!navigator.onLine) {
        await carregarDoCache()
        return
      }

      const [osRes, preenchRes] = await Promise.all([
        supabase.from('Ordem_Servico').select('*').eq('Id_Ordem', id).single(),
        supabase.from('Ordem_Servico_Tecnicos').select('*').eq('Ordem_Servico', id).maybeSingle(),
      ])

      // Se a query principal falhou (rede instável), fallback para cache
      if (osRes.error && !osRes.data) {
        console.warn('[os-detalhe] Query falhou, usando cache offline...')
        await carregarDoCache()
        return
      }

      const osData = osRes.data
      const preench = preenchRes.data

      if (osData) {
        setOs(osData as OrdemServico)
        // Cache-on-read: garante que esta OS abra offline mesmo se o prefetch
        // não a pegou (throttle, OS nova, etc.)
        offlineSet(`prefetch:os:${id}`, osData)
        if (osData.Cnpj_Cliente) {
          const { data: cli } = await supabase
            .from('Clientes')
            .select('cidade')
            .eq('cnpj_cpf', osData.Cnpj_Cliente)
            .maybeSingle()
          if (cli?.cidade) setCidade(cli.cidade)
          offlineSet(`prefetch:cliente:${osData.Cnpj_Cliente}`, { cnpj_cpf: osData.Cnpj_Cliente, cidade: cli?.cidade || '' })
        }
      }
      if (preench) {
        offlineSet(`prefetch:os-tec:${id}`, preench)
        setExistingId(preench.IdOs)
        setJaPreenchida(true)
        setStatusPreench(preench.Status)
        if (preench.Data) setDataEnvio(preench.Data)

        // Carregar dias já registrados
        const diasLoaded: DiaVisita[] = []
        if (preench.DataInicio) {
          diasLoaded.push({
            data: preench.DataInicio, horaChegada: preench.InicioHora || '',
            horaSaida: preench.FinalHora || '', kmTotal: preench.InicioKm || preench.TotalKm || '',
          })
        }
        if (preench.AdicionarData2 && preench.DataInicio2) {
          diasLoaded.push({
            data: preench.DataInicio2, horaChegada: preench.InicioHora2 || '',
            horaSaida: preench.FinalHora2 || '', kmTotal: preench.InicioKm2 || '',
          })
        }
        if (preench.AdicionarData3 && preench.DataInicio3) {
          diasLoaded.push({
            data: preench.DataInicio3, horaChegada: preench.InicioHora3 || '',
            horaSaida: preench.FinalHora3 || '', kmTotal: preench.InicioKm3 || '',
          })
        }
        if (diasLoaded.length > 0) {
          setDias(diasLoaded)
          if (diasLoaded.some(d => d.horaChegada && d.horaSaida)) {
            setHorariosRegistrados(true)
          }
        }
        if (preench.JustificativaAtraso) {
          setJustificativa(preench.JustificativaAtraso)
        }
      }
      setLoading(false)
    }
    carregar().catch(async () => {
      console.warn('[os-detalhe] Rede falhou, tentando cache offline...')
      await carregarDoCache()
    })
  }, [id])

  // Aquece o RSC da tela de preencher desta OS enquanto ha internet, para que
  // "Preencher/Editar OS" abra offline (o SW guarda pela rota, ignorando ?_rsc).
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      fetch(`/os/${id}/preencher`, { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } }).catch(() => {})
    }
  }, [id])

  // Verificar se precisa justificar (atraso >= 2 dias após previsão)
  // 1 dia não é considerado atraso
  useEffect(() => {
    if (!os || !dias[0]?.data) return
    const previsao = os.Previsao_Execucao
    if (previsao) {
      const prevDate = new Date(previsao + 'T00:00:00')
      const diaDate = new Date(dias[0].data + 'T00:00:00')
      const diffDias = Math.floor((diaDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
      setPrecisaJustificar(diffDias >= 2)
    } else {
      setPrecisaJustificar(false)
    }
  }, [os, dias])

  const updateDia = (index: number, field: keyof DiaVisita, value: string) => {
    setDias(prev => prev.map((d, i) => i === index ? { ...d, [field]: value } : d))
    setHorariosRegistrados(false) // Marcar como não salvo ao editar
  }

  const calcTotalHoras = () => {
    let total = 0
    for (const d of dias) {
      if (d.horaChegada && d.horaSaida) {
        const [hi, mi] = d.horaChegada.split(':').map(Number)
        const [hf, mf] = d.horaSaida.split(':').map(Number)
        let diff = (hf * 60 + mf) - (hi * 60 + mi)
        if (diff < 0) diff += 24 * 60
        total += diff
      }
    }
    if (total <= 0) return ''
    const h = Math.floor(total / 60)
    const m = total % 60
    return `${h}h${m > 0 ? `${m}m` : ''}`
  }

  const calcTotalKm = () => {
    let total = 0
    for (const d of dias) {
      total += parseFloat(d.kmTotal) || 0
    }
    return total > 0 ? String(total) : ''
  }

  const salvarHorarios = async () => {
    if (!user) return

    // Validar que pelo menos o primeiro dia tem chegada e saída
    if (!dias[0].horaChegada || !dias[0].horaSaida) {
      alert('Preencha pelo menos a hora de chegada e saída do primeiro dia.')
      return
    }

    // Validar km total de cada dia
    const diaKmVazio = dias.findIndex(d => !d.kmTotal.trim())
    if (diaKmVazio >= 0) {
      alert(`Preencha o Total KM do dia ${diaKmVazio + 1}.`)
      return
    }

    // Validar justificativa se necessário
    if (precisaJustificar && !justificativa.trim()) {
      alert('Informe a justificativa do atraso (serviço iniciado após a previsão de execução).')
      return
    }

    setSalvando(true)

    const payload: Record<string, unknown> = {
      Ordem_Servico: id,
      TecResp1: user.tecnico_nome,
      // Dia 1
      DataInicio: dias[0]?.data || '',
      DataFinal: dias[dias.length - 1]?.data || dias[0]?.data || '',
      InicioHora: dias[0]?.horaChegada || '',
      FinalHora: dias[0]?.horaSaida || '',
      InicioKm: dias[0]?.kmTotal || '',
      FinalKm: '',
      // Dia 2
      AdicionarData2: dias.length >= 2,
      DataInicio2: dias[1]?.data || '',
      InicioHora2: dias[1]?.horaChegada || '',
      FinalHora2: dias[1]?.horaSaida || '',
      InicioKm2: dias[1]?.kmTotal || '',
      FinalKm2: '',
      // Dia 3
      AdicionarData3: dias.length >= 3,
      DataInicio3: dias[2]?.data || '',
      InicioHora3: dias[2]?.horaChegada || '',
      FinaHora3: dias[2]?.horaSaida || '',
      InicioKm3: dias[2]?.kmTotal || '',
      FinalKm3: '',
      TotalHora: calcTotalHoras(),
      TotalKm: calcTotalKm(),
      Data: hoje(),
      Status: 'rascunho',
      pdf_criado: false,
      JustificativaAtraso: precisaJustificar ? justificativa.trim() : null,
    }

    if (existingId) {
      const res = await offlineWrite({
        table: 'Ordem_Servico_Tecnicos', action: 'update',
        data: payload, match: { IdOs: existingId },
      })
      if (!res.ok) { setSalvando(false); alert('Erro ao salvar: ' + (res.error || 'Erro desconhecido')); return }
    } else {
      if (navigator.onLine) {
        const { data } = await supabase.from('Ordem_Servico_Tecnicos').insert(payload).select('IdOs').single()
        if (data) {
          setExistingId(data.IdOs)
          setJaPreenchida(true)
          setStatusPreench('rascunho')
        }
      } else {
        const res = await offlineWrite({ table: 'Ordem_Servico_Tecnicos', action: 'insert', data: payload })
        if (!res.ok) { setSalvando(false); alert('Erro ao salvar: ' + (res.error || 'Erro desconhecido')); return }
      }
    }

    setHorariosRegistrados(true)
    setSalvando(false)
    clearBackup()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!os) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      {!navigator.onLine ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1F2937' }}>Dados nao disponíveis offline</div>
          <div style={{ fontSize: 13, color: '#6B7280', maxWidth: 280, lineHeight: 1.6 }}>
            Conecte-se a internet para baixar os dados desta OS. Depois, ela ficara disponivel mesmo sem sinal.
          </div>
          <Link href="/os" style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: '#1E3A5F', textDecoration: 'none' }}>
            ← Voltar para lista
          </Link>
        </div>
      ) : (
        <div style={{ color: '#9CA3AF' }}>OS nao encontrada</div>
      )}
    </div>
  )

  const jaEnviada = jaPreenchida && statusPreench === 'enviado'
  const dentroPrazo48h = (() => {
    if (!dataEnvio) return false
    const envio = new Date(dataEnvio + 'T00:00:00')
    const agora = new Date()
    const diffMs = agora.getTime() - envio.getTime()
    return diffMs < 48 * 60 * 60 * 1000
  })()
  const formatarData = (d: string) => {
    if (!d) return ''
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  // Técnico primário x secundário: só o primário preenche o relatório.
  const nomeTec = user?.nome_pos || user?.tecnico_nome || ''
  const osAny = os as OrdemServico & { Os_Tecnico?: string | null; Os_Tecnico2?: string | null }
  const matchTec = (f?: string | null) => !!f && !!nomeTec && f.toLowerCase().includes(nomeTec.toLowerCase())
  const isSecundario = !matchTec(osAny.Os_Tecnico) && matchTec(osAny.Os_Tecnico2)
  const tecPrimario = (osAny.Os_Tecnico || '').trim()

  // Atrasada para preencher: previsão vencida e ainda não enviada.
  const prevExec = (os.Previsao_Execucao || '').trim()
  const atrasada = !jaEnviada && !!prevExec && prevExec < hoje()

  return (
    <div>
      <Link href="/os" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        color: '#C41E2A', fontSize: 15, fontWeight: 600,
        textDecoration: 'none', marginBottom: 16, padding: '8px 0',
      }}>
        <ArrowLeft size={20} /> Voltar
      </Link>

      {/* Header OS */}
      <div className="hb-in" style={{
        background: 'linear-gradient(135deg, #C41E2A, #9B1520)', borderRadius: 20,
        padding: 20, color: '#fff', marginBottom: 20,
        boxShadow: '0 8px 20px rgba(196,30,42,0.25)',
      }}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Ordem de Serviço</div>
        <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{os.Id_Ordem}</div>
        <div style={{
          display: 'inline-block', marginTop: 10,
          background: 'rgba(255,255,255,0.2)', borderRadius: 8,
          padding: '4px 12px', fontSize: 12, fontWeight: 700,
        }}>
          {os.Status}
        </div>
      </div>

      {/* Faixa vermelha pulsante: OS atrasada para preencher */}
      {atrasada && (
        <div className="animate-pulse-alert" style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#DC2626', color: '#fff', borderRadius: 14,
          padding: '14px 16px', marginBottom: 20, fontWeight: 700,
          boxShadow: '0 6px 18px rgba(220,38,38,0.35)',
        }}>
          <AlertTriangle size={20} />
          <div style={{ fontSize: 14 }}>
            OS atrasada — previsão de execução venceu em {formatarData(prevExec)}
          </div>
        </div>
      )}

      {/* Técnico secundário: só o primário preenche */}
      {isSecundario && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 16,
          padding: '16px 18px', marginBottom: 20,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: '#D97706',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Clock size={22} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#B45309' }}>
              Aguardando {tecPrimario || 'o técnico responsável'} preencher o relatório
            </div>
            <div style={{ fontSize: 13, color: '#92400E', marginTop: 2 }}>
              Você é o técnico secundário — pode ver as informações, mas o preenchimento é do técnico principal.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>

        {/* Client info card */}
        <div className="hb-in" style={{ ...cardStyle, animationDelay: '60ms' }}>
          <SecHeader icon={User} color="#C41E2A" label="Cliente" />
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1F2937' }}>{os.Os_Cliente}</div>
          {os.Cnpj_Cliente && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 13, color: '#6B7280' }}>
              <Hash size={14} /> {os.Cnpj_Cliente}
            </div>
          )}
          {cidade && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 13, color: '#1E3A5F', fontWeight: 600 }}>
              <MapPin size={14} /> {cidade}
            </div>
          )}
          {os.Endereco_Cliente && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 13, color: '#6B7280' }}>
              <MapPin size={14} /> {os.Endereco_Cliente}
            </div>
          )}
        </div>

        {/* Service info card */}
        <div className="hb-in" style={{ ...cardStyle, animationDelay: '120ms' }}>
          <SecHeader icon={Briefcase} color="#1E3A5F" label="Serviço" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={labelStyle}>Tipo de Serviço</div>
              <div style={valueStyle}>{os.Tipo_Servico || '-'}</div>
            </div>
            <div>
              <div style={labelStyle}>Projeto</div>
              <div style={valueStyle}>{os.Projeto || '-'}</div>
            </div>
          </div>

          {os.Serv_Solicitado && (
            <div>
              <div style={labelStyle}>Descrição do Serviço</div>
              <div style={{ fontSize: 14, lineHeight: 1.5, color: '#1F2937', marginTop: 2 }}>
                {os.Serv_Solicitado}
              </div>
            </div>
          )}
        </div>

        {/* Numbers row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="hb-in" style={{ ...cardStyle, animationDelay: '180ms' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Clock size={14} color="#1E3A5F" />
              <span style={labelStyle}>Horas</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1E3A5F' }}>
              {os.Qtd_HR ?? '-'}
              {typeof os.Qtd_HR === 'number' && <span style={{ fontSize: 13, fontWeight: 500, color: '#6B7280' }}> h</span>}
            </div>
          </div>
          <div className="hb-in" style={{ ...cardStyle, animationDelay: '220ms' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Navigation size={14} color="#1E3A5F" />
              <span style={labelStyle}>Deslocamento</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1E3A5F' }}>
              {os.Qtd_KM ?? '-'}
              {typeof os.Qtd_KM === 'number' && <span style={{ fontSize: 13, fontWeight: 500, color: '#6B7280' }}> km</span>}
            </div>
          </div>
        </div>

        {/* PPV card */}
        {os.ID_PPV && (
          <div className="hb-in" style={{
            ...cardStyle,
            borderLeft: '4px solid #1E3A5F',
            animationDelay: '260ms',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={16} color="#1E3A5F" />
              <div>
                <div style={labelStyle}>PPV</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1E3A5F' }}>{os.ID_PPV}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========== REGISTRO DE HORÁRIOS (NOVO) ========== */}
      {!isSecundario && !jaEnviada && (
        <div className="hb-in" style={{
          background: '#fff', borderRadius: 20, padding: 18,
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: 20,
          border: horariosRegistrados ? '1.5px solid #A7F3D0' : '1.5px solid #BFDBFE',
          animationDelay: '300ms',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 11, flexShrink: 0,
                background: horariosRegistrados ? '#059669' : '#2563EB',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 3px 8px rgba(0,0,0,0.12)',
              }}>
                <Clock size={18} color="#fff" strokeWidth={2.2} />
              </div>
              <span style={{ fontSize: 16, fontWeight: 600, color: horariosRegistrados ? '#059669' : '#1E3A5F' }}>
                Registrar Horários
              </span>
            </div>
            {horariosRegistrados && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 8,
                background: '#D1FAE5', color: '#059669',
              }}>
                Salvo
              </span>
            )}
          </div>

          <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
            Informe os horários de chegada e saída no cliente antes de preencher o relatório.
          </p>

          {/* Previsão de execução */}
          {os.Previsao_Execucao && (
            <div style={{
              background: '#F9FAFB', borderRadius: 10, padding: '10px 14px', marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
            }}>
              <Clock size={14} color="#6B7280" />
              <span style={{ color: '#6B7280' }}>Previsão de execução:</span>
              <strong style={{ color: '#1E3A5F' }}>{formatarData(os.Previsao_Execucao)}</strong>
            </div>
          )}

          {/* Dias de visita */}
          {dias.map((dia, i) => (
            <div key={i} style={{
              background: '#F9FAFB', borderRadius: 12, padding: 14, marginBottom: 10,
              border: '1px solid #E5E7EB',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>
                  Dia {i + 1}
                </span>
                {i > 0 && (
                  <button type="button" onClick={() => {
                    setDias(prev => prev.filter((_, idx) => idx !== i))
                    setHorariosRegistrados(false)
                  }}
                    style={{ fontSize: 12, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                    Remover
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#6B7280' }}>Data</label>
                  <input type="date" value={dia.data}
                    onChange={(e) => updateDia(i, 'data', e.target.value)}
                    style={inputStyle} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#6B7280' }}>Hora chegada</label>
                    <input type="time" value={dia.horaChegada}
                      onChange={(e) => updateDia(i, 'horaChegada', e.target.value)}
                      style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#6B7280' }}>Hora saída</label>
                    <input type="time" value={dia.horaSaida}
                      onChange={(e) => updateDia(i, 'horaSaida', e.target.value)}
                      style={inputStyle} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#6B7280' }}>Total KM</label>
                  <input type="text" inputMode="numeric" value={dia.kmTotal}
                    onChange={(e) => updateDia(i, 'kmTotal', e.target.value)}
                    style={inputStyle} placeholder="0" />
                </div>
              </div>
            </div>
          ))}

          {/* Botão adicionar dia */}
          {dias.length < 3 && (
            <button type="button" onClick={() => {
              setDias(prev => [...prev, { data: hoje(), horaChegada: '', horaSaida: '', kmTotal: '' }])
              setHorariosRegistrados(false)
            }} style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              border: '2px dashed #E5E7EB', background: '#fff', color: '#6B7280', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4, width: '100%', justifyContent: 'center',
              marginBottom: 10,
            }}>
              <Plus size={14} /> Adicionar mais um dia
            </button>
          )}

          {/* Totais */}
          {dias.some(d => d.horaChegada && d.horaSaida) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div style={{ background: '#DBEAFE', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#6B7280' }}>Total Horas</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>{calcTotalHoras() || '—'}</div>
              </div>
              <div style={{ background: '#DBEAFE', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#6B7280' }}>Total KM</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>{calcTotalKm() || '—'}</div>
              </div>
            </div>
          )}

          {/* Justificativa de atraso */}
          {precisaJustificar && (
            <div style={{
              background: '#FEF2F2', borderRadius: 12, padding: 14, marginBottom: 12,
              border: '2px solid #FECACA',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <AlertTriangle size={18} color="#DC2626" />
                <span style={{ fontSize: 14, fontWeight: 700, color: '#DC2626' }}>
                  Justificativa de Atraso
                </span>
              </div>
              <p style={{ fontSize: 12, color: '#991B1B', marginBottom: 8 }}>
                A data de início ({formatarData(dias[0].data)}) é posterior à previsão de execução ({formatarData(os.Previsao_Execucao)}).
                Explique o motivo do atraso.
              </p>
              <textarea
                value={justificativa}
                onChange={(e) => { setJustificativa(e.target.value); setHorariosRegistrados(false) }}
                placeholder="Ex: Aguardando peças, cliente indisponível..."
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
          )}

          {/* Botão salvar */}
          <button type="button" onClick={salvarHorarios} disabled={salvando} className="hb" style={{
            width: '100%', padding: '14px 0', borderRadius: 14,
            background: salvando ? '#9CA3AF' : '#1E3A5F', color: '#fff',
            border: 'none', fontSize: 15, fontWeight: 600, cursor: salvando ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Save size={18} />
            {salvando ? 'Salvando...' : 'Salvar Horários'}
          </button>
        </div>
      )}

      {/* Fill/edit button (bloqueado para o técnico secundário) */}
      {!isSecundario && (jaEnviada ? (
        dentroPrazo48h ? (
          <Link href={`/os/${os.Id_Ordem}/preencher`} className="hb" style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: '#D97706', color: '#fff', borderRadius: 18, padding: '22px 20px',
            textDecoration: 'none',
            boxShadow: '0 6px 20px rgba(217,119,6,0.3)',
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <ClipboardEdit size={26} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Editar OS Enviada</div>
              <div style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>Você tem até 48h após o envio para corrigir</div>
            </div>
          </Link>
        ) : (
          <div style={{
            background: '#D1FAE5', borderRadius: 16, padding: '20px 18px',
            display: 'flex', alignItems: 'center', gap: 14,
            border: '2px solid #6EE7B7',
          }}>
            <CheckCircle size={28} color="#059669" />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#059669' }}>OS enviada</div>
              <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>Prazo de 48h para edição expirado.</div>
            </div>
          </div>
        )
      ) : !horariosRegistrados ? (
        <div style={{
          background: '#F3F4F6', borderRadius: 16, padding: '20px 18px',
          display: 'flex', alignItems: 'center', gap: 14,
          border: '2px solid #E5E7EB',
        }}>
          <Clock size={28} color="#9CA3AF" />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#6B7280' }}>Registre os horários primeiro</div>
            <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 2 }}>Salve os horários de chegada e saída para liberar o preenchimento do relatório.</div>
          </div>
        </div>
      ) : (
        <Link href={`/os/${os.Id_Ordem}/preencher`} className="hb" style={{
          display: 'flex', alignItems: 'center', gap: 14,
          background: jaPreenchida ? '#1E3A5F' : 'linear-gradient(135deg, #C41E2A, #9B1520)',
          color: '#fff', borderRadius: 18, padding: '22px 20px',
          textDecoration: 'none',
          boxShadow: jaPreenchida ? '0 6px 20px rgba(30,58,95,0.3)' : '0 6px 20px rgba(196,30,42,0.3)',
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {jaPreenchida ? <Wrench size={26} /> : <ClipboardEdit size={26} />}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {jaPreenchida ? 'Editar OS Técnica' : 'Preencher OS Técnica'}
            </div>
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>
              {jaPreenchida ? 'Rascunho salvo — toque para continuar' : 'Horários registrados — preencha o relatório'}
            </div>
          </div>
        </Link>
      ))}

      <div style={{ height: 20 }} />
    </div>
  )
}
