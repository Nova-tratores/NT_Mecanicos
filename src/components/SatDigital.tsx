'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { colors, shadow } from '@/lib/ui'
import { dataLocalISO } from '@/lib/tecnico-utils'
import {
  Headset, Plus, Search, X, Clock, AlertTriangle, Loader2, ChevronDown,
  Wrench, RotateCcw, Truck, Calculator, CalendarDays, User, WifiOff, RefreshCw,
} from 'lucide-react'

interface SAT {
  id: string; cliente_nome: string; cliente_endereco: string; cliente_cnpj: string
  tipo: string; descricao: string; status: string; data_limite: string
  criado_por: string; criado_por_nome: string
  concluido_por_nome: string; concluido_at: string
  cancelado_por_nome: string; cancelado_at: string
  created_at: string
}

interface ClienteBusca { id: number; nome: string; cnpj: string; endereco: string; cidade: string }

const TIPOS: Record<string, { label: string; cor: string; icon: any }> = {
  manutencao: { label: 'Manutenção', cor: '#0EA5E9', icon: Wrench },
  revisao: { label: 'Revisão', cor: '#F59E0B', icon: RotateCcw },
  entrega: { label: 'Entrega técnica', cor: '#10B981', icon: Truck },
  orcamento: { label: 'Orçamento', cor: '#8B5CF6', icon: Calculator },
}

const STATUS_CONFIG: Record<string, { label: string; cor: string }> = {
  aberto: { label: 'Aberto', cor: '#DC2626' },
  andamento: { label: 'Em andamento', cor: '#F59E0B' },
  concluido: { label: 'Concluído', cor: '#10B981' },
  cancelado: { label: 'Cancelado', cor: '#6B7280' },
}

// Data pura (YYYY-MM-DD) vira meia-noite UTC no new Date() → no Brasil mostrava
// o dia anterior e marcava "ATRASADO" no próprio dia limite. Ancora no fuso local.
function parseData(iso: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T12:00:00') : new Date(iso)
}

