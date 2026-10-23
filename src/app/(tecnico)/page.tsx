'use client'
import { hojeBR } from '@/lib/hoje'
// TELA INICIAL do técnico — "Estilo POS NewPortal" (José, 22/10/2026), no visual aprovado da página /teste:
// saudação + data, 3 números coloridos, a semana dele na Lousa (barrinha com as cores das situações + legenda que
// filtra), o feed do dia com os cartões coloridos, ordens em aberto e os atalhos em grade. A Lousa vem de /api/feed
// (com o login). Jornada, SAT Digital e Relatórios saíram — o técnico não usa.
import { useState, useRef, useEffect, useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { supabase } from '@/lib/supabase'
import {
  FileText, ChevronRight, User, Megaphone, CheckCircle2, Plus,
  Clock, MapPin, ShieldCheck, Car,
  AlertCircle, AlertTriangle, BookOpen,
  Camera, Image as ImageIcon, Smile, X, ChevronRight as ArrowRight,
  Fuel, Info, Shield,
  ClipboardList, CalendarDays, Coffee, Users, Sun, CalendarX, Wrench, Package, ChevronLeft,
} from 'lucide-react'
import Link from 'next/link'
import { PageSpinner } from '@/components/ui'
import OrdensEmAberto from '@/components/OrdensEmAberto'
import LigaXP from '@/components/LigaXP'
import SeloOffline from '@/components/SeloOffline'
import BotaoAtalhos from '@/components/BotaoAtalhos'
import VitrineCatalogo from '@/components/VitrineCatalogo'
import { colors } from '@/lib/ui'
import {
  CartaoSituacao, LEGENDA, SITUACAO, situacaoOS, nomeBonito, cidadeCurta, numeroOS, clarinho,
  type ChipCartao, type Situacao,
} from '@/components/OsCardTecnico'

interface AvisoGeral {
  id: number
  titulo: string
  mensagem: string
  prioridade: 'normal' | 'urgente'
  created_at: string
}

interface DashboardData {
  osPendentes: number
  osAbertas: number
  osEnviadas: number
  osAtrasadas: number
  reqPendentes: number
  reqEnviadas: number
  fotosCount: number
  garantiasPendentes: number
  garantiasAbertas: number
  avisos: AvisoGeral[]
  avisosHistorico: AvisoGeral[]
}

async function fetchDashboardData(nome: string, tecnicoNome: string): Promise<DashboardData> {
  const hoje = hojeBR()

  // Avisos já confirmados pelo técnico: filtrados na própria consulta (antes o limit(5) vinha antes do
  // filtro e um aviso novo podia sumir atrás de 5 confirmados) (José, 23/10/2026)
  let confirmadosIds: number[] = []
  if (tecnicoNome) {
    const { data: conf } = await supabase
      .from('avisos_gerais_confirmados')
      .select('aviso_id')
      .eq('tecnico_nome', tecnicoNome)
      .order('aviso_id', { ascending: false })
      .limit(300)
    confirmadosIds = [...new Set((conf || []).map((c: { aviso_id: number }) => Number(c.aviso_id)).filter(Number.isFinite))]
  }
  const avisosBase = () => supabase
    .from('avisos_gerais')
    .select('id, titulo, mensagem, prioridade, created_at')
    .eq('ativo', true)
    .or(`expira_em.is.null,expira_em.gte.${hoje}`)
    .order('created_at', { ascending: false })
    .limit(5)

  const [osRes, reqPendRes, reqEnvRes, avisosRes, historicoRes] = await Promise.all([
    // Só as OS ainda abertas: antes vinham todas da vida (passava de 1000 e o .in() ficava gigante) (José, 23/10/2026)
    supabase
      .from('Ordem_Servico')
      .select('Id_Ordem, Status, Previsao_Execucao')
      .not('Status', 'in', `("${FASES_FINAIS.join('","')}")`)
      .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`),
    supabase
      .from('Requisicao')
      .select('id', { count: 'exact', head: true })
      .or(`solicitante.ilike.%${nome}%,solicitante.eq.${tecnicoNome}`)
      .eq('status', 'pedido')
      .is('recibo_fornecedor', null),
    supabase
      .from('Requisicao')
      .select('id', { count: 'exact', head: true })
      .or(`solicitante.ilike.%${nome}%,solicitante.eq.${tecnicoNome}`)
      .in('status', ['pedido', 'completa', 'aguardando']),
    confirmadosIds.length ? avisosBase().not('id', 'in', `(${confirmadosIds.join(',')})`) : avisosBase(),
    confirmadosIds.length ? avisosBase().in('id', confirmadosIds) : Promise.resolve({ data: [] as AvisoGeral[] }),
  ])

  // Se a query principal falhou (offline), lança para useCached usar fallback do IndexedDB
  if (osRes.error) throw new Error(osRes.error.message)

  const avisosFiltrados = (avisosRes.data || []) as AvisoGeral[]
  const avisosHistorico = (historicoRes.data || []) as AvisoGeral[]

  const todas = (osRes.data || []) as { Id_Ordem: string; Status: string; Previsao_Execucao: string | null }[]

  // Buscar status do tecnico (preenchida/enviada)
  const ids = todas.map(o => o.Id_Ordem)
  let preenchSet = new Set<string>()
  let enviadaSet = new Set<string>()
  if (ids.length > 0) {
    const { data: tecData } = await supabase
      .from('Ordem_Servico_Tecnicos')
      .select('Ordem_Servico, Status')
      .or(`TecResp1.ilike.%${nome}%,TecResp2.ilike.%${nome}%`)
      .in('Ordem_Servico', ids)
    if (tecData) {
      preenchSet = new Set(tecData.map((e: { Ordem_Servico: string }) => String(e.Ordem_Servico)))
      enviadaSet = new Set(
        tecData
          .filter((e: { Status: string }) => e.Status === 'enviado')
          .map((e: { Ordem_Servico: string }) => String(e.Ordem_Servico)),
      )
    }
  }

  // OS com status concluido pelo tecnico tambem contam como enviadas
  const FASES_CONCLUIDAS = [
    'Relatório Concluído', 'Relatorio Concluido',
    'Executada aguardando comercial',
    'Concluída', 'Concluida', 'Concluído', 'Concluido',
    'Faturada', 'Faturado',
    'Finalizada', 'Finalizado',
    'Enviado Para Omie', 'Enviado para Omie',
    'Preenchido Garantia',
  ]
  for (const o of todas) {
    if (FASES_CONCLUIDAS.includes(o.Status)) enviadaSet.add(String(o.Id_Ordem))
  }
  // Técnico já preencheu o relatório → conta como enviada
  for (const id of preenchSet) {
    enviadaSet.add(id)
  }

  let osPendentes = 0
  let osAbertas = 0
  let osAtrasadas = 0
  for (const o of todas) {
    const id = String(o.Id_Ordem)
    if (enviadaSet.has(id)) continue
    const prev = o.Previsao_Execucao?.trim?.() || ''
    if (o.Status === 'Aguardando ordem Técnico' && !preenchSet.has(id)) {
      if (prev && prev < hoje) {
        const diffDias = Math.floor((new Date(hoje + 'T00:00:00').getTime() - new Date(prev + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24))
        if (diffDias > 1) { osAtrasadas++; continue }
      }
      osPendentes++
    } else {
      osAbertas++
    }
  }

  // Fotos: a coluna fotos_path não existe (dava HTTP 400). Conta os relatórios enviados, que é o que a
  // tela /fotos lista (José, 23/10/2026)
  let fotosCount = 0
  if (nome) {
    const { count } = await supabase
      .from('Ordem_Servico_Tecnicos')
      .select('Ordem_Servico', { count: 'exact', head: true })
      .or(`TecResp1.ilike.%${nome}%,TecResp2.ilike.%${nome}%`)
      .eq('Status', 'enviado')
    fotosCount = Math.min(count || 0, 200)
  }

  // Garantias do técnico: pendentes (B.O./fábrica devolveu) e abertas (em andamento)
  let garantiasPendentes = 0
  let garantiasAbertas = 0
  if (tecnicoNome) {
    const [pendRes, abertasRes] = await Promise.all([
      supabase
        .from('garantias')
        .select('id', { count: 'exact', head: true })
        .eq('tecnico_nome', tecnicoNome)
        .in('status', ['bo_tecnico', 'info_pendente']),
      supabase
        .from('garantias')
        .select('id', { count: 'exact', head: true })
        .eq('tecnico_nome', tecnicoNome)
        .not('status', 'in', '("aprovada","rejeitada")'),
    ])
    garantiasPendentes = pendRes.count || 0
    garantiasAbertas = abertasRes.count || 0
  }

  return {
    osPendentes,
    osAbertas,
    osEnviadas: enviadaSet.size,
    osAtrasadas,
    reqPendentes: reqPendRes.count || 0,
    reqEnviadas: reqEnvRes.count || 0,
    fotosCount,
    garantiasPendentes,
    garantiasAbertas,
    avisos: avisosFiltrados,
    avisosHistorico,
  }
}

interface VeiculoInfo {
  veiculo: {
    id: string; placa: string; placa_fmt?: string; marca: string | null; modelo: string | null
    ano: number | null; ano_modelo: number | null; cor: string | null
    combustivel: string | null; chassi: string | null; renavam: string | null
    tipo_veiculo: string | null; categoria: string | null; status: string | null
    proprietario: string | null; equipamentos: string[] | null
    exercicio_crlv: number | null; capacidade_tanque: number | null
    tem_rastreador: boolean; hodometro: number | null; imagem_url: string | null
    senha_cartao_veloe?: string | null
  }
  responsavel: { nome: string; inicio: string; origem: string } | null
  historico: { nome: string; inicio: string; fim: string | null }[]
  custos: Record<string, number>
  multas: { abertas: number; valor: number }
  documentos?: { id: string; tipo: string; numero: string | null; emissor: string | null; vigencia_fim: string | null; url: string | null; nome_arquivo: string | null }[]
}

const PERSONAGENS = ['🧑‍🔧', '👷', '🧔', '👨‍🔧', '🐻', '🦊', '🐼', '🦁', '🐶', '🦉', '🤖', '🐯']

/* ═══ Slider: ordens em aberto do técnico ═══ */
interface OrdemAberta {
  Id_Ordem: string
  Os_Cliente: string | null
  Os_Tecnico: string | null
  Status: string
  Tipo_Servico: string | null
  Serv_Solicitado: string | null
  Previsao_Execucao: string | null
  Data?: string | null
  Projeto?: string | null
  Cidade_Cliente?: string | null
  _classe: 'pendente' | 'aberta'
}

const FASES_FINAIS = [
  'Concluida','Cancelada','Concluída','cancelada',
  'Relatório Concluído','Relatorio Concluido',
  'Executada aguardando comercial',
  'Faturada','Faturado','Finalizada','Finalizado',
  'Enviado Para Omie','Enviado para Omie',
  'Preenchido Garantia',
]

async function fetchMinhasOrdensAbertas(nome: string): Promise<OrdemAberta[]> {
  if (!nome) return []
  const { data } = await supabase
    .from('Ordem_Servico')
    .select('Id_Ordem, Os_Cliente, Os_Tecnico, Status, Tipo_Servico, Serv_Solicitado, Previsao_Execucao, Data, Projeto, Cidade_Cliente')
    .not('Status', 'in', `("${FASES_FINAIS.join('","')}")`)
    .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
    .order('Id_Ordem', { ascending: false })
    .limit(80)
  const todas = (data || []) as (Omit<OrdemAberta, '_classe'>)[]
  if (todas.length === 0) return []

  const ids = todas.map(o => o.Id_Ordem)
  const { data: tecData } = await supabase
    .from('Ordem_Servico_Tecnicos')
    .select('Ordem_Servico, Status')
    .or(`TecResp1.ilike.%${nome}%,TecResp2.ilike.%${nome}%`)
    .in('Ordem_Servico', ids)

  const preenchSet = new Set<string>()
  const enviadaSet = new Set<string>()
  if (tecData) {
    for (const t of tecData) {
      preenchSet.add(String(t.Ordem_Servico))
      if (t.Status === 'enviado') enviadaSet.add(String(t.Ordem_Servico))
    }
  }

  const resultado: OrdemAberta[] = []
  for (const o of todas) {
    const id = String(o.Id_Ordem)
    if (enviadaSet.has(id) || preenchSet.has(id)) continue
    resultado.push({ ...o, _classe: o.Status === 'Aguardando ordem Técnico' ? 'pendente' : 'aberta' })
  }

  resultado.sort((a, b) => {
    if (a._classe === 'pendente' && b._classe !== 'pendente') return -1
    if (a._classe !== 'pendente' && b._classe === 'pendente') return 1
    return 0
  })

  return resultado
}


/* ═══ Feed da Lousa (GET /api/feed com o token do login) ═══ */
interface FeedItem {
  fonte: 'os' | 'lousa'; id: string; dia: string; hora?: string | null; horaFim?: string | null
  status?: string; cliente?: string | null; cidade?: string | null; solicitacao?: string; tipo?: string; projeto?: string | null
  oficina?: boolean; ppv?: string | null; resservicoDe?: string | null; junto?: string | null
  periodo?: string | null; descricao?: string | null; todos?: boolean
}
interface Feed {
  tecnico: string; de: string; ate: string; hoje: string; itens: FeedItem[]; pendentes: FeedItem[]
  equipe: { dia: string; tipo: string; quem: string; descricao: string | null }[]
}

async function fetchFeed(de: string): Promise<Feed> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('sem sessão')
  const r = await fetch(`/api/feed${de ? `?de=${de}` : ''}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  })
  if (!r.ok) throw new Error(`feed ${r.status}`)
  return r.json()
}
/** última semana vista fica no aparelho para abrir sem internet */
const FEED_LS = (uid: string, de: string) => `nt-home-feed:${uid}:${de || 'atual'}`
function feedSalvo(uid: string, de: string): Feed | null {
  try { const raw = localStorage.getItem(FEED_LS(uid, de)); return raw ? JSON.parse(raw) as Feed : null } catch { return null }
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const SEMANA_LONGA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const addDias = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
// domingo → segunda seguinte, igual ao /api/feed (José, 23/10/2026)
const segundaDe = (d: string) => addDias(d, dow(d) === 0 ? 1 : 1 - dow(d))
const primeiroNome = (n?: string | null) => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() }
const ddmm = (d: string) => `${Number(d.slice(8, 10))}/${d.slice(5, 7)}`
const semMovimento = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function lousaInfo(t?: string) {
  switch (t) {
    case 'feriado': return { rot: 'Feriado', ic: Sun, cor: '#B45309' }
    case 'reuniao': return { rot: 'Reunião', ic: Users, cor: '#2563EB' }
    case 'folga': return { rot: 'Folga', ic: Coffee, cor: '#0D9488' }
    case 'ferias': return { rot: 'Férias', ic: Sun, cor: '#0D9488' }
    case 'faltou': case 'falta': return { rot: 'Falta', ic: CalendarX, cor: '#DC2626' }
    case 'medico': return { rot: 'Médico', ic: CalendarX, cor: '#DC2626' }
    case 'saida': return { rot: 'Saída', ic: Clock, cor: '#475569' }
    default: return { rot: 'Serviço', ic: Wrench, cor: '#2563EB' }
  }
}

/** situação de um item do feed: atrasada quando o dia já passou e ainda não foi feita */
const situacaoItem = (i: FeedItem, hoje?: string) => situacaoOS(i.status, !!hoje && !!i.dia && i.dia < hoje, !!i.resservicoDe)

function chipsItem(i: FeedItem): ChipCartao[] {
  const c: ChipCartao[] = []
  if (i.oficina) c.push({ icon: Wrench, texto: 'Oficina' })
  else if (i.cidade) c.push({ icon: MapPin, texto: cidadeCurta(i.cidade) })
  if (i.junto) c.push({ icon: Users, texto: `com ${nomeBonito(i.junto).split(' ')[0]}` })
  if (i.ppv) c.push({ icon: Package, texto: i.ppv })
  return c
}

function CartaoLousa({ i }: { i: FeedItem }) {
  const L = lousaInfo(i.tipo)
  return (
    <div className="hm-entra" style={{
      display: 'flex', alignItems: 'center', gap: 11, marginLeft: 54, padding: '11px 13px', borderRadius: 14, minWidth: 0,
      border: `1px solid ${clarinho(L.cor, 25, colors.border)}`, background: clarinho(L.cor, 6),
    }}>
      <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 11, display: 'grid', placeItems: 'center', color: '#FEFEFE', background: L.cor }}>
        <L.ic size={17} />
      </span>
      <div style={{ display: 'grid', lineHeight: 1.3, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 500, color: colors.text }}>{L.rot}{i.todos ? ' · equipe toda' : ''}</span>
        <small style={{ fontSize: 12.5, color: colors.textMuted }}>
          {[i.periodo === 'manha' ? 'manhã' : i.periodo === 'tarde' ? 'tarde' : 'dia todo', i.descricao, i.cliente && i.tipo === 'servico' ? i.cliente : ''].filter(Boolean).join(' · ')}
        </small>
      </div>
    </div>
  )
}

