'use client'
import { useState, useEffect, useCallback } from 'react'
import { colors, shadow } from '@/lib/ui'
import {
  Building2, Search, ChevronLeft, ChevronDown, ChevronUp, Phone, Mail, MapPin,
  FileText, DollarSign, Tag, Loader2, ClipboardList, ShoppingCart,
  FolderOpen, ExternalLink, X, Filter, Wrench, Package, Hash, User,
} from 'lucide-react'

interface Cliente {
  cod_cli: number; empresa: string; razao_social: string; nome_fantasia: string
  cnpj_cpf: string; cidade: string; estado: string; telefone: string; email: string
  inativo: string; total_os: number; total_valor: number; os_ativas: number
  projetos: { codigo: string; nome: string }[]
}

interface Etiqueta { id: number; nome: string; cor: string }
interface EtiquetaMap { cnpj_cpf: string; etiqueta_id: number }

interface OrdemServico {
  num_os: string; cod_os: string; empresa: string; cod_cli: number; cliente_nome: string
  etapa: string; data_previsao: string; data_inclusao: string; data_faturamento: string
  valor_total: number; status: string; cancelada: boolean; faturada: boolean
  num_pedido_cli: string; vendedor: string; cidade: string; contrato: string; projeto: string
  num_nf: string; link_nf: string; servicos: any; obs: string; dados_adic: string
}

interface PedidoVenda {
  num_pedido: string; cod_pedido: string; empresa: string; cod_cli: number
  cliente_nome: string; data_previsao: string; data_inclusao: string
  etapa: string; valor_total: number; cancelado: boolean; faturado: boolean
  numero_nf: string; link_nf: string; itens: any; observacoes: string
}

function fmtCnpj(v: string) {
  if (!v) return ''
  const n = v.replace(/\D/g, '')
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return v
}

