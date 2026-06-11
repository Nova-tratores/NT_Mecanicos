'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAdmin } from '@/hooks/useAdmin'
import { colors, shadow } from '@/lib/ui'
import {
  Users, ArrowLeft, Wrench, AlertTriangle, CheckCircle, XCircle, Plus, X,
  ChevronDown, ChevronRight, Package, FileText, ShoppingCart, AlertOctagon,
  Calendar, BarChart3,
} from 'lucide-react'

interface Mecanico {
  id: string; nome: string; email: string; funcao: string; avatar_url: string | null
  mecanico_role: string; tecnico_nome: string
  stats: { total: number; horas: number; km: number; valor: number }
  ocorrencias_pendentes: number; alertas_pendentes: number
}
interface Ordem {
  os_num: string; cod_int: string; data: string; horas: string; km: string; valor: string
  status: string; faturada: boolean; interno: boolean; cidade: string; cliente: string; cidade_cliente: string
  relatorio_tecnico: string; diagnostico_tecnico: string; servico_solicitado: string
  relatorio_status: string; relatorio_data_envio: string
  ppvs: { id: string; pedido_omie: string; status: string; produtos: { codigo: string; descricao: string; qtd: number; preco: number; devolvido: number }[] }[]
}
interface Ocorrencia { id: number; tecnico_nome: string; tipo: string; descricao: string; pontos: number; data_referencia: string; admin_nome: string | null; created_at: string }
interface Requisicao { id_pedido: string; Id_Os: string; status: string; data: string; pedido_omie: string; valor_total: number; Tipo_Pedido: string }
interface Alerta {
  id: number; tecnico_nome: string; tipo: string; severidade: string; data_referencia: string; descricao: string; detalhes: string
  id_ordem: string; status: string; admin_nome: string; admin_comentario: string; resolvido_em: string; created_at: string; carryover?: boolean
  ordem?: { os_num: string; data: string; status: string; faturada: boolean; cliente: string; cidade_cliente: string; horas: string; km: string; valor: string; relatorio_tecnico: string; diagnostico_tecnico: string; servico_solicitado: string; ppvs: any[] } | null
}
interface MecDetalhe extends Mecanico {
  mes: string; ordens: Ordem[]; ocorrencias: Ocorrencia[]; requisicoes: Requisicao[]; alertas: Alerta[]
  gps: { kmMes: number; dias: number; dirigindoMin: number; paradoForaMin: number }
}

const TIPO_CORES: Record<string, { bg: string; text: string; label: string }> = {
  atraso: { bg: '#FEF3C7', text: '#92400E', label: 'Atraso' },
  falta: { bg: '#FEE2E2', text: '#991B1B', label: 'Falta' },
  advertencia: { bg: '#FFE4E6', text: '#BE123C', label: 'Advertencia' },
  elogio: { bg: '#D1FAE5', text: '#065F46', label: 'Elogio' },
  observacao: { bg: '#E0E7FF', text: '#3730A3', label: 'Observacao' },
  geral: { bg: '#F1F5F9', text: '#475569', label: 'Geral' },
}

const fmtBRL = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

