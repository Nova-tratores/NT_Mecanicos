'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  ChevronLeft, ChevronRight, CheckCircle, XCircle, Package, Calendar,
  Plus, X, Trash2, Search, Wrench, Ban, Sun, LogOut, Bell, User,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────
interface LousaEntry {
  id: string
  data: string
  cliente_cnpj: string | null
  cliente_nome: string
  descricao: string | null
  criado_por_id: string
  criado_por_nome: string
  cor: string
  created_at: string
  tecnico_nome: string | null
  periodo: string | null
  tipo?: string | null
  temOsAberta?: boolean
  ordensAbertas?: { id_ordem: string; status: string }[]
  temPedidoPPV?: boolean
}

type TipoMarca = 'servico' | 'faltou' | 'feriado' | 'saida'
const TIPO_CONFIG: Record<TipoMarca, { label: string; cor: string; bg: string; icon: typeof Wrench }> = {
  servico: { label: 'Serviço', cor: '#3b82f6', bg: '#eff6ff', icon: Wrench },
  faltou:  { label: 'Faltou', cor: '#dc2626', bg: '#fef2f2', icon: Ban },
  feriado: { label: 'Feriado', cor: '#f59e0b', bg: '#fffbeb', icon: Sun },
  saida:   { label: 'Saída', cor: '#8b5cf6', bg: '#faf5ff', icon: LogOut },
}

interface Cliente { cnpj_cpf: string; nome_fantasia: string; razao_social: string; cidade: string }
interface Tecnico { user_id: string; tecnico_nome: string }
interface Usuario { id: string; nome: string; funcao: string }

const CORES = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1']