/** número que sobe de 0 até o valor (sem animação se o aparelho pede menos movimento) */
function Contador({ valor }: { valor: number }) {
  const [mostra, setMostra] = useState(valor)
  const anterior = useRef(0)
  useEffect(() => {
    const de = anterior.current
    anterior.current = valor
    if (semMovimento() || de === valor) { const id = requestAnimationFrame(() => setMostra(valor)); return () => cancelAnimationFrame(id) }
    const t0 = performance.now(), dur = 550
    let id = 0
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      setMostra(Math.round(de + (valor - de) * (1 - Math.pow(1 - p, 3))))
      if (p < 1) id = requestAnimationFrame(passo)
    }
    id = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(id)
  }, [valor])
  return <>{mostra}</>
}

/** anel de progresso (feitas / total da semana) */
function Anel({ feitas, total }: { feitas: number; total: number }) {
  const r = 22, c = 2 * Math.PI * r
  const p = total ? feitas / total : 0
  return (
    <svg width={56} height={56} viewBox="0 0 56 56" style={{ flexShrink: 0 }} aria-hidden>
      <circle cx={28} cy={28} r={r} fill="none" stroke={colors.border} strokeWidth={6} />
      <circle
        cx={28} cy={28} r={r} fill="none" stroke={SITUACAO.feita.cor} strokeWidth={6} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform="rotate(-90 28 28)" className="hm-anel"
      />
      <text x={28} y={32} textAnchor="middle" fontSize={13} fill={colors.text}>{Math.round(p * 100)}%</text>
    </svg>
  )
}

/* ═══ estilos repetidos ═══ */
const cartao: CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 14, display: 'grid', gap: 12, minWidth: 0 }
const icQuadrado = (cor: string, cheio = false, tam = 38): CSSProperties => ({
  width: tam, height: tam, flexShrink: 0, borderRadius: 11, display: 'grid', placeItems: 'center',
  color: cheio ? '#FEFEFE' : cor, background: cheio ? cor : clarinho(cor, 9),
  border: cheio ? 'none' : `1px solid ${clarinho(cor, 16, 'transparent')}`,
})
function SecTitulo({ icone: Icone, titulo, sub, cor = colors.primary, direita }: { icone: typeof FileText; titulo: string; sub?: string; cor?: string; direita?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
      <span style={icQuadrado(cor)}><Icone size={18} /></span>
      <div style={{ display: 'grid', flex: 1, lineHeight: 1.25, minWidth: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 500, color: colors.text }}>{titulo}</span>
        {sub && <small style={{ fontSize: 12.5, color: colors.textMuted }}>{sub}</small>}
      </div>
      {direita}
    </div>
  )
}
function TituloLista({ titulo, sub }: { titulo: string; sub?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '4px 2px 0', minWidth: 0 }}>
      <span style={{ fontSize: 18, fontWeight: 500, color: colors.text, textTransform: 'capitalize' }}>{titulo}</span>
      {sub && <small style={{ fontSize: 13, color: colors.textMuted, textAlign: 'right' }}>{sub}</small>}
    </div>
  )
}
const vazio: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 22, borderRadius: 16,
  border: `1px dashed ${colors.borderStrong}`, color: colors.textSubtle, fontSize: 14, background: colors.surface, textAlign: 'center',
}
const botaoSeta: CSSProperties = {
  width: 34, height: 34, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface,
  color: colors.text, display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0,
}