export default function TecnicosPage() {
  const { admin } = useAdmin()
  const [mecanicos, setMecanicos] = useState<Mecanico[]>([])
  const [detalhe, setDetalhe] = useState<MecDetalhe | null>(null)
  const [loading, setLoading] = useState(true)
  const [secao, setSecao] = useState<'servicos' | 'requisicoes' | 'alertas' | 'ocorrencias'>('servicos')
  const [expandedOs, setExpandedOs] = useState<Set<string>>(new Set())
  const [expandedAlerta, setExpandedAlerta] = useState<number | null>(null)

  // Nova ocorrencia
  const [showNovaOc, setShowNovaOc] = useState(false)
  const [novaOc, setNovaOc] = useState({ tipo: 'geral', titulo: '', descricao: '' })
  const [salvando, setSalvando] = useState(false)

  // Meses anteriores
  const [mesesAnteriores, setMesesAnteriores] = useState<Record<string, MecDetalhe | 'loading'>>({})
  const [mesExpandido, setMesExpandido] = useState<string | null>(null)

  const getMesAtual = () => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }
  const mesLabel = (mes: string) => {
    const [y, m] = mes.split('-').map(Number)
    return new Date(y, m - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  }
  const getMesesAnteriores = () => {
    const meses: string[] = []
    const now = new Date()
    for (let i = 1; i <= 5; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return meses
  }

  const carregarLista = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/mecanicos')
      if (!res.ok) throw new Error('Erro')
      const data = await res.json()
      setMecanicos(data?.mecanicos ? data.mecanicos : Array.isArray(data) ? data : [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  const carregarDetalhe = useCallback(async (nome: string) => {
    setLoading(true)
    setMesesAnteriores({})
    setMesExpandido(null)
    try {
      const res = await fetch(`/api/mecanicos?nome=${encodeURIComponent(nome)}`)
      if (!res.ok) throw new Error('Erro')
      const data = await res.json()
      setDetalhe(data)
      setSecao('servicos')
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  const carregarMesAnterior = async (nome: string, mes: string) => {
    if (mesesAnteriores[mes] && mesesAnteriores[mes] !== 'loading') {
      setMesExpandido(mesExpandido === mes ? null : mes)
      return
    }
    setMesExpandido(mes)
    setMesesAnteriores(prev => ({ ...prev, [mes]: 'loading' }))
    try {
      const res = await fetch(`/api/mecanicos?nome=${encodeURIComponent(nome)}&mes=${mes}`)
      if (res.ok) {
        const data = await res.json()
        setMesesAnteriores(prev => ({ ...prev, [mes]: data }))
      }
    } catch {
      setMesesAnteriores(prev => { const n = { ...prev }; delete n[mes]; return n })
      setMesExpandido(null)
    }
  }

  useEffect(() => { carregarLista() }, [carregarLista])

  useEffect(() => {
    const ch = supabase.channel('mecanicos-admin-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mecanico_alertas' }, () => { if (detalhe) carregarDetalhe(detalhe.tecnico_nome); else carregarLista() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mecanico_ocorrencias' }, () => { if (detalhe) carregarDetalhe(detalhe.tecnico_nome); else carregarLista() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [detalhe, carregarDetalhe, carregarLista])

  const criarOcorrencia = async () => {
    if (!detalhe || !novaOc.titulo.trim() || !admin) return
    setSalvando(true)
    await fetch('/api/mecanicos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'criar_ocorrencia', tecnico_nome: detalhe.tecnico_nome, tipo: novaOc.tipo, titulo: novaOc.titulo, descricao: novaOc.descricao, criado_por: admin.tecnico_nome || 'admin' }) })
    setNovaOc({ tipo: 'geral', titulo: '', descricao: '' })
    setShowNovaOc(false)
    setSalvando(false)
    carregarDetalhe(detalhe.tecnico_nome)
  }

  const justificarAlerta = async (id: number) => {
    const motivo = prompt('Motivo da justificativa:')
    if (motivo === null) return
    await fetch('/api/mecanicos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'justificar_alerta', id, admin_comentario: motivo, admin_nome: admin?.tecnico_nome || 'admin' }) })
    if (detalhe) carregarDetalhe(detalhe.tecnico_nome)
  }
  const alertaParaOcorrencia = async (id: number) => {
    await fetch('/api/mecanicos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'alerta_para_ocorrencia', id, admin_nome: admin?.tecnico_nome || 'admin' }) })
    if (detalhe) carregarDetalhe(detalhe.tecnico_nome)
  }
  const atualizarOcorrencia = async (id: number, status: string) => {
    await fetch('/api/mecanicos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'atualizar_ocorrencia', id, status }) })
    if (detalhe) carregarDetalhe(detalhe.tecnico_nome)
  }

  const toggleOs = (osNum: string) => setExpandedOs(prev => { const n = new Set(prev); n.has(osNum) ? n.delete(osNum) : n.add(osNum); return n })

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  // ━━ DETALHE ━━
  if (detalhe) {
    const ocPendentes = detalhe.ocorrencias.filter(o => o.pontos === 0 || o.pontos === 1).length
    const secoes = [
      { id: 'servicos' as const, icon: <Wrench size={14} />, label: 'Serviços', count: detalhe.ordens.length, color: '#2563EB', badge: 0 },
      { id: 'requisicoes' as const, icon: <ShoppingCart size={14} />, label: 'Req.', count: detalhe.requisicoes.length, color: '#7C3AED', badge: 0 },
      { id: 'alertas' as const, icon: <AlertOctagon size={14} />, label: 'Alertas', count: detalhe.alertas.length, color: '#DC2626', badge: detalhe.alertas.filter(a => a.status === 'pendente').length },
      { id: 'ocorrencias' as const, icon: <AlertTriangle size={14} />, label: 'Ocorr.', count: detalhe.ocorrencias.length, color: '#B45309', badge: ocPendentes },
    ]

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => { setDetalhe(null); carregarLista() }} style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${colors.borderStrong}`, background: colors.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ArrowLeft size={16} color={colors.textMuted} />
          </button>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
            {detalhe.avatar_url ? <img src={detalhe.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Users size={20} color="#fff" />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detalhe.nome}</div>
            <div style={{ fontSize: 11, color: colors.textSubtle }}>{detalhe.tecnico_nome} · {detalhe.gps.kmMes} km · {detalhe.gps.dirigindoMin >= 60 ? `${Math.floor(detalhe.gps.dirigindoMin / 60)}h dirigindo` : `${detalhe.gps.dirigindoMin || 0}min`}</div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          <MiniCard label="OS" value={detalhe.ordens.length} bg="#EFF6FF" color="#2563EB" />
          <MiniCard label="Req" value={detalhe.requisicoes.length} bg="#F5F3FF" color="#7C3AED" />
          <MiniCard label="Alertas" value={detalhe.alertas.length} bg="#FEF2F2" color="#DC2626" />
          <MiniCard label="Ocorr." value={detalhe.ocorrencias.length} bg="#FFFBEB" color="#D97706" />
        </div>

        {/* GPS info */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, fontWeight: 600 }}>
          <span style={{ color: '#2563EB' }}>{detalhe.gps.kmMes} km</span>
          <span style={{ color: '#059669' }}>{detalhe.gps.dirigindoMin >= 60 ? `${Math.floor(detalhe.gps.dirigindoMin / 60)}h${detalhe.gps.dirigindoMin % 60 > 0 ? String(detalhe.gps.dirigindoMin % 60).padStart(2, '0') + 'min' : ''} dirigindo` : `${detalhe.gps.dirigindoMin || 0}min dirigindo`}</span>
          <span style={{ color: '#D97706' }}>{detalhe.gps.paradoForaMin >= 60 ? `${Math.floor(detalhe.gps.paradoForaMin / 60)}h parado fora` : `${detalhe.gps.paradoForaMin || 0}min parado fora`}</span>
          <span style={{ color: '#9CA3AF' }}>{detalhe.gps.dias} dias GPS</span>
          <span style={{ color: '#6366F1', marginLeft: 'auto', textTransform: 'capitalize' }}>{mesLabel(detalhe.mes || getMesAtual())}</span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${colors.border}`, overflowX: 'auto' }}>
          {secoes.map(s => {
            const active = secao === s.id
            return (
              <button key={s.id} onClick={() => setSecao(s.id)} style={{
                padding: '10px 12px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                borderBottom: active ? `2px solid ${s.color}` : '2px solid transparent', color: active ? s.color : colors.textMuted, fontWeight: active ? 700 : 500, fontSize: 12,
              }}>
                {s.icon} {s.label}
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8, background: active ? `${s.color}15` : colors.surfaceAlt, color: active ? s.color : '#9CA3AF' }}>{s.count}</span>
                {(s.badge || 0) > 0 && <span style={{ minWidth: 15, height: 15, borderRadius: 8, background: '#EF4444', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{s.badge}</span>}
              </button>
            )
          })}
        </div>

        {/* ── SERVIÇOS ── */}
        {secao === 'servicos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detalhe.ordens.length === 0 ? <EmptyState text="Nenhuma OS no mês" /> :
              detalhe.ordens.map(o => {
                const isOpen = expandedOs.has(o.os_num)
                const temPecas = o.ppvs.some(p => p.produtos.length > 0)
                const temRelTec = !!o.relatorio_tecnico?.trim()
                const temDiag = !!o.diagnostico_tecnico?.trim()
                const relEnviado = o.relatorio_status === 'enviado'
                const semRelatorio = !temRelTec && o.relatorio_status !== 'rascunho'
                return (
                  <div key={o.os_num} style={{ background: semRelatorio ? '#FFFBEB' : colors.surface, border: `1px solid ${isOpen ? '#BFDBFE' : semRelatorio ? '#FDE68A' : colors.border}`, borderRadius: 12, overflow: 'hidden' }}>
                    <div onClick={() => toggleOs(o.os_num)} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', cursor: 'pointer', gap: 6, flexWrap: 'wrap' }}>
                      <ChevronDown size={12} color="#9CA3AF" style={{ transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform .15s', flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, color: '#2563EB', fontSize: 13 }}>OS {o.os_num}</span>
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>{o.data ? o.data.split('-').reverse().join('/') : '-'}</span>
                      {o.cliente && <span style={{ fontSize: 11, color: colors.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{o.cliente}</span>}
                      {o.interno && <Badge bg="#EFF6FF" color="#2563EB">INT</Badge>}
                      {relEnviado && <Badge bg="#ECFDF5" color="#059669">Rel. OK</Badge>}
                      {semRelatorio && <Badge bg="#FEF2F2" color="#DC2626">Sem rel.</Badge>}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 11, fontWeight: 600 }}>
                        <span style={{ color: '#059669' }}>{(parseFloat(o.horas) || 0).toFixed(1)}h</span>
                        <span style={{ color: '#D97706' }}>{(parseFloat(o.km) || 0).toFixed(0)}km</span>
                      </div>
                      {temPecas && <Package size={12} color="#EA580C" />}
                    </div>
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${colors.border}`, padding: 12, fontSize: 12 }}>
                        {o.cliente && <div style={{ marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <div><Lbl>CLIENTE</Lbl> <span style={{ color: colors.text, fontWeight: 500 }}>{o.cliente}</span></div>
                          {o.cidade_cliente && <div><Lbl>CIDADE</Lbl> <span style={{ color: colors.textMuted }}>{o.cidade_cliente}</span></div>}
                          <div><Lbl>VALOR</Lbl> <span style={{ color: '#7C3AED', fontWeight: 600 }}>{fmtBRL(parseFloat(o.valor) || 0)}</span></div>
                        </div>}
                        {o.servico_solicitado?.trim() && <TextBlock label="Serviço Solicitado" text={o.servico_solicitado} />}
                        {temDiag && <TextBlock label="Diagnóstico" text={o.diagnostico_tecnico} bg="#FFFBEB" border="#FDE68A" />}
                        {temRelTec && <TextBlock label="Relatório Técnico" text={o.relatorio_tecnico} bg="#F0FDF4" border="#BBF7D0" />}
                        {temPecas && o.ppvs.filter(p => p.produtos.length > 0).map(ppv => (
                          <div key={ppv.id} style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                              <Package size={10} /> {ppv.id} {ppv.pedido_omie && <span style={{ color: '#2563EB' }}>| Omie: {ppv.pedido_omie}</span>}
                              <Badge bg={ppv.status === 'Concluída' ? '#ECFDF5' : '#FFFBEB'} color={ppv.status === 'Concluída' ? '#059669' : '#D97706'}>{ppv.status}</Badge>
                            </div>
                            {ppv.produtos.map((prod, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', background: colors.surfaceAlt, borderRadius: 5, fontSize: 11, marginBottom: 2 }}>
                                <span style={{ fontFamily: 'monospace', color: '#6B7280', minWidth: 55 }}>{prod.codigo}</span>
                                <span style={{ flex: 1, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prod.descricao}</span>
                                <span style={{ fontWeight: 600 }}>{prod.qtd - prod.devolvido}x</span>
                                <span style={{ color: '#6B7280' }}>R$ {prod.preco.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )}

        {/* ── REQUISIÇÕES ── */}
        {secao === 'requisicoes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detalhe.requisicoes.length === 0 ? <EmptyState text="Nenhuma requisição" /> :
              detalhe.requisicoes.map(r => (
                <div key={r.id_pedido} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: '#7C3AED', fontSize: 12 }}>{r.id_pedido}</span>
                  {r.Id_Os && <span style={{ fontSize: 11, color: '#2563EB' }}>{r.Id_Os}</span>}
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>{r.data || '-'}</span>
                  <Badge bg={r.status.includes('Cancelad') ? '#FEF2F2' : r.status.includes('Conclu') ? '#ECFDF5' : '#FFFBEB'} color={r.status.includes('Cancelad') ? '#991B1B' : r.status.includes('Conclu') ? '#059669' : '#D97706'}>{r.status}</Badge>
                  <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 12 }}>{fmtBRL(r.valor_total || 0)}</span>
                </div>
              ))}
          </div>
        )}

        {/* ── ALERTAS ── */}
        {secao === 'alertas' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detalhe.alertas.length === 0 ? <EmptyState text="Nenhum alerta no mês" /> :
              detalhe.alertas.map(a => {
                const isPendente = a.status === 'pendente'
                const isExpanded = expandedAlerta === a.id
                const isAtraso = a.tipo === 'atraso_relatorio'
                const isDiv = a.tipo === 'divergencia_km'
                const tipoBg = isAtraso ? '#FEF2F2' : isDiv ? '#FEF2F2' : '#FFFBEB'
                const tipoColor = isAtraso ? '#DC2626' : isDiv ? '#DC2626' : '#D97706'
                const tipoLabel = isAtraso ? 'Sem Relatório' : isDiv ? 'Div. KM' : 'Atraso Entrega'
                const statusBg = a.status === 'justificada' ? '#ECFDF5' : a.status === 'ocorrencia' ? '#EFF6FF' : '#FFFBEB'
                const statusColor = a.status === 'justificada' ? '#059669' : a.status === 'ocorrencia' ? '#2563EB' : '#D97706'
                const ord = a.ordem

                return (
                  <div key={a.id} style={{ background: colors.surface, border: `1px solid ${isPendente ? '#FECACA' : colors.border}`, borderRadius: 10, overflow: 'hidden', opacity: isPendente ? 1 : 0.65 }}>
                    <div onClick={() => setExpandedAlerta(isExpanded ? null : a.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', cursor: 'pointer', flexWrap: 'wrap' }}>
                      <ChevronDown size={12} color="#9CA3AF" style={{ transform: isExpanded ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform .15s', flexShrink: 0 }} />
                      <Badge bg={tipoBg} color={tipoColor}>{tipoLabel}</Badge>
                      <Badge bg={statusBg} color={statusColor}>{a.status}</Badge>
                      {a.carryover && <Badge bg="#7C3AED" color="#fff">MÊS ANT.</Badge>}
                      {ord && <span style={{ fontSize: 11, color: '#2563EB', fontWeight: 600 }}>OS {ord.os_num}</span>}
                      <span style={{ fontSize: 11, color: '#9CA3AF', flex: 1, textAlign: 'right' }}>{a.data_referencia ? a.data_referencia.split('-').reverse().join('/') : ''}</span>
                    </div>
                    {isExpanded && (
                      <div style={{ borderTop: `1px solid ${colors.border}`, padding: 12 }}>
                        <div style={{ padding: '8px 10px', borderRadius: 8, background: isDiv ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${isDiv ? '#FECACA' : '#FDE68A'}`, marginBottom: 10, fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: colors.text, marginBottom: 2 }}>{a.descricao}</div>
                          {a.detalhes && <div style={{ color: '#6B7280', fontSize: 11 }}>{a.detalhes}</div>}
                        </div>
                        {ord && (
                          <div style={{ marginBottom: 10, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 11 }}>
                              <Wrench size={11} color="#2563EB" /> <span style={{ fontWeight: 700, color: '#2563EB' }}>OS {ord.os_num}</span>
                              <span style={{ color: '#9CA3AF' }}>{ord.data ? ord.data.split('-').reverse().join('/') : '-'}</span>
                              <Badge bg={ord.faturada ? '#ECFDF5' : '#FFFBEB'} color={ord.faturada ? '#059669' : '#D97706'}>{ord.faturada ? 'Faturada' : ord.status}</Badge>
                            </div>
                            {ord.cliente && <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{ord.cliente} {ord.cidade_cliente && <span style={{ color: '#9CA3AF' }}>({ord.cidade_cliente})</span>}</div>}
                            <div style={{ display: 'flex', gap: 12, fontSize: 11, fontWeight: 600 }}>
                              <span style={{ color: '#059669' }}>{(parseFloat(ord.horas) || 0).toFixed(1)}h</span>
                              <span style={{ color: '#D97706' }}>{(parseFloat(ord.km) || 0).toFixed(0)} km</span>
                              <span style={{ color: '#7C3AED' }}>{fmtBRL(parseFloat(ord.valor) || 0)}</span>
                            </div>
                          </div>
                        )}
                        {a.admin_comentario && (
                          <div style={{ padding: '6px 10px', borderRadius: 6, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 12, marginBottom: 10 }}>
                            <strong>{a.admin_nome || 'Admin'}:</strong> {a.admin_comentario}
                            {a.resolvido_em && <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Resolvido em {new Date(a.resolvido_em).toLocaleString('pt-BR')}</div>}
                          </div>
                        )}
                        {isPendente && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <BtnOutline color="#059669" onClick={() => justificarAlerta(a.id)}><CheckCircle size={11} /> Justificar</BtnOutline>
                            <BtnOutline color="#DC2626" onClick={() => alertaParaOcorrencia(a.id)}><AlertTriangle size={11} /> Virar Ocorrência</BtnOutline>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )}

        {/* ── OCORRÊNCIAS ── */}
        {secao === 'ocorrencias' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => setShowNovaOc(!showNovaOc)} style={{
              alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 10,
              border: 'none', background: '#1E3A5F', color: '#fff', fontSize: 12, fontWeight: 600,
            }}>
              <Plus size={13} /> Nova
            </button>

            {showNovaOc && (
              <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 14, boxShadow: shadow.sm }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select value={novaOc.tipo} onChange={e => setNovaOc({ ...novaOc, tipo: e.target.value })} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${colors.borderStrong}`, fontSize: 12 }}>
                    {Object.entries(TIPO_CORES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <input value={novaOc.titulo} onChange={e => setNovaOc({ ...novaOc, titulo: e.target.value })} placeholder="Título" style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1px solid ${colors.borderStrong}`, fontSize: 12 }} />
                </div>
                <textarea value={novaOc.descricao} onChange={e => setNovaOc({ ...novaOc, descricao: e.target.value })} placeholder="Descrição (opcional)" rows={3} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${colors.borderStrong}`, fontSize: 12, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                  <button onClick={() => setShowNovaOc(false)} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${colors.borderStrong}`, background: colors.surface, fontSize: 12 }}>Cancelar</button>
                  <button onClick={criarOcorrencia} disabled={salvando || !novaOc.titulo.trim()} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#2563EB', color: '#fff', fontSize: 12, fontWeight: 600, opacity: salvando ? 0.6 : 1 }}>
                    {salvando ? 'Salvando...' : 'Criar'}
                  </button>
                </div>
              </div>
            )}

            {detalhe.ocorrencias.length === 0 ? <EmptyState text="Nenhuma ocorrência registrada" /> :
              detalhe.ocorrencias.map(oc => {
                const tipo = TIPO_CORES[oc.tipo] || TIPO_CORES.geral
                const statusLabel = oc.pontos === 2 ? 'justificada' : oc.pontos === 1 ? 'resolvida' : oc.pontos === -1 ? 'cancelada' : 'pendente'
                const stColors: Record<string, { bg: string; text: string }> = {
                  pendente: { bg: '#FFFBEB', text: '#D97706' }, resolvida: { bg: '#ECFDF5', text: '#059669' },
                  cancelada: { bg: '#F3F4F6', text: '#6B7280' }, justificada: { bg: '#EFF6FF', text: '#2563EB' },
                }
                const st = stColors[statusLabel] || stColors.pendente
                return (
                  <div key={oc.id} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 12, opacity: statusLabel === 'justificada' ? 0.6 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
                      <Badge bg={tipo.bg} color={tipo.text}>{tipo.label}</Badge>
                      <Badge bg={st.bg} color={st.text}>{statusLabel === 'justificada' ? 'justificada (fora da ficha)' : statusLabel}</Badge>
                      <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 'auto' }}>{new Date(oc.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{oc.descricao}</div>
                    {statusLabel === 'pendente' && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <BtnOutline color="#059669" onClick={() => atualizarOcorrencia(oc.id, 'resolvida')}><CheckCircle size={11} /> Resolver</BtnOutline>
                        <BtnOutline color="#2563EB" onClick={() => atualizarOcorrencia(oc.id, 'justificada')}><FileText size={11} /> Justificar</BtnOutline>
                        <BtnOutline color="#6B7280" onClick={() => atualizarOcorrencia(oc.id, 'cancelada')}><XCircle size={11} /> Cancelar</BtnOutline>
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )}

        {/* ── MESES ANTERIORES ── */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Calendar size={12} /> Meses Anteriores
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {getMesesAnteriores().map(mes => {
              const isExp = mesExpandido === mes
              const dados = mesesAnteriores[mes]
              const isLoad = dados === 'loading'
              const mesData = (dados && dados !== 'loading') ? dados as MecDetalhe : null
              return (
                <div key={mes} style={{ background: colors.surface, border: `1px solid ${isExp ? '#BFDBFE' : colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div onClick={() => carregarMesAnterior(detalhe.tecnico_nome, mes)} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', cursor: 'pointer' }}>
                    <ChevronDown size={12} color="#9CA3AF" style={{ transform: isExp ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform .15s', marginRight: 6, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: colors.text, textTransform: 'capitalize', flex: 1 }}>{mesLabel(mes)}</span>
                    {isLoad && <span style={{ fontSize: 11, color: '#9CA3AF' }}>Carregando...</span>}
                    {mesData && (
                      <div style={{ display: 'flex', gap: 8, fontSize: 10, fontWeight: 600 }}>
                        <span style={{ color: '#2563EB' }}>{mesData.ordens.length} OS</span>
                        <span style={{ color: '#DC2626' }}>{mesData.alertas.length} Al</span>
                        <span style={{ color: '#D97706' }}>{mesData.ocorrencias.length} Oc</span>
                      </div>
                    )}
                  </div>
                  {isExp && mesData && (
                    <div style={{ borderTop: `1px solid ${colors.border}`, padding: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }}>
                        <MiniCard label="OS" value={mesData.ordens.length} bg="#EFF6FF" color="#2563EB" />
                        <MiniCard label="Req" value={mesData.requisicoes.length} bg="#F5F3FF" color="#7C3AED" />
                        <MiniCard label="Alertas" value={mesData.alertas.length} bg="#FEF2F2" color="#DC2626" />
                        <MiniCard label="Ocorr." value={mesData.ocorrencias.length} bg="#FFFBEB" color="#D97706" />
                      </div>
                      {mesData.ordens.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <Lbl>ORDENS ({mesData.ordens.length})</Lbl>
                          {mesData.ordens.map(o => (
                            <div key={o.os_num} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: colors.surfaceAlt, borderRadius: 6, fontSize: 11, marginBottom: 2, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 600, color: '#2563EB' }}>OS {o.os_num}</span>
                              <span style={{ color: colors.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.cliente || o.cidade || '-'}</span>
                              <span style={{ color: '#059669', fontWeight: 600 }}>{(parseFloat(o.horas) || 0).toFixed(1)}h</span>
                              <span style={{ color: '#D97706', fontWeight: 600 }}>{(parseFloat(o.km) || 0).toFixed(0)}km</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {mesData.alertas.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <Lbl>ALERTAS ({mesData.alertas.length})</Lbl>
                          {mesData.alertas.map((a: any) => (
                            <div key={a.id} style={{ background: a.status === 'pendente' ? '#FEF2F2' : colors.surfaceAlt, border: `1px solid ${a.status === 'pendente' ? '#FECACA' : colors.border}`, borderRadius: 6, padding: '6px 10px', marginBottom: 3, fontSize: 11 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                <Badge bg={a.tipo === 'atraso_relatorio' ? '#FFFBEB' : '#FEF2F2'} color={a.tipo === 'atraso_relatorio' ? '#D97706' : '#DC2626'}>{a.tipo === 'atraso_relatorio' ? 'Atraso' : 'Div. KM'}</Badge>
                                {a.ordem && <span style={{ color: '#2563EB', fontWeight: 600 }}>OS {a.ordem.os_num}</span>}
                                <span style={{ color: '#9CA3AF', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.descricao}</span>
                                <Badge bg={a.status === 'justificada' ? '#ECFDF5' : a.status === 'ocorrencia' ? '#EFF6FF' : '#FFFBEB'} color={a.status === 'justificada' ? '#059669' : a.status === 'ocorrencia' ? '#2563EB' : '#D97706'}>{a.status}</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {mesData.ocorrencias.length > 0 && (
                        <div>
                          <Lbl>OCORRÊNCIAS ({mesData.ocorrencias.length})</Lbl>
                          {mesData.ocorrencias.map((oc: any) => (
                            <div key={oc.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', background: '#FFFBEB', borderRadius: 6, fontSize: 11, marginBottom: 2, flexWrap: 'wrap' }}>
                              <Badge bg="#FEF3C7" color="#D97706">{oc.tipo}</Badge>
                              <span style={{ color: colors.text, flex: 1 }}>{oc.descricao}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {mesData.ordens.length === 0 && mesData.alertas.length === 0 && mesData.ocorrencias.length === 0 && (
                        <div style={{ textAlign: 'center', padding: 12, color: '#9CA3AF', fontSize: 11 }}>Nenhum registro neste mês</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ━━ LISTA ━━
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Users size={22} color="#6366F1" />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>Mecânicos</div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>Técnicos, alertas e desempenho</div>
        </div>
      </div>

      {mecanicos.length === 0 ? (
        <EmptyState text="Nenhum mecânico cadastrado" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mecanicos.map(m => {
            const initials = m.nome.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
            const pendentes = m.alertas_pendentes + m.ocorrencias_pendentes
            return (
              <div key={m.id} onClick={() => carregarDetalhe(m.tecnico_nome)} style={{
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14,
                padding: '14px 14px', boxShadow: shadow.sm,
              }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {m.avatar_url ? <img src={m.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{initials}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.nome}</div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 11, color: colors.textSubtle, marginTop: 2 }}>
                    <span style={{ fontWeight: 600, color: '#2563EB' }}>{m.stats.total} OS</span>
                    <span>{m.stats.horas.toFixed(0)}h</span>
                    <span>{m.stats.km.toFixed(0)} km</span>
                  </div>
                </div>
                {pendentes > 0 && (
                  <span style={{ minWidth: 20, height: 20, borderRadius: 10, background: '#EF4444', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0 }}>
                    {pendentes}
                  </span>
                )}
                <ChevronRight size={16} color={colors.borderStrong} style={{ flexShrink: 0 }} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Helpers ──

function MiniCard({ label, value, bg, color }: { label: string; value: number; bg: string; color: string }) {
  return (
    <div style={{ background: bg, borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: `${color}99`, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

function Badge({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: bg, color, whiteSpace: 'nowrap' }}>{children}</span>
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ textAlign: 'center', padding: 30, color: '#9CA3AF', fontSize: 13, background: colors.surfaceAlt, border: `1px solid ${colors.border}`, borderRadius: 12 }}>{text}</div>
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3, display: 'block' }}>{children}</span>
}

function TextBlock({ label, text, bg, border }: { label: string; text: string; bg?: string; border?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <Lbl>{label}</Lbl>
      <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, background: bg || 'transparent', borderRadius: bg ? 6 : 0, padding: bg ? 8 : 0, border: border ? `1px solid ${border}` : 'none', whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  )
}

function BtnOutline({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={e => { e.stopPropagation(); onClick() }} style={{
      padding: '5px 10px', borderRadius: 6, border: `1px solid ${color}40`, background: `${color}08`,
      color, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
    }}>
      {children}
    </button>
  )
}