function fmtData(iso: string) {
  if (!iso) return ''
  const d = parseData(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR')
}

function isAtrasado(sat: SAT) {
  if (!sat.data_limite) return false
  if (sat.status === 'concluido' || sat.status === 'cancelado') return false
  return sat.data_limite.slice(0, 10) < dataLocalISO()
}

function statusCfg(status: string) {
  return STATUS_CONFIG[status] || { label: status || '—', cor: '#6B7280' }
}

function primeiroNome(nome: string) {
  return (nome || '').split(' ')[0]
}

interface Props {
  userId: string
  userName: string
}

export default function SatDigital({ userId, userName }: Props) {
  const [sats, setSats] = useState<SAT[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'aberto' | 'andamento' | 'concluido' | 'cancelado'>('aberto')
  const [showModal, setShowModal] = useState(false)
  const [selectedSat, setSelectedSat] = useState<SAT | null>(null)
  const [erroCarga, setErroCarga] = useState(false)
  const [cancelando, setCancelando] = useState(false)

  // Recarrega sem piscar o spinner (realtime chama isto a cada mudança)
  const carregar = useCallback(async (mostrarSpinner = false) => {
    if (mostrarSpinner) setLoading(true)
    try {
      const res = await fetch('/api/sat')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSats(Array.isArray(data) ? data : [])
      setErroCarga(false)
    } catch (e) {
      console.error(e)
      setErroCarga(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar(true) }, [carregar])

  useEffect(() => {
    const onOnline = () => carregar()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [carregar])

  // Realtime
  useEffect(() => {
    const ch = supabase.channel('sats_app')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_sats' }, () => carregar())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [carregar])

  const filtrados = sats.filter(s => s.status === tab)

  const counts = {
    aberto: sats.filter(s => s.status === 'aberto').length,
    andamento: sats.filter(s => s.status === 'andamento').length,
    concluido: sats.filter(s => s.status === 'concluido').length,
    cancelado: sats.filter(s => s.status === 'cancelado').length,
  }

  const cancelar = async (sat: SAT) => {
    if (cancelando) return
    if (!confirm(`Cancelar SAT do cliente "${sat.cliente_nome}"?`)) return
    setCancelando(true)
    try {
      const res = await fetch('/api/sat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'cancelar', id: sat.id, cancelado_por_nome: userName }) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSelectedSat(null)
      await carregar()
    } catch (e) {
      console.error(e)
      alert('Não foi possível cancelar o SAT. Verifique a conexão e tente novamente.')
    } finally {
      setCancelando(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Headset size={22} color="#D97706" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>SAT Digital</div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>Solicitações de atendimento</div>
          </div>
        </div>
        <button onClick={() => setShowModal(true)} style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '10px 16px', borderRadius: 10, minHeight: 44, flexShrink: 0,
          border: 'none', background: '#1E3A5F', color: '#fff', fontSize: 14, fontWeight: 700,
        }}>
          <Plus size={15} /> Novo
        </button>
      </div>

      {/* Tabs - Kanban columns */}
      <div style={{ display: 'flex', gap: 0, background: colors.surfaceAlt, borderRadius: 10, padding: 3 }}>
        {(['aberto', 'andamento', 'concluido', 'cancelado'] as const).map(key => {
          const cfg = STATUS_CONFIG[key]
          const count = counts[key]
          return (
            <button key={key} onClick={() => setTab(key)} style={{
              flex: 1, minWidth: 0, padding: '8px 2px', minHeight: 44, borderRadius: 8, border: 'none', fontSize: 10, fontWeight: 700,
              background: tab === key ? cfg.cor : 'transparent',
              color: tab === key ? '#fff' : colors.textMuted,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, transition: 'all .15s',
            }}>
              <span>{cfg.label}</span>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Loading */}
      {loading && <div style={{ padding: 30, textAlign: 'center' }}><Loader2 size={24} className="spinner" color="#1E3A5F" /></div>}

      {/* Erro de rede: não fingir "Nenhum SAT" */}
      {!loading && erroCarga && sats.length === 0 && (
        <div style={{ textAlign: 'center', padding: 28, background: colors.surface, borderRadius: 14, border: `1px solid ${colors.border}` }}>
          <WifiOff size={30} color={colors.textSubtle} style={{ margin: '0 auto 10px', display: 'block' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, marginBottom: 4 }}>Não consegui carregar os SATs</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 14 }}>Verifique a conexão e tente de novo.</div>
          <button onClick={() => carregar(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12,
            border: 'none', background: '#1E3A5F', color: '#fff', fontSize: 14, fontWeight: 700,
          }}>
            <RefreshCw size={15} /> Tentar de novo
          </button>
        </div>
      )}

      {/* Cards */}
      {!loading && !(erroCarga && sats.length === 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtrados.length === 0 && (
            <div style={{ textAlign: 'center', padding: 30, color: colors.textSubtle, fontSize: 12, background: colors.surfaceAlt, borderRadius: 12, border: `1px solid ${colors.border}` }}>
              Nenhum SAT {statusCfg(tab).label.toLowerCase()}
            </div>
          )}

          {filtrados.map(sat => {
            const tipo = TIPOS[sat.tipo] || TIPOS.manutencao
            const TipoIcon = tipo.icon
            const atrasado = isAtrasado(sat)

            return (
              <div key={sat.id} onClick={() => setSelectedSat(sat)} style={{
                background: colors.surface, borderRadius: 14, padding: '14px',
                border: `1px solid ${atrasado ? '#FCA5A5' : colors.border}`,
                boxShadow: shadow.sm, cursor: 'pointer',
                borderLeft: `4px solid ${statusCfg(sat.status).cor}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: tipo.cor + '15', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <TipoIcon size={16} color={tipo.cor} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, lineHeight: 1.3 }}>
                      {sat.cliente_nome}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5,
                        background: tipo.cor + '15', color: tipo.cor,
                      }}>{tipo.label}</span>
                      {atrasado && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, fontWeight: 700, color: '#DC2626' }}>
                          <AlertTriangle size={10} /> ATRASADO
                        </span>
                      )}
                    </div>
                    {sat.cliente_endereco && (
                      <div style={{ fontSize: 10, color: colors.textSubtle, marginTop: 4 }}>{sat.cliente_endereco}</div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: `1px solid ${colors.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <User size={10} color={colors.textSubtle} />
                    <span style={{ fontSize: 10, color: colors.textSubtle }}>{primeiroNome(sat.criado_por_nome)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {sat.data_limite && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: atrasado ? '#DC2626' : colors.textSubtle }}>
                        <CalendarDays size={10} /> {fmtData(sat.data_limite)}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: colors.textSubtle }}>{fmtData(sat.created_at)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Detail sheet */}
      {selectedSat && (
        <>
          <div onClick={() => setSelectedSat(null)} style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.2)', zIndex: 1999,
          }} />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2000,
            background: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.15)', maxHeight: '80vh', overflowY: 'auto', overscrollBehavior: 'contain',
            padding: '12px 16px calc(28px + env(safe-area-inset-bottom, 0px))',
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: '#D1D5DB', margin: '0 auto 14px' }} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: (TIPOS[selectedSat.tipo]?.cor || '#6B7280') + '15',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {(() => { const Icon = TIPOS[selectedSat.tipo]?.icon || Wrench; return <Icon size={22} color={TIPOS[selectedSat.tipo]?.cor || '#6B7280'} /> })()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: colors.text, overflowWrap: 'anywhere' }}>{selectedSat.cliente_nome}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
                    background: statusCfg(selectedSat.status).cor + '15',
                    color: statusCfg(selectedSat.status).cor,
                  }}>{statusCfg(selectedSat.status).label}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
                    background: (TIPOS[selectedSat.tipo]?.cor || '#6B7280') + '15',
                    color: TIPOS[selectedSat.tipo]?.cor || '#6B7280',
                  }}>{TIPOS[selectedSat.tipo]?.label || selectedSat.tipo}</span>
                </div>
              </div>
              <button onClick={() => setSelectedSat(null)} aria-label="Fechar" style={{ background: 'none', border: 'none', width: 44, height: 44, margin: -10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} color="#9CA3AF" />
              </button>
            </div>

            {/* Info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {selectedSat.cliente_endereco && <DetailRow label="Endereço" value={selectedSat.cliente_endereco} />}
              {selectedSat.cliente_cnpj && <DetailRow label="CNPJ" value={selectedSat.cliente_cnpj} />}
              <DetailRow label="Criado por" value={selectedSat.criado_por_nome || '---'} />
              <DetailRow label="Criado em" value={fmtData(selectedSat.created_at)} />
              {selectedSat.data_limite && <DetailRow label="Data limite" value={fmtData(selectedSat.data_limite)} highlight={isAtrasado(selectedSat)} />}

              {selectedSat.descricao && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', marginBottom: 4 }}>Observação</div>
                  <div style={{ fontSize: 12, color: colors.text, lineHeight: 1.6, whiteSpace: 'pre-wrap', padding: '10px 12px', background: colors.surfaceAlt, borderRadius: 10 }}>
                    {selectedSat.descricao}
                  </div>
                </div>
              )}

              {selectedSat.concluido_por_nome && (
                <div style={{ padding: '10px 12px', background: '#DCFCE7', borderRadius: 10, border: '1px solid #BBF7D0' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#16A34A' }}>Concluído por {selectedSat.concluido_por_nome}</div>
                  <div style={{ fontSize: 10, color: '#15803D' }}>{fmtData(selectedSat.concluido_at)}</div>
                </div>
              )}

              {selectedSat.cancelado_por_nome && (
                <div style={{ padding: '10px 12px', background: '#F3F4F6', borderRadius: 10, border: '1px solid #E5E7EB' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280' }}>Cancelado por {selectedSat.cancelado_por_nome}</div>
                  <div style={{ fontSize: 10, color: '#9CA3AF' }}>{fmtData(selectedSat.cancelado_at)}</div>
                </div>
              )}
            </div>

            {/* Cancel button - only for creator, only if not concluded/cancelled */}
            {selectedSat.criado_por === userId && (selectedSat.status === 'aberto' || selectedSat.status === 'andamento') && (
              <button onClick={() => cancelar(selectedSat)} disabled={cancelando} style={{
                opacity: cancelando ? 0.6 : 1,
                width: '100%', padding: 14, borderRadius: 12, border: `1px solid ${colors.dangerBorder}`,
                background: colors.surface, fontSize: 13, fontWeight: 700, color: colors.danger,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                {cancelando ? <Loader2 size={15} className="spinner" /> : <X size={15} />} {cancelando ? 'Cancelando...' : 'Cancelar SAT'}
              </button>
            )}

            {selectedSat.criado_por !== userId && (selectedSat.status === 'aberto' || selectedSat.status === 'andamento') && (
              <div style={{ textAlign: 'center', padding: 10, fontSize: 11, color: colors.textSubtle, fontStyle: 'italic' }}>
                Apenas quem criou pode cancelar este SAT
              </div>
            )}
          </div>
        </>
      )}

      {/* Create modal */}
      {showModal && (
        <CriarSatModal
          userId={userId}
          userName={userName}
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); carregar() }}
        />
      )}
    </div>
  )
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
      <span style={{ color: colors.textSubtle, fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <span style={{ color: highlight ? '#DC2626' : colors.text, fontWeight: 600, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}

// ========== MODAL CRIAR ==========
function CriarSatModal({ userId, userName, onClose, onCreated }: {
  userId: string; userName: string; onClose: () => void; onCreated: () => void
}) {
  const [clienteNome, setClienteNome] = useState('')
  const [clienteEndereco, setClienteEndereco] = useState('')
  const [clienteCnpj, setClienteCnpj] = useState('')
  const [tipo, setTipo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [dataLimite, setDataLimite] = useState('')
  const [resultados, setResultados] = useState<ClienteBusca[]>([])
  const [buscando, setBuscando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [erro, setErro] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buscaSeqRef = useRef(0)
  const salvandoRef = useRef(false)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const buscarClientes = (termo: string) => {
    setClienteNome(termo)
    setShowResults(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (termo.length < 2) { setResultados([]); return }
    debounceRef.current = setTimeout(async () => {
      // Resposta lenta de uma busca antiga não pode sobrescrever a mais nova
      const seq = ++buscaSeqRef.current
      setBuscando(true)
      try {
        const res = await fetch(`/api/sat?busca=${encodeURIComponent(termo)}`)
        const data = res.ok ? await res.json() : []
        if (seq === buscaSeqRef.current) setResultados(Array.isArray(data) ? data : [])
      } catch { if (seq === buscaSeqRef.current) setResultados([]) }
      if (seq === buscaSeqRef.current) setBuscando(false)
    }, 300)
  }

  const selecionarCliente = (c: ClienteBusca) => {
    setClienteNome(c.nome)
    setClienteEndereco(c.endereco)
    setClienteCnpj(c.cnpj)
    setShowResults(false)
    setResultados([])
  }

  const salvar = async () => {
    if (!clienteNome || !tipo || salvandoRef.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setErro('Sem conexão. Os dados continuam aqui — tente quando o sinal voltar.')
      return
    }
    salvandoRef.current = true
    setSalvando(true)
    setErro('')
    try {
      const res = await fetch('/api/sat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'criar', cliente_nome: clienteNome, cliente_endereco: clienteEndereco,
          cliente_cnpj: clienteCnpj, tipo, descricao, data_limite: dataLimite || null,
          criado_por: userId, criado_por_nome: userName,
        }) })
      // Antes fechava o modal mesmo com erro do servidor → SAT perdido sem aviso
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onCreated()
    } catch (e) {
      console.error(e)
      setErro('Não foi possível abrir o SAT. Verifique a conexão e tente novamente.')
    } finally {
      salvandoRef.current = false
      setSalvando(false)
    }
  }

  const hoje = dataLocalISO()

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1999,
      }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2000,
        background: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.15)', maxHeight: '85vh', overflowY: 'auto', overscrollBehavior: 'contain',
        padding: '12px 16px calc(28px + env(safe-area-inset-bottom, 0px))',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#D1D5DB', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 18, fontWeight: 800, color: colors.text, marginBottom: 16 }}>Novo SAT</div>

        {/* Client search */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Cliente *</label>
          <div style={{ position: 'relative' }}>
            <Search size={15} color="#9CA3AF" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={clienteNome} onChange={e => buscarClientes(e.target.value)}
              placeholder="Buscar cliente por nome ou CNPJ..."
              style={{
                width: '100%', padding: '11px 36px 11px 36px', borderRadius: 10, fontSize: 16,
                border: `1px solid ${colors.borderStrong}`, background: '#FAFAFA',
                boxSizing: 'border-box', fontFamily: 'inherit',
              }} />
            {buscando && <Loader2 size={14} className="spinner" color="#9CA3AF" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }} />}
          </div>
          {showResults && resultados.length > 0 && (
            <div style={{
              background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10,
              marginTop: 4, maxHeight: 200, overflowY: 'auto', boxShadow: shadow.md,
            }}>
              {resultados.map(c => (
                <div key={c.id} onClick={() => selecionarCliente(c)} style={{
                  padding: '12px 14px', cursor: 'pointer', borderBottom: `1px solid ${colors.border}`,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{c.nome}</div>
                  <div style={{ fontSize: 10, color: colors.textSubtle }}>{c.cnpj}{c.cidade ? ` · ${c.cidade}` : ''}</div>
                </div>
              ))}
            </div>
          )}
          {clienteEndereco && (
            <div style={{ fontSize: 10, color: colors.textSubtle, marginTop: 4, paddingLeft: 4 }}>{clienteEndereco}</div>
          )}
        </div>

        {/* Type selector */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Tipo de serviço *</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {Object.entries(TIPOS).map(([key, cfg]) => {
              const Icon = cfg.icon
              const sel = tipo === key
              return (
                <button key={key} onClick={() => setTipo(key)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '12px 10px', borderRadius: 10,
                  border: sel ? `2px solid ${cfg.cor}` : `1px solid ${colors.border}`,
                  background: sel ? cfg.cor + '10' : colors.surface,
                  fontSize: 12, fontWeight: 600, color: sel ? cfg.cor : colors.textMuted,
                }}>
                  <Icon size={16} /> {cfg.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Deadline */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Data limite</label>
          <input type="date" value={dataLimite} min={hoje} onChange={e => setDataLimite(e.target.value)}
            style={{
              width: '100%', padding: '11px 14px', borderRadius: 10, fontSize: 16,
              border: `1px solid ${colors.borderStrong}`, background: '#FAFAFA',
              boxSizing: 'border-box', fontFamily: 'inherit', minHeight: 46,
            }} />
        </div>

        {/* Description */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Observação</label>
          <textarea value={descricao} onChange={e => setDescricao(e.target.value)}
            rows={3} placeholder="Descreva o serviço solicitado..."
            style={{
              width: '100%', padding: '11px 14px', borderRadius: 10, fontSize: 16,
              border: `1px solid ${colors.borderStrong}`, background: '#FAFAFA',
              boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical',
            }} />
        </div>

        {erro && (
          <div style={{ fontSize: 12, color: colors.danger, fontWeight: 600, marginBottom: 12 }}>{erro}</div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 14, borderRadius: 12, border: `1px solid ${colors.border}`,
            background: colors.surface, fontSize: 14, fontWeight: 600, color: colors.textMuted,
          }}>Cancelar</button>
          <button onClick={salvar} disabled={!clienteNome || !tipo || salvando} style={{
            flex: 2, padding: 14, borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 800,
            background: (!clienteNome || !tipo || salvando) ? '#94a3b8' : '#1E3A5F', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            {salvando ? <Loader2 size={16} className="spinner" /> : <Plus size={16} />}
            {salvando ? 'Abrindo...' : 'Abrir SAT'}
          </button>
        </div>
      </div>
    </>
  )
}