/* animações da Lousa (desligadas com prefers-reduced-motion) */
const CSS_HOME = `
@keyframes hmDeDireita { from { opacity: 0; transform: translateX(28px) } to { opacity: 1; transform: none } }
@keyframes hmDeEsquerda { from { opacity: 0; transform: translateX(-28px) } to { opacity: 1; transform: none } }
@keyframes hmPop { 0% { transform: scale(.9) } 60% { transform: scale(1.06) } 100% { transform: scale(1) } }
@keyframes hmEntra { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
.hm-semana-prox { animation: hmDeDireita .32s cubic-bezier(.16,1,.3,1) }
.hm-semana-ant { animation: hmDeEsquerda .32s cubic-bezier(.16,1,.3,1) }
.hm-dia-on { animation: hmPop .32s cubic-bezier(.34,1.56,.64,1) }
.hm-entra { animation: hmEntra .3s ease backwards }
.hm-anel { transition: stroke-dashoffset .7s cubic-bezier(.16,1,.3,1) }
.hm-barra > i { transition: flex-grow .4s ease }
.hm-dias { touch-action: pan-y }
@media (prefers-reduced-motion: reduce) {
  .hm-semana-prox, .hm-semana-ant, .hm-dia-on, .hm-entra { animation: none }
  .hm-anel, .hm-barra > i { transition: none }
}
`

