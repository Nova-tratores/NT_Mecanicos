'use client'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { supabase } from '@/lib/supabase'
import type { OrdemServico } from '@/lib/types'
import {
  FileText, ChevronRight, User, Megaphone,
  Navigation, Clock, MapPin, ShieldCheck, Car,
  BarChart3, AlertCircle, Headset, BookOpen,
  Camera, Image as ImageIcon, Smile, X, ChevronRight as ArrowRight,
  Fuel, Info, Shield,
} from 'lucide-react'
import Link from 'next/link'
import { PageSpinner } from '@/components/ui'
import { colors, radius, shadow } from '@/lib/ui'

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
  const hoje = new Date().toISOString().split('T')[0]

  const [osRes, reqPendRes, reqEnvRes, avisosRes] = await Promise.all([
    supabase
      .from('Ordem_Servico')
      .select('Id_Ordem, Status, Previsao_Execucao')
      .not('Status', 'in', '("Concluida","Cancelada","Concluída","cancelada")')
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
    supabase
      .from('avisos_gerais')
      .select('id, titulo, mensagem, prioridade, created_at')
      .eq('ativo', true)
      .or(`expira_em.is.null,expira_em.gte.${hoje}`)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  // Se a query principal falhou (offline), lança para useCached usar fallback do IndexedDB
  if (osRes.error) throw new Error(osRes.error.message)

  // Filtrar avisos já confirmados pelo técnico
  const todosAvisos = (avisosRes.data || []) as AvisoGeral[]
  let avisosFiltrados = todosAvisos
  let avisosHistorico: AvisoGeral[] = []
  if (todosAvisos.length > 0 && tecnicoNome) {
    const ids = todosAvisos.map(a => a.id)
    const { data: confirmados } = await supabase
      .from('avisos_gerais_confirmados')
      .select('aviso_id')
      .eq('tecnico_nome', tecnicoNome)
      .in('aviso_id', ids)
    const confirmSet = new Set((confirmados || []).map((c: any) => c.aviso_id))
    avisosFiltrados = todosAvisos.filter(a => !confirmSet.has(a.id))
    avisosHistorico = todosAvisos.filter(a => confirmSet.has(a.id))
  }

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
  ]
  for (const o of todas) {
    if (FASES_CONCLUIDAS.includes(o.Status)) enviadaSet.add(String(o.Id_Ordem))
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

  // Contar fotos - ordens com fotos do tecnico
  let fotosCount = 0
  if (ids.length > 0) {
    const { count } = await supabase
      .from('Ordem_Servico')
      .select('Id_Ordem', { count: 'exact', head: true })
      .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
      .not('Status', 'in', '("Concluida","Cancelada","Concluída","cancelada")')
      .not('fotos_path', 'is', null)
    fotosCount = count || 0
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
  }
  responsavel: { nome: string; inicio: string; origem: string } | null
  historico: { nome: string; inicio: string; fim: string | null }[]
  custos: Record<string, number>
  multas: { abertas: number; valor: number }
  documentos?: { id: string; tipo: string; numero: string | null; emissor: string | null; vigencia_fim: string | null; url: string | null; nome_arquivo: string | null }[]
}

const PERSONAGENS = ['🧑‍🔧', '👷', '🧔', '👨‍🔧', '🐻', '🦊', '🐼', '🦁', '🐶', '🦉', '🤖', '🐯']

/* ═══ Slider: ordens em aberto de todos os técnicos ═══ */
interface OrdemAberta {
  Id_Ordem: string
  Os_Cliente: string | null
  Os_Tecnico: string | null
  Status: string
  Tipo_Servico: string | null
  Serv_Solicitado: string | null
}

async function fetchMinhasOrdensAbertas(nome: string): Promise<OrdemAberta[]> {
  if (!nome) return []
  const { data } = await supabase
    .from('Ordem_Servico')
    .select('Id_Ordem, Os_Cliente, Os_Tecnico, Status, Tipo_Servico, Serv_Solicitado')
    .not('Status', 'in', '("Concluida","Cancelada","Concluída","cancelada","Relatório Concluído","Relatorio Concluido","Executada aguardando comercial","Faturada","Faturado","Finalizada","Finalizado","Enviado Para Omie","Enviado para Omie")')
    .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
    .order('Id_Ordem', { ascending: false })
    .limit(50)
  return (data || []) as OrdemAberta[]
}

// Extrai o pedido do cliente ("Solicitação do Cliente: ...")
function solicitacaoCurta(serv?: string | null, fallback?: string | null): string {
  if (serv) {
    const txt = serv.replace(/\s+/g, ' ').trim()
    const m = txt.match(/solicita[çc][ãa]o do cliente\s*:?\s*(.*)/i)
    if (m) {
      const val = m[1].split(/servi[çc]o\s+realizado/i)[0].trim()
      if (val) return val
    }
  }
  return fallback || ''
}

export default function TecnicoHome() {
  const { user, refresh } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const { data, loading, refreshing } = useCached<DashboardData>(
    `dashboard:${nome}`,
    () => fetchDashboardData(nome, user?.tecnico_nome || ''),
    { skip: !user },
  )

  // Carrossel de ordens em aberto do próprio técnico
  const { data: minhasOrdens } = useCached<OrdemAberta[]>(
    `home:minhas-ordens:${nome}`,
    () => fetchMinhasOrdensAbertas(nome),
    { skip: !user },
  )
  const ordensAbertasList = useMemo(() => minhasOrdens || [], [minhasOrdens])

  const [showHistorico, setShowHistorico] = useState(false)
  const [avisosModal, setAvisosModal] = useState(false)

  // --- Perfil: foto (camera/galeria) e personagem ---
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [perfilModal, setPerfilModal] = useState(false)
  const [escolherPersonagem, setEscolherPersonagem] = useState(false)
  const [personagem, setPersonagem] = useState<string>('')

  // --- Veiculo do tecnico ---
  const [veiculo, setVeiculo] = useState<{ placa: string; descricao: string } | null>(null)
  const [veiculoInfo, setVeiculoInfo] = useState<VeiculoInfo | null>(null)
  const [veiculoModal, setVeiculoModal] = useState(false)
  const [veiculoTab, setVeiculoTab] = useState<'info' | 'docs' | 'checklist'>('info')
  const [checklistPendente, setChecklistPendente] = useState(false)

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
          body: JSON.stringify({ tecnico_nome: nome }),
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
  }, [nome])

  const salvarPersonagem = (p: string) => {
    if (!user) return
    localStorage.setItem(`mec_personagem_${user.id}`, p)
    setPersonagem(p)
    setEscolherPersonagem(false)
    setPerfilModal(false)
  }

  const handleFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('userId', user.id)
      const res = await fetch('/api/avatar', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erro ao enviar')
      if (refresh) refresh()
      setPerfilModal(false)
    } catch (err) {
      console.error('Erro ao enviar foto:', err)
      alert('Erro ao enviar foto. Tente novamente.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }


  if (loading) return <PageSpinner />

  const {
    osPendentes = 0, osAbertas = 0, osEnviadas = 0, osAtrasadas = 0,
    reqPendentes = 0, reqEnviadas = 0, fotosCount = 0,
    garantiasPendentes = 0, garantiasAbertas = 0,
    avisos = [], avisosHistorico = [],
  } = data || {}

  const saudacao = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  const dataLabel = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })

  // estilos compartilhados dos blocos de acao (linha horizontal, largura total)
  const blocoStyle = {
    display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none',
    background: colors.surface, borderRadius: 20, padding: 18,
    border: `1px solid ${colors.border}`, boxShadow: shadow.sm,
  } as const
  const blocoIcone = {
    width: 52, height: 52, borderRadius: 16, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
  } as const
  const blocoTitulo = { fontSize: 16, fontWeight: 600, color: colors.text } as const
  const blocoSub = { fontSize: 12, color: colors.textMuted, marginTop: 2 } as const

  // estilos das opcoes do modal de perfil
  const opcaoStyle = {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
    padding: 12, borderRadius: 14, border: `1px solid ${colors.border}`,
    background: colors.surface, cursor: 'pointer', textAlign: 'left' as const,
  } as const
  const opcaoIcone = {
    width: 40, height: 40, borderRadius: 12, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as const
  const opcaoTexto = { flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: colors.text } as const

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {refreshing && <div className="refresh-bar" />}

      {/* ═══ BLOQUEIO: CHECKLIST PENDENTE ═══ */}
      {checklistPendente && (
        <div style={{
          background: colors.dangerBg, borderRadius: 16, padding: 16,
          border: `1px solid ${colors.dangerBorder || '#FECACA'}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: colors.danger, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertCircle size={22} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.danger }}>Checklist pendente</div>
            <div style={{ fontSize: 11, color: colors.text, marginTop: 2 }}>
              Complete a inspeção do veículo para continuar usando o app
            </div>
          </div>
          <Link href="/checklist-veiculo" style={{
            padding: '8px 14px', borderRadius: 10, background: colors.danger, color: '#fff',
            textDecoration: 'none', fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>Fazer</Link>
        </div>
      )}

      {/* ═══ PERFIL + SAUDAÇÃO (topo) ═══ */}
      <div
        className="hb"
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'linear-gradient(135deg, #1E3A5F, #2B5583)',
          borderRadius: 20, padding: 16,
          border: '1px solid #1E3A5F', boxShadow: shadow.sm,
        }}
      >
        {/* Avatar (abre modal de foto) */}
        <div
          onClick={() => { setEscolherPersonagem(false); setPerfilModal(true) }}
          style={{ position: 'relative', flexShrink: 0, cursor: 'pointer' }}
        >
          <div style={{
            width: 56, height: 56, borderRadius: '50%', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: user?.avatar_url ? '#fff' : 'rgba(255,255,255,0.16)',
            border: '2px solid rgba(255,255,255,0.5)',
          }}>
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span className="char-anim" style={{ fontSize: 32, lineHeight: 1 }}>{personagem}</span>
            )}
          </div>
          <div style={{
            position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: '50%',
            background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
          }}>
            <Camera size={10} color="#1E3A5F" />
          </div>
        </div>

        {/* Nome + cargo */}
        <div
          onClick={() => { setEscolherPersonagem(false); setPerfilModal(true) }}
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
        >
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{saudacao()},</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.tecnico_nome?.split(' ')[0] || 'Tecnico'}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 1 }}>
            {user?.role === 'admin' ? 'Administrador' : 'Tecnico de campo'}
          </div>
        </div>

        {/* Veiculo (abre modal do carro) */}
        {veiculo && (() => {
          const partes = veiculo.placa.split(' - ')
          const placaNum = partes[partes.length - 1]
          const placaFmt = placaNum.length >= 7 ? placaNum.slice(0, 3) + '-' + placaNum.slice(3) : placaNum
          const imgUrl = veiculoInfo?.veiculo?.imagem_url
          return (
            <div
              onClick={() => { setVeiculoTab('info'); setVeiculoModal(true) }}
              style={{
                flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                cursor: 'pointer',
              }}
            >
              <div style={{
                width: 56, height: 56, borderRadius: 14, overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: imgUrl ? '#fff' : 'rgba(255,255,255,0.16)',
                border: '2px solid rgba(255,255,255,0.3)',
              }}>
                {imgUrl ? (
                  <img src={imgUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Car size={26} color="rgba(255,255,255,0.8)" />
                )}
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: 0.5,
                background: 'rgba(255,255,255,0.16)', padding: '2px 8px', borderRadius: 6,
              }}>
                {placaFmt}
              </span>
            </div>
          )
        })()}
      </div>

      {/* ═══ CARD: ORDENS DE SERVICO (link direto) ═══ */}
      <Link href="/os" className="hb" style={{
        display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none',
        background: colors.surface, borderRadius: 20, padding: 20,
        border: `1px solid ${colors.border}`, boxShadow: shadow.sm,
        animationDelay: '0ms',
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 16, background: colors.primary,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
        }}>
          <FileText size={26} color="#fff" strokeWidth={2.2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: colors.text }}>Ordens de Servico</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>Abertas e enviadas</div>
        </div>
        <ChevronRight size={20} color={colors.textSubtle} style={{ flexShrink: 0 }} />
      </Link>

      {/* ═══ CARROSSEL: minhas ordens em aberto (estilo foto) ═══ */}
      {ordensAbertasList.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Minhas ordens em aberto
            </span>
            <span style={{ fontSize: 11, color: colors.textSubtle }}>· {ordensAbertasList.length}</span>
          </div>
          <div className="no-scrollbar" style={{
            display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4,
            scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
          }}>
            {ordensAbertasList.map((o, i) => (
              <Link
                key={o.Id_Ordem}
                href={`/os/${o.Id_Ordem}`}
                className="slide-card"
                style={{
                  flex: '0 0 auto', width: 232, scrollSnapAlign: 'start', textDecoration: 'none',
                  borderRadius: 18, overflow: 'hidden', background: colors.surface,
                  border: `1px solid ${colors.border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  display: 'flex', flexDirection: 'column',
                  animationDelay: `${Math.min(i * 70, 500)}ms`,
                }}
              >
                {/* "foto" da OS */}
                <div style={{
                  height: 100, position: 'relative',
                  background: 'linear-gradient(135deg, #C41E2A, #9B1520)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <FileText size={42} color="rgba(255,255,255,0.9)" strokeWidth={1.5} />
                  <span style={{
                    position: 'absolute', top: 10, left: 12, fontSize: 13, fontWeight: 700, color: '#fff',
                  }}>
                    {o.Id_Ordem}
                  </span>
                </div>
                {/* info */}
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.Os_Cliente || 'Sem cliente'}
                  </span>
                  <span style={{ fontSize: 12, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {solicitacaoCurta(o.Serv_Solicitado, o.Tipo_Servico) || '—'}
                  </span>
                  <span style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: colors.primary, display: 'flex', alignItems: 'center', gap: 4 }}>
                    Preencher <ChevronRight size={14} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ═══ CARD: AVISOS (abre modal) ═══ */}
      <button
        onClick={() => { setShowHistorico(false); setAvisosModal(true) }}
        className="hb"
        style={{ ...blocoStyle, animationDelay: '60ms', width: '100%', padding: 20, cursor: 'pointer' }}
      >
        <div style={{
          width: 52, height: 52, borderRadius: 16, background: colors.warning,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
        }}>
          <Megaphone size={26} color="#fff" strokeWidth={2.2} />
        </div>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: colors.text }}>Avisos</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
            {avisos.length > 0 ? `${avisos.length} aviso${avisos.length > 1 ? 's' : ''} ativo${avisos.length > 1 ? 's' : ''}` : 'Nenhum aviso'}
          </div>
        </div>
        {avisos.some(a => a.prioridade === 'urgente') && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
            background: colors.danger, color: '#fff', flexShrink: 0,
          }}>URGENTE</span>
        )}
        <ChevronRight size={20} color={colors.textSubtle} style={{ flexShrink: 0 }} />
      </button>

      {/* ═══ BLOCOS DE ACAO ═══ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Jornada */}
        <Link href="/jornada" className="hb" style={{ ...blocoStyle, animationDelay: '120ms' }}>
          <div style={{ ...blocoIcone, background: colors.info }}>
            <Navigation size={25} color="#fff" strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={blocoTitulo}>Jornada</div>
            <div style={blocoSub}>Deslocamentos</div>
          </div>
          <ChevronRight size={20} color={colors.textSubtle} style={{ flexShrink: 0 }} />
        </Link>

        {/* Mapa de Veiculos */}
        <Link href="/mapa" className="hb" style={{ ...blocoStyle, animationDelay: '165ms' }}>
          <div style={{ ...blocoIcone, background: colors.accent }}>
            <MapPin size={25} color="#fff" strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={blocoTitulo}>Mapa de Veiculos</div>
            <div style={blocoSub}>Ver quem esta perto</div>
          </div>
          <ChevronRight size={20} color={colors.textSubtle} style={{ flexShrink: 0 }} />
        </Link>

        {/* Garantias */}
        <Link href="/garantias" className="hb" style={{
          ...blocoStyle,
          animationDelay: '210ms',
          background: garantiasPendentes > 0 ? colors.warningBg : colors.surface,
          border: `1px solid ${garantiasPendentes > 0 ? colors.warningBorder : colors.border}`,
        }}>
          <div style={{
            ...blocoIcone,
            background: garantiasPendentes > 0 ? colors.warning : colors.success,
            position: 'relative',
          }}>
            <ShieldCheck size={25} color="#fff" strokeWidth={2.2} />
            {garantiasPendentes > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                background: colors.danger, color: '#fff', fontSize: 10,
                fontWeight: 700, borderRadius: 10, minWidth: 20, height: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                border: '2px solid #fff', boxShadow: shadow.sm,
              }}>
                {garantiasPendentes}
              </span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={blocoTitulo}>Garantias</div>
            <div style={{
              ...blocoSub,
              color: garantiasPendentes > 0 ? colors.warning : colors.textMuted,
            }}>
              {garantiasPendentes > 0
                ? `${garantiasPendentes} precisa${garantiasPendentes > 1 ? 'm' : ''} de resposta`
                : garantiasAbertas > 0
                  ? `${garantiasAbertas} em andamento`
                  : 'Status e B.O.'}
            </div>
          </div>
          <ChevronRight size={20} color={colors.textSubtle} style={{ flexShrink: 0 }} />
        </Link>

        {/* Opa */}
        <Link href="/opa" className="hb" style={{ ...blocoStyle, animationDelay: '255ms' }}>
          <div style={{ ...blocoIcone, background: colors.danger }}>
            <AlertCircle size={25} color="#fff" strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={blocoTitulo}>Opa</div>
            <div style={blocoSub}>Ocorrencias</div>
          </div>
          <ChevronRight size={20} color={colors.textSubtle} style={{ flexShrink: 0 }} />
        </Link>

        {/* SAT Digital */}
        <Link href="/sat" className="hb" style={{ ...blocoStyle, animationDelay: '300ms' }}>
          <div style={{ ...blocoIcone, background: '#D97706' }}>
            <Headset size={25} color="#fff" strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={blocoTitulo}>SAT Digital</div>
            <div style={blocoSub}>Solicitar atendimento</div>
          </div>
          <ChevronRight size={20} color={colors.textSubtle} style={{ flexShrink: 0 }} />
        </Link>

        {/* Catalogo de Pecas */}
        <Link href="/catalogos" className="hb" style={{ ...blocoStyle, animationDelay: '345ms' }}>
          <div style={{ ...blocoIcone, background: '#7C3AED' }}>
            <BookOpen size={25} color="#fff" strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={blocoTitulo}>Catálogo de Peças</div>
            <div style={blocoSub}>Consultar peças e diagramas</div>
          </div>
          <ChevronRight size={20} color={colors.textSubtle} style={{ flexShrink: 0 }} />
        </Link>

        {/* Relatorios */}
        <Link href="/relatorios" className="hb" style={{ ...blocoStyle, animationDelay: '390ms' }}>
          <div style={{ ...blocoIcone, background: colors.success }}>
            <BarChart3 size={25} color="#fff" strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={blocoTitulo}>Relatorios</div>
            <div style={blocoSub}>Faturamento e custos</div>
          </div>
          <ChevronRight size={20} color={colors.textSubtle} style={{ flexShrink: 0 }} />
        </Link>

      </div>

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
              background: colors.surface, borderRadius: 24, width: '100%', maxWidth: 440,
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
                <span style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>Avisos</span>
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
                          fontSize: 14, fontWeight: 700,
                          color: av.prioridade === 'urgente' ? colors.danger : colors.text,
                        }}>
                          {av.titulo}
                        </span>
                        {av.prioridade === 'urgente' && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5,
                            background: colors.danger, color: '#fff',
                          }}>URGENTE</span>
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
                    fontSize: 12, fontWeight: 600, color: colors.textSubtle, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                    <Clock size={13} />
                    {showHistorico ? 'Ocultar historico' : `Ver historico (${avisosHistorico.length})`}
                  </button>
                  {showHistorico && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                      {avisosHistorico.map((av) => (
                        <div key={av.id} style={{
                          background: colors.surfaceAlt, borderRadius: 14, padding: '12px 16px',
                          border: `1px solid ${colors.border}`, opacity: 0.7,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: colors.textMuted }}>{av.titulo}</span>
                            <span style={{
                              fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 5,
                              background: colors.successBg, color: colors.success,
                            }}>LIDO</span>
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
          onClick={() => setPerfilModal(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            className="perfil-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: colors.surface, borderRadius: 24, width: '100%', maxWidth: 440,
              padding: 20, boxShadow: '0 -4px 30px rgba(0,0,0,0.2)',
              marginBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>
                {escolherPersonagem ? 'Escolha um personagem' : 'Foto de perfil'}
              </div>
              <button
                onClick={() => (escolherPersonagem ? setEscolherPersonagem(false) : setPerfilModal(false))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0 }}
              >
                <X size={20} color={colors.textMuted} />
              </button>
            </div>

            {escolherPersonagem ? (
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
                  {uploading && <div className="spinner" style={{ width: 16, height: 16 }} />}
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
              <span style={{ fontSize: 12, fontWeight: 600, color: colors.text, textAlign: 'right', wordBreak: 'break-all' }}>{val}</span>
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
                  <div style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>{nomeModelo || 'Veiculo'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span style={{
                      fontSize: 12, fontWeight: 700, color: '#333', background: '#fff',
                      border: '1.5px solid #333', borderRadius: 4, padding: '1px 6px', letterSpacing: 1,
                    }}>{placaFmt}</span>
                    {v?.tem_rastreador && (
                      <span style={{ fontSize: 9, fontWeight: 600, color: colors.success, background: colors.successBg, padding: '2px 6px', borderRadius: 4 }}>RASTREADO</span>
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
                      background: 'none', fontSize: 12, fontWeight: 600,
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
                    Carregando informacoes...
                  </div>
                ) : veiculoTab === 'docs' ? (
                  /* ── ABA: DOCUMENTOS ── */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(vi.documentos || []).length > 0 ? (vi.documentos || []).map((doc) => {
                      const vencido = doc.vigencia_fim ? new Date(doc.vigencia_fim) < new Date() : false
                      const diasRestantes = doc.vigencia_fim ? Math.ceil((new Date(doc.vigencia_fim).getTime() - Date.now()) / 86400000) : null
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
                            <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{doc.tipo}</div>
                            {doc.numero && <div style={{ fontSize: 11, color: colors.textMuted }}>Nº {doc.numero}</div>}
                            {doc.emissor && <div style={{ fontSize: 11, color: colors.textMuted }}>{doc.emissor}</div>}
                          </div>
                          {doc.vigencia_fim && (
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: corValidade }}>
                                {vencido ? 'Vencido' : diasRestantes !== null && diasRestantes <= 30 ? `${diasRestantes}d` : 'Vigente'}
                              </div>
                              <div style={{ fontSize: 10, color: colors.textMuted }}>
                                {new Date(doc.vigencia_fim).toLocaleDateString('pt-BR')}
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
                      <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Inspeção Mensal</div>
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
                        fontSize: 14, fontWeight: 600,
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
                        <div style={{ fontSize: 12, fontWeight: 700, color: colors.warning, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <AlertCircle size={14} /> PENDENCIAS
                        </div>
                        <div style={{ fontSize: 11, color: colors.text, marginTop: 4 }}>
                          {vi.multas.abertas} multa{vi.multas.abertas > 1 ? 's' : ''} em aberto ({fmtMoney(vi.multas.valor)})
                        </div>
                      </div>
                    )}

                    {/* Identificacao */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: colors.textSubtle, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Info size={13} /> IDENTIFICACAO
                      </div>
                      <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: '4px 12px', border: `1px solid ${colors.border}` }}>
                        {row('Marca / Modelo', nomeModelo)}
                        {row('Ano', v.ano_modelo ? `${v.ano || v.ano_modelo}/${v.ano_modelo}` : v.ano)}
                        {row('Cor', v.cor)}
                        {row('Combustivel', v.combustivel)}
                        {row('Chassi', v.chassi)}
                        {row('RENAVAM', v.renavam)}
                        {row('Tipo', v.tipo_veiculo)}
                        {row('Categoria', v.categoria)}
                        {row('Status', v.status)}
                        {row('Proprietario', v.proprietario)}
                        {row('Documento (exercicio)', v.exercicio_crlv ? String(v.exercicio_crlv) : null)}
                        {row('Hodometro (rastreador)', v.hodometro != null ? `${v.hodometro.toLocaleString('pt-BR')} km` : null)}
                        {row('Tanque', v.capacidade_tanque ? `${v.capacidade_tanque} L` : null)}
                        {v.equipamentos && v.equipamentos.length > 0 && (
                          <div style={{ padding: '8px 0' }}>
                            <span style={{ fontSize: 12, color: colors.textMuted }}>Equipamentos</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                              {v.equipamentos.map((eq) => (
                                <span key={eq} style={{
                                  fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
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
                      <div style={{ fontSize: 12, fontWeight: 700, color: colors.textSubtle, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <User size={13} /> RESPONSAVEL
                      </div>
                      <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: 12, border: `1px solid ${colors.border}` }}>
                        {vi.responsavel ? (
                          <>
                            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{vi.responsavel.nome}</div>
                            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                              desde {fmtDate(vi.responsavel.inicio)} · origem: {vi.responsavel.origem}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: colors.textMuted }}>Sem responsavel atribuido</div>
                        )}
                      </div>
                    </div>

                    {/* Historico */}
                    {vi.historico.length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: colors.textSubtle, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Clock size={13} /> HISTORICO
                        </div>
                        <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: '4px 12px', border: `1px solid ${colors.border}` }}>
                          {vi.historico.map((h, i) => (
                            <div key={i} style={{
                              display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0',
                              borderBottom: i < vi.historico.length - 1 ? `1px solid ${colors.border}` : 'none',
                            }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{h.nome}</span>
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
                        <div style={{ fontSize: 12, fontWeight: 700, color: colors.textSubtle, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Fuel size={13} /> CUSTOS (ULTIMOS 12 MESES)
                        </div>
                        <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: '4px 12px', border: `1px solid ${colors.border}` }}>
                          {Object.entries(vi.custos).sort((a, b) => b[1] - a[1]).map(([tipo, valor], i, arr) => (
                            <div key={tipo} style={{
                              display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0',
                              borderBottom: i < arr.length - 1 ? `1px solid ${colors.border}` : 'none',
                            }}>
                              <span style={{ fontSize: 12, color: colors.textMuted }}>{tipo}</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{fmtMoney(valor)}</span>
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
                    fontSize: 14, fontWeight: 600,
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
