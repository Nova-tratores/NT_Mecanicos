'use client'
import { useState } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import type { OrdemServico, AgendaItem } from '@/lib/types'
import {
  AlertTriangle, MapPin, ChevronRight, Clock, Navigation,
  Wrench, ClipboardList, FilePlus, Compass, Calendar, X, Loader2,
  Route, User, FileText,
} from 'lucide-react'
import Link from 'next/link'
import { Card, ListRow, Section, PageSpinner, EmptyState, Badge } from '@/components/ui'
import { colors, radius, shadow, text } from '@/lib/ui'

interface CaminhoAvulso {
  id: number
  cliente: string
  cidade_cliente: string
  descricao: string
  status: string
  created_at: string
}

interface HomeData {
  osHoje: OrdemServico[]
  osAtrasadas: OrdemServico[]
  reqPendentes: number
  agendaHoje: AgendaItem[]
  caminhosHoje: CaminhoAvulso[]
  cidadeMap: Record<string, string>
}

async function fetchHomeData(nome: string, tecnicoNome: string): Promise<HomeData> {
  const hoje = new Date().toISOString().split('T')[0]

  const [agendaRes, caminhosRes, osRes, reqRes] = await Promise.all([
    supabase
      .from('agenda_visao')
      .select('id, data, tecnico_nome, id_ordem, cliente, servico, endereco, cidade, qtd_horas, ordem_sequencia, status, observacoes')
      .eq('tecnico_nome', nome)
      .eq('data', hoje)
      .order('ordem_sequencia'),
    supabase
      .from('Diario_Tecnico')
      .select('id, cliente, cidade_cliente, descricao, status, created_at')
      .eq('tecnico_nome', nome)
      .eq('data', hoje)
      .is('id_ordem', null)
      .order('created_at'),
    supabase
      .from('Ordem_Servico')
      .select('*')
      .not('Status', 'in', '("Concluída","Cancelada","Concluida","cancelada")')
      .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
      .order('Previsao_Execucao'),
    supabase
      .from('Requisicao')
      .select('id', { count: 'exact', head: true })
      .or(`solicitante.ilike.%${nome}%,solicitante.eq.${tecnicoNome}`)
      .eq('status', 'pedido')
      .is('recibo_fornecedor', null),
  ])

  const todas = (osRes.data || []) as OrdemServico[]
  const osHoje: OrdemServico[] = []
  const osAtrasadas: OrdemServico[] = []
  for (const os of todas) {
    const prev = os.Previsao_Execucao?.trim?.() || ''
    if (!prev || prev === hoje) { osHoje.push(os); continue }
    // Atrasada = APENAS "Aguardando ordem Técnico" com previsão vencida > 1 dia
    if (prev < hoje && os.Status === 'Aguardando ordem Técnico') {
      const prevDate = new Date(prev + 'T00:00:00')
      const hojeDate = new Date(hoje + 'T00:00:00')
      const diffDias = Math.floor((hojeDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDias > 1) osAtrasadas.push(os)
    }
  }

  const cidadeMap: Record<string, string> = {}
  const cnpjs = [...new Set(todas.map(o => o.Cnpj_Cliente).filter(Boolean))]
  if (cnpjs.length > 0) {
    const { data: cliData } = await supabase
      .from('Clientes')
      .select('cnpj_cpf, cidade')
      .in('cnpj_cpf', cnpjs)
    cliData?.forEach((c: { cnpj_cpf: string; cidade: string | null }) => {
      if (c.cidade) cidadeMap[c.cnpj_cpf] = c.cidade
    })
  }

  return {
    osHoje,
    osAtrasadas,
    reqPendentes: reqRes.count || 0,
    agendaHoje: (agendaRes.data || []) as unknown as AgendaItem[],
    caminhosHoje: (caminhosRes.data || []) as unknown as CaminhoAvulso[],
    cidadeMap,
  }
}

export default function TecnicoHome() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const { data, loading, refreshing, refresh } = useCached<HomeData>(
    `home:${nome}`,
    () => fetchHomeData(nome, user?.tecnico_nome || ''),
    { skip: !user },
  )

  const [showModal, setShowModal] = useState(false)
  const [camCliente, setCamCliente] = useState('')
  const [camCidade, setCamCidade] = useState('')
  const [camDescricao, setCamDescricao] = useState('')
  const [camTempoEstimado, setCamTempoEstimado] = useState('')
  const [camSaving, setCamSaving] = useState(false)

  const horaAtual = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const salvarCaminho = async () => {
    if (!camCliente.trim()) { alert('Informe o cliente.'); return }
    if (!camCidade.trim()) { alert('Informe a cidade.'); return }
    setCamSaving(true)
    const hoje = new Date().toISOString().split('T')[0]
    const hora = horaAtual()

    // 1. Salvar no Diario_Tecnico (com fallback offline)
    const diarioData = {
      tecnico_nome: nome,
      data: hoje,
      id_ordem: null,
      cliente: camCliente.trim(),
      cidade_cliente: camCidade.trim(),
      descricao: camDescricao.trim() || null,
      status: 'em_rota',
      hora_saida_origem: hora,
      tempo_estimado_min: camTempoEstimado ? parseInt(camTempoEstimado) : null,
    }
    const res = await offlineWrite({ table: 'Diario_Tecnico', action: 'insert', data: diarioData })
    if (!res.ok) { setCamSaving(false); alert('Erro ao salvar: ' + (res.error || 'Erro desconhecido')); return }

    // 2. Inserir na agenda_visao para aparecer no painel mecânicos do portal
    await offlineWrite({
      table: 'agenda_visao', action: 'insert',
      data: {
        data: hoje, tecnico_nome: nome, id_ordem: null,
        cliente: camCliente.trim(),
        servico: camDescricao.trim() || 'Visita avulsa',
        cidade: camCidade.trim(), endereco: camCidade.trim(),
        qtd_horas: camTempoEstimado ? Math.ceil(parseInt(camTempoEstimado) / 60) : 1,
        status: 'em_rota',
        observacoes: `Caminho registrado pelo técnico às ${hora}`,
        hora_inicio: hora,
      },
    })

    // 3. Notificar portal (só se online)
    if (navigator.onLine) {
      const usuarios = await getUsuariosPortalPainel()
      if (usuarios.length > 0) {
        await supabase.from('portal_notificacoes').insert(
          usuarios.map((u: { user_id: string }) => ({
            user_id: u.user_id,
            tipo: 'caminho_tecnico',
            titulo: `Novo caminho — ${nome.split(' ')[0]}`,
            descricao: `${nome} saiu para ${camCliente.trim()} em ${camCidade.trim()}`,
            link: '/pos/painel-mecanicos',
          }))
        )
      }
    }

    setCamSaving(false)
    setCamCliente(''); setCamCidade(''); setCamDescricao(''); setCamTempoEstimado('')
    setShowModal(false)
    refresh()
  }

  async function getUsuariosPortalPainel() {
    const { data: permissoes } = await supabase
      .from('portal_permissoes')
      .select('user_id, is_admin, modulos_permitidos')
    if (!permissoes || permissoes.length === 0) return []
    return permissoes.filter(
      (p: { is_admin: boolean; modulos_permitidos: string[] | null }) =>
        p.is_admin || (p.modulos_permitidos && p.modulos_permitidos.includes('painel-mecanicos'))
    )
  }

  if (loading) return <PageSpinner />

  const { osHoje = [], osAtrasadas = [], reqPendentes = 0, agendaHoje = [], caminhosHoje = [], cidadeMap = {} } = data || {}
  const temAlgoHoje = agendaHoje.length > 0 || osHoje.length > 0 || caminhosHoje.length > 0
  const saudacao = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  const dataLabel = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {refreshing && <div className="refresh-bar" />}

      {/* Saudação */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: colors.textSubtle }}>{saudacao()},</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.tecnico_nome?.split(' ')[0] || 'Técnico'}
          </div>
        </div>
        <span style={{
          fontSize: 12, fontWeight: 600, color: colors.textSubtle,
          background: colors.surface, borderRadius: radius.md, padding: '6px 12px',
          border: `1px solid ${colors.border}`, flexShrink: 0,
          textTransform: 'capitalize' as const,
        }}>
          {dataLabel}
        </span>
      </div>

      {/* ═══ PENDÊNCIAS (prioridade visual) ═══ */}
      {(osAtrasadas.length > 0 || reqPendentes > 0) && (
        <Section label="Precisa de atenção" icon={AlertTriangle} color={colors.danger}>
          {osAtrasadas.length > 0 && (
            <ListRow
              href="/os"
              icon={AlertTriangle}
              iconColor={colors.danger}
              iconBg={colors.dangerBg}
              tone="danger"
              title={
                <span style={{ color: colors.danger, fontWeight: 700 }}>
                  {osAtrasadas.length} OS atrasada{osAtrasadas.length > 1 ? 's' : ''}
                </span>
              }
              subtitle="Toque para ver e resolver"
            />
          )}
          {reqPendentes > 0 && (
            <ListRow
              href="/requisicoes"
              icon={ClipboardList}
              iconColor={colors.warning}
              iconBg={colors.warningBg}
              tone="warning"
              title={
                <span style={{ color: colors.warning, fontWeight: 700 }}>
                  {reqPendentes} requisição{reqPendentes > 1 ? 'ões' : ''} para atualizar
                </span>
              }
              subtitle="Adicione valor e comprovante"
            />
          )}
        </Section>
      )}

      {/* ═══ SEU DIA ═══ */}
      <Section label="Seu dia" icon={Calendar}>
        {!temAlgoHoje ? (
          <EmptyState
            icon={Compass}
            title="Nenhum compromisso hoje"
            subtitle="Aproveite para organizar suas ordens"
          />
        ) : (
          <>
            {/* Caminhos avulsos */}
            {caminhosHoje.map((cam) => (
              <ListRow
                key={cam.id}
                icon={Navigation}
                iconColor={cam.status === 'finalizado' ? colors.success : colors.info}
                iconBg={cam.status === 'finalizado' ? colors.successBg : colors.infoBg}
                title={cam.cliente}
                subtitle={cam.cidade_cliente}
                trailing={
                  <Badge
                    bg={cam.status === 'finalizado' ? colors.successBg : colors.infoBg}
                    color={cam.status === 'finalizado' ? colors.success : colors.info}
                  >
                    {cam.status === 'finalizado' ? 'Finalizado' : 'Em rota'}
                  </Badge>
                }
              />
            ))}

            {/* Agenda (mesma tabela do painel mecânicos) */}
            {agendaHoje.map((ag) => {
              const idOrdem = (ag as unknown as { id_ordem?: string | null }).id_ordem
              const servico = (ag as unknown as { servico?: string | null }).servico
              const endereco = (ag as unknown as { endereco?: string | null }).endereco
              const cidade = (ag as unknown as { cidade?: string | null }).cidade
              const qtdHoras = (ag as unknown as { qtd_horas?: number | null }).qtd_horas
              return (
                <ListRow
                  key={ag.id}
                  href={idOrdem ? `/os/${idOrdem}` : '/agenda'}
                  icon={Clock}
                  iconColor={colors.accent}
                  iconBg={colors.accentBg}
                  title={ag.cliente || servico || 'Serviço agendado'}
                  subtitle={servico || undefined}
                  meta={
                    <>
                      {(cidade || endereco) && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <MapPin size={11} /> {cidade || endereco}
                        </span>
                      )}
                      {qtdHoras != null && qtdHoras > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock size={11} /> {qtdHoras}h
                        </span>
                      )}
                    </>
                  }
                />
              )
            })}

            {/* OS de hoje (fallback quando não há agenda) */}
            {agendaHoje.length === 0 && osHoje.map((os) => {
              const cidade = cidadeMap[os.Cnpj_Cliente]
              return (
                <ListRow
                  key={os.Id_Ordem}
                  href={`/os/${os.Id_Ordem}`}
                  icon={Wrench}
                  iconColor={colors.primary}
                  iconBg={colors.primaryBg}
                  badge={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: colors.primary }}>
                        {os.Id_Ordem}
                      </span>
                      <Badge bg={colors.infoBg} color={colors.info}>{os.Status}</Badge>
                    </div>
                  }
                  title={os.Os_Cliente}
                  subtitle={cidade || undefined}
                />
              )
            })}
          </>
        )}
      </Section>

      {/* ═══ AÇÕES RÁPIDAS ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Link href="/requisicoes/nova" style={{
          background: colors.surface, borderRadius: radius.lg, padding: '16px 10px',
          textDecoration: 'none', border: `1px solid ${colors.border}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: colors.primaryBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FilePlus size={18} color={colors.primary} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: colors.text, textAlign: 'center' }}>Requisição</span>
        </Link>

        <Link href="/agenda" style={{
          background: colors.surface, borderRadius: radius.lg, padding: '16px 10px',
          textDecoration: 'none', border: `1px solid ${colors.border}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: colors.accentBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Calendar size={18} color={colors.accent} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: colors.text, textAlign: 'center' }}>Agenda</span>
        </Link>

        <button onClick={() => setShowModal(true)} style={{
          background: colors.surface, borderRadius: radius.lg, padding: '16px 10px',
          border: `1px solid ${colors.border}`, cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: colors.successBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Route size={18} color={colors.success} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: colors.text, textAlign: 'center' }}>Caminho</span>
        </button>
      </div>

      {/* Modal Novo Caminho */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }} onClick={() => setShowModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: '20px 20px 0 0', padding: '20px 20px 32px',
            width: '100%', maxWidth: 480,
            boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            {/* Handle bar */}
            <div style={{ width: 36, height: 4, borderRadius: 2, background: '#D1D5DB', margin: '0 auto 16px' }} />

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: colors.successBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Route size={18} color={colors.success} />
                </div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, color: colors.text, margin: 0 }}>Novo Caminho</h2>
                  <div style={{ fontSize: 12, color: colors.textMuted }}>{new Date().toLocaleDateString('pt-BR')} - {horaAtual()}</div>
                </div>
              </div>
              <button onClick={() => setShowModal(false)} style={{ background: colors.surface, border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8 }}>
                <X size={18} color={colors.textMuted} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Cliente */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <User size={12} /> Cliente
                </label>
                <input value={camCliente} onChange={e => setCamCliente(e.target.value)} placeholder="Nome do cliente ou empresa"
                  style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#FAFAFA' }} />
              </div>

              {/* Cidade */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <MapPin size={12} /> Destino (Cidade)
                </label>
                <input value={camCidade} onChange={e => setCamCidade(e.target.value)} placeholder="Ex: Piraju, Avaré..."
                  style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#FAFAFA' }} />
              </div>

              {/* Tempo estimado */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <Clock size={12} /> Tempo estimado de serviço (minutos)
                </label>
                <input type="number" value={camTempoEstimado} onChange={e => setCamTempoEstimado(e.target.value)} placeholder="Ex: 120"
                  style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#FAFAFA' }} />
              </div>

              {/* Descrição */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <FileText size={12} /> Descrição do serviço
                </label>
                <textarea value={camDescricao} onChange={e => setCamDescricao(e.target.value)} placeholder="Descreva brevemente o motivo da visita..."
                  rows={3} style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', background: '#FAFAFA', lineHeight: 1.5 }} />
              </div>

              {/* Botão */}
              <button onClick={salvarCaminho} disabled={camSaving || !camCliente.trim() || !camCidade.trim()} style={{
                width: '100%', padding: '13px 0', borderRadius: 12, marginTop: 4,
                background: (!camCliente.trim() || !camCidade.trim()) ? '#E5E7EB' : colors.accent,
                color: (!camCliente.trim() || !camCidade.trim()) ? '#9CA3AF' : '#fff',
                fontSize: 15, fontWeight: 700, border: 'none',
                cursor: camSaving ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: camSaving ? 0.7 : 1,
              }}>
                {camSaving ? <Loader2 size={18} className="spinner" /> : <Navigation size={18} />}
                {camSaving ? 'Registrando...' : 'Iniciar Caminho'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ height: 80 }} />
    </div>
  )
}