function fmtMoeda(v: number) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtData(iso: string) {
  if (!iso) return '--'
  return new Date(iso).toLocaleDateString('pt-BR')
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([])
  const [etiquetasMapa, setEtiquetasMapa] = useState<EtiquetaMap[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [empresaFilter, setEmpresaFilter] = useState('')
  const [selected, setSelected] = useState<Cliente | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/clientes')
      const data = await res.json()
      setClientes(data.clientes || [])
      setEtiquetas(data.etiquetas || [])
      setEtiquetasMapa(data.etiquetasMapa || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const empresas = [...new Set(clientes.map(c => c.empresa))].sort()

  const filtrados = clientes.filter(c => {
    if (empresaFilter && c.empresa !== empresaFilter) return false
    if (!search) return true
    const s = search.toLowerCase()
    const nome = (c.nome_fantasia || c.razao_social || '').toLowerCase()
    const cnpj = (c.cnpj_cpf || '').toLowerCase()
    const cidade = (c.cidade || '').toLowerCase()
    const proj = (c.projetos || []).some(p => (p.nome || '').toLowerCase().includes(s))
    return nome.includes(s) || cnpj.includes(s) || cidade.includes(s) || proj
  })

  const getTagsCliente = (cnpj: string) => {
    const ids = etiquetasMapa.filter(m => m.cnpj_cpf === cnpj).map(m => m.etiqueta_id)
    return etiquetas.filter(e => ids.includes(e.id))
  }

  if (selected) {
    return <ClienteDetalhe
      cliente={selected}
      etiquetas={etiquetas}
      etiquetasMapa={etiquetasMapa}
      onBack={() => setSelected(null)}
      onTagsChange={(mapa) => setEtiquetasMapa(mapa)}
    />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Building2 size={22} color="#2563EB" />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>Clientes</div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>{filtrados.length} clientes</div>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search size={16} color="#9CA3AF" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar nome, CNPJ, cidade, projeto..."
          style={{
            width: '100%', padding: '11px 14px 11px 38px', borderRadius: 12, fontSize: 14,
            border: `1px solid ${colors.borderStrong}`, background: colors.surface,
            boxSizing: 'border-box', fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Empresa filter */}
      {empresas.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => setEmpresaFilter('')} style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: 'none',
            background: !empresaFilter ? '#1E3A5F' : colors.surfaceAlt,
            color: !empresaFilter ? '#fff' : colors.textMuted,
          }}>Todas</button>
          {empresas.map(e => (
            <button key={e} onClick={() => setEmpresaFilter(e)} style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: 'none',
              background: empresaFilter === e ? '#1E3A5F' : colors.surfaceAlt,
              color: empresaFilter === e ? '#fff' : colors.textMuted,
            }}>{e}</button>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Loader2 size={28} color="#1E3A5F" className="spinner" style={{ margin: '0 auto' }} />
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 8 }}>Carregando clientes...</div>
        </div>
      )}

      {/* List */}
      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtrados.slice(0, 100).map(c => {
            const tags = getTagsCliente(c.cnpj_cpf)
            return (
              <div key={`${c.cod_cli}-${c.empresa}`} onClick={() => setSelected(c)} style={{
                background: colors.surface, borderRadius: 14, padding: '14px', cursor: 'pointer',
                border: `1px solid ${colors.border}`, boxShadow: shadow.sm,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: c.total_os > 0 ? '#DBEAFE' : colors.surfaceAlt,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Building2 size={18} color={c.total_os > 0 ? '#2563EB' : '#9CA3AF'} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, lineHeight: 1.3 }}>
                      {c.nome_fantasia || c.razao_social}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textSubtle, marginTop: 2 }}>
                      {fmtCnpj(c.cnpj_cpf)}{c.cidade ? ` · ${c.cidade}` : ''}{c.estado ? `/${c.estado}` : ''}
                    </div>
                    {tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                        {tags.map(t => (
                          <span key={t.id} style={{
                            fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                            background: t.cor + '20', color: t.cor, border: `1px solid ${t.cor}40`,
                          }}>{t.nome}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {c.total_os > 0 && (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 800, color: colors.text }}>{c.total_os}</div>
                        <div style={{ fontSize: 9, color: colors.textSubtle }}>OS</div>
                      </>
                    )}
                  </div>
                </div>
                {/* Bottom stats */}
                {c.total_os > 0 && (
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${colors.border}` }}>
                    <span style={{ fontSize: 10, color: colors.textMuted }}>
                      <span style={{ fontWeight: 700, color: colors.success }}>{c.os_ativas}</span> ativas
                    </span>
                    <span style={{ fontSize: 10, color: colors.textMuted }}>
                      {fmtMoeda(c.total_valor)}
                    </span>
                    {c.projetos.length > 0 && (
                      <span style={{ fontSize: 10, color: '#8B5CF6', fontWeight: 600 }}>
                        {c.projetos.length} projeto(s)
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {filtrados.length > 100 && (
            <div style={{ textAlign: 'center', padding: 12, fontSize: 12, color: colors.textMuted }}>
              Mostrando 100 de {filtrados.length} — refine a busca
            </div>
          )}

          {filtrados.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: 30, color: colors.textSubtle, fontSize: 13, background: colors.surfaceAlt, borderRadius: 12, border: `1px solid ${colors.border}` }}>
              Nenhum cliente encontrado
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ========== DETALHE ==========
function ClienteDetalhe({ cliente, etiquetas, etiquetasMapa, onBack, onTagsChange }: {
  cliente: Cliente; etiquetas: Etiqueta[]; etiquetasMapa: EtiquetaMap[]
  onBack: () => void; onTagsChange: (m: EtiquetaMap[]) => void
}) {
  const [ordens, setOrdens] = useState<OrdemServico[]>([])
  const [pedidos, setPedidos] = useState<PedidoVenda[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'os' | 'pv' | 'proj'>('os')
  const [expandedOS, setExpandedOS] = useState<string | null>(null)
  const [expandedPV, setExpandedPV] = useState<string | null>(null)
  const [showTagPicker, setShowTagPicker] = useState(false)

  // Projeto modal state
  const [projetoModal, setProjetoModal] = useState<string | null>(null)
  const [projetoData, setProjetoData] = useState<any>(null)
  const [projetoLoading, setProjetoLoading] = useState(false)
  const [projetoTab, setProjetoTab] = useState('resumo')

  const abrirProjeto = async (nome: string) => {
    setProjetoModal(nome)
    setProjetoLoading(true)
    setProjetoData(null)
    setProjetoTab('resumo')
    try {
      const res = await fetch(`/api/clientes/projeto?nome=${encodeURIComponent(nome)}&empresa=${encodeURIComponent(cliente.empresa)}`)
      const data = await res.json()
      setProjetoData(data)
    } catch {}
    setProjetoLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    fetch(`/api/clientes?codCli=${cliente.cod_cli}&empresa=${encodeURIComponent(cliente.empresa)}`)
      .then(r => r.json())
      .then(data => {
        setOrdens(data.ordens || [])
        setPedidos(data.pedidos || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [cliente])

  const clienteTags = etiquetasMapa
    .filter(m => m.cnpj_cpf === cliente.cnpj_cpf)
    .map(m => etiquetas.find(e => e.id === m.etiqueta_id))
    .filter(Boolean) as Etiqueta[]

  const addTag = async (etId: number) => {
    await fetch('/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'salvar_etiqueta', cnpj_cpf: cliente.cnpj_cpf, etiqueta_id: etId }) })
    onTagsChange([...etiquetasMapa, { cnpj_cpf: cliente.cnpj_cpf, etiqueta_id: etId }])
  }

  const removeTag = async (etId: number) => {
    await fetch('/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'remover_etiqueta', cnpj_cpf: cliente.cnpj_cpf, etiqueta_id: etId }) })
    onTagsChange(etiquetasMapa.filter(m => !(m.cnpj_cpf === cliente.cnpj_cpf && m.etiqueta_id === etId)))
  }

  const osOrdenadas = [...ordens].sort((a, b) => (b.data_previsao || b.data_inclusao || '').localeCompare(a.data_previsao || a.data_inclusao || ''))
  const pvOrfas = pedidos.filter(p => !ordens.some(os => String(os.num_pedido_cli) === String(p.num_pedido)))
    .sort((a, b) => (b.data_previsao || b.data_inclusao || '').localeCompare(a.data_previsao || a.data_inclusao || ''))

  const totalOS = ordens.length
  const osAtivas = ordens.filter(o => !o.cancelada).length
  const osFaturadas = ordens.filter(o => o.faturada).length
  const valorOS = ordens.reduce((s, o) => s + (o.valor_total || 0), 0)
  const valorPV = pedidos.reduce((s, p) => s + (p.valor_total || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Back */}
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
        fontSize: 13, fontWeight: 600, color: '#2563EB', cursor: 'pointer', padding: 0,
      }}>
        <ChevronLeft size={16} /> Voltar
      </button>

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1E3A5F 0%, #2563EB 100%)',
        borderRadius: 16, padding: '20px 16px', color: '#fff',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.3 }}>
          {cliente.nome_fantasia || cliente.razao_social}
        </div>
        {cliente.razao_social && cliente.nome_fantasia && cliente.razao_social !== cliente.nome_fantasia && (
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{cliente.razao_social}</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12, fontSize: 11, opacity: 0.85 }}>
          {cliente.cnpj_cpf && <span>{fmtCnpj(cliente.cnpj_cpf)}</span>}
          {cliente.cidade && <span><MapPin size={10} style={{ verticalAlign: -1 }} /> {cliente.cidade}/{cliente.estado}</span>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6, fontSize: 11, opacity: 0.85 }}>
          {cliente.telefone && <span><Phone size={10} style={{ verticalAlign: -1 }} /> {cliente.telefone}</span>}
          {cliente.email && <span><Mail size={10} style={{ verticalAlign: -1 }} /> {cliente.email}</span>}
        </div>
        <div style={{ marginTop: 6, fontSize: 10, opacity: 0.6 }}>{cliente.empresa}</div>
      </div>

      {/* Tags */}
      <div style={{ background: colors.surface, borderRadius: 14, padding: '12px 14px', border: `1px solid ${colors.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase' }}>Etiquetas</span>
          <button onClick={() => setShowTagPicker(!showTagPicker)} style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6,
            border: `1px solid ${colors.border}`, background: colors.surfaceAlt, fontSize: 10, fontWeight: 600, color: colors.textMuted,
          }}>
            <Tag size={11} /> {showTagPicker ? 'Fechar' : 'Editar'}
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {clienteTags.length === 0 && <span style={{ fontSize: 11, color: colors.textSubtle, fontStyle: 'italic' }}>Sem etiquetas</span>}
          {clienteTags.map(t => (
            <span key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700,
              padding: '3px 8px', borderRadius: 6, background: t.cor + '20', color: t.cor, border: `1px solid ${t.cor}40`,
            }}>
              {t.nome}
              {showTagPicker && (
                <button onClick={() => removeTag(t.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 1 }}>
                  <X size={10} color={t.cor} />
                </button>
              )}
            </span>
          ))}
        </div>
        {showTagPicker && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${colors.border}`, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {etiquetas.filter(e => !clienteTags.some(ct => ct.id === e.id)).map(e => (
              <button key={e.id} onClick={() => addTag(e.id)} style={{
                fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                border: `1px dashed ${e.cor}60`, background: 'transparent', color: e.cor, cursor: 'pointer',
              }}>+ {e.nome}</button>
            ))}
          </div>
        )}
      </div>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <MiniCard label="Total OS" value={String(totalOS)} color="#3B82F6" />
        <MiniCard label="Ativas" value={String(osAtivas)} color="#16A34A" />
        <MiniCard label="Faturadas" value={String(osFaturadas)} color="#8B5CF6" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <MiniCard label="Valor OS" value={fmtMoeda(valorOS)} color="#F59E0B" />
        <MiniCard label="Valor PV" value={fmtMoeda(valorPV)} color="#EC4899" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, background: colors.surfaceAlt, borderRadius: 10, padding: 3 }}>
        {([
          ['os', `OS (${ordens.length})`, ClipboardList],
          ['pv', `PV (${pvOrfas.length})`, ShoppingCart],
          ['proj', `Proj (${cliente.projetos.length})`, FolderOpen],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key as any)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '9px 0', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700,
            background: tab === key ? '#1E3A5F' : 'transparent',
            color: tab === key ? '#fff' : colors.textMuted,
          }}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && <div style={{ padding: 30, textAlign: 'center' }}><Loader2 size={24} className="spinner" color="#1E3A5F" /></div>}

      {/* OS Tab */}
      {!loading && tab === 'os' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {osOrdenadas.length === 0 && <EmptyMsg text="Nenhuma OS encontrada" />}
          {osOrdenadas.map(os => {
            const isExp = expandedOS === os.num_os
            const statusCor = os.cancelada ? '#EF4444' : os.faturada ? '#8B5CF6' : '#16A34A'
            const statusTxt = os.cancelada ? 'Cancelada' : os.faturada ? 'Faturada' : 'Ativa'
            const descricao = (os.servicos && Array.isArray(os.servicos))
              ? os.servicos.map((s: any) => s.descricao || s.cDescricao || '').filter(Boolean).join(', ')
              : os.obs || ''

            return (
              <div key={os.num_os} style={{
                background: colors.surface, borderRadius: 12, overflow: 'hidden',
                border: `1px solid ${colors.border}`, boxShadow: shadow.sm,
              }}>
                <div onClick={() => setExpandedOS(isExp ? null : os.num_os)} style={{
                  padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: colors.text }}>OS {os.num_os}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: statusCor + '15', color: statusCor }}>{statusTxt}</span>
                      {os.num_pedido_cli && <span style={{ fontSize: 9, color: colors.textSubtle }}>PV {os.num_pedido_cli}</span>}
                    </div>
                    {descricao && <div style={{ fontSize: 11, color: colors.textSubtle, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{descricao}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>{fmtMoeda(os.valor_total)}</div>
                    <div style={{ fontSize: 9, color: colors.textSubtle }}>{fmtData(os.data_previsao)}</div>
                  </div>
                  <ChevronDown size={14} color="#9CA3AF" style={{ transform: isExp ? 'rotate(180deg)' : 'none', transition: '.15s', flexShrink: 0 }} />
                </div>

                {isExp && (
                  <div style={{ borderTop: `1px solid ${colors.border}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <InfoRow label="Inclusão" value={fmtData(os.data_inclusao)} />
                    <InfoRow label="Previsão" value={fmtData(os.data_previsao)} />
                    {os.data_faturamento && <InfoRow label="Faturamento" value={fmtData(os.data_faturamento)} />}
                    {os.vendedor && <InfoRow label="Vendedor" value={os.vendedor} />}
                    {os.cidade && <InfoRow label="Cidade" value={os.cidade} />}
                    {os.projeto && <InfoRow label="Projeto" value={os.projeto} />}
                    {os.num_nf && <InfoRow label="NF" value={os.num_nf} />}

                    {/* Servicos */}
                    {os.servicos && Array.isArray(os.servicos) && os.servicos.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', marginBottom: 4 }}>Serviços</div>
                        {os.servicos.map((s: any, i: number) => (
                          <div key={i} style={{ fontSize: 11, color: colors.text, padding: '4px 0', borderBottom: i < os.servicos.length - 1 ? `1px solid ${colors.border}` : 'none' }}>
                            <span>{s.descricao || s.cDescricao}</span>
                            {(s.valor || s.nValUnit) && <span style={{ float: 'right', fontWeight: 600 }}>{fmtMoeda(s.valor || s.nValUnit)}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {os.obs && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', marginBottom: 4 }}>Observações</div>
                        <div style={{ fontSize: 11, color: colors.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{os.obs}</div>
                      </div>
                    )}

                    {os.link_nf && (
                      <a href={os.link_nf} target="_blank" rel="noopener noreferrer" style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        padding: 10, borderRadius: 8, background: '#EFF6FF', border: '1px solid #BFDBFE',
                        fontSize: 12, fontWeight: 600, color: '#2563EB', textDecoration: 'none',
                      }}>
                        <ExternalLink size={13} /> Abrir NF
                      </a>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* PV Tab */}
      {!loading && tab === 'pv' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pvOrfas.length === 0 && <EmptyMsg text="Nenhum PV avulso encontrado" />}
          {pvOrfas.map(pv => {
            const isExp = expandedPV === pv.num_pedido
            const statusCor = pv.cancelado ? '#EF4444' : pv.faturado ? '#8B5CF6' : '#16A34A'
            const statusTxt = pv.cancelado ? 'Cancelado' : pv.faturado ? 'Faturado' : pv.etapa || 'Ativo'

            return (
              <div key={pv.num_pedido} style={{
                background: colors.surface, borderRadius: 12, overflow: 'hidden',
                border: `1px solid ${colors.border}`, boxShadow: shadow.sm,
              }}>
                <div onClick={() => setExpandedPV(isExp ? null : pv.num_pedido)} style={{
                  padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: colors.text }}>PV {pv.num_pedido}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: statusCor + '15', color: statusCor }}>{statusTxt}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>{fmtMoeda(pv.valor_total)}</div>
                    <div style={{ fontSize: 9, color: colors.textSubtle }}>{fmtData(pv.data_previsao)}</div>
                  </div>
                  <ChevronDown size={14} color="#9CA3AF" style={{ transform: isExp ? 'rotate(180deg)' : 'none', transition: '.15s', flexShrink: 0 }} />
                </div>

                {isExp && (
                  <div style={{ borderTop: `1px solid ${colors.border}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <InfoRow label="Inclusão" value={fmtData(pv.data_inclusao)} />
                    <InfoRow label="Previsão" value={fmtData(pv.data_previsao)} />
                    {pv.etapa && <InfoRow label="Etapa" value={pv.etapa} />}
                    {pv.numero_nf && <InfoRow label="NF" value={pv.numero_nf} />}

                    {pv.itens && Array.isArray(pv.itens) && pv.itens.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', marginBottom: 4 }}>Itens</div>
                        {pv.itens.map((it: any, i: number) => (
                          <div key={i} style={{ fontSize: 11, color: colors.text, padding: '4px 0', borderBottom: i < pv.itens.length - 1 ? `1px solid ${colors.border}` : 'none' }}>
                            <span>{it.descricao || it.cDescricao || `Item ${i + 1}`}</span>
                            {(it.valor || it.nValUnit) && <span style={{ float: 'right', fontWeight: 600 }}>{fmtMoeda(it.valor || it.nValUnit)}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {pv.observacoes && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', marginBottom: 4 }}>Observações</div>
                        <div style={{ fontSize: 11, color: colors.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{pv.observacoes}</div>
                      </div>
                    )}

                    {pv.link_nf && (
                      <a href={pv.link_nf} target="_blank" rel="noopener noreferrer" style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        padding: 10, borderRadius: 8, background: '#EFF6FF', border: '1px solid #BFDBFE',
                        fontSize: 12, fontWeight: 600, color: '#2563EB', textDecoration: 'none',
                      }}>
                        <ExternalLink size={13} /> Abrir NF
                      </a>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Projetos Tab */}
      {!loading && tab === 'proj' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cliente.projetos.length === 0 && <EmptyMsg text="Nenhum projeto vinculado" />}
          {cliente.projetos.map(p => (
            <div key={p.codigo} onClick={() => abrirProjeto(p.nome)} style={{
              background: colors.surface, borderRadius: 12, padding: '14px', cursor: 'pointer',
              border: `1px solid ${colors.border}`, boxShadow: shadow.sm,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: '#F3E8FF',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <FolderOpen size={16} color="#8B5CF6" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{p.nome}</div>
                <div style={{ fontSize: 10, color: colors.textSubtle }}>Código: {p.codigo}</div>
              </div>
              <ChevronDown size={14} color="#9CA3AF" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }} />
            </div>
          ))}
        </div>
      )}

      {/* Modal Projeto */}
      {projetoModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setProjetoModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 540,
            maxHeight: '94vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ padding: '18px 20px', background: 'linear-gradient(135deg, #1E3A5F 0%, #2563EB 100%)', color: '#fff', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FolderOpen size={20} />
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>{projetoModal}</div>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>{cliente.empresa}</div>
                  </div>
                </div>
                <button onClick={() => setProjetoModal(null)} style={{
                  background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, padding: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <X size={16} color="#fff" />
                </button>
              </div>
            </div>

            {projetoLoading ? (
              <div style={{ padding: 60, textAlign: 'center' }}>
                <Loader2 size={24} className="spinner" color="#1E3A5F" />
                <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 8 }}>Carregando projeto...</div>
              </div>
            ) : !projetoData ? (
              <div style={{ padding: 60, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>Erro ao carregar</div>
            ) : <ProjetoConteudo data={projetoData} tab={projetoTab} setTab={setProjetoTab} />}
          </div>
        </div>
      )}
    </div>
  )
}

// ========== PROJETO CONTEUDO ==========
type ProjetoTabId = 'resumo' | 'donos' | 'servicos' | 'pecas'

function ProjetoConteudo({ data, tab, setTab }: { data: any; tab: string; setTab: (t: string) => void }) {
  const [expandedDono, setExpandedDono] = useState<number | null>(null)
  const resumo = data.resumo || {}
  const chassis: any[] = data.chassis || []
  const donos: any[] = data.donos || []
  const osProj: any[] = data.ordens || []
  const servicosList: any[] = data.servicos || []
  const pecasList: any[] = data.pecas || []

  const servicosAgrupados = (() => {
    const m = new Map<string, { num_os: string; linhas: any[]; valor: number; data: string; cliente: string }>()
    for (const s of servicosList) {
      const k = String(s.num_os)
      let e = m.get(k)
      if (!e) { e = { num_os: s.num_os, linhas: [] as any[], valor: 0, data: s.data, cliente: s.cliente }; m.set(k, e) }
      e.linhas.push(s); e.valor += s.valor || 0
    }
    return Array.from(m.values())
  })()

  const pecasAgrupadas = (() => {
    const m = new Map<string, { num_pv: string; itens: any[]; valor: number; cliente: string; data: string }>()
    for (const p of pecasList) {
      const k = String(p.num_pv)
      let e = m.get(k)
      if (!e) { e = { num_pv: p.num_pv, itens: [] as any[], valor: 0, cliente: p.cliente, data: p.data }; m.set(k, e) }
      e.itens.push(p); e.valor += p.valor_total || 0
    }
    return Array.from(m.values())
  })()

  const osDoDono = (codCli: number) => osProj.filter((o: any) => o.cod_cli === codCli)

  const tabs: { id: ProjetoTabId; label: string; count: number | null }[] = [
    { id: 'resumo', label: 'Resumo', count: null },
    { id: 'donos', label: 'Donos', count: donos.length },
    { id: 'servicos', label: 'Serviços', count: servicosList.length },
    { id: 'pecas', label: 'Peças', count: pecasList.length },
  ]

  return (
    <>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${colors.border}`, background: colors.surfaceAlt, flexShrink: 0, overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '10px 14px', border: 'none',
            borderBottom: tab === t.id ? '2px solid #2563EB' : '2px solid transparent',
            background: 'none', fontSize: 11, fontWeight: tab === t.id ? 700 : 500,
            color: tab === t.id ? '#2563EB' : colors.textMuted, whiteSpace: 'nowrap',
          }}>
            {t.label}
            {t.count !== null && t.count > 0 && (
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 8, background: tab === t.id ? '#EFF6FF' : colors.surface, color: tab === t.id ? '#2563EB' : colors.textSubtle, fontWeight: 700 }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {/* RESUMO */}
        {tab === 'resumo' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              padding: '12px 14px', background: '#F8FAFC', border: `1px solid ${colors.border}`,
              borderRadius: 12, fontSize: 13, color: '#374151', lineHeight: 1.6,
            }}>
              Este projeto teve <strong style={{ color: '#2563EB' }}>{resumo.total_os || 0}</strong> {(resumo.total_os || 0) === 1 ? 'OS' : 'OS'}, <strong style={{ color: '#EA580C' }}>{resumo.total_pv || 0}</strong> PV e faturou <strong style={{ color: '#059669' }}>{fmtMoeda(resumo.valor_total_os || 0)}</strong> em serviços.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { l: 'Ordens de Serviço', v: String(resumo.total_os || 0), c: '#2563EB', bg: '#EFF6FF' },
                { l: 'Valor Serviços', v: fmtMoeda(resumo.valor_total_os || 0), c: '#059669', bg: '#ECFDF5' },
                { l: 'Pedidos de Venda', v: String(resumo.total_pv || 0), c: '#EA580C', bg: '#FFF7ED' },
                { l: 'Valor PV', v: fmtMoeda(resumo.valor_total_pv || 0), c: '#EC4899', bg: '#FDF2F8' },
              ].map((f, i) => (
                <div key={i} style={{ padding: '12px', border: `1px solid ${colors.border}`, borderRadius: 12, background: f.bg }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{f.l}</div>
                  <div style={{ fontSize: 18, color: f.c, fontWeight: 800 }}>{f.v}</div>
                </div>
              ))}
            </div>

            {/* Chassis */}
            {chassis.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Chassis ({chassis.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {chassis.map((ch: any, i: number) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      border: `1px solid ${colors.border}`, borderRadius: 10, background: colors.surface,
                    }}>
                      <Hash size={14} color="#2563EB" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, fontFamily: 'monospace' }}>{ch.chassis}</div>
                        <div style={{ fontSize: 10, color: colors.textSubtle }}>{ch.modelo || 'Modelo não informado'}{ch.cliente_nome ? ` — ${ch.cliente_nome}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* DONOS */}
        {tab === 'donos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {donos.length === 0 && <EmptyMsg text="Nenhum dono encontrado" />}
            {donos.map((dono: any, di: number) => {
              const aberto = expandedDono === dono.cod_cli
              const oss = osDoDono(dono.cod_cli)
              return (
                <div key={di} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.surface, overflow: 'hidden' }}>
                  <div onClick={() => setExpandedDono(aberto ? null : dono.cod_cli)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer',
                    background: aberto ? '#F8FAFC' : colors.surface,
                  }}>
                    <User size={18} color={di === 0 ? '#2563EB' : '#9CA3AF'} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{dono.nome || 'Sem nome'}</span>
                        {di === 0 && <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#EFF6FF', color: '#2563EB' }}>ATUAL</span>}
                      </div>
                      <div style={{ fontSize: 10, color: colors.textSubtle }}>{dono.cidade ? `${dono.cidade}/${dono.estado}` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{dono.total_os} OS</div>
                      <div style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>{fmtMoeda(dono.total_valor)}</div>
                    </div>
                    {aberto ? <ChevronUp size={14} color="#9CA3AF" /> : <ChevronDown size={14} color="#9CA3AF" />}
                  </div>
                  {aberto && (
                    <div style={{ borderTop: `1px solid ${colors.border}`, padding: 8, background: '#F9FAFB' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: colors.textSubtle, padding: '4px 8px', textTransform: 'uppercase' }}>OS deste dono</div>
                      {oss.length === 0 ? <div style={{ padding: 12, fontSize: 11, color: colors.textSubtle }}>Nenhuma OS</div> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {oss.map((os: any) => (
                            <div key={os.num_os} style={{
                              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                              background: colors.surface, borderRadius: 8, border: `1px solid ${colors.border}`,
                            }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>OS {os.num_os}</span>
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4,
                                background: os.cancelada ? '#FEE2E2' : os.faturada ? '#F3E8FF' : '#DCFCE7',
                                color: os.cancelada ? '#EF4444' : os.faturada ? '#8B5CF6' : '#16A34A',
                              }}>{os.cancelada ? 'Canc.' : os.faturada ? 'Fat.' : 'Ativa'}</span>
                              <span style={{ flex: 1 }} />
                              <span style={{ fontSize: 11, fontWeight: 600, color: colors.text }}>{fmtMoeda(os.valor_total || 0)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* SERVICOS */}
        {tab === 'servicos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {servicosAgrupados.length === 0 && <EmptyMsg text="Nenhum serviço encontrado" />}
            {servicosAgrupados.map((g, i) => (
              <div key={i} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.surface, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${colors.border}`, background: '#F8FAFC' }}>
                  <Wrench size={13} color="#2563EB" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>OS {g.num_os}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>{fmtMoeda(g.valor)}</span>
                </div>
                <div style={{ padding: '8px 14px' }}>
                  {g.linhas.map((s: any, j: number) => (
                    <div key={j} style={{ padding: '6px 0', borderBottom: j < g.linhas.length - 1 ? `1px solid ${colors.border}` : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ fontSize: 11, color: colors.text, flex: 1, lineHeight: 1.5 }}>{s.desc}</span>
                      {s.valor > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: colors.text, flexShrink: 0 }}>{fmtMoeda(s.valor)}</span>}
                    </div>
                  ))}
                  <div style={{ fontSize: 10, color: colors.textSubtle, marginTop: 4 }}>{g.cliente} · {fmtData(g.data)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* PECAS */}
        {tab === 'pecas' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pecasAgrupadas.length === 0 && <EmptyMsg text="Nenhuma peça encontrada" />}
            {pecasAgrupadas.map((g, i) => (
              <div key={i} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.surface, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${colors.border}`, background: '#FFF7ED' }}>
                  <Package size={13} color="#EA580C" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>PV {g.num_pv}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#EA580C' }}>{fmtMoeda(g.valor)}</span>
                </div>
                <div style={{ padding: '8px 14px' }}>
                  {g.itens.map((p: any, j: number) => (
                    <div key={j} style={{ padding: '6px 0', borderBottom: j < g.itens.length - 1 ? `1px solid ${colors.border}` : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: colors.text, lineHeight: 1.5 }}>{p.desc}</div>
                        {p.codigo && <div style={{ fontSize: 9, color: colors.textSubtle }}>Cód: {p.codigo} · Qtd: {p.quantidade}</div>}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: colors.text, flexShrink: 0 }}>{fmtMoeda(p.valor_total)}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 10, color: colors.textSubtle, marginTop: 4 }}>{g.cliente} · {fmtData(g.data)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function MiniCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: colors.surface, borderRadius: 10, padding: '10px 8px', textAlign: 'center',
      border: `1px solid ${colors.border}`,
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 9, fontWeight: 600, color: colors.textSubtle }}>{label}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
      <span style={{ color: colors.textSubtle, fontWeight: 600 }}>{label}</span>
      <span style={{ color: colors.text, fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function EmptyMsg({ text }: { text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 24, color: colors.textSubtle, fontSize: 12, background: colors.surfaceAlt, borderRadius: 12, border: `1px solid ${colors.border}` }}>
      {text}
    </div>
  )
}