export default function TecnicoHome() {
  const { user, refresh } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const { data, loading, refreshing } = useCached<DashboardData>(
    `dashboard:${nome}`,
    () => fetchDashboardData(nome, user?.tecnico_nome || ''),
    { skip: !user },
  )


  const [showHistorico, setShowHistorico] = useState(false)
  const [avisosModal, setAvisosModal] = useState(false)

  // --- Perfil: foto (camera/galeria) e personagem ---
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [perfilModal, setPerfilModal] = useState(false)
  const [fotoPreview, setFotoPreview] = useState<{ url: string; file: File } | null>(null)
  const [avatarLocal, setAvatarLocal] = useState<string | null>(null)
  const [fotoFullscreen, setFotoFullscreen] = useState(false)
  const [escolherPersonagem, setEscolherPersonagem] = useState(false)
  const [personagem, setPersonagem] = useState<string>('')

  // --- Veiculo do tecnico ---
  const [veiculo, setVeiculo] = useState<{ placa: string; descricao: string } | null>(null)
  const [veiculoInfo, setVeiculoInfo] = useState<VeiculoInfo | null>(null)
  const [veiculoModal, setVeiculoModal] = useState(false)
  const [veiculoTab, setVeiculoTab] = useState<'info' | 'docs' | 'checklist'>('info')
  const [checklistPendente, setChecklistPendente] = useState(false)
  // tela inicial escolhida pelo José (23/10/2026): opção B — Liga no topo, 2 botões grandes, "Faça agora".
  // ?inicio=atual mostra a antiga e ?inicio=a a opção A (só para comparar).
  const [layout, setLayout] = useState('b')
  useEffect(() => { const v = new URLSearchParams(window.location.search).get('inicio'); if (v === 'a' || v === 'atual') setLayout(v) }, [])
  // Carrossel de ordens em aberto: só a tela antiga ('atual') mostra — a B não busca (José, 23/10/2026)
  const { data: minhasOrdens } = useCached<OrdemAberta[]>(
    `home:minhas-ordens:${nome}`,
    () => fetchMinhasOrdensAbertas(nome),
    { skip: !user || layout !== 'atual' },
  )
  const ordensAbertasList = useMemo(() => minhasOrdens || [], [minhasOrdens])
  // Senha do cartão Veloe do MEU carro — mascarada, toque pra revelar
  const [verSenhaVeloe, setVerSenhaVeloe] = useState(false)

  useEffect(() => {
    if (!user) return
    const salvo = localStorage.getItem(`mec_personagem_${user.id}`)
    setPersonagem(salvo || '🧑‍🔧')
  }, [user])

  useEffect(() => {
    if (!nome) return
    ;(async () => {
      try {
        const res = await fetch('/api/veiculo-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tecnico_nome: nome, cpf: user?.cpf, user_id: user?.id }),
        })
        if (res.ok) {
          const info = await res.json()
          setVeiculoInfo(info)
          const placaDisplay = info.veiculo?.placa || ''
          setVeiculo({ placa: placaDisplay, descricao: '' })
        }
      } catch {}
      // Check checklist status
      try {
        const res = await fetch('/api/checklist-veiculo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verificar', tecnico_nome: nome }),
        })
        if (res.ok) {
          const { pendente } = await res.json()
          setChecklistPendente(pendente)
        }
      } catch {}
    })()
  }, [nome, user?.cpf])

  const salvarPersonagem = (p: string) => {
    if (!user) return
    localStorage.setItem(`mec_personagem_${user.id}`, p)
    setPersonagem(p)
    setEscolherPersonagem(false)
    setPerfilModal(false)
  }

  const resizeImage = (file: File, maxSize: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        let { width, height } = img
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error('Falha ao comprimir')),
          'image/jpeg',
          0.8,
        )
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem invalida')) }
      img.src = url
    })
  }

  const handleFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setFotoPreview({ url, file })
    e.target.value = ''
  }

  const confirmarFoto = async () => {
    if (!fotoPreview || !user) return
    setUploading(true)
    try {
      const compressed = await resizeImage(fotoPreview.file, 512)
      const fd = new FormData()
      fd.append('file', new File([compressed], 'avatar.jpg', { type: 'image/jpeg' }))
      fd.append('userId', user.id)
      const res = await fetch('/api/avatar', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erro ao enviar')
      setAvatarLocal(json.avatar_url)
      try {
        const cached = JSON.parse(localStorage.getItem('nt-mecanicos-profile') || '{}')
        cached.avatar_url = json.avatar_url
        localStorage.setItem('nt-mecanicos-profile', JSON.stringify(cached))
      } catch {}
      if (refresh) refresh()
      URL.revokeObjectURL(fotoPreview.url)
      setFotoPreview(null)
      setPerfilModal(false)
    } catch (err) {
      console.error('Erro ao enviar foto:', err)
      alert((err instanceof Error && err.message) || 'Erro ao enviar foto. Tente novamente.')
    } finally {
      setUploading(false)
    }
  }

  const cancelarPreview = () => {
    if (fotoPreview) URL.revokeObjectURL(fotoPreview.url)
    setFotoPreview(null)
  }


  // --- Lousa: a semana do técnico (GET /api/feed) ---
  const [semana, setSemana] = useState('') // '' = semana atual
  const [direcao, setDirecao] = useState<'prox' | 'ant' | ''>('')
  const [diaEscolhido, setDiaEscolhido] = useState('')
  const [filtroSit, setFiltroSit] = useState('') // rótulo da situação tocada na legenda
  const [arrasto, setArrasto] = useState(0)
  const toqueX = useRef<number | null>(null)
  const [feedState, setFeedState] = useState<{ chave: string; feed: Feed | null } | null>(null)
  const uid = user?.id || ''
  const chaveFeed = `${uid}:${semana}`
  const feedGuardado = useMemo(() => (uid ? feedSalvo(uid, semana) : null), [uid, semana])

  useEffect(() => {
    if (!uid) return
    let vivo = true
    fetchFeed(semana).then((f) => {
      if (!vivo) return
      try { localStorage.setItem(FEED_LS(uid, semana), JSON.stringify(f)) } catch { /* cheio */ }
      setFeedState({ chave: `${uid}:${semana}`, feed: f })
    }).catch((e) => {
      console.warn('[home] feed da Lousa:', e)
      if (vivo) setFeedState({ chave: `${uid}:${semana}`, feed: null })
    })
    return () => { vivo = false }
  }, [uid, semana])

  if (loading) return <PageSpinner />

  const {
    garantiasPendentes = 0, garantiasAbertas = 0, fotosCount = 0,
    avisos = [], avisosHistorico = [],
    osPendentes = 0, osAtrasadas = 0, osAbertas = 0, reqPendentes = 0,
  } = data || {}

  /* ── dados da Lousa ── */
  const feedPronto = feedState?.chave === chaveFeed
  const feed: Feed | null = (feedPronto ? feedState?.feed : null) || feedGuardado || null
  const carregandoFeed = !feedPronto && !feed
  const hoje = feed?.hoje || hojeBR()
  const dias = feed ? Array.from({ length: 6 }, (_, i) => addDias(feed.de, i)) : []
  const doDia = (d: string) => (feed?.itens || []).filter((i) => i.dia === d)
  const dia = !feed ? '' : diaEscolhido && diaEscolhido >= feed.de && diaEscolhido <= feed.ate ? diaEscolhido
    : feed.hoje >= feed.de && feed.hoje <= feed.ate ? feed.hoje : feed.de
  const semanaAtual = feed ? feed.de === segundaDe(feed.hoje) : true
  const osSemana = (feed?.itens || []).filter((i) => i.fonte === 'os')
  // OS que aparece em mais de um dia conta uma vez no resumo (vale a situação do último dia)
  const unicas = new Map<string, Situacao>()
  for (const i of osSemana) unicas.set(i.id, situacaoItem(i, hoje))
  const totalSemana = unicas.size
  const feitasSemana = [...unicas.values()].filter((s) => s === SITUACAO.feita).length
  const atrasadasSemana = [...unicas.values()].filter((s) => s === SITUACAO.atrasada).length
  const pecasSemana = [...unicas.values()].filter((s) => s === SITUACAO.pecas).length
  const pendentesQtd = feed?.pendentes.length || 0
  const listaDia = dia ? doDia(dia) : []
  const lista = filtroSit ? listaDia.filter((i) => i.fonte === 'os' && situacaoItem(i, hoje).rot === filtroSit) : listaDia
  const osNoDia = listaDia.filter((i) => i.fonte === 'os').length
  const tituloDia = !feed || !dia ? '' : dia === feed.hoje ? 'Hoje' : dia === addDias(feed.hoje, 1) ? 'Amanhã' : dia === addDias(feed.hoje, -1) ? 'Ontem' : SEMANA_LONGA[dow(dia)]

  const trocarSemana = (n: number) => {
    if (!feed) return
    setDirecao(n > 0 ? 'prox' : 'ant')
    setSemana(addDias(feed.de, 7 * n))
    setDiaEscolhido('')
  }
  const irHoje = () => {
    if (!feed) return
    setDirecao(feed.de > segundaDe(feed.hoje) ? 'ant' : 'prox')
    setSemana('')
    setDiaEscolhido('')
  }
  const toqueInicio = (e: React.TouchEvent) => { toqueX.current = e.touches[0].clientX }
  const toqueMove = (e: React.TouchEvent) => {
    if (toqueX.current == null) return
    const dx = e.touches[0].clientX - toqueX.current
    setArrasto(Math.max(-90, Math.min(90, dx)))
  }
  const toqueFim = (e: React.TouchEvent) => {
    const x0 = toqueX.current
    toqueX.current = null
    setArrasto(0)
    if (x0 == null) return
    const dx = e.changedTouches[0].clientX - x0
    if (Math.abs(dx) > 50) trocarSemana(dx < 0 ? 1 : -1)
  }

  const hora = new Date().getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
  const agora = new Date()
  const dataLabel = `${SEMANA_LONGA[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]}`
  const fotoPerfil = avatarLocal || user?.avatar_url || ''
  const nomeTela = primeiroNome(user?.tecnico_nome || feed?.tecnico) || 'Técnico'
  const avisoUrgente = avisos.some(a => a.prioridade === 'urgente')

  // estilos das opcoes do modal de perfil
  const opcaoStyle = {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
    padding: 12, borderRadius: 14, border: `1px solid ${colors.border}`,
    background: colors.surface, cursor: 'pointer', textAlign: 'left' as const,
  } as const
  const opcaoIcone = {
    width: 40, height: 40, borderRadius: 11, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as const
  const opcaoTexto = { flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: colors.text } as const

  // ── Tela inicial: variantes para o José escolher (?inicio=a | ?inicio=b; sem nada = a de hoje) ──
  // Uso medido em 90 dias (22/10/2026): relatório de OS 185 · requisição feita à mão 159 · avisos 43 ·
  // justificativa de ocorrência 29 · checklist do carro 9 · Opa ~0 · notificações lidas: só 10%.
  const ORDENS: Record<string, Record<string, number>> = {
    atual: { checklist: 0, header: 1, avisos: 2, liga: 3, lousa: 4, ordens: 5, equipe: 6, atalhos: 7 },
    // a Liga com a barra de XP fica logo abaixo do nome (José, 23/10/2026)
    a: { checklist: 0, header: 1, liga: 2, faca: 3, acoes: 4, avisos: 5, ordens: 6, lousa: 7, atalhos: 8, equipe: 9 },
    // o selo "N OS no celular" vai para o fim (José, 23/10/2026)
    // o catálogo vem depois da agenda (José, 23/10/2026)
    b: { checklist: 0, header: 1, liga: 2, acoes: 3, faca: 4, avisos: 5, lousa: 6, ordens: 7, equipe: 8, selo: 9, atalhos: 10 },
  }
  // atalhos na ordem do uso medido
  // "Ordens" sai: já tem o botão grande lá em cima
  // Requisições saem do app por enquanto, confundiam o técnico (José, 23/10/2026)
  const POR_USO = ['Garantias', 'Avisos', 'Ocorrências', 'Catálogo', 'Fotos', 'Mapa', 'Opa']
  const compacto = layout !== 'atual'
  const ordem = (k: string) => ORDENS[layout]?.[k] ?? 20

  /** o que precisa de ação AGORA — só aparece o que tem pendência */
  const pendencias: { k: string; t: string; sub: string; cor: string; ic: typeof FileText; h?: string; onClick?: () => void }[] = [
    ...(checklistPendente ? [{ k: 'ck', t: 'Checklist do carro', sub: 'inspeção do mês pendente', cor: colors.danger, ic: Car, h: '/checklist-veiculo' }] : []),
    ...(osAtrasadas > 0 ? [{ k: 'atr', t: `${osAtrasadas} OS atrasada${osAtrasadas > 1 ? 's' : ''}`, sub: 'a previsão já passou — preencha o relatório', cor: colors.osAtrasada, ic: AlertTriangle, h: '/os' }] : []),
    ...(osPendentes > 0 ? [{ k: 'pre', t: `${osPendentes} OS para preencher`, sub: 'relatório ainda não enviado', cor: colors.osFazer, ic: FileText, h: '/os' }] : []),
    ...(false && reqPendentes > 0 ? [{ k: 'req', t: `${reqPendentes} requisiç${reqPendentes > 1 ? 'ões esperam' : 'ão espera'} a nota`, sub: 'anexe a nota/recibo do que você comprou', cor: '#0D9488', ic: ClipboardList, h: '/requisicoes' }] : []),
    ...(garantiasPendentes > 0 ? [{ k: 'gar', t: `${garantiasPendentes} garantia${garantiasPendentes > 1 ? 's' : ''} para responder`, sub: 'a fábrica ou o escritório pediu algo', cor: colors.warning, ic: ShieldCheck, h: '/garantias' }] : []),
    ...(avisos.length > 0 ? [{ k: 'av', t: `${avisos.length} aviso${avisos.length > 1 ? 's' : ''} para confirmar`, sub: 'leia e confirme', cor: avisoUrgente ? colors.danger : '#475569', ic: Megaphone, onClick: () => { setShowHistorico(false); setAvisosModal(true) } }] : []),
  ]
  const FacaAgora = () => (
    <section style={cartao}>
      <SecTitulo icone={CheckCircle2} titulo="Faça agora" sub={pendencias.length ? `${pendencias.length} coisa${pendencias.length > 1 ? 's' : ''} esperando você` : 'tudo em dia'} />
      {pendencias.length === 0 ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14.5, color: '#166534', background: colors.successBg, borderRadius: 12, padding: '10px 12px' }}>
          <CheckCircle2 size={18} color={colors.success} /> Nada pendente. Bom trabalho!
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {pendencias.map((p) => {
            const dentro = (
              <>
                <span style={icQuadrado(p.cor, false, 38)}><p.ic size={18} /></span>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span style={{ display: 'block', fontSize: 15, color: colors.text }}>{p.t}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: colors.textSubtle }}>{p.sub}</span>
                </span>
                <ChevronRight size={18} color="#94A3B8" style={{ flexShrink: 0 }} />
              </>
            )
            const est: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 14, border: `1px solid ${clarinho(p.cor, 22, colors.border)}`, background: clarinho(p.cor, 4), color: colors.text, textDecoration: 'none', cursor: 'pointer', font: 'inherit', width: '100%' }
            return p.h ? <Link key={p.k} href={p.h} className="hb" style={est}>{dentro}</Link> : <button key={p.k} type="button" onClick={p.onClick} className="hb" style={est}>{dentro}</button>
          })}
        </div>
      )}
    </section>
  )
  /** as duas coisas que o técnico mais faz: OS e requisição */
  /** as duas coisas que o técnico mais faz: OS e requisição — dois botões redondos (José, 23/10/2026) */
  const AcoesPrincipais = ({ variante }: { variante: string }) => {
    const paraPreencher = osAtrasadas + osPendentes
    const itens = [
      { k: 'os', t: 'Minhas OS', sub: paraPreencher > 0 ? `${paraPreencher} para preencher` : `${osAbertas} em andamento`, selo: paraPreencher, cor: '#2563EB', ic: FileText, h: '/os' },
      // no lugar da requisição: as OS que ele já enviou (José, 23/10/2026). Sem número: o contador da tela inicial
      // só enxerga as OS ainda abertas e mostrava "nenhuma ainda"
      { k: 'env', t: 'OS enviadas', sub: 'relatórios que você já mandou', selo: 0, cor: '#16A34A', ic: CheckCircle2, h: '/os-enviadas' },
    ]
    if (variante !== 'b') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {itens.map((a) => (
            <Link key={a.k} href={a.h} className="hb" style={{ display: 'grid', gap: 6, padding: 12, borderRadius: 16, textDecoration: 'none', color: colors.text, background: colors.surface, border: `1px solid ${colors.border}` }}>
              <span style={{ width: 36, height: 36, borderRadius: 12, display: 'grid', placeItems: 'center', background: clarinho(a.cor, 10), color: a.cor }}><a.ic size={18} /></span>
              <span style={{ fontSize: 15 }}>{a.t}</span>
              <span style={{ fontSize: 12.5, color: colors.textSubtle, marginTop: -4 }}>{a.sub}</span>
            </Link>
          ))}
        </div>
      )
    }
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '6px 0 2px' }}>
        {itens.map((a) => (
          <Link key={a.k} href={a.h} className="acao-redonda" style={{ display: 'grid', justifyItems: 'center', gap: 8, textDecoration: 'none', color: colors.text, outline: 'none' }}>
            <span className="acao-circulo" style={{ position: 'relative', width: 96, height: 96, borderRadius: 999, display: 'grid', placeItems: 'center', color: '#FEFEFE',
              background: a.cor, boxShadow: `0 14px 26px -14px ${a.cor}, 0 0 0 6px ${clarinho(a.cor, 12)}` }}>
              <a.ic size={40} strokeWidth={2.1} />
              {a.selo > 0 && (
                <span style={{ position: 'absolute', top: 2, right: 2, minWidth: 28, height: 28, padding: '0 7px', borderRadius: 14, background: colors.danger, color: '#FEFEFE',
                  fontSize: 14, display: 'grid', placeItems: 'center', border: `3px solid ${colors.surfaceAlt}` }}>{a.selo}</span>
              )}
            </span>
            <span style={{ fontSize: 17, color: colors.text, textAlign: 'center', lineHeight: 1.2 }}>{a.t}</span>
            <span style={{ fontSize: 13, color: a.selo > 0 ? a.cor : colors.textSubtle, marginTop: -4, textAlign: 'center' }}>{a.sub}</span>
          </Link>
        ))}
        <style>{`.acao-redonda:active .acao-circulo { transform: scale(.95) } .acao-circulo { transition: transform .15s } .acao-redonda:focus-visible .acao-circulo { box-shadow: 0 0 0 4px #FEFEFE, 0 0 0 7px #0369A1 }`}</style>
      </div>
    )
  }

  const atalhos: { t: string; ic: typeof FileText; cor: string; h?: string; onClick?: () => void; badge?: number; sub?: string; subCor?: string }[] = [
    { t: 'Ordens', ic: FileText, cor: '#2563EB', h: '/os' },
    { t: 'Requisições', ic: ClipboardList, cor: '#EA580C', h: '/requisicoes', ...(layout !== 'atual' && reqPendentes > 0 ? { sub: `${reqPendentes} esperam nota`, subCor: '#EA580C' } : {}) },
    { t: 'Catálogo', ic: BookOpen, cor: '#7C3AED', h: '/catalogos' },
    {
      t: 'Garantias', ic: ShieldCheck, cor: garantiasPendentes > 0 ? colors.warning : '#16A34A', h: '/garantias', badge: garantiasPendentes,
      sub: garantiasPendentes > 0 ? `${garantiasPendentes} p/ responder` : garantiasAbertas > 0 ? `${garantiasAbertas} em andamento` : undefined,
      subCor: garantiasPendentes > 0 ? colors.warning : undefined,
    },
    { t: 'Mapa', ic: MapPin, cor: '#0891B2', h: '/mapa' },
    { t: 'Opa', ic: AlertCircle, cor: '#DC2626', h: '/opa' },
    { t: 'Ocorrências', ic: AlertTriangle, cor: '#B45309', h: '/ocorrencias' },
    {
      t: 'Avisos', ic: Megaphone, cor: avisoUrgente ? colors.danger : '#475569', badge: avisos.length,
      onClick: () => { setShowHistorico(false); setAvisosModal(true) },
    },
    { t: 'Fotos', ic: Camera, cor: '#DB2777', h: '/fotos', sub: fotosCount > 0 ? `${fotosCount} OS` : undefined },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, color: colors.text }}>
      <style>{CSS_HOME}</style>
      {refreshing && <div className="refresh-bar" />}

      <div style={{ order: ordem('checklist') }}>
      {/* ═══ BLOQUEIO: CHECKLIST PENDENTE ═══ */}
      {checklistPendente && (
        <div style={{
          background: clarinho(colors.danger, 6), borderRadius: 16, padding: 14,
          border: `1px solid ${clarinho(colors.danger, 25, colors.border)}`,
          display: 'flex', alignItems: 'center', gap: 12, minWidth: 0,
        }}>
          <span style={icQuadrado(colors.danger, true, 42)}><AlertCircle size={20} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#991B1B' }}>Checklist do carro pendente</div>
            <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 2, lineHeight: 1.35 }}>
              Complete a inspeção do veículo para continuar usando o app
            </div>
          </div>
          <Link href="/checklist-veiculo" style={{
            padding: '9px 14px', borderRadius: 12, background: colors.danger, color: '#FEFEFE',
            textDecoration: 'none', fontSize: 14, flexShrink: 0,
          }}>Fazer</Link>
        </div>
      )}

      </div>
      <div style={{ order: ordem('header') }}>
      {/* ═══ CABEÇALHO: foto, saudação e o carro ═══ */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => { setEscolherPersonagem(false); setPerfilModal(true) }}
          aria-label="foto de perfil"
          style={{ position: 'relative', flexShrink: 0, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
        >
          <span style={{
            width: 50, height: 50, borderRadius: 14, overflow: 'hidden', display: 'grid', placeItems: 'center',
            background: fotoPerfil ? '#FEFEFE' : clarinho(colors.primary, 10),
            border: `1px solid ${clarinho(colors.primary, 18, 'transparent')}`,
          }}>
            {fotoPerfil ? (
              <img src={fotoPerfil} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span className="char-anim" style={{ fontSize: 28, lineHeight: 1 }}>{personagem}</span>
            )}
          </span>
          <span style={{
            position: 'absolute', bottom: -3, right: -3, width: 20, height: 20, borderRadius: 7,
            background: '#FEFEFE', border: `1px solid ${colors.border}`, display: 'grid', placeItems: 'center',
          }}>
            <Camera size={11} color={colors.primary} />
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setEscolherPersonagem(false); setPerfilModal(true) }}
          style={{ flex: 1, minWidth: 0, display: 'grid', lineHeight: 1.25, padding: 0, border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', color: colors.text }}
        >
          <span style={{ fontSize: 20, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {saudacao}, {nomeTela}
          </span>
          <small style={{ fontSize: 13.5, color: colors.textMuted }}>
            {dataLabel}{user?.role === 'admin' ? ' · administrador' : ''}
          </small>
        </button>

        {veiculo && (() => {
          const partes = veiculo.placa.split(' - ')
          const placaNum = partes[partes.length - 1]
          const placaFmt = placaNum.length >= 7 ? placaNum.slice(0, 3) + '-' + placaNum.slice(3) : placaNum
          const imgUrl = veiculoInfo?.veiculo?.imagem_url
          return (
            <button
              type="button"
              onClick={() => { setVeiculoTab('info'); setVeiculoModal(true) }}
              aria-label="meu carro"
              style={{ flexShrink: 0, display: 'grid', justifyItems: 'center', gap: 4, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
            >
              <span style={{
                width: 46, height: 46, borderRadius: 13, overflow: 'hidden', display: 'grid', placeItems: 'center',
                background: imgUrl ? '#FEFEFE' : colors.surface, border: `1px solid ${colors.border}`,
              }}>
                {imgUrl ? <img src={imgUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Car size={22} color={colors.textMuted} />}
              </span>
              <span style={{
                fontSize: 11, color: colors.text, background: colors.surface, border: `1px solid ${colors.border}`,
                padding: '1px 6px', borderRadius: 6, letterSpacing: 0.3, fontVariantNumeric: 'tabular-nums',
              }}>{placaFmt}</span>
            </button>
          )
        })()}
      </header>

      </div>
      <div style={{ order: ordem('avisos') }}>
      {/* ═══ AVISOS NOVOS (abre o modal) ═══ */}
      {avisos.length > 0 && (() => {
        const cor = avisoUrgente ? colors.danger : colors.warning
        return (
          <button
            type="button"
            onClick={() => { setShowHistorico(false); setAvisosModal(true) }}
            className="hb"
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', minWidth: 0, textAlign: 'left', cursor: 'pointer',
              background: clarinho(cor, 6), border: `1px solid ${clarinho(cor, 28, colors.border)}`, borderRadius: 16, padding: 12,
              color: colors.text,
            }}
          >
            <span style={icQuadrado(cor, true, 40)}><Megaphone size={19} /></span>
            <div style={{ flex: 1, minWidth: 0, display: 'grid', lineHeight: 1.3 }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>
                {avisos.length} aviso{avisos.length > 1 ? 's' : ''} novo{avisos.length > 1 ? 's' : ''}
              </span>
              <small style={{ fontSize: 13, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{avisos[0].titulo}</small>
            </div>
            {avisoUrgente && (
              <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: colors.danger, color: '#FEFEFE', flexShrink: 0 }}>Urgente</span>
            )}
            <ChevronRight size={18} color="#94A3B8" style={{ flexShrink: 0 }} />
          </button>
        )
      })()}

      </div>
      <div style={{ order: ordem('liga') }}>
      {/* ═══ XP E LIGA (José, 22/10/2026 — no lugar dos 3 números) ═══ */}
      <LigaXP />

      </div>
      <div style={{ order: ordem('lousa'), display: 'grid', gap: 14, minWidth: 0 }}>
      {/* ═══ MINHA SEMANA NA LOUSA ═══ */}
      <section
        style={{ ...cartao, overflow: 'hidden' }}
        onTouchStart={toqueInicio}
        onTouchMove={toqueMove}
        onTouchEnd={toqueFim}
        onTouchCancel={() => { toqueX.current = null; setArrasto(0) }}
      >
        <SecTitulo
          icone={CalendarDays}
          titulo={compacto ? 'Minha agenda' : 'Minha semana na Lousa'}
          sub={feed
            ? compacto ? `${semanaAtual ? 'esta semana' : 'outra semana'} · ${ddmm(feed.de)} a ${ddmm(feed.ate)} · toque num dia` : `${ddmm(feed.de)} a ${ddmm(feed.ate)}${semanaAtual ? ' · esta semana' : ''}`
            : carregandoFeed ? 'carregando…' : 'sem conexão com a Lousa'}
          direita={
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {feed && !semanaAtual && (
                <button type="button" onClick={irHoje} style={{ ...botaoSeta, width: 'auto', padding: '0 10px', fontSize: 13, color: colors.primary, borderColor: colors.primaryBorder, background: colors.primaryBg }}>
                  Hoje
                </button>
              )}
              <button type="button" onClick={() => trocarSemana(-1)} aria-label="semana anterior" style={botaoSeta}><ChevronLeft size={18} /></button>
              <button type="button" onClick={() => trocarSemana(1)} aria-label="próxima semana" style={botaoSeta}><ChevronRight size={18} /></button>
            </div>
          }
        />

        {feed && (
          <div
            key={feed.de}
            className={`hm-dias ${direcao ? `hm-semana-${direcao}` : ''}`}
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 6,
              transform: arrasto ? `translateX(${arrasto * 0.5}px)` : undefined,
              opacity: arrasto ? 1 - Math.abs(arrasto) / 300 : undefined,
              transition: arrasto ? 'none' : 'transform .25s ease, opacity .25s ease',
            }}
          >
            {dias.map((d) => {
              const n = doDia(d)
              const os = n.filter((i) => i.fonte === 'os')
              const evento = n.find((i) => i.fonte === 'lousa' && i.tipo !== 'servico')
              const on = d === dia
              const ehHoje = d === feed.hoje
              // barrinha empilhada: quantas OS de cada situação
              const partes = new Map<string, number>()
              for (const i of os) { const c = situacaoItem(i, hoje).cor; partes.set(c, (partes.get(c) || 0) + 1) }
              return (
                <button
                  key={d}
                  type="button"
                  className={on ? 'hm-dia-on' : ''}
                  onClick={() => setDiaEscolhido(d)}
                  style={{
                    display: 'grid', justifyItems: 'center', gap: 3, padding: '8px 4px 7px', borderRadius: 13, minWidth: 0,
                    border: `1px solid ${on ? '#0F172A' : ehHoje ? '#38BDF8' : colors.border}`,
                    background: on ? '#0F172A' : colors.surface, color: on ? '#FEFEFE' : colors.text, cursor: 'pointer',
                  }}
                >
                  <small style={{ fontSize: 11.5, color: on ? '#CBD5E1' : colors.textSubtle }}>{compacto && ehHoje ? 'hoje' : SEMANA[dow(d)]}</small>
                  <span style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.1 }}>{Number(d.slice(8))}</span>
                  <small style={{ fontSize: 10.5, color: on ? '#CBD5E1' : colors.textSubtle, whiteSpace: 'nowrap' }}>
                    {os.length ? `${os.length} OS` : evento ? lousaInfo(evento.tipo).rot : compacto ? 'livre' : '—'}
                  </small>
                  <span className="hm-barra" style={{
                    display: 'flex', width: '100%', height: 5, borderRadius: 3, overflow: 'hidden', gap: 1,
                    background: on ? 'rgba(255,255,255,.18)' : colors.surfaceAlt,
                  }}>
                    {os.length
                      ? [...partes.entries()].map(([c, q]) => <i key={c} style={{ flexGrow: q, flexBasis: 0, background: c }} />)
                      : evento ? <i style={{ flexGrow: 1, background: lousaInfo(evento.tipo).cor }} /> : null}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* resumo da semana */}
        {feed && totalSemana > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 13, background: colors.surfaceAlt, minWidth: 0 }}>
            <Anel feitas={feitasSemana} total={totalSemana} />
            <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 15, color: colors.text }}>
                <Contador valor={feitasSemana} /> de {totalSemana} feita{totalSemana === 1 ? '' : 's'}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {atrasadasSemana > 0 && (
                  <span style={{ fontSize: 12.5, padding: '1px 8px', borderRadius: 999, color: SITUACAO.atrasada.cor, background: clarinho(SITUACAO.atrasada.cor, 10) }}>
                    {atrasadasSemana} atrasada{atrasadasSemana === 1 ? '' : 's'}
                  </span>
                )}
                {pecasSemana > 0 && (
                  <span style={{ fontSize: 12.5, padding: '1px 8px', borderRadius: 999, color: SITUACAO.pecas.cor, background: clarinho(SITUACAO.pecas.cor, 10) }}>
                    {pecasSemana} esperando peças
                  </span>
                )}
                {atrasadasSemana === 0 && pecasSemana === 0 && (
                  <span style={{ fontSize: 12.5, color: colors.textMuted }}>nada atrasado</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* legenda: tocar numa cor filtra o dia — some na tela nova: cada cartão já diz a situação em texto (José, 23/10/2026) */}
        {!compacto && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 10, borderTop: `1px solid ${colors.surfaceAlt}` }}>
          {LEGENDA.map((c) => {
            const ativo = filtroSit === c.rot
            return (
              <button
                key={c.rot}
                type="button"
                title={c.dica}
                onClick={() => setFiltroSit(ativo ? '' : c.rot)}
                aria-pressed={ativo}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '3px 9px', borderRadius: 999,
                  cursor: 'pointer', color: ativo ? c.cor : '#334155',
                  border: `1px solid ${ativo ? c.cor : 'transparent'}`, background: ativo ? clarinho(c.cor, 10) : 'transparent',
                  opacity: filtroSit && !ativo ? 0.55 : 1, transition: 'opacity .2s, background .2s',
                }}
              >
                <i style={{ width: 10, height: 10, borderRadius: '50%', background: c.cor }} />{c.rot}
              </button>
            )
          })}
        </div>}
      </section>

      {/* ═══ O DIA ESCOLHIDO ═══ */}
      {feed && (
        <TituloLista
          titulo={compacto && dia && tituloDia !== SEMANA_LONGA[dow(dia)] ? `${tituloDia}, ${SEMANA_LONGA[dow(dia)]}` : tituloDia}
          sub={dia ? <>{ddmm(dia)} · {osNoDia} {osNoDia === 1 ? 'ordem' : 'ordens'}</> : undefined}
        />
      )}
      {filtroSit && (
        <button type="button" onClick={() => setFiltroSit('')} style={{
          justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 10px',
          borderRadius: 999, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.textMuted, cursor: 'pointer',
        }}>
          Só “{filtroSit}” <X size={13} />
        </button>
      )}
      {carregandoFeed && <div style={vazio}>carregando a Lousa…</div>}
      {!carregandoFeed && !feed && <div style={vazio}>Não deu para abrir a Lousa agora.</div>}
      {feed && dia && lista.length === 0 && (
        <div style={vazio}>
          <Coffee size={22} />
          <span>{filtroSit ? `Nenhuma ordem “${filtroSit}” neste dia.` : compacto ? 'Dia livre: nenhuma ordem marcada para você.' : 'Nada marcado na Lousa para este dia.'}</span>
        </div>
      )}
      {lista.length > 0 && (
        <div key={`${dia}-${filtroSit}`} style={{ display: 'grid', gap: 10, minWidth: 0 }}>
          {lista.map((i, k) => i.fonte === 'lousa' ? <CartaoLousa key={`l-${i.id}`} i={i} /> : (
            <CartaoSituacao
              key={`o-${i.id}-${i.dia}`}
              href={`/os/${i.id}`}
              sit={situacaoItem(i, hoje)}
              numero={numeroOS(i.id)}
              cliente={i.cliente}
              solicitacao={i.solicitacao}
              resservicoDe={i.resservicoDe}
              chips={chipsItem(i)}
              index={k}
              hora={i.hora ? (
                <>
                  <span style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: colors.text }}>{i.hora}</span>
                  {i.horaFim && <small style={{ fontSize: 11.5, color: colors.textSubtle, textAlign: 'right' }}>até {i.horaFim}</small>}
                </>
              ) : <small style={{ fontSize: 11.5, color: colors.textSubtle, textAlign: 'right' }}>sem hora</small>}
            />
          ))}
        </div>
      )}

      {/* ═══ PENDENTES (sem dia na Lousa) ═══ */}
      {feed && pendentesQtd > 0 && (
        <>
          <TituloLista titulo="Pendentes" sub="sem dia na Lousa ainda" />
          <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
            {feed.pendentes.map((i, k) => (
              <CartaoSituacao
                key={`p-${i.id}`}
                href={`/os/${i.id}`}
                sit={situacaoOS(i.status, false, !!i.resservicoDe)}
                numero={numeroOS(i.id)}
                cliente={i.cliente}
                solicitacao={i.solicitacao}
                resservicoDe={i.resservicoDe}
                chips={chipsItem(i)}
                index={k}
                hora={<small style={{ fontSize: 11.5, color: colors.textSubtle, textAlign: 'right' }}>sem dia</small>}
              />
            ))}
          </div>
        </>
      )}

      </div>
      <div style={{ order: ordem('ordens'), display: 'grid', gap: 14, minWidth: 0 }}>
      {/* ═══ MINHAS ORDENS EM ABERTO: faixa andando + lista em foco (José, 22/10/2026) ═══ */}
      {/* José, 23/10/2026: no lugar da faixa de ordens passando, páginas sorteadas do catálogo */}
      {compacto ? <VitrineCatalogo /> : <OrdensEmAberto ordens={ordensAbertasList} />}

      </div>
      <div style={{ order: ordem('equipe') }}>
      {/* ═══ EQUIPE NA SEMANA ═══ */}
      {feed && feed.equipe.length > 0 && (
        <section style={cartao}>
          <SecTitulo icone={Users} titulo="Equipe na semana" sub="quem está fora" />
          <div style={{ display: 'grid', gap: 8 }}>
            {feed.equipe.map((e, k) => {
              const L = lousaInfo(e.tipo)
              return (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr) auto', gap: 10, alignItems: 'center', fontSize: 14 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', color: L.cor, background: clarinho(L.cor, 10) }}><L.ic size={14} /></span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeBonito(e.quem)}</span>
                  <small style={{ fontSize: 12.5, color: colors.textMuted }}>{L.rot} · {SEMANA[dow(e.dia)]} {Number(e.dia.slice(8))}</small>
                </div>
              )
            })}
          </div>
        </section>
      )}

      </div>
      <div style={{ order: ordem('atalhos'), display: 'grid', gap: 14, minWidth: 0 }}>
      {/* ═══ ATALHOS ═══ */}
      {!compacto && <TituloLista titulo="Atalhos" />}
      {!compacto ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${compacto ? 4 : 3}, minmax(0, 1fr))`, gap: compacto ? 6 : 8 }}>
          {(layout === 'atual' ? atalhos : POR_USO.map((t) => atalhos.find((a) => a.t === t)!).filter(Boolean)).map((a) => {
            const dentro = (
              <>
                <span style={{ ...icQuadrado(a.cor, true, compacto ? 38 : 44), borderRadius: compacto ? 11 : 13, position: 'relative' }}>
                  <a.ic size={compacto ? 18 : 21} />
                  {!!a.badge && (
                    <span style={{
                      position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 10,
                      background: colors.danger, color: '#FEFEFE', fontSize: 11, display: 'grid', placeItems: 'center',
                      border: `2px solid ${colors.surface}`,
                    }}>{a.badge}</span>
                  )}
                </span>
                <span style={{ fontSize: compacto ? 12.5 : 13.5, textAlign: 'center', lineHeight: 1.2 }}>{a.t}</span>
                {a.sub && <small style={{ fontSize: compacto ? 10.5 : 11.5, marginTop: -4, color: a.subCor || colors.textSubtle, textAlign: 'center', lineHeight: 1.2 }}>{a.sub}</small>}
              </>
            )
            const estilo: CSSProperties = {
              display: 'grid', justifyItems: 'center', alignContent: 'start', gap: compacto ? 6 : 7, padding: compacto ? '12px 4px 10px' : '14px 6px 12px', borderRadius: compacto ? 14 : 16, minWidth: 0,
              border: `1px solid ${colors.border}`, background: colors.surface, color: colors.text, textDecoration: 'none', cursor: 'pointer',
            }
            return a.h
              ? <Link key={a.t} href={a.h} className="hb" style={estilo}>{dentro}</Link>
              : <button key={a.t} type="button" onClick={a.onClick} className="hb" style={estilo}>{dentro}</button>
          })}
        </div>
      ) : (
        // atalhos num botão central que abre as opções no meio da tela (José, 23/10/2026)
        <>
          <div style={{ height: 76 }} aria-hidden />
          <BotaoAtalhos itens={['Ordens', ...POR_USO].map((t) => atalhos.find((a) => a.t === t)).filter(Boolean) as typeof atalhos} />
        </>
      )}

      </div>

      {/* ═══ FAÇA AGORA + AÇÕES (variantes A/B da tela inicial — José, 22/10/2026) ═══ */}
      {layout !== 'atual' && <div style={{ order: ordem('acoes') }}><AcoesPrincipais variante={layout} /></div>}
      <div style={{ order: ordem('selo') }}><SeloOffline /></div>
      {/* "Faça agora" saiu da tela escolhida (José, 23/10/2026: "pode remover isso"); fica só na opção A */}
      {layout === 'a' && <div style={{ order: ordem('faca') }}><FacaAgora /></div>}

      {/* inputs ocultos de foto */}
      <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={handleFoto} style={{ display: 'none' }} />
      <input ref={galRef} type="file" accept="image/*" onChange={handleFoto} style={{ display: 'none' }} />

      {/* ═══ MODAL: AVISOS ═══ */}
      {avisosModal && (
        <div
          onClick={() => setAvisosModal(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            className="perfil-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: colors.surface, borderRadius: 20, width: '100%', maxWidth: 440,
              maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 -4px 30px rgba(0,0,0,0.2)',
              marginBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 20px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Megaphone size={20} color={colors.warning} />
                <span style={{ fontSize: 16, fontWeight: 500, color: colors.text }}>Avisos</span>
              </div>
              <button
                onClick={() => setAvisosModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0 }}
              >
                <X size={20} color={colors.textMuted} />
              </button>
            </div>

            <div style={{ padding: 20, overflowY: 'auto' }}>
              {avisos.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {avisos.map((av) => (
                    <div key={av.id} style={{
                      background: av.prioridade === 'urgente' ? colors.dangerBg : colors.surfaceAlt,
                      borderRadius: 14, padding: '14px 16px',
                      border: `1px solid ${av.prioridade === 'urgente' ? colors.dangerBorder : colors.border}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 14, fontWeight: 500,
                          color: av.prioridade === 'urgente' ? colors.danger : colors.text,
                        }}>
                          {av.titulo}
                        </span>
                        {av.prioridade === 'urgente' && (
                          <span style={{
                            fontSize: 9, fontWeight: 500, padding: '2px 6px', borderRadius: 5,
                            background: colors.danger, color: '#fff',
                          }}>Urgente</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {av.mensagem}
                      </div>
                      <div style={{ fontSize: 10, color: colors.textSubtle, marginTop: 6 }}>
                        {new Date(av.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  background: colors.surfaceAlt, borderRadius: 14, padding: '24px',
                  textAlign: 'center', color: colors.textSubtle, fontSize: 13,
                }}>
                  Tudo tranquilo por aqui
                </div>
              )}

              {avisosHistorico.length > 0 && (
                <>
                  <button onClick={() => setShowHistorico(!showHistorico)} style={{
                    width: '100%', marginTop: 12, padding: '10px 14px', borderRadius: 10,
                    background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
                    fontSize: 12, fontWeight: 500, color: colors.textSubtle, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                    <Clock size={13} />
                    {showHistorico ? 'Ocultar histórico' : `Ver histórico (${avisosHistorico.length})`}
                  </button>
                  {showHistorico && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                      {avisosHistorico.map((av) => (
                        <div key={av.id} style={{
                          background: colors.surfaceAlt, borderRadius: 14, padding: '12px 16px',
                          border: `1px solid ${colors.border}`, opacity: 0.7,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: colors.textMuted }}>{av.titulo}</span>
                            <span style={{
                              fontSize: 9, fontWeight: 500, padding: '2px 6px', borderRadius: 5,
                              background: colors.successBg, color: colors.success,
                            }}>Lido</span>
                          </div>
                          <div style={{ fontSize: 11, color: colors.textSubtle, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                            {av.mensagem}
                          </div>
                          <div style={{ fontSize: 10, color: colors.textSubtle, marginTop: 4 }}>
                            {new Date(av.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL: FOTO / PERSONAGEM ═══ */}
      {perfilModal && (
        <div
          onClick={() => { cancelarPreview(); setPerfilModal(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            className="perfil-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: colors.surface, borderRadius: 20, width: '100%', maxWidth: 440,
              padding: 20, boxShadow: '0 -4px 30px rgba(0,0,0,0.2)',
              marginBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: colors.text }}>
                {escolherPersonagem ? 'Escolha um personagem' : 'Foto de perfil'}
              </div>
              <button
                onClick={() => fotoPreview ? cancelarPreview() : escolherPersonagem ? setEscolherPersonagem(false) : setPerfilModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0 }}
              >
                <X size={20} color={colors.textMuted} />
              </button>
            </div>

            {!fotoPreview && !escolherPersonagem && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                <div
                  onClick={() => { if (avatarLocal || user?.avatar_url) setFotoFullscreen(true) }}
                  style={{
                    width: 120, height: 120, borderRadius: '50%', overflow: 'hidden',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: (avatarLocal || user?.avatar_url) ? '#fff' : colors.surfaceAlt,
                    border: `3px solid ${colors.border}`,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                    cursor: (avatarLocal || user?.avatar_url) ? 'pointer' : 'default',
                  }}
                >
                  {(avatarLocal || user?.avatar_url) ? (
                    <img src={avatarLocal || user?.avatar_url || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 56, lineHeight: 1 }}>{personagem}</span>
                  )}
                </div>
              </div>
            )}

            {fotoPreview ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 180, height: 180, borderRadius: '50%', overflow: 'hidden',
                  border: `3px solid ${colors.primary}`, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                }}>
                  <img
                    src={fotoPreview.url}
                    alt="Preview"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                  <button
                    onClick={cancelarPreview}
                    disabled={uploading}
                    style={{
                      flex: 1, padding: '12px 0', borderRadius: 12, border: `1px solid ${colors.border}`,
                      background: colors.surfaceAlt, color: colors.text, fontSize: 14, fontWeight: 500, cursor: 'pointer',
                    }}
                  >Cancelar</button>
                  <button
                    onClick={confirmarFoto}
                    disabled={uploading}
                    style={{
                      flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                      background: colors.primary, color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                      opacity: uploading ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                  >
                    {uploading && <div className="spinner" style={{ width: 16, height: 16 }} />}
                    {uploading ? 'Enviando...' : 'Confirmar'}
                  </button>
                </div>
              </div>
            ) : escolherPersonagem ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {PERSONAGENS.map((p) => (
                  <button
                    key={p}
                    onClick={() => salvarPersonagem(p)}
                    style={{
                      aspectRatio: '1', borderRadius: 16, fontSize: 32, cursor: 'pointer',
                      border: p === personagem ? `2px solid ${colors.primary}` : `1px solid ${colors.border}`,
                      background: p === personagem ? colors.primaryBg : colors.surfaceAlt,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <span className={p === personagem ? 'char-anim' : ''}>{p}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button onClick={() => camRef.current?.click()} disabled={uploading} style={opcaoStyle}>
                  <div style={{ ...opcaoIcone, background: colors.primaryBg }}><Camera size={20} color={colors.primary} /></div>
                  <span style={opcaoTexto}>Tirar foto</span>
                </button>
                <button onClick={() => galRef.current?.click()} disabled={uploading} style={opcaoStyle}>
                  <div style={{ ...opcaoIcone, background: colors.infoBg }}><ImageIcon size={20} color={colors.info} /></div>
                  <span style={opcaoTexto}>Escolher da galeria</span>
                </button>
                <button onClick={() => setEscolherPersonagem(true)} style={opcaoStyle}>
                  <div style={{ ...opcaoIcone, background: colors.successBg }}><Smile size={20} color={colors.success} /></div>
                  <span style={opcaoTexto}>Escolher personagem</span>
                  <ArrowRight size={18} color={colors.textSubtle} />
                </button>
                <Link href="/perfil" style={{ ...opcaoStyle, textDecoration: 'none' }}>
                  <div style={{ ...opcaoIcone, background: colors.surfaceAlt }}><User size={20} color={colors.textMuted} /></div>
                  <span style={opcaoTexto}>Ver perfil completo</span>
                  <ArrowRight size={18} color={colors.textSubtle} />
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ FULLSCREEN: FOTO DE PERFIL ═══ */}
      {fotoFullscreen && (avatarLocal || user?.avatar_url) && (
        <div
          onClick={() => setFotoFullscreen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <button
            onClick={() => setFotoFullscreen(false)}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 12, padding: '8px 16px',
              fontSize: 14, fontWeight: 500, color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, zIndex: 201,
            }}
          >
            <X size={18} /> Fechar
          </button>
          <img
            src={avatarLocal || user?.avatar_url || ''}
            alt="Foto de perfil"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '90vw', maxHeight: '85vh',
              borderRadius: 16, objectFit: 'contain',
              boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            }}
          />
        </div>
      )}

      {/* ═══ MODAL: VEICULO ═══ */}
      {veiculoModal && veiculo && (() => {
        const vi = veiculoInfo
        const v = vi?.veiculo
        const partes = veiculo.placa.split(' - ')
        const nomeModelo = v ? [v.marca, v.modelo].filter(Boolean).join(' ') : (partes.length > 1 ? partes.slice(0, -1).join(' - ') : veiculo.descricao || '')
        const placaNum = partes[partes.length - 1]
        const placaFmt = placaNum.length >= 7 ? placaNum.slice(0, 3) + '-' + placaNum.slice(3) : placaNum
        const fmtDate = (d: string | null) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : ''
        const fmtMoney = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        const row = (label: string, val: string | number | null | undefined) => (
          val != null && val !== '' ? (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ fontSize: 12, color: colors.textMuted, flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: colors.text, textAlign: 'right', wordBreak: 'break-all' }}>{val}</span>
            </div>
          ) : null
        )
        return (
          <div
            onClick={() => setVeiculoModal(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0,
            }}
          >
            <div
              className="perfil-modal"
              onClick={(e) => e.stopPropagation()}
              style={{
                background: colors.surface, borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 440,
                maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '0 -4px 30px rgba(0,0,0,0.2)',
              }}
            >
              {/* Header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px',
                borderBottom: `1px solid ${colors.border}`, flexShrink: 0,
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12, overflow: 'hidden', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: v?.imagem_url ? '#fff' : colors.primaryBg,
                }}>
                  {v?.imagem_url ? (
                    <img src={v.imagem_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Car size={24} color={colors.primary} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: colors.text }}>{nomeModelo || 'Veículo'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span style={{
                      fontSize: 12, fontWeight: 500, color: '#333', background: '#fff',
                      border: '1.5px solid #333', borderRadius: 4, padding: '1px 6px', letterSpacing: 1,
                    }}>{placaFmt}</span>
                    {v?.tem_rastreador && (
                      <span style={{ fontSize: 9, fontWeight: 500, color: colors.success, background: colors.successBg, padding: '2px 6px', borderRadius: 4 }}>Rastreado</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setVeiculoModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0, flexShrink: 0 }}
                >
                  <X size={20} color={colors.textMuted} />
                </button>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, flexShrink: 0, padding: '0 20px' }}>
                {([['info', 'Informações'], ['docs', 'Documentos'], ['checklist', 'Checklist']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setVeiculoTab(key)}
                    style={{
                      flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                      background: 'none', fontSize: 12, fontWeight: 500,
                      color: veiculoTab === key ? colors.primary : colors.textMuted,
                      borderBottom: veiculoTab === key ? `2px solid ${colors.primary}` : '2px solid transparent',
                    }}
                  >{label}</button>
                ))}
              </div>

              {/* Conteudo scrollavel */}
              <div style={{ overflowY: 'auto', padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {!vi || !v ? (
                  <div style={{ textAlign: 'center', padding: 24, color: colors.textMuted, fontSize: 13 }}>
                    <div className="spinner" style={{ width: 24, height: 24, margin: '0 auto 8px' }} />
                    Carregando informações...
                  </div>
                ) : veiculoTab === 'docs' ? (
                  /* ── ABA: DOCUMENTOS ── */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(vi.documentos || []).length > 0 ? (vi.documentos || []).map((doc) => {
                      // Vencimento pelo dia (Brasília): 'AAAA-MM-DD' puro era lido como UTC, um dia antes (José, 23/10/2026)
                      const vigFim = doc.vigencia_fim ? String(doc.vigencia_fim).slice(0, 10) : ''
                      const vencido = vigFim ? vigFim < hojeBR() : false
                      const diasRestantes = vigFim ? Math.round((new Date(vigFim + 'T12:00:00').getTime() - new Date(hojeBR() + 'T12:00:00').getTime()) / 86400000) : null
                      const corValidade = vencido ? colors.danger : (diasRestantes !== null && diasRestantes <= 30) ? colors.warning : colors.success
                      return (
                        <a
                          key={doc.id}
                          href={doc.url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: 12,
                            background: colors.surfaceAlt, borderRadius: 12, textDecoration: 'none',
                            border: `1px solid ${colors.border}`,
                          }}
                        >
                          <div style={{
                            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                            background: vencido ? colors.dangerBg : colors.primaryBg,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <FileText size={20} color={vencido ? colors.danger : colors.primary} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{doc.tipo}</div>
                            {doc.numero && <div style={{ fontSize: 11, color: colors.textMuted }}>Nº {doc.numero}</div>}
                            {doc.emissor && <div style={{ fontSize: 11, color: colors.textMuted }}>{doc.emissor}</div>}
                          </div>
                          {doc.vigencia_fim && (
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 11, fontWeight: 500, color: corValidade }}>
                                {vencido ? 'Vencido' : diasRestantes !== null && diasRestantes <= 30 ? `${diasRestantes}d` : 'Vigente'}
                              </div>
                              <div style={{ fontSize: 10, color: colors.textMuted }}>
                                {new Date(vigFim + 'T12:00:00').toLocaleDateString('pt-BR')}
                              </div>
                            </div>
                          )}
                        </a>
                      )
                    }) : (
                      <div style={{ textAlign: 'center', padding: 24, color: colors.textMuted, fontSize: 13 }}>
                        Nenhum documento encontrado
                      </div>
                    )}
                  </div>
                ) : veiculoTab === 'checklist' ? (
                  /* ── ABA: CHECKLIST ── */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ textAlign: 'center', padding: '12px 0' }}>
                      <Shield size={36} color={colors.primary} style={{ margin: '0 auto 8px' }} />
                      <div style={{ fontSize: 14, fontWeight: 500, color: colors.text }}>Inspeção Mensal</div>
                      <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                        Checklist obrigatório todo final de mês
                      </div>
                    </div>
                    <Link
                      href="/checklist-veiculo"
                      onClick={() => setVeiculoModal(false)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        padding: '12px 16px', borderRadius: 14,
                        background: colors.primary, color: '#fff', textDecoration: 'none',
                        fontSize: 14, fontWeight: 500,
                      }}
                    >
                      <Camera size={16} /> Iniciar Checklist
                    </Link>
                  </div>
                ) : (
                  <>
                    {/* Pendencias */}
                    {vi.multas.abertas > 0 && (
                      <div style={{
                        background: colors.warningBg, borderRadius: 12, padding: '10px 14px',
                        border: `1px solid ${colors.warningBorder}`,
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: colors.warning, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <AlertCircle size={14} /> Pendências
                        </div>
                        <div style={{ fontSize: 11, color: colors.text, marginTop: 4 }}>
                          {vi.multas.abertas} multa{vi.multas.abertas > 1 ? 's' : ''} em aberto ({fmtMoney(vi.multas.valor)})
                        </div>
                      </div>
                    )}

                    {/* Identificacao */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: colors.textSubtle, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Info size={13} /> Identificação
                      </div>
                      <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: '4px 12px', border: `1px solid ${colors.border}` }}>
                        {row('Marca / Modelo', nomeModelo)}
                        {row('Ano', v.ano_modelo ? `${v.ano || v.ano_modelo}/${v.ano_modelo}` : v.ano)}
                        {row('Cor', v.cor)}
                        {row('Combustível', v.combustivel)}
                        {row('Chassi', v.chassi)}
                        {row('RENAVAM', v.renavam)}
                        {row('Tipo', v.tipo_veiculo)}
                        {row('Categoria', v.categoria)}
                        {row('Status', v.status)}
                        {row('Proprietário', v.proprietario)}
                        {row('Documento (exercício)', v.exercicio_crlv ? String(v.exercicio_crlv) : null)}
                        {row('Hodômetro (rastreador)', v.hodometro != null ? `${v.hodometro.toLocaleString('pt-BR')} km` : null)}
                        {row('Tanque', v.capacidade_tanque ? `${v.capacidade_tanque} L` : null)}
                        {v.senha_cartao_veloe && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
                            <span style={{ fontSize: 12, color: colors.textMuted, flexShrink: 0 }}>Senha cartão Veloe</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 500, color: colors.text }}>
                              {verSenhaVeloe ? v.senha_cartao_veloe : '••••••'}
                              <button
                                onClick={() => setVerSenhaVeloe((s) => !s)}
                                style={{ background: 'none', border: 'none', color: colors.primary, fontSize: 11, fontWeight: 500, padding: 0, cursor: 'pointer' }}
                              >
                                {verSenhaVeloe ? 'ocultar' : 'mostrar'}
                              </button>
                            </span>
                          </div>
                        )}
                        {v.equipamentos && v.equipamentos.length > 0 && (
                          <div style={{ padding: '8px 0' }}>
                            <span style={{ fontSize: 12, color: colors.textMuted }}>Equipamentos</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                              {v.equipamentos.map((eq) => (
                                <span key={eq} style={{
                                  fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 6,
                                  background: colors.successBg, color: colors.success,
                                }}>{eq}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Responsavel */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: colors.textSubtle, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <User size={13} /> Responsável
                      </div>
                      <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: 12, border: `1px solid ${colors.border}` }}>
                        {vi.responsavel ? (
                          <>
                            <div style={{ fontSize: 14, fontWeight: 500, color: colors.text }}>{vi.responsavel.nome}</div>
                            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                              desde {fmtDate(vi.responsavel.inicio)} · origem: {vi.responsavel.origem}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: colors.textMuted }}>Sem responsável atribuído</div>
                        )}
                      </div>
                    </div>

                    {/* Historico */}
                    {vi.historico.length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: colors.textSubtle, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Clock size={13} /> Histórico
                        </div>
                        <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: '4px 12px', border: `1px solid ${colors.border}` }}>
                          {vi.historico.map((h, i) => (
                            <div key={i} style={{
                              display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0',
                              borderBottom: i < vi.historico.length - 1 ? `1px solid ${colors.border}` : 'none',
                            }}>
                              <span style={{ fontSize: 12, fontWeight: 500, color: colors.text }}>{h.nome}</span>
                              <span style={{ fontSize: 11, color: colors.textMuted, flexShrink: 0 }}>
                                {fmtDate(h.inicio)} → {h.fim ? fmtDate(h.fim) : 'atual'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Custos */}
                    {Object.keys(vi.custos).length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: colors.textSubtle, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Fuel size={13} /> Custos (últimos 12 meses)
                        </div>
                        <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: '4px 12px', border: `1px solid ${colors.border}` }}>
                          {Object.entries(vi.custos).sort((a, b) => b[1] - a[1]).map(([tipo, valor], i, arr) => (
                            <div key={tipo} style={{
                              display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0',
                              borderBottom: i < arr.length - 1 ? `1px solid ${colors.border}` : 'none',
                            }}>
                              <span style={{ fontSize: 12, color: colors.textMuted }}>{tipo}</span>
                              <span style={{ fontSize: 12, fontWeight: 500, color: colors.text }}>{fmtMoney(valor)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <Link
                  href="/mapa"
                  onClick={() => setVeiculoModal(false)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '12px 16px', borderRadius: 14,
                    background: colors.primary, color: '#fff', textDecoration: 'none',
                    fontSize: 14, fontWeight: 500,
                  }}
                >
                  <MapPin size={16} /> Ver no Mapa
                </Link>
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
