'use client'
import { numeroBR } from '@/lib/numero'
import { hojeBR } from '@/lib/hoje'
import { useEffect, useState, useCallback, useRef } from 'react'
import { use } from 'react'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import type { OrdemServico } from '@/lib/types'
import { getCachedOS, getCachedOSTec, getCachedCliente } from '@/lib/prefetch'
import { offlineSet, addPendingPdf } from '@/lib/offlineCache'
import { sincronizarTudo } from '@/lib/syncManager'
import { diasDoRegistro, buscarRelatorioDaOS, minutosDoDia, horasTexto, atualizarCacheRelatorio } from '@/lib/diasRelatorio'
import {
  ArrowLeft, ClipboardEdit, CheckCircle, MapPin, User, Wrench,
  Briefcase, Clock, Navigation, FileText, Hash, Plus, AlertTriangle, Save,
} from 'lucide-react'
import { ResservicoAviso } from '@/components/ResservicoAviso'
import { infoResservico } from '@/lib/resservico'
import { colors } from '@/lib/ui'
import Link from 'next/link'

interface DiaVisita {
  data: string
  horaChegada: string
  horaSaida: string
  kmTotal: string
  /** saída antes da chegada confirmada como virada da meia-noite (José, 23/10/2026) */
  virouNoite?: boolean
}

/** até quantos dias: o mesmo do preencher */
const MAX_DIAS = 10

/* ── Estilo POS NewPortal (22/10/2026): cartões brancos, texto escuro, sem negrito, cor da situação no ícone/etiqueta ── */
const cardStyle: React.CSSProperties = {
  background: colors.surface,
  borderRadius: 16,
  padding: 16,
  border: `1px solid ${colors.border}`,
  boxShadow: '0 10px 24px -20px rgba(15,23,42,.5)',
  minWidth: 0,
}

/** quadradinho do ícone: cheio (cor da situação) ou clarinho (cor a ~9%) */
function IconeQuad({
  icon: Icon, cor, cheio = false, tam = 38,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  cor: string
  cheio?: boolean
  tam?: number
}) {
  return (
    <span style={{
      width: tam, height: tam, borderRadius: 11, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: cheio ? cor : `color-mix(in srgb, ${cor} 9%, #FEFEFE)`,
      border: cheio ? 'none' : `1px solid color-mix(in srgb, ${cor} 16%, transparent)`,
      color: cheio ? '#fff' : cor,
    }}>
      <Icon size={Math.round(tam * 0.47)} color={cheio ? '#fff' : cor} strokeWidth={2} />
    </span>
  )
}

/* Cabeçalho de seção: ícone em quadradinho clarinho + título peso 500 */
function SecHeader({
  icon, color, label, sub,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  color: string
  label: string
  sub?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12, minWidth: 0 }}>
      <IconeQuad icon={icon} cor={color} />
      <div style={{ display: 'grid', minWidth: 0, lineHeight: 1.25 }}>
        <span style={{ fontSize: 16, fontWeight: 500, color: colors.text }}>{label}</span>
        {sub && <span style={{ fontSize: 12.5, color: colors.textMuted }}>{sub}</span>}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: colors.textMuted,
  marginBottom: 3,
}

const valueStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 500,
  color: colors.text,
  overflowWrap: 'anywhere',
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 46, padding: '0 14px', borderRadius: 12,
  border: `1px solid ${colors.border}`, fontSize: 16, outline: 'none',
  background: '#fff', boxSizing: 'border-box', color: colors.text, minWidth: 0,
}

const rotuloCampo: React.CSSProperties = { display: 'block', fontSize: 13, color: colors.textMuted, marginBottom: 5 }

/* foco dos campos (borda azul-clara + anel), só nesta tela */
const CSS_CAMPOS = `
.osd-campo:focus { border-color: #38BDF8 !important; box-shadow: 0 0 0 3px rgba(14,165,233,.15) }
.osd-campo[type="date"], .osd-campo[type="time"] { -webkit-appearance: none; appearance: none }
`