const TECH_PALETTES = [
  { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af', avatar: '#3b82f6' },
  { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', avatar: '#22c55e' },
  { bg: '#fffbeb', border: '#fde68a', text: '#92400e', avatar: '#f59e0b' },
  { bg: '#faf5ff', border: '#d8b4fe', text: '#6b21a8', avatar: '#a855f7' },
  { bg: '#fdf2f8', border: '#fbcfe8', text: '#9d174d', avatar: '#ec4899' },
  { bg: '#ecfeff', border: '#a5f3fc', text: '#155e75', avatar: '#06b6d4' },
  { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', avatar: '#f97316' },
  { bg: '#eef2ff', border: '#c7d2fe', text: '#3730a3', avatar: '#6366f1' },
  { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', avatar: '#ef4444' },
  { bg: '#f0fdfa', border: '#99f6e4', text: '#115e59', avatar: '#14b8a6' },
]

// ── Helpers ─────────────────────────────────────────────────────────
function getSegunda(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function fmtDate(d: Date): string { return d.toISOString().slice(0, 10) }
function fmtDateBR(d: Date): string { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }

// ── Props ───────────────────────────────────────────────────────────
interface LousaVirtualProps {
  userId: string
  userName: string
  isAdmin?: boolean
  defaultTecnico?: string
}

export default function LousaVirtual({ userId, userName, isAdmin, defaultTecnico }: LousaVirtualProps) {
  // ── State: dados ──
  const [diaAtual, setDiaAtual] = useState(() => new Date())
  const [entradas, setEntradas] = useState<LousaEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])

  // ── State: modal criação/edição ──
  const [modalOpen, setModalOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<LousaEntry | null>(null)
  const [modalDia, setModalDia] = useState('')
  const [modalTecnico, setModalTecnico] = useState('')
  const [modalPeriodo, setModalPeriodo] = useState<'manha' | 'tarde'>('manha')
  const [modalTipo, setModalTipo] = useState<TipoMarca>('servico')
  const [formCliente, setFormCliente] = useState<Cliente | null>(null)
  const [formClienteSearch, setFormClienteSearch] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formCor, setFormCor] = useState('#3b82f6')
  const [clienteResults, setClienteResults] = useState<Cliente[]>([])
  const [searchingClientes, setSearchingClientes] = useState(false)
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)
  const [saving, setSaving] = useState(false)

  // ── State: notificação config ──
  const [configOpen, setConfigOpen] = useState(false)
  const [configUser, setConfigUser] = useState<{ id: string; nome: string } | null>(null)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loadingConfig, setLoadingConfig] = useState(false)

  // ── Refs ──
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const swiping = useRef(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ── Computed ──
  const semana = useMemo(() => getSegunda(diaAtual), [diaAtual])
  const sabado = useMemo(() => addDays(semana, 5), [semana])
  const hoje = fmtDate(new Date())
  const diaStr = fmtDate(diaAtual)

  // ── Carregar dados da semana ──
  const carregar = useCallback(async () => {
    setLoading(true)
    const inicio = fmtDate(semana)
    const fim = fmtDate(sabado)

    const [{ data: rows }, { data: tecList }] = await Promise.all([
      supabase.from('lousa_servicos').select('*').gte('data', inicio).lte('data', fim).order('created_at'),
      supabase.from('portal_permissoes').select('user_id, mecanico_tecnico_nome, mecanico_role')
        .eq('mecanico_role', 'tecnico').not('mecanico_tecnico_nome', 'is', null),
    ])

    const lista = rows || []
    const cnpjs = [...new Set(lista.map(e => e.cliente_cnpj).filter(Boolean))] as string[]
    let osMap: Record<string, { id_ordem: string; status: string }[]> = {}
    let ppvMap: Record<string, boolean> = {}

    if (cnpjs.length > 0) {
      const { data: ordens } = await supabase.from('Ordem_Servico')
        .select('Id_Ordem, CNPJ_CPF_Cliente, Status').in('CNPJ_CPF_Cliente', cnpjs)
        .not('Status', 'in', '("Concluída","Cancelada")')

      const ordensList = ordens || []
      for (const o of ordensList) {
        if (!osMap[o.CNPJ_CPF_Cliente]) osMap[o.CNPJ_CPF_Cliente] = []
        osMap[o.CNPJ_CPF_Cliente].push({ id_ordem: String(o.Id_Ordem), status: o.Status })
      }

      const osIds = ordensList.map(o => String(o.Id_Ordem))
      if (osIds.length > 0) {
        const { data: peds } = await supabase.from('pedidos').select('Id_Os').in('Id_Os', osIds)
        const pedOsSet = new Set((peds || []).map(p => String(p.Id_Os)))
        for (const o of ordensList) {
          if (pedOsSet.has(String(o.Id_Ordem))) ppvMap[o.CNPJ_CPF_Cliente] = true
        }
      }
    }

    setEntradas(lista.map(e => ({
      ...e,
      temOsAberta: e.cliente_cnpj ? (osMap[e.cliente_cnpj]?.length || 0) > 0 : false,
      ordensAbertas: e.cliente_cnpj ? osMap[e.cliente_cnpj] || [] : [],
      temPedidoPPV: e.cliente_cnpj ? !!ppvMap[e.cliente_cnpj] : false,
    })))
    setTecnicos(
      ((tecList || []) as any[])
        .map(t => ({ user_id: t.user_id, tecnico_nome: t.mecanico_tecnico_nome }))
        .sort((a, b) => a.tecnico_nome.localeCompare(b.tecnico_nome))
    )
    setLoading(false)
  }, [semana, sabado])

  useEffect(() => { carregar() }, [carregar])

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowClienteDropdown(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // ── Busca de clientes ──
  const buscarClientes = useCallback((q: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (q.length < 2) { setClienteResults([]); return }
    searchTimeout.current = setTimeout(async () => {
      setSearchingClientes(true)
      const { data } = await supabase.from('portal_nt_clientes_PRINCIPAL')
        .select('cnpj_cpf, nome_fantasia, razao_social, cidade')
        .or(`nome_fantasia.ilike.%${q}%,razao_social.ilike.%${q}%,cnpj_cpf.ilike.%${q}%`)
        .limit(20)
      setClienteResults(data || [])
      setSearchingClientes(false)
      setShowClienteDropdown(true)
    }, 300)
  }, [])

  // ── CRUD ──
  const abrirNovaEntrada = (periodo: 'manha' | 'tarde') => {
    setEditEntry(null)
    setModalDia(diaStr)
    setModalTecnico(defaultTecnico || '')
    setModalPeriodo(periodo)
    setModalTipo('servico')
    setFormCliente(null)
    setFormClienteSearch('')
    setFormDesc('')
    setFormCor('#3b82f6')
    setClienteResults([])
    setShowClienteDropdown(false)
    setModalOpen(true)
  }

  const abrirEdicao = (entry: LousaEntry) => {
    setEditEntry(entry)
    setModalDia(entry.data)
    setModalTecnico(entry.tecnico_nome || '')
    setModalPeriodo((entry.periodo === 'tarde' ? 'tarde' : 'manha') as 'manha' | 'tarde')
    setModalTipo((entry.tipo as TipoMarca) || 'servico')
    setFormCliente(entry.cliente_cnpj ? { cnpj_cpf: entry.cliente_cnpj, nome_fantasia: entry.cliente_nome, razao_social: '', cidade: '' } : null)
    setFormClienteSearch(entry.cliente_nome)
    setFormDesc(entry.descricao || '')
    setFormCor(entry.cor || '#3b82f6')
    setClienteResults([])
    setShowClienteDropdown(false)
    setModalOpen(true)
  }

  const podeSalvar = modalTipo === 'servico'
    ? !!formClienteSearch.trim()
    : modalTipo === 'faltou'
      ? !!formDesc.trim()
      : true

  const salvar = async () => {
    if (!podeSalvar) return
    setSaving(true)
    const isServico = modalTipo === 'servico'
    const payload: any = {
      data: modalDia,
      tipo: modalTipo,
      cliente_cnpj: isServico ? (formCliente?.cnpj_cpf || null) : null,
      cliente_nome: isServico ? (formCliente?.nome_fantasia || formClienteSearch.trim()) : TIPO_CONFIG[modalTipo].label,
      descricao: formDesc.trim() || null,
      cor: isServico ? formCor : TIPO_CONFIG[modalTipo].cor,
      tecnico_nome: modalTecnico || null,
      periodo: modalPeriodo,
    }

    let error: any = null
    if (editEntry) {
      const res = await supabase.from('lousa_servicos').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editEntry.id)
      error = res.error
    } else {
      const res = await supabase.from('lousa_servicos').insert({ ...payload, criado_por_id: userId, criado_por_nome: userName })
      error = res.error
    }
    setSaving(false)
    if (error) { alert(`Erro ao salvar: ${error.message}`); return }
    setModalOpen(false)
    carregar()
  }

  const excluir = async (id: string) => {
    if (!confirm('Excluir esta marcação?')) return
    await supabase.from('lousa_servicos').delete().eq('id', id)
    setModalOpen(false)
    carregar()
  }

  // ── Config notificação (admin only) ──
  const abrirConfig = async () => {
    setConfigOpen(true)
    setLoadingConfig(true)
    const [{ data: cfg }, { data: usrs }] = await Promise.all([
      supabase.from('lousa_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('financeiro_usu').select('id, nome, funcao').order('nome'),
    ])
    setConfigUser(cfg?.notificar_user_id ? { id: cfg.notificar_user_id, nome: cfg.notificar_user_nome || '' } : null)
    setUsuarios(usrs || [])
    setLoadingConfig(false)
  }

  const salvarConfig = async () => {
    await supabase.from('lousa_config').upsert({
      id: 1, notificar_user_id: configUser?.id || null,
      notificar_user_nome: configUser?.nome || null, updated_at: new Date().toISOString(),
    })
    setConfigOpen(false)
  }

  // ── Swipe ──
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    swiping.current = true
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return
    swiping.current = false
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return
    setDiaAtual(prev => addDays(prev, dx < 0 ? 1 : -1))
  }, [])

  // ── Dados filtrados ──
  const entradasDia = useMemo(() => entradas.filter(e => e.data === diaStr), [entradas, diaStr])
  const isHoje = diaStr === hoje
  const diaNome = diaAtual.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })

  const diasSemana = useMemo(() =>
    Array.from({ length: 6 }, (_, i) => {
      const d = addDays(semana, i)
      return { date: d, str: fmtDate(d), label: d.toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3) }
    }), [semana])

  // ── Agrupar entradas por técnico ──
  const gruposTecnico = useMemo(() => {
    const map = new Map<string, LousaEntry[]>()
    for (const e of entradasDia) {
      const key = e.tecnico_nome || '___sem_tecnico___'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return Array.from(map.entries()).map(([nome, entries]) => ({ nome: nome === '___sem_tecnico___' ? '' : nome, entries }))
  }, [entradasDia])

  // ── Render sub-entry (linha dentro do card do técnico) ──
  const renderSubEntry = (entry: LousaEntry) => {
    const per = entry.periodo === 'tarde' ? 'tarde' : 'manha'
    const tipoMarca = (entry.tipo as TipoMarca) || 'servico'
    const isServico = tipoMarca === 'servico'
    const cfgMarca = TIPO_CONFIG[tipoMarca] || TIPO_CONFIG.servico
    const IconMarca = cfgMarca.icon

    return (
      <div key={entry.id} onClick={() => abrirEdicao(entry)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
        background: isServico ? '#FAFAFA' : cfgMarca.bg, borderRadius: 10, cursor: 'pointer',
        borderLeft: `4px solid ${entry.cor || cfgMarca.cor}`,
      }}>
        <span style={{
          fontSize: 8, fontWeight: 800, padding: '3px 6px', borderRadius: 4, flexShrink: 0,
          background: per === 'manha' ? '#FEF3C7' : '#EDE9FE',
          color: per === 'manha' ? '#92400E' : '#5B21B6',
          width: 38, textAlign: 'center' as const,
        }}>
          {per === 'manha' ? 'MANHÃ' : 'TARDE'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: isServico ? '#1a1a1a' : cfgMarca.cor,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {isServico ? entry.cliente_nome : cfgMarca.label}
          </div>
          {entry.descricao && (
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.descricao}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
          {!isServico && <IconMarca size={14} color={cfgMarca.cor} />}
          {isServico && (entry.temOsAberta
            ? <CheckCircle size={14} color="#059669" />
            : <XCircle size={14} color="#dc2626" />)}
          {isServico && entry.temPedidoPPV && <Package size={14} color="#d97706" />}
        </div>
      </div>
    )
  }

  // ── Render card agrupado por técnico ──
  const renderTecnicoCard = (grupo: { nome: string; entries: LousaEntry[] }) => {
    const tecIdx = tecnicos.findIndex(t => t.tecnico_nome === grupo.nome)
    const palette = tecIdx >= 0 ? TECH_PALETTES[tecIdx % TECH_PALETTES.length]
      : { bg: '#f9fafb', border: '#e5e7eb', avatar: '#9ca3af', text: '#6b7280' }

    return (
      <div key={grupo.nome || 'sem'} style={{
        background: '#fff', borderRadius: 16, overflow: 'hidden',
        boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
      }}>
        {/* Header do técnico */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px 10px',
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: palette.avatar,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: '#fff',
          }}>
            {grupo.nome ? grupo.nome.charAt(0).toUpperCase() : '?'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: palette.text }}>
              {grupo.nome || 'Sem Técnico'}
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600 }}>
              {grupo.entries.length} serviço{grupo.entries.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
        {/* Entradas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 10px 12px' }}>
          {grupo.entries.map(renderSubEntry)}
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════
  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{ minHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}
    >
      {/* ─── Header ─── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar size={18} color="#3b82f6" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Lousa Virtual
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && (
            <button onClick={abrirConfig} style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8,
              border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, color: '#6B7280',
            }}>
              <Bell size={13} /> Notif.
            </button>
          )}
          {!isHoje && (
            <button onClick={() => setDiaAtual(new Date())} style={{
              padding: '4px 12px', borderRadius: 8, border: '1px solid #3b82f6',
              background: '#EFF6FF', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#3b82f6',
            }}>
              Hoje
            </button>
          )}
        </div>
      </div>

      {/* ─── Dia atual ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => setDiaAtual(prev => addDays(prev, -1))} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
        }}>
          <ChevronLeft size={22} color="#1E3A5F" />
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{
            fontSize: 20, fontWeight: 800, color: isHoje ? '#2563EB' : '#1E3A5F',
            textTransform: 'capitalize', lineHeight: 1.2,
          }}>
            {diaNome}
          </div>
          {isHoje && (
            <span style={{
              fontSize: 10, fontWeight: 700, background: '#2563EB', color: '#fff',
              padding: '2px 10px', borderRadius: 6, display: 'inline-block', marginTop: 4,
            }}>HOJE</span>
          )}
        </div>
        <button onClick={() => setDiaAtual(prev => addDays(prev, 1))} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
        }}>
          <ChevronRight size={22} color="#1E3A5F" />
        </button>
      </div>

      {/* ─── Dots da semana ─── */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
        {diasSemana.map(d => {
          const isSelected = d.str === diaStr
          const isDiaHoje = d.str === hoje
          const temEntrada = entradas.some(e => e.data === d.str)
          return (
            <button key={d.str} onClick={() => setDiaAtual(d.date)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              background: isSelected ? '#1E3A5F' : 'transparent',
              border: isDiaHoje && !isSelected ? '2px solid #3b82f6' : '2px solid transparent',
              borderRadius: 10, padding: '4px 8px', cursor: 'pointer', minWidth: 42,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: isSelected ? '#fff' : '#9CA3AF' }}>
                {d.label}
              </span>
              <span style={{ fontSize: 14, fontWeight: 800, color: isSelected ? '#fff' : isDiaHoje ? '#2563EB' : '#1E3A5F' }}>
                {d.date.getDate()}
              </span>
              {temEntrada && (
                <div style={{ width: 4, height: 4, borderRadius: 2, background: isSelected ? '#fff' : isDiaHoje ? '#2563EB' : '#9CA3AF' }} />
              )}
            </button>
          )
        })}
      </div>

      {/* ─── Legenda ─── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, fontSize: 11, color: '#6B7280', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><CheckCircle size={11} color="#059669" /> OS</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><XCircle size={11} color="#dc2626" /> Sem OS</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Package size={11} color="#d97706" /> PPV</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Ban size={11} color="#dc2626" /> Faltou</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Sun size={11} color="#f59e0b" /> Feriado</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><LogOut size={11} color="#8b5cf6" /> Saída</span>
      </div>

      {/* ─── Conteúdo do dia ─── */}
      <div style={{ flex: 1 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#6B7280', letterSpacing: 0.5 }}>
                {entradasDia.length} agendamento{entradasDia.length !== 1 ? 's' : ''}
              </span>
              <button onClick={() => abrirNovaEntrada('manha')} style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8,
                border: '1px dashed #D1D5DB', background: '#fff', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, color: '#9CA3AF',
              }}>
                <Plus size={13} /> Novo
              </button>
            </div>
            {gruposTecnico.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {gruposTecnico.map(renderTecnicoCard)}
              </div>
            ) : (
              <div style={{
                background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center',
                color: '#D1D5DB', fontSize: 13, border: '1px dashed #E5E7EB',
              }}>
                Nenhum agendamento neste dia
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Hint swipe ─── */}
      <div style={{ textAlign: 'center', padding: '16px 0 8px', fontSize: 11, color: '#D1D5DB' }}>
        ← deslize para navegar →
      </div>

      {/* ─── FAB criar ─── */}
      <button onClick={() => abrirNovaEntrada('manha')} style={{
        position: 'fixed', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 16,
        background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none',
        boxShadow: '0 6px 20px rgba(59,130,246,0.4)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40,
      }}>
        <Plus size={26} color="#fff" />
      </button>

      {/* ════════════════════════════════════════════════════════════ */}
      {/* MODAL CRIAR / EDITAR                                       */}
      {/* ════════════════════════════════════════════════════════════ */}
      {modalOpen && (
        <div onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
          zIndex: 50000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div style={{
            background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 540,
            maxHeight: '90vh', overflowY: 'auto', padding: '24px 20px env(safe-area-inset-bottom, 20px)',
          }}>
            {/* Header modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1E3A5F', margin: 0 }}>
                {editEntry ? 'Editar marcação' : 'Nova marcação'}
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {editEntry && (
                  <button onClick={() => excluir(editEntry.id)} style={{
                    width: 36, height: 36, borderRadius: 10, border: 'none',
                    background: '#FEF2F2', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Trash2 size={16} color="#dc2626" />
                  </button>
                )}
                <button onClick={() => setModalOpen(false)} style={{
                  width: 36, height: 36, borderRadius: 10, border: 'none',
                  background: '#F3F4F6', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <X size={16} color="#6B7280" />
                </button>
              </div>
            </div>

            {/* Tipo */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: 1, display: 'block', marginBottom: 6 }}>TIPO</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {(Object.keys(TIPO_CONFIG) as TipoMarca[]).map(t => {
                  const cfg = TIPO_CONFIG[t]
                  const Icon = cfg.icon
                  const ativo = modalTipo === t
                  return (
                    <button key={t} onClick={() => setModalTipo(t)} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: '10px 4px', borderRadius: 10, cursor: 'pointer',
                      border: ativo ? `2px solid ${cfg.cor}` : '1px solid #E5E7EB',
                      background: ativo ? cfg.bg : '#fff',
                      color: ativo ? cfg.cor : '#6B7280',
                      fontSize: 11, fontWeight: 700, lineHeight: 1.1, textAlign: 'center',
                    }}>
                      <Icon size={16} />
                      {cfg.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Técnico + Período */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: 1, display: 'block', marginBottom: 6 }}>TÉCNICO</label>
                <select value={modalTecnico} onChange={e => setModalTecnico(e.target.value)} style={{
                  width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #E5E7EB',
                  fontSize: 13, background: '#fff', color: '#1a1a1a', boxSizing: 'border-box',
                }}>
                  <option value="">Sem técnico</option>
                  {tecnicos.map(t => <option key={t.user_id} value={t.tecnico_nome}>{t.tecnico_nome}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: 1, display: 'block', marginBottom: 6 }}>PERÍODO</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['manha', 'tarde'] as const).map(p => (
                    <button key={p} onClick={() => setModalPeriodo(p)} style={{
                      flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 12, fontWeight: 600,
                      border: modalPeriodo === p ? '2px solid #3b82f6' : '1px solid #E5E7EB',
                      background: modalPeriodo === p ? '#eff6ff' : '#fff',
                      color: modalPeriodo === p ? '#2563eb' : '#6B7280', cursor: 'pointer',
                    }}>
                      {p === 'manha' ? 'Manhã' : 'Tarde'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Data */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: 1, display: 'block', marginBottom: 6 }}>DATA</label>
              <input type="date" value={modalDia} onChange={e => setModalDia(e.target.value)} style={{
                width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #E5E7EB',
                fontSize: 14, background: '#fff', color: '#1a1a1a', boxSizing: 'border-box',
              }} />
            </div>

            {/* Cliente (só serviço) */}
            {modalTipo === 'servico' && (
              <div style={{ marginBottom: 16, position: 'relative' }} ref={dropdownRef}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: 1, display: 'block', marginBottom: 6 }}>CLIENTE</label>
                <div style={{ position: 'relative' }}>
                  <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
                  <input
                    value={formClienteSearch}
                    onChange={e => { setFormClienteSearch(e.target.value); setFormCliente(null); buscarClientes(e.target.value) }}
                    onFocus={() => { if (clienteResults.length > 0) setShowClienteDropdown(true) }}
                    placeholder="Buscar por nome, CNPJ..."
                    style={{
                      width: '100%', padding: '10px 14px 10px 36px', borderRadius: 10,
                      border: '1px solid #E5E7EB', fontSize: 14, background: '#fff',
                      color: '#1a1a1a', boxSizing: 'border-box',
                    }}
                  />
                  {formCliente && (
                    <span style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      fontSize: 9, fontWeight: 700, color: '#059669', background: '#ECFDF5',
                      padding: '3px 8px', borderRadius: 6,
                    }}>Vinculado</span>
                  )}
                </div>
                {showClienteDropdown && clienteResults.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                    background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB',
                    boxShadow: '0 12px 32px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto', marginTop: 4,
                  }}>
                    {clienteResults.map((c, i) => (
                      <div key={c.cnpj_cpf + i} onClick={() => {
                        setFormCliente(c); setFormClienteSearch(c.nome_fantasia || c.razao_social); setShowClienteDropdown(false)
                      }} style={{
                        padding: '10px 14px', cursor: 'pointer',
                        borderBottom: i < clienteResults.length - 1 ? '1px solid #F3F4F6' : 'none',
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
                          {c.nome_fantasia || c.razao_social}
                        </div>
                        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                          {c.cnpj_cpf} {c.cidade ? `· ${c.cidade}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {searchingClientes && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                    background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB',
                    padding: 16, textAlign: 'center', color: '#9CA3AF', fontSize: 12, marginTop: 4,
                  }}>Buscando...</div>
                )}
              </div>
            )}

            {/* Descrição / Motivo */}
            {modalTipo !== 'feriado' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                  {modalTipo === 'faltou' ? 'MOTIVO' : modalTipo === 'saida' ? 'HORÁRIO / MOTIVO' : 'DESCRIÇÃO'}
                </label>
                <textarea
                  value={formDesc} onChange={e => setFormDesc(e.target.value)}
                  placeholder={modalTipo === 'faltou' ? 'Por que faltou?' : modalTipo === 'saida' ? 'Ex: saiu 15h por consulta...' : 'Descreva o serviço...'}
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #E5E7EB',
                    fontSize: 14, background: '#fff', color: '#1a1a1a', resize: 'vertical',
                    fontFamily: 'inherit', boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {/* Cor (só serviço) */}
            {modalTipo === 'servico' && (
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: 1, display: 'block', marginBottom: 6 }}>COR</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {CORES.map(c => (
                    <button key={c} onClick={() => setFormCor(c)} style={{
                      width: 32, height: 32, borderRadius: 8,
                      border: formCor === c ? '3px solid #1a1a1a' : '2px solid transparent',
                      background: c, cursor: 'pointer',
                    }} />
                  ))}
                </div>
              </div>
            )}

            {/* Botões salvar */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setModalOpen(false)} style={{
                flex: 1, padding: '14px 0', borderRadius: 12, border: '1px solid #E5E7EB',
                background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#6B7280',
              }}>
                Cancelar
              </button>
              <button onClick={salvar} disabled={!podeSalvar || saving} style={{
                flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
                background: !podeSalvar || saving ? '#94a3b8' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: !podeSalvar || saving ? 'not-allowed' : 'pointer',
                boxShadow: podeSalvar && !saving ? '0 4px 12px rgba(59,130,246,0.25)' : 'none',
              }}>
                {saving ? 'Salvando...' : editEntry ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/* MODAL CONFIG NOTIFICAÇÃO (admin only)                      */}
      {/* ════════════════════════════════════════════════════════════ */}
      {configOpen && (
        <div onClick={e => { if (e.target === e.currentTarget) setConfigOpen(false) }} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
          zIndex: 50000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div style={{
            background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 540,
            maxHeight: '80vh', overflowY: 'auto', padding: '24px 20px env(safe-area-inset-bottom, 20px)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Bell size={20} color="#fff" />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: '#1E3A5F', margin: 0 }}>Notificação PPV</h3>
                  <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0 }}>Aviso diário às 16h</p>
                </div>
              </div>
              <button onClick={() => setConfigOpen(false)} style={{
                width: 36, height: 36, borderRadius: 10, border: 'none', background: '#F3F4F6',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <X size={16} color="#6B7280" />
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, marginBottom: 16 }}>
              Escolha quem recebe a notificação quando alguma OS da lousa tiver pedido de peças (PPV).
            </p>

            {loadingConfig ? (
              <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto', marginBottom: 20 }}>
                <button onClick={() => setConfigUser(null)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12,
                  border: !configUser ? '2px solid #3b82f6' : '1px solid #E5E7EB',
                  background: !configUser ? '#EFF6FF' : '#fff', cursor: 'pointer', width: '100%', textAlign: 'left' as const,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, background: '#F3F4F6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <X size={16} color="#9CA3AF" />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>Nenhum (desativado)</span>
                </button>
                {usuarios.map(u => {
                  const sel = configUser?.id === u.id
                  return (
                    <button key={u.id} onClick={() => setConfigUser({ id: u.id, nome: u.nome })} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12,
                      border: sel ? '2px solid #3b82f6' : '1px solid #E5E7EB',
                      background: sel ? '#EFF6FF' : '#fff', cursor: 'pointer', width: '100%', textAlign: 'left' as const,
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: sel ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : '#F3F4F6',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <User size={16} color={sel ? '#fff' : '#9CA3AF'} />
                      </div>
                      <div>
                        <span style={{ fontSize: 14, fontWeight: sel ? 700 : 500, color: '#1a1a1a', display: 'block' }}>{u.nome}</span>
                        <span style={{ fontSize: 11, color: '#9CA3AF' }}>{u.funcao}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfigOpen(false)} style={{
                flex: 1, padding: '14px 0', borderRadius: 12, border: '1px solid #E5E7EB',
                background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#6B7280',
              }}>Cancelar</button>
              <button onClick={salvarConfig} style={{
                flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(245,158,11,0.25)',
              }}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
