'use client'
import { useState } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import type { OrdemServico } from '@/lib/types'
import {
  Wrench, ClipboardList, User, Megaphone, Camera,
  Calendar, Route, Navigation, MapPin, Clock, FileText,
  X, Loader2, ChevronRight, ChevronDown, AlertTriangle,
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
  avisos: AvisoGeral[]
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
  const FASES_CONCLUIDAS = ['Relatorio Concluido', 'Relatório Concluído', 'Executada aguardando comercial']
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

  return {
    osPendentes,
    osAbertas,
    osEnviadas: enviadaSet.size,
    osAtrasadas,
    reqPendentes: reqPendRes.count || 0,
    reqEnviadas: reqEnvRes.count || 0,
    fotosCount,
    avisos: (avisosRes.data || []) as AvisoGeral[],
  }
}

export default function TecnicoHome() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const { data, loading, refreshing } = useCached<DashboardData>(
    `dashboard:${nome}`,
    () => fetchDashboardData(nome, user?.tecnico_nome || ''),
    { skip: !user },
  )

  const [openCards, setOpenCards] = useState<Set<string>>(new Set())
  const toggleCard = (key: string) => setOpenCards(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  // Modal novo caminho
  const [showModal, setShowModal] = useState(false)
  const [camCliente, setCamCliente] = useState('')
  const [camCidade, setCamCidade] = useState('')
  const [camDescricao, setCamDescricao] = useState('')
  const [camTempoEstimado, setCamTempoEstimado] = useState('')
  const [camSaving, setCamSaving] = useState(false)

  const horaAtual = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const salvarCaminho = async () => {
    if (!camCliente.trim()) return
    if (!camCidade.trim()) return
    setCamSaving(true)
    const hoje = new Date().toISOString().split('T')[0]
    const hora = horaAtual()
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
    await offlineWrite({
      table: 'agenda_visao', action: 'insert',
      data: {
        data: hoje, tecnico_nome: nome, id_ordem: null,
        cliente: camCliente.trim(),
        servico: camDescricao.trim() || 'Visita avulsa',
        cidade: camCidade.trim(), endereco: camCidade.trim(),
        qtd_horas: camTempoEstimado ? Math.ceil(parseInt(camTempoEstimado) / 60) : 1,
        status: 'em_rota',
        observacoes: `Caminho registrado pelo tecnico as ${hora}`,
        hora_inicio: hora,
      },
    })
    if (navigator.onLine) {
      const { data: permissoes } = await supabase
        .from('portal_permissoes')
        .select('user_id, is_admin, modulos_permitidos')
      const usuarios = (permissoes || []).filter(
        (p: { is_admin: boolean; modulos_permitidos: string[] | null }) =>
          p.is_admin || (p.modulos_permitidos && p.modulos_permitidos.includes('painel-mecanicos'))
      )
      if (usuarios.length > 0) {
        await supabase.from('portal_notificacoes').insert(
          usuarios.map((u: { user_id: string }) => ({
            user_id: u.user_id,
            tipo: 'caminho_tecnico',
            titulo: `Novo caminho - ${nome.split(' ')[0]}`,
            descricao: `${nome} saiu para ${camCliente.trim()} em ${camCidade.trim()}`,
            link: '/pos/painel-mecanicos',
          }))
        )
      }
    }
    setCamSaving(false)
    setCamCliente(''); setCamCidade(''); setCamDescricao(''); setCamTempoEstimado('')
    setShowModal(false)
  }

  if (loading) return <PageSpinner />

  const {
    osPendentes = 0, osAbertas = 0, osEnviadas = 0, osAtrasadas = 0,
    reqPendentes = 0, reqEnviadas = 0, fotosCount = 0, avisos = [],
  } = data || {}

  const saudacao = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  const dataLabel = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {refreshing && <div className="refresh-bar" />}

      {/* Saudacao */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: colors.textSubtle }}>{saudacao()},</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.tecnico_nome?.split(' ')[0] || 'Tecnico'}
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

      {/* ═══ CARD: ORDENS DE SERVICO ═══ */}
      <div style={{
        background: colors.surface, borderRadius: 20,
        border: `1px solid ${colors.border}`, boxShadow: shadow.sm, overflow: 'hidden',
      }}>
        <button onClick={() => toggleCard('os')} style={{
          width: '100%', padding: '20px 20px', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16,
              background: colors.primaryBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Wrench size={26} color={colors.primary} />
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: colors.text }}>Ordens de Servico</div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                {osPendentes + osAtrasadas} pendente{osPendentes + osAtrasadas !== 1 ? 's' : ''} · {osAbertas} aberta{osAbertas !== 1 ? 's' : ''} · {osEnviadas} enviada{osEnviadas !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {osAtrasadas > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 8,
                background: colors.dangerBg, color: colors.danger, border: `1px solid ${colors.dangerBorder}`,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <AlertTriangle size={11} /> {osAtrasadas}
              </span>
            )}
            <ChevronDown size={20} color={colors.textSubtle} style={{
              transition: 'transform 0.2s', transform: openCards.has('os') ? 'rotate(180deg)' : 'rotate(0deg)',
            }} />
          </div>
        </button>

        {openCards.has('os') && (
          <div style={{ padding: '0 20px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div style={{
                background: osAtrasadas > 0 ? colors.dangerBg : colors.warningBg,
                borderRadius: 14, padding: '14px 10px', textAlign: 'center',
                border: `1px solid ${osAtrasadas > 0 ? colors.dangerBorder : colors.warningBorder}`,
              }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: osAtrasadas > 0 ? colors.danger : colors.warning }}>
                  {osPendentes + osAtrasadas}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: osAtrasadas > 0 ? colors.danger : colors.warning }}>
                  Pendentes
                </div>
                {osAtrasadas > 0 && (
                  <div style={{
                    fontSize: 9, fontWeight: 700, color: colors.danger,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, marginTop: 4,
                  }}>
                    <AlertTriangle size={9} /> {osAtrasadas} atrasada{osAtrasadas > 1 ? 's' : ''}
                  </div>
                )}
              </div>
              <div style={{
                background: colors.infoBg, borderRadius: 14, padding: '14px 10px', textAlign: 'center',
                border: `1px solid ${colors.infoBorder}`,
              }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: colors.info }}>{osAbertas}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.info }}>Abertas</div>
              </div>
              <div style={{
                background: colors.successBg, borderRadius: 14, padding: '14px 10px', textAlign: 'center',
                border: `1px solid ${colors.successBorder}`,
              }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: colors.success }}>{osEnviadas}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.success }}>Enviadas</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <Link href="/os" style={{
                flex: 1, textDecoration: 'none', background: colors.primary, color: '#fff',
                borderRadius: 12, padding: '13px 14px', textAlign: 'center',
                fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <Wrench size={16} /> Ver Ordens
              </Link>
              <Link href="/fotos" style={{
                flex: 1, textDecoration: 'none', background: colors.surfaceAlt,
                borderRadius: 12, padding: '13px 14px', textAlign: 'center',
                fontSize: 14, fontWeight: 700, color: colors.text,
                border: `1px solid ${colors.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <Camera size={16} color={colors.accent} /> Fotos
                {fotosCount > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: colors.accent,
                    background: colors.accentBg, padding: '2px 8px', borderRadius: 8,
                  }}>
                    {fotosCount}
                  </span>
                )}
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* ═══ CARD: REQUISICOES ═══ */}
      <div style={{
        background: colors.surface, borderRadius: 20,
        border: `1px solid ${colors.border}`, boxShadow: shadow.sm, overflow: 'hidden',
      }}>
        <button onClick={() => toggleCard('req')} style={{
          width: '100%', padding: '20px 20px', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16,
              background: colors.accentBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              position: 'relative',
            }}>
              <ClipboardList size={26} color={colors.accent} />
              {reqPendentes > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  background: colors.danger, color: '#fff', fontSize: 10,
                  fontWeight: 700, borderRadius: 10, minWidth: 20, height: 20,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                }}>
                  {reqPendentes}
                </span>
              )}
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: colors.text }}>Requisicoes</div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                {reqEnviadas > 0 ? `${reqEnviadas} em aberto` : 'Solicitar pecas'}
              </div>
            </div>
          </div>
          <ChevronDown size={20} color={colors.textSubtle} style={{
            transition: 'transform 0.2s', transform: openCards.has('req') ? 'rotate(180deg)' : 'rotate(0deg)',
          }} />
        </button>

        {openCards.has('req') && (
          <div style={{ padding: '0 20px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div style={{
                background: reqPendentes > 0 ? colors.warningBg : colors.surfaceAlt,
                borderRadius: 14, padding: '14px 10px', textAlign: 'center',
                border: `1px solid ${reqPendentes > 0 ? colors.warningBorder : colors.border}`,
              }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: reqPendentes > 0 ? colors.warning : colors.textSubtle }}>
                  {reqPendentes}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: reqPendentes > 0 ? colors.warning : colors.textSubtle }}>
                  Aguardando recibo
                </div>
              </div>
              <div style={{
                background: colors.infoBg, borderRadius: 14, padding: '14px 10px', textAlign: 'center',
                border: `1px solid ${colors.infoBorder}`,
              }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: colors.info }}>{reqEnviadas}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.info }}>Em aberto</div>
              </div>
            </div>

            <Link href="/requisicoes" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              textDecoration: 'none', background: colors.accent, color: '#fff',
              borderRadius: 12, padding: '13px 14px',
              fontSize: 14, fontWeight: 700,
            }}>
              <ClipboardList size={16} /> Ver Requisicoes
            </Link>
          </div>
        )}
      </div>

      {/* ═══ CARD: AVISOS ═══ */}
      <div style={{
        background: colors.surface, borderRadius: 20,
        border: `1px solid ${colors.border}`, boxShadow: shadow.sm, overflow: 'hidden',
      }}>
        <button onClick={() => toggleCard('avisos')} style={{
          width: '100%', padding: '20px 20px', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16,
              background: colors.warningBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Megaphone size={26} color={colors.warning} />
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: colors.text }}>Avisos</div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                {avisos.length > 0 ? `${avisos.length} aviso${avisos.length > 1 ? 's' : ''} ativo${avisos.length > 1 ? 's' : ''}` : 'Nenhum aviso'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {avisos.some(a => a.prioridade === 'urgente') && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                background: colors.danger, color: '#fff',
              }}>URGENTE</span>
            )}
            <ChevronDown size={20} color={colors.textSubtle} style={{
              transition: 'transform 0.2s', transform: openCards.has('avisos') ? 'rotate(180deg)' : 'rotate(0deg)',
            }} />
          </div>
        </button>

        {openCards.has('avisos') && (
          <div style={{ padding: '0 20px 20px' }}>
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
                      {av.mensagem.length > 120 ? av.mensagem.slice(0, 120) + '...' : av.mensagem}
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
          </div>
        )}
      </div>

      {/* ═══ GRID: ACOES RAPIDAS ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Link href="/os" style={{
          background: colors.surface, borderRadius: 20, padding: '20px 16px',
          textDecoration: 'none', border: `1px solid ${colors.border}`, boxShadow: shadow.sm,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
            background: colors.primaryBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Camera size={22} color={colors.primary} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>Fotos</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>Enviar fotos</div>
          </div>
        </Link>

        <Link href="/perfil" style={{
          background: colors.surface, borderRadius: 20, padding: '20px 16px',
          textDecoration: 'none', border: `1px solid ${colors.border}`, boxShadow: shadow.sm,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, overflow: 'hidden', flexShrink: 0,
            background: user?.avatar_url ? 'transparent' : colors.primaryBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <User size={22} color={colors.primary} />
            )}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>Perfil</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>{user?.tecnico_nome?.split(' ')[0] || 'Meus dados'}</div>
          </div>
        </Link>

        <Link href="/agenda" style={{
          background: colors.surface, borderRadius: 20, padding: '20px 16px',
          textDecoration: 'none', border: `1px solid ${colors.border}`, boxShadow: shadow.sm,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
            background: colors.accentBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Calendar size={22} color={colors.accent} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>Agenda</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>Programacao</div>
          </div>
        </Link>

        <Link href="/diario" style={{
          background: colors.surface, borderRadius: 20, padding: '20px 16px',
          textDecoration: 'none', border: `1px solid ${colors.border}`, boxShadow: shadow.sm,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
            background: colors.infoBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Navigation size={22} color={colors.info} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>Diario</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>Registros</div>
          </div>
        </Link>
      </div>

      {/* ═══ BOTAO: NOVO CAMINHO ═══ */}
      <button onClick={() => setShowModal(true)} style={{
        width: '100%', background: colors.success, color: '#fff',
        borderRadius: 20, padding: '18px 20px', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        fontSize: 16, fontWeight: 700, boxShadow: shadow.sm,
      }}>
        <Route size={20} /> Novo Caminho
      </button>

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
            <div style={{ width: 36, height: 4, borderRadius: 2, background: '#D1D5DB', margin: '0 auto 16px' }} />
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
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <User size={12} /> Cliente
                </label>
                <input value={camCliente} onChange={e => setCamCliente(e.target.value)} placeholder="Nome do cliente ou empresa"
                  style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#FAFAFA' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <MapPin size={12} /> Destino (Cidade)
                </label>
                <input value={camCidade} onChange={e => setCamCidade(e.target.value)} placeholder="Ex: Piraju, Avare..."
                  style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#FAFAFA' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <Clock size={12} /> Tempo estimado (minutos)
                </label>
                <input type="number" value={camTempoEstimado} onChange={e => setCamTempoEstimado(e.target.value)} placeholder="Ex: 120"
                  style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#FAFAFA' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <FileText size={12} /> Descricao do servico
                </label>
                <textarea value={camDescricao} onChange={e => setCamDescricao(e.target.value)} placeholder="Descreva brevemente o motivo da visita..."
                  rows={3} style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${colors.border}`, fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', background: '#FAFAFA', lineHeight: 1.5 }} />
              </div>
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
    </div>
  )
}