function hoje() {
  return hojeBR()
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
    const TEMPO = 8000
    const comTempo = <T,>(p: PromiseLike<T>): Promise<T> =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TEMPO))])

    /** relatório salvo → horários na tela (banco ou cache — offline também restaura os dias) */
    const aplicarRegistro = (preench: Record<string, unknown>) => {
      setExistingId((preench.IdOs as number) || null)
      setJaPreenchida(true)
      setStatusPreench(String(preench.Status || ''))
      if (preench.Data) setDataEnvio(String(preench.Data))
      // Dias já registrados (até 10, como no preencher — DiasExecucao; senão as colunas antigas)
      const diasLoaded: DiaVisita[] = diasDoRegistro(preench).map((d) => ({
        data: d.data, horaChegada: d.horaInicio, horaSaida: d.horaFim, kmTotal: d.kmTotal,
        virouNoite: !!d.virouNoite,
      }))
      if (diasLoaded.length > 0) {
        setDias(diasLoaded)
        if (diasLoaded.some(d => d.horaChegada && d.horaSaida)) setHorariosRegistrados(true)
      }
      if (preench.JustificativaAtraso) setJustificativa(String(preench.JustificativaAtraso))
    }

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
      if (cachedTec) aplicarRegistro(cachedTec as Record<string, unknown>)
      setLoading(false)
    }

    const carregar = async () => {
      // Se offline, usar dados do prefetch direto
      if (!navigator.onLine) {
        await carregarDoCache()
        return
      }

      const [osRes, preenchRes] = await Promise.all([
        comTempo(supabase.from('Ordem_Servico').select('*').eq('Id_Ordem', id).single()),
        // a melhor linha (enviado > rascunho, mais nova): com 2 linhas o .maybeSingle() quebrava
        buscarRelatorioDaOS(id, '*', TEMPO),
      ])

      // Se a query principal falhou (rede instável), fallback para cache
      if (osRes.error && !osRes.data) {
        console.warn('[os-detalhe] Query falhou, usando cache offline...')
        await carregarDoCache()
        return
      }

      const osData = osRes.data
      // consulta do relatório falhou: usa o do cache (não mostrar "sem horários" por cima do salvo)
      const preench = preenchRes.error
        ? ((await getCachedOSTec(id)) as Record<string, unknown> | null)
        : preenchRes.data

      if (osData) {
        setOs(osData as OrdemServico)
        // Cache-on-read: garante que esta OS abra offline mesmo se o prefetch
        // não a pegou (throttle, OS nova, etc.)
        offlineSet(`prefetch:os:${id}`, osData)
        if (osData.Cnpj_Cliente) {
          // cadastro de clientes do Omie no portal (a tabela "Clientes" não existe)
          const cli = await comTempo(supabase
            .from('portal_nt_clientes_cadastro_omie')
            .select('cidade')
            .eq('cnpj_cpf', osData.Cnpj_Cliente)
            .limit(1)).then((r) => (r.data?.[0] as { cidade?: string } | undefined) || null, () => null)
          if (cli?.cidade) {
            setCidade(cli.cidade)
            offlineSet(`prefetch:cliente:${osData.Cnpj_Cliente}`, { cnpj_cpf: osData.Cnpj_Cliente, cidade: cli.cidade })
          } else {
            const cachedCli = await getCachedCliente(osData.Cnpj_Cliente as string)
            if (cachedCli?.cidade) setCidade(cachedCli.cidade)
          }
        }
      }
      if (preench) {
        if (!preenchRes.error) offlineSet(`prefetch:os-tec:${id}`, preench)
        aplicarRegistro(preench)
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
      fetch(`/os/${id}/preencher`, { headers: { RSC: '1' } }).catch(() => {})
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
    setDias(prev => prev.map((d, i) => i === index
      ? { ...d, [field]: value, ...(field === 'horaChegada' || field === 'horaSaida' ? { virouNoite: false } : {}) }
      : d))
    setHorariosRegistrados(false) // Marcar como não salvo ao editar
  }

  // saída antes da chegada só conta (+24h) com a confirmação de que passou da meia-noite
  const calcTotalHoras = () => horasTexto(dias.reduce((s, d) => {
    const r = minutosDoDia(d.horaChegada, d.horaSaida)
    return s + (r.virou && !d.virouNoite ? 0 : r.min)
  }, 0))

  const calcTotalKm = () => {
    let total = 0
    for (const d of dias) {
      total += numeroBR(d.kmTotal) || 0
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

    // Saída antes da chegada sem confirmar a virada da meia-noite
    const diaVirou = dias.findIndex(d => minutosDoDia(d.horaChegada, d.horaSaida).virou && !d.virouNoite)
    if (diaVirou >= 0) {
      alert(`Dia ${diaVirou + 1}: a hora de saída está antes da chegada. Corrija ou confirme que passou da meia-noite.`)
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
      // todos os dias (até 10) no formato do preencher
      DiasExecucao: dias.map((d) => ({ data: d.data, horaInicio: d.horaChegada, horaFim: d.horaSaida, kmTotal: d.kmTotal, ...(d.virouNoite ? { virouNoite: true } : {}) })),
      Data: hoje(),
      JustificativaAtraso: precisaJustificar ? justificativa.trim() : null,
    }
    // relatório já enviado nunca volta a rascunho (antes "Salvar horários" regravava 'rascunho' por cima)
    if (statusPreench !== 'enviado') { payload.Status = 'rascunho'; payload.pdf_criado = false }
    else {
      // já enviado: não troca a data do envio nem o técnico responsável; o PDF é refeito com as horas novas
      // (José, 23/10/2026)
      delete payload.Data; delete payload.TecResp1
      payload.pdf_criado = false
    }

    // Um relatório por OS: o offlineWrite grava por Ordem_Servico (update se existe, senão insert) e CONFERE o
    // erro — antes, online, o insert não olhava o erro e a tela mostrava "Salvo" e apagava o rascunho.
    const res = await offlineWrite({
      table: 'Ordem_Servico_Tecnicos',
      action: existingId ? 'update' : 'insert',
      data: payload,
      match: existingId ? { IdOs: existingId } : undefined,
    })
    if (!res.ok) { setSalvando(false); alert('Erro ao salvar: ' + (res.error || 'Erro desconhecido')); return }
    if (res.idOs) setExistingId(res.idOs)
    setJaPreenchida(true)
    if (statusPreench !== 'enviado') setStatusPreench('rascunho')

    // Atualiza o cache de leitura para a tela de preencher enxergar os horários
    // salvos (importante offline, quando o registro ainda está só na fila).
    await atualizarCacheRelatorio(id, { ...payload, ...(res.idOs ? { IdOs: res.idOs } : {}) }, { nome: user.nome_pos || user.tecnico_nome })

    // relatório enviado com horas novas: PDF pendente, refeito depois que a fila subir
    if (statusPreench === 'enviado') {
      await addPendingPdf(id)
      if (navigator.onLine) void sincronizarTudo()
    }

    setHorariosRegistrados(true)
    setSalvando(false)
    clearBackup()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!os) return (
    <div style={{ padding: '40px 16px', textAlign: 'center' }}>
      {!navigator.onLine ? (
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 24 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: colors.warningBg, border: `1px solid ${colors.warningBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={colors.warning} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
          </div>
          <div style={{ fontSize: 17, fontWeight: 500, color: colors.text }}>Dados não disponíveis offline</div>
          <div style={{ fontSize: 14, color: colors.textMuted, maxWidth: 300, lineHeight: 1.55 }}>
            Conecte-se à internet para baixar os dados desta OS. Depois, ela ficará disponível mesmo sem sinal.
          </div>
          <Link href="/os" style={{ marginTop: 6, fontSize: 15, fontWeight: 500, color: colors.primary, textDecoration: 'none' }}>
            ← Voltar para a lista
          </Link>
        </div>
      ) : (
        <div style={{ color: colors.textSubtle, fontSize: 15 }}>OS não encontrada</div>
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

  // Cor da situação (mesma regra do app todo: roxo para fazer, azul execução, laranja peças, verde feita,
  // vermelho atrasada, vinho resserviço) — só visual, não muda nada da OS.
  const statusTxt = String(os.Status || '')
  const ehResservico = !!infoResservico(os as { resservico_de?: string | null; Serv_Solicitado?: string | null })
  const sit: { rot: string; cor: string; dica: string } = (() => {
    if (jaEnviada || /Conclu|Relat|Executada|Omie|Cobrando/i.test(statusTxt)) return { rot: 'Feita', cor: colors.osFeita, dica: jaEnviada ? 'relatório enviado' : 'serviço concluído' }
    if (ehResservico) return { rot: 'Resserviço', cor: colors.osResservico, dica: 'voltar para refazer' }
    if (atrasada) return { rot: 'Atrasada', cor: colors.osAtrasada, dica: 'a previsão já passou' }
    if (/Or[çc]amento/i.test(statusTxt)) return { rot: 'Orçamento', cor: '#0891B2', dica: 'esperando o cliente aprovar' }
    if (/pe[çc]as/i.test(statusTxt)) return { rot: 'Esperando peças', cor: colors.osPecas, dica: 'parada pela peça' }
    if (/Execu/i.test(statusTxt)) return { rot: 'Em execução', cor: colors.osExecucao, dica: 'você está fazendo' }
    if (/^Aguardando/i.test(statusTxt)) return { rot: 'Para fazer', cor: colors.osFazer, dica: 'ainda não começou' }
    return { rot: statusTxt || 'Ordem de serviço', cor: colors.textSubtle, dica: '' }
  })()
  const numeroOS = String(os.Id_Ordem || id).replace(/^OS-?/i, '')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 0, minWidth: 0 }}>
      <style>{CSS_CAMPOS}</style>
      <Link href="/os" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, justifySelf: 'start',
        color: colors.primary, fontSize: 15, fontWeight: 500,
        textDecoration: 'none', marginBottom: 12, padding: '8px 0',
      }}>
        <ArrowLeft size={20} /> Voltar
      </Link>

      {/* Cabeçalho da OS: cartão branco, faixa no topo com a situação, etiqueta "OS 0846" */}
      <div className="hb-in" style={{ ...cardStyle, padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
          padding: '7px 16px', background: sit.cor, color: '#FEFEFE',
        }}>
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>{sit.rot}</span>
          {sit.dica && <span style={{ fontSize: 12.5, opacity: 0.9 }}>{sit.dica}</span>}
        </div>
        <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <IconeQuad icon={FileText} cor={sit.cor} cheio tam={44} />
          <div style={{ display: 'grid', gap: 5, minWidth: 0, flex: 1 }}>
            <span style={{
              justifySelf: 'start', display: 'inline-flex', alignItems: 'baseline', gap: 5,
              fontSize: 14, padding: '1px 9px', borderRadius: 8, color: colors.text,
              fontVariantNumeric: 'tabular-nums',
              background: `color-mix(in srgb, ${sit.cor} 8%, #FEFEFE)`,
              border: `1px solid color-mix(in srgb, ${sit.cor} 22%, transparent)`,
            }}>
              <span style={{ fontSize: 11.5, color: sit.cor }}>OS</span>{numeroOS}
            </span>
            <span style={{ fontSize: 18, fontWeight: 500, color: colors.text, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
              {os.Os_Cliente || 'Cliente'}
            </span>
          </div>
        </div>
        {statusTxt && (
          <div style={{ padding: '0 16px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '3px 10px',
              borderRadius: 999, color: colors.text, background: '#FEFEFE', border: `1px solid ${colors.border}`,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: sit.cor }} />
              {statusTxt}
            </span>
            {os.Previsao_Execucao && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, padding: '3px 10px',
                borderRadius: 999, color: colors.textMuted, background: '#FEFEFE', border: `1px solid ${colors.border}`,
              }}>
                <Clock size={12} /> Previsão {formatarData(os.Previsao_Execucao)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Resserviço: o técnico volta para refazer o serviço de outra OS (José, 22/10/2026) */}
      <ResservicoAviso os={os} />

      {/* Faixa vermelha clara: OS atrasada para preencher */}
      {atrasada && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: colors.dangerBg, border: `1px solid ${colors.dangerBorder}`, borderRadius: 16,
          padding: '12px 14px', marginBottom: 14, color: '#991B1B',
        }}>
          <span className="animate-pulse-alert" style={{ display: 'flex' }}>
            <IconeQuad icon={AlertTriangle} cor={colors.osAtrasada} cheio />
          </span>
          <div style={{ display: 'grid', minWidth: 0, lineHeight: 1.3 }}>
            <span style={{ fontSize: 15, fontWeight: 500 }}>OS atrasada</span>
            <span style={{ fontSize: 13, color: '#B91C1C' }}>A previsão de execução venceu em {formatarData(prevExec)}</span>
          </div>
        </div>
      )}

      {/* Técnico secundário: só o primário preenche */}
      {isSecundario && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: colors.warningBg, border: `1px solid ${colors.warningBorder}`, borderRadius: 16,
          padding: '14px 16px', marginBottom: 14,
        }}>
          <IconeQuad icon={Clock} cor={colors.osPecas} cheio tam={42} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#9A3412', overflowWrap: 'anywhere' }}>
              Aguardando {tecPrimario || 'o técnico responsável'} preencher o relatório
            </div>
            <div style={{ fontSize: 13, color: '#9A3412', marginTop: 2, lineHeight: 1.45 }}>
              Você é o técnico secundário — pode ver as informações, mas o preenchimento é do técnico principal.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, marginBottom: 18 }}>

        {/* Cliente */}
        <div className="hb-in" style={{ ...cardStyle, animationDelay: '60ms' }}>
          <SecHeader icon={User} color={colors.primary} label="Cliente" />
          <div style={{ fontSize: 16, fontWeight: 500, color: colors.text, overflowWrap: 'anywhere' }}>{os.Os_Cliente}</div>
          {os.Cnpj_Cliente && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, fontSize: 14, color: colors.textMuted, overflowWrap: 'anywhere' }}>
              <Hash size={15} style={{ flexShrink: 0 }} /> {os.Cnpj_Cliente}
            </div>
          )}
          {cidade && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, fontSize: 14, color: colors.text, overflowWrap: 'anywhere' }}>
              <MapPin size={15} color={colors.primary} style={{ flexShrink: 0 }} /> {cidade}
            </div>
          )}
          {os.Endereco_Cliente && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 6, fontSize: 14, color: colors.textMuted, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
              <MapPin size={15} style={{ flexShrink: 0, marginTop: 2 }} /> {os.Endereco_Cliente}
            </div>
          )}
        </div>

        {/* Serviço */}
        <div className="hb-in" style={{ ...cardStyle, animationDelay: '120ms' }}>
          <SecHeader icon={Briefcase} color={colors.primary} label="Serviço" />

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginBottom: os.Serv_Solicitado ? 12 : 0 }}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>Tipo de serviço</div>
              <div style={valueStyle}>{os.Tipo_Servico || '-'}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>Projeto</div>
              <div style={valueStyle}>{os.Projeto || '-'}</div>
            </div>
          </div>

          {os.Serv_Solicitado && (
            <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: '10px 12px' }}>
              <div style={labelStyle}>Descrição do serviço</div>
              <div style={{ fontSize: 15, lineHeight: 1.5, color: colors.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {os.Serv_Solicitado}
              </div>
            </div>
          )}
        </div>

        {/* Números */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
          <div className="hb-in" style={{ ...cardStyle, padding: '12px 14px', animationDelay: '180ms' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.textMuted, fontSize: 13 }}>
              <Clock size={15} color={colors.primary} /> Horas
            </div>
            <div style={{ fontSize: 26, fontWeight: 500, color: colors.text, marginTop: 4, lineHeight: 1.1 }}>
              {os.Qtd_HR ?? '-'}
              {typeof os.Qtd_HR === 'number' && <span style={{ fontSize: 14, fontWeight: 400, color: colors.textSubtle }}> h</span>}
            </div>
          </div>
          <div className="hb-in" style={{ ...cardStyle, padding: '12px 14px', animationDelay: '220ms' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.textMuted, fontSize: 13 }}>
              <Navigation size={15} color={colors.primary} /> Deslocamento
            </div>
            <div style={{ fontSize: 26, fontWeight: 500, color: colors.text, marginTop: 4, lineHeight: 1.1 }}>
              {os.Qtd_KM ?? '-'}
              {typeof os.Qtd_KM === 'number' && <span style={{ fontSize: 14, fontWeight: 400, color: colors.textSubtle }}> km</span>}
            </div>
          </div>
        </div>

        {/* PPV */}
        {os.ID_PPV && (
          <div className="hb-in" style={{ ...cardStyle, padding: '12px 14px', animationDelay: '260ms', display: 'flex', alignItems: 'center', gap: 12 }}>
            <IconeQuad icon={FileText} cor={colors.primary} />
            <div style={{ minWidth: 0 }}>
              <div style={{ ...labelStyle, marginBottom: 1 }}>PPV (peças separadas)</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: colors.text, overflowWrap: 'anywhere' }}>{os.ID_PPV}</div>
            </div>
          </div>
        )}
      </div>

      {/* ========== REGISTRO DE HORÁRIOS ========== */}
      {!isSecundario && !jaEnviada && (
        <div className="hb-in" style={{
          ...cardStyle, padding: 0, overflow: 'hidden', marginBottom: 14, animationDelay: '300ms',
          border: `1px solid ${horariosRegistrados ? colors.successBorder : colors.border}`,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            padding: '14px 16px', borderBottom: `1px solid ${colors.border}`,
            background: horariosRegistrados ? colors.successBg : colors.surface,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <IconeQuad icon={Clock} cor={horariosRegistrados ? colors.osFeita : colors.osExecucao} cheio />
              <div style={{ display: 'grid', minWidth: 0, lineHeight: 1.25 }}>
                <span style={{ fontSize: 16, fontWeight: 500, color: colors.text }}>Registrar horários</span>
                <span style={{ fontSize: 12.5, color: colors.textMuted }}>Chegada e saída no cliente</span>
              </div>
            </div>
            {horariosRegistrados && (
              <span style={{
                fontSize: 12.5, fontWeight: 500, padding: '3px 10px', borderRadius: 999, flexShrink: 0,
                background: colors.osFeita, color: '#fff',
              }}>
                Salvo
              </span>
            )}
          </div>

          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
            <p style={{ fontSize: 14, color: colors.textMuted, margin: 0, lineHeight: 1.45 }}>
              Informe os horários de chegada e saída no cliente antes de preencher o relatório.
            </p>

            {/* Previsão de execução */}
            {os.Previsao_Execucao && (
              <div style={{
                background: colors.surfaceAlt, borderRadius: 12, padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, flexWrap: 'wrap',
              }}>
                <Clock size={15} color={colors.textSubtle} />
                <span style={{ color: colors.textMuted }}>Previsão de execução:</span>
                <span style={{ color: colors.text, fontWeight: 500 }}>{formatarData(os.Previsao_Execucao)}</span>
              </div>
            )}

            {/* Dias de visita */}
            {dias.map((dia, i) => (
              <div key={i} style={{
                background: '#F8FAFC', borderRadius: 14, padding: 14,
                border: `1px solid ${colors.border}`, minWidth: 0,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 500, color: colors.osExecucao, padding: '2px 10px', borderRadius: 999,
                    background: colors.infoBg, border: `1px solid ${colors.infoBorder}`,
                  }}>
                    Dia {i + 1}
                  </span>
                  {i > 0 && (
                    <button type="button" onClick={() => {
                      setDias(prev => prev.filter((_, idx) => idx !== i))
                      setHorariosRegistrados(false)
                    }}
                      style={{ fontSize: 14, color: colors.danger, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 2px' }}>
                      Remover
                    </button>
                  )}
                </div>

                <div id={`dia-${i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
                  <div>
                    <label style={rotuloCampo}>Data</label>
                    <input type="date" value={dia.data} className="osd-campo"
                      onChange={(e) => updateDia(i, 'data', e.target.value)}
                      style={inputStyle} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <label style={rotuloCampo}>Hora chegada</label>
                      <input type="time" value={dia.horaChegada} className="osd-campo"
                        onChange={(e) => updateDia(i, 'horaChegada', e.target.value)}
                        style={inputStyle} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <label style={rotuloCampo}>Hora saída</label>
                      <input type="time" value={dia.horaSaida} className="osd-campo"
                        onChange={(e) => updateDia(i, 'horaSaida', e.target.value)}
                        style={inputStyle} />
                    </div>
                  </div>
                  {minutosDoDia(dia.horaChegada, dia.horaSaida).virou && (
                    <div style={{
                      background: dia.virouNoite ? colors.surfaceAlt : colors.warningBg, border: `1px solid ${dia.virouNoite ? colors.border : colors.warningBorder}`,
                      borderRadius: 12, padding: '10px 12px', fontSize: 14, color: colors.text, lineHeight: 1.4,
                    }}>
                      A saída está antes da chegada. Se passou da meia-noite, confirme; senão, corrija a hora.
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, minHeight: 36, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!dia.virouNoite} style={{ width: 20, height: 20 }}
                          onChange={(e) => { setDias(prev => prev.map((d, k) => (k === i ? { ...d, virouNoite: e.target.checked } : d))); setHorariosRegistrados(false) }} />
                        Sim, passou da meia-noite ({horasTexto(minutosDoDia(dia.horaChegada, dia.horaSaida).min)})
                      </label>
                    </div>
                  )}
                  <div>
                    <label style={rotuloCampo}>Total KM</label>
                    <input type="text" inputMode="decimal" value={dia.kmTotal} className="osd-campo"
                      onChange={(e) => updateDia(i, 'kmTotal', e.target.value)}
                      style={inputStyle} placeholder="0" />
                  </div>
                </div>
              </div>
            ))}

            {/* Botão adicionar dia */}
            {dias.length < MAX_DIAS && (
              <button type="button" onClick={() => {
                setDias(prev => [...prev, { data: hoje(), horaChegada: '', horaSaida: '', kmTotal: '' }])
                setHorariosRegistrados(false)
              }} style={{
                height: 46, borderRadius: 12, fontSize: 15, fontWeight: 500,
                border: `1px dashed ${colors.borderStrong}`, background: colors.surface, color: colors.primary, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center',
              }}>
                <Plus size={17} /> Adicionar mais um dia
              </button>
            )}

            {/* Totais */}
            {dias.some(d => d.horaChegada && d.horaSaida) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
                <div style={{ background: colors.infoBg, border: `1px solid ${colors.infoBorder}`, borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ fontSize: 13, color: colors.textMuted }}>Total de horas</div>
                  <div style={{ fontSize: 24, fontWeight: 500, color: colors.text, lineHeight: 1.2 }}>{calcTotalHoras() || '—'}</div>
                </div>
                <div style={{ background: colors.infoBg, border: `1px solid ${colors.infoBorder}`, borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ fontSize: 13, color: colors.textMuted }}>Total de KM</div>
                  <div style={{ fontSize: 24, fontWeight: 500, color: colors.text, lineHeight: 1.2 }}>{calcTotalKm() || '—'}</div>
                </div>
              </div>
            )}

            {/* Justificativa de atraso */}
            {precisaJustificar && (
              <div style={{
                background: colors.dangerBg, borderRadius: 14, padding: 14,
                border: `1px solid ${colors.dangerBorder}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <IconeQuad icon={AlertTriangle} cor={colors.osAtrasada} cheio tam={34} />
                  <span style={{ fontSize: 15, fontWeight: 500, color: '#991B1B' }}>
                    Justificativa do atraso
                  </span>
                </div>
                <p style={{ fontSize: 13.5, color: '#991B1B', margin: '0 0 10px', lineHeight: 1.45 }}>
                  A data de início ({formatarData(dias[0].data)}) é posterior à previsão de execução ({formatarData(os.Previsao_Execucao)}).
                  Explique o motivo do atraso.
                </p>
                <textarea
                  value={justificativa}
                  className="osd-campo"
                  onChange={(e) => { setJustificativa(e.target.value); setHorariosRegistrados(false) }}
                  placeholder="Ex: Aguardando peças, cliente indisponível..."
                  rows={3}
                  style={{ ...inputStyle, height: 'auto', padding: '12px 14px', resize: 'vertical', lineHeight: 1.45 }}
                />
              </div>
            )}

            {/* Botão salvar */}
            <button type="button" onClick={salvarHorarios} disabled={salvando} className="hb" style={{
              width: '100%', height: 48, borderRadius: 12,
              background: salvando ? colors.textGhost : colors.primary, color: '#fff',
              border: 'none', fontSize: 16, fontWeight: 500, cursor: salvando ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: salvando ? 'none' : '0 6px 16px -8px rgba(3,105,161,0.6)',
            }}>
              <Save size={18} />
              {salvando ? 'Salvando...' : 'Salvar horários'}
            </button>
          </div>
        </div>
      )}

      {/* Preencher / editar (bloqueado para o técnico secundário) */}
      {!isSecundario && (jaEnviada ? (
        dentroPrazo48h ? (
          <Link href={`/os/${os.Id_Ordem}/preencher`} className="hb" style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: colors.surface, color: colors.text, borderRadius: 16, padding: '16px',
            textDecoration: 'none', border: `1px solid ${colors.warningBorder}`,
            boxShadow: '0 10px 24px -20px rgba(15,23,42,.5)',
          }}>
            <IconeQuad icon={ClipboardEdit} cor={colors.osPecas} cheio tam={46} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 500 }}>Editar OS enviada</div>
              <div style={{ fontSize: 13.5, color: colors.textMuted, marginTop: 2 }}>Você tem até 48h após o envio para corrigir</div>
            </div>
          </Link>
        ) : (
          <div style={{
            background: colors.successBg, borderRadius: 16, padding: 16,
            display: 'flex', alignItems: 'center', gap: 14,
            border: `1px solid ${colors.successBorder}`,
          }}>
            <IconeQuad icon={CheckCircle} cor={colors.osFeita} cheio tam={46} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: '#166534' }}>OS enviada</div>
              <div style={{ fontSize: 13.5, color: colors.textMuted, marginTop: 2 }}>Prazo de 48h para edição expirado.</div>
            </div>
          </div>
        )
      ) : !horariosRegistrados ? (
        <div style={{
          background: colors.surface, borderRadius: 16, padding: 16,
          display: 'flex', alignItems: 'center', gap: 14,
          border: `1px dashed ${colors.borderStrong}`,
        }}>
          <IconeQuad icon={Clock} cor={colors.textSubtle} tam={46} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: colors.text }}>Registre os horários primeiro</div>
            <div style={{ fontSize: 13.5, color: colors.textMuted, marginTop: 2, lineHeight: 1.4 }}>Salve os horários de chegada e saída para liberar o preenchimento do relatório.</div>
          </div>
        </div>
      ) : (
        <Link href={`/os/${os.Id_Ordem}/preencher`} className="hb" style={{
          display: 'flex', alignItems: 'center', gap: 14,
          background: colors.primary, color: '#fff', borderRadius: 16, padding: '16px',
          textDecoration: 'none',
          boxShadow: '0 10px 22px -12px rgba(3,105,161,0.7)',
        }}>
          <span style={{
            width: 46, height: 46, borderRadius: 12, flexShrink: 0,
            background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {jaPreenchida ? <Wrench size={23} /> : <ClipboardEdit size={23} />}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 500 }}>
              {jaPreenchida ? 'Editar OS técnica' : 'Preencher OS técnica'}
            </div>
            <div style={{ fontSize: 13.5, opacity: 0.88, marginTop: 2 }}>
              {jaPreenchida ? 'Rascunho salvo — toque para continuar' : 'Horários registrados — preencha o relatório'}
            </div>
          </div>
        </Link>
      ))}

      <div style={{ height: 20 }} />
    </div>
  )
}
