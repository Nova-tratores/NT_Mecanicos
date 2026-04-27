'use client'
import { useState, useEffect, useMemo } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { useDebounce } from '@/hooks/useDebounce'
import { supabase } from '@/lib/supabase'
import type { OrdemServico } from '@/lib/types'
import {
  Wrench, FileText, AlertTriangle, FileCheck, Clock, MapPin, CheckCircle2, Send,
  Calendar, Package, ChevronDown, ChevronUp, User, Clipboard, Info,
} from 'lucide-react'
import {
  PageHeader, StatCard, TabBar, ListRow, EmptyState, PageSpinner,
  Badge, Section, SearchInput, Card,
} from '@/components/ui'
import { colors, radius, text } from '@/lib/ui'

/* ═══ Tipos ═══ */
interface OsData {
  ordens: OrdemServico[]
  preenchidas: Set<string>
  enviadas: Set<string>
  cidadeMap: Record<string, string>
  enviadasCount: number
  agendaMap: Record<string, string[]> // Id_Ordem → datas agendadas
}

interface PecaPPV {
  CodProduto: string
  Descricao: string
  Qtde: string
  Preco: number
}

/* ═══ Fetch principal ═══ */
async function fetchOsData(nome: string): Promise<OsData> {
  const [osRes, envRes] = await Promise.all([
    supabase
      .from('Ordem_Servico')
      .select('*')
      .not('Status', 'in', '("Concluída","Cancelada","Concluida","cancelada")')
      .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
      .order('Id_Ordem', { ascending: false }),
    supabase
      .from('Ordem_Servico_Tecnicos')
      .select('id', { count: 'exact', head: true })
      .ilike('TecResp1', nome)
      .eq('Status', 'enviado'),
  ])

  const todas = (osRes.data || []) as OrdemServico[]

  let preenchidas = new Set<string>()
  let enviadas = new Set<string>()
  const cidadeMap: Record<string, string> = {}
  const agendaMap: Record<string, string[]> = {}

  if (todas.length > 0) {
    const ids = todas.map(o => o.Id_Ordem)
    const cnpjs = [...new Set(todas.map(o => o.Cnpj_Cliente).filter(Boolean))]
    const [preenchRes, cliRes, agendaRes] = await Promise.all([
      supabase.from('Ordem_Servico_Tecnicos').select('Ordem_Servico, Status').in('Ordem_Servico', ids),
      cnpjs.length > 0
        ? supabase.from('Clientes').select('cnpj_cpf, cidade').in('cnpj_cpf', cnpjs)
        : Promise.resolve({ data: null }),
      supabase
        .from('agenda_tecnico')
        .select('id_ordem, data_agendada')
        .in('id_ordem', ids)
        .not('status', 'eq', 'cancelado'),
    ])
    if (preenchRes.data) {
      preenchidas = new Set(preenchRes.data.map((p: { Ordem_Servico: string }) => p.Ordem_Servico))
      enviadas = new Set(
        preenchRes.data
          .filter((p: { Status: string }) => p.Status === 'enviado')
          .map((p: { Ordem_Servico: string }) => p.Ordem_Servico),
      )
    }
    cliRes.data?.forEach((c: { cnpj_cpf: string; cidade: string | null }) => {
      if (c.cidade) cidadeMap[c.cnpj_cpf] = c.cidade
    })
    agendaRes.data?.forEach((a: { id_ordem: string; data_agendada: string }) => {
      if (!agendaMap[a.id_ordem]) agendaMap[a.id_ordem] = []
      agendaMap[a.id_ordem].push(a.data_agendada)
    })
  }

  return { ordens: todas, preenchidas, enviadas, cidadeMap, enviadasCount: envRes.count || 0, agendaMap }
}

/* ═══ Helpers ═══ */
function getHoje() {
  return new Date().toISOString().split('T')[0]
}

function formatarData(d: string) {
  const [ano, mes, dia] = d.split('-')
  return `${dia}/${mes}`
}

function formatarDataCompleta(d: string) {
  const date = new Date(d + 'T12:00:00')
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
}

/* ═══ Helpers de fase ═══ */
const FASES_EXECUCAO = ['Execução', 'Execução Procurando peças', 'Execução aguardando peças (em transporte)']
const FASES_AGUARDANDO = ['Aguardando outros', 'Aguardando ordem Técnico', 'Relatório Concluído', 'Executada aguardando comercial']

function getFaseInfo(status: string): { label: string; color: string; bg: string } {
  if (FASES_EXECUCAO.includes(status)) {
    if (status.includes('peças')) return { label: 'Aguardando peças', color: colors.warning, bg: colors.warningBg }
    return { label: 'Em execução', color: colors.info, bg: colors.infoBg }
  }
  if (status === 'Aguardando ordem Técnico') return { label: 'Aguard. ordem técnico', color: '#7C3AED', bg: '#F5F3FF' }
  if (status === 'Relatório Concluído') return { label: 'Rel. Concluído', color: colors.warning, bg: colors.warningBg }
  if (status === 'Executada aguardando comercial') return { label: 'Aguard. comercial', color: colors.warning, bg: colors.warningBg }
  if (status === 'Aguardando outros') return { label: 'Aguardando', color: colors.textMuted, bg: colors.border }
  if (status.includes('Orçamento')) return { label: 'Orçamento', color: colors.accent, bg: colors.accentBg }
  return { label: status, color: colors.textMuted, bg: colors.border }
}

/* ═══ Card de OS compacto (Preencher) ═══ */
function OsCard({
  os,
  cidade,
  preenchida,
}: {
  os: OrdemServico
  cidade?: string
  preenchida: boolean
}) {
  const fase = getFaseInfo(os.Status)

  return (
    <ListRow
      href={`/os/${os.Id_Ordem}`}
      icon={preenchida ? CheckCircle2 : FileText}
      iconColor={preenchida ? colors.success : colors.warning}
      iconBg={preenchida ? colors.successBg : colors.warningBg}
      badge={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.primary }}>
            {os.Id_Ordem}
          </span>
          <Badge status={preenchida ? 'preenchida' : 'pendente'}>
            {preenchida ? 'Preenchida' : 'Pendente'}
          </Badge>
          <Badge bg={fase.bg} color={fase.color}>{fase.label}</Badge>
        </div>
      }
      title={os.Os_Cliente}
      meta={
        <>
          {cidade && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: colors.accent, fontWeight: 600 }}>
              <MapPin size={11} /> {cidade}
            </span>
          )}
          <span>{os.Tipo_Servico}{os.ID_PPV ? ` · ${os.ID_PPV}` : ''}</span>
        </>
      }
    />
  )
}

/* ═══ Card detalhado (Ordens para você) ═══ */
function OsCardDetalhado({
  os,
  cidade,
  pecas,
  carregandoPecas,
}: {
  os: OrdemServico
  cidade?: string
  pecas?: PecaPPV[]
  carregandoPecas?: boolean
}) {
  const [expandido, setExpandido] = useState(false)

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header do card */}
      <div
        onClick={() => setExpandido(!expandido)}
        style={{
          padding: '14px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{
          width: 42, height: 42, borderRadius: radius.md, flexShrink: 0,
          background: colors.accentBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Clipboard size={20} color={colors.accent} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: colors.primary }}>{os.Id_Ordem}</span>
            <Badge status="pendente">{os.Status}</Badge>
            {os.ID_PPV && <Badge bg={colors.infoBg} color={colors.info}>{os.ID_PPV}</Badge>}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {os.Os_Cliente}
          </div>
          {cidade && (
            <div style={{ fontSize: 11, color: colors.accent, fontWeight: 600, marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
              <MapPin size={10} /> {cidade}
            </div>
          )}
        </div>
        {expandido ? <ChevronUp size={18} color={colors.textSubtle} /> : <ChevronDown size={18} color={colors.textSubtle} />}
      </div>

      {/* Detalhes expandidos */}
      {expandido && (
        <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${colors.border}` }}>
          {/* Info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <InfoItem icon={Wrench} label="Tipo" value={os.Tipo_Servico || '—'} />
            <InfoItem icon={User} label="Técnico" value={os.Os_Tecnico || '—'} />
            {os.Os_Tecnico2 && <InfoItem icon={User} label="2º Técnico" value={os.Os_Tecnico2} />}
            {os.Projeto && <InfoItem icon={Info} label="Projeto" value={os.Projeto} />}
            {os.Revisao && <InfoItem icon={Info} label="Revisão" value={os.Revisao} />}
            {os.Previsao_Execucao && <InfoItem icon={Calendar} label="Previsão" value={formatarData(os.Previsao_Execucao)} />}
          </div>

          {/* Serviço solicitado */}
          {os.Serv_Solicitado && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                Serviço Solicitado
              </div>
              <div style={{
                fontSize: 13, color: colors.text, lineHeight: 1.5,
                background: colors.surfaceAlt, borderRadius: radius.sm, padding: '10px 12px',
                border: `1px solid ${colors.border}`,
              }}>
                {os.Serv_Solicitado}
              </div>
            </div>
          )}

          {/* Endereço */}
          {os.Endereco_Cliente && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                Endereço
              </div>
              <div style={{ fontSize: 13, color: colors.textMuted, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                <MapPin size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                {os.Endereco_Cliente}
              </div>
            </div>
          )}

          {/* Peças PPV */}
          {os.ID_PPV && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: colors.info, textTransform: 'uppercase',
                letterSpacing: 0.5, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Package size={12} /> Peças ({os.ID_PPV})
              </div>
              {carregandoPecas ? (
                <div style={{ fontSize: 12, color: colors.textSubtle, padding: 8 }}>Carregando peças...</div>
              ) : pecas && pecas.length > 0 ? (
                <div style={{
                  background: colors.infoBg, borderRadius: radius.sm, padding: 10,
                  border: `1px solid ${colors.infoBorder}`,
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  {pecas.map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.Descricao}
                        </div>
                        <div style={{ fontSize: 10, color: colors.textSubtle }}>{p.CodProduto}</div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: colors.accent, whiteSpace: 'nowrap' }}>
                        {p.Qtde}x
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: colors.textSubtle, padding: 8 }}>Nenhuma peça registrada</div>
              )}
            </div>
          )}

          {/* Botão ir para OS */}
          <a
            href={`/os/${os.Id_Ordem}`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              marginTop: 14, padding: '10px 16px',
              background: colors.primary, color: '#fff',
              borderRadius: radius.md, fontSize: 13, fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            <FileText size={14} /> Ver Ordem
          </a>
        </div>
      )}
    </Card>
  )
}

function InfoItem({ icon: Icon, label, value }: { icon: typeof Wrench; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      <Icon size={13} color={colors.textSubtle} style={{ marginTop: 1, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 10, fontWeight: 600, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{value}</div>
      </div>
    </div>
  )
}

/* ═══ Página principal ═══ */
export default function OrdensHub() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const { data, loading, refreshing } = useCached<OsData>(
    `os:${nome}`,
    () => fetchOsData(nome),
    { skip: !user },
  )

  const [aba, setAba] = useState<'preencher' | 'enviadas' | 'paravoce'>('preencher')
  const [busca, setBusca] = useState('')
  const buscaDebounced = useDebounce(busca, 300)
  const [resultadoBusca, setResultadoBusca] = useState<OrdemServico[]>([])
  const [buscando, setBuscando] = useState(false)
  const [buscaCidadeMap, setBuscaCidadeMap] = useState<Record<string, string>>({})

  const { ordens: ordensRaw = [], preenchidas = new Set<string>(), enviadas = new Set<string>(), cidadeMap = {}, enviadasCount = 0, agendaMap = {} } = data || {}

  const hoje = getHoje()

  // Separar: atrasadas, hoje, futuras, outras fases (exclui enviadas)
  const { atrasadas, deHoje, futuras, outrasFases, pendentesCount } = useMemo(() => {
    const ords = ordensRaw.filter(o => !enviadas.has(o.Id_Ordem))

    const atr: OrdemServico[] = []
    const hoj: OrdemServico[] = []
    const fut: OrdemServico[] = []
    const outras: OrdemServico[] = []

    ords.forEach(o => {
      const prev = o.Previsao_Execucao?.trim?.() || ''
      const datas = agendaMap[o.Id_Ordem] || []
      const datasOrdenadas = [...datas].sort()
      const proximaData = datasOrdenadas.find(d => d >= hoje) || prev

      // OS em fases não-execução (aguardando cliente, etc.)
      const aguardandoPecas = o.Status.includes('peças') || o.Status.includes('Procurando peças')
      const aguardando = FASES_AGUARDANDO.includes(o.Status)

      if (aguardando) {
        outras.push(o)
      } else if (aguardandoPecas) {
        // Aguardando peças nunca é atrasada — vai para "outras fases"
        outras.push(o)
      } else if (prev && prev < hoje && !datasOrdenadas.some(d => d >= hoje)) {
        // Só é atraso se >= 2 dias de diferença (1 dia não conta)
        const prevDate = new Date(prev + 'T00:00:00')
        const hojeDate = new Date(hoje + 'T00:00:00')
        const diffDias = Math.floor((hojeDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
        if (diffDias >= 2) {
          atr.push(o)
        } else {
          hoj.push(o) // 1 dia: mostra em "hoje"
        }
      } else if (proximaData === hoje) {
        hoj.push(o)
      } else {
        fut.push(o)
      }
    })

    const pend = ords.filter(o => !preenchidas.has(o.Id_Ordem)).length
    return { atrasadas: atr, deHoje: hoj, futuras: fut, outrasFases: outras, pendentesCount: pend }
  }, [ordensRaw, enviadas, preenchidas, agendaMap, hoje])

  // Busca com debounce
  useEffect(() => {
    if (!buscaDebounced.trim()) {
      setResultadoBusca([])
      return
    }
    let cancelled = false
    setBuscando(true)
    ;(async () => {
      const { data: searchData } = await supabase
        .from('Ordem_Servico')
        .select('*')
        .not('Status', 'in', '("Concluída","Cancelada","Concluida","cancelada")')
        .or(`Id_Ordem.ilike.%${buscaDebounced.trim()}%,Os_Cliente.ilike.%${buscaDebounced.trim()}%,ID_PPV.ilike.%${buscaDebounced.trim()}%`)
        .limit(10)
      if (cancelled) return
      const resultado = (searchData || []) as OrdemServico[]
      setResultadoBusca(resultado)
      const cnpjs = [...new Set(resultado.map(o => o.Cnpj_Cliente).filter(Boolean))]
      if (cnpjs.length > 0) {
        const { data: cliData } = await supabase.from('Clientes').select('cnpj_cpf, cidade').in('cnpj_cpf', cnpjs)
        if (cancelled) return
        const mapa: Record<string, string> = {}
        cliData?.forEach((c: { cnpj_cpf: string; cidade: string | null }) => {
          if (c.cidade) mapa[c.cnpj_cpf] = c.cidade
        })
        setBuscaCidadeMap(mapa)
      }
      setBuscando(false)
    })()
    return () => { cancelled = true }
  }, [buscaDebounced])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {refreshing && <div className="refresh-bar" />}

      <PageHeader title="Ordens" />

      {/* Métricas */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <StatCard value={pendentesCount} label="Pendentes" tone="warning" />
        <StatCard value={atrasadas.length} label="Atrasadas" tone="danger" />
        <StatCard value={enviadasCount} label="Enviadas" tone="success" />
      </div>

      {/* Tabs */}
      <TabBar
        value={aba}
        onChange={setAba}
        options={[
          { value: 'preencher', label: 'Preencher', icon: Wrench },
          { value: 'enviadas', label: 'Enviadas', icon: FileCheck },
          { value: 'paravoce', label: 'Para você', icon: Calendar },
        ]}
      />

      {/* ═══ ABA PREENCHER ═══ */}
      {aba === 'preencher' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SearchInput value={busca} onChange={setBusca} placeholder="Buscar OS, cliente ou PPV..." />

          {busca.trim() && (
            <Section label="Resultados">
              {buscando ? (
                <PageSpinner />
              ) : resultadoBusca.length === 0 ? (
                <EmptyState icon={FileText} title="Nenhuma OS encontrada" />
              ) : (
                resultadoBusca.map(os => (
                  <OsCard
                    key={os.Id_Ordem}
                    os={os}
                    cidade={buscaCidadeMap[os.Cnpj_Cliente]}
                    preenchida={preenchidas.has(os.Id_Ordem)}
                  />
                ))
              )}
            </Section>
          )}

          {loading ? (
            <PageSpinner />
          ) : (atrasadas.length === 0 && deHoje.length === 0 && futuras.length === 0) ? (
            <EmptyState
              icon={Wrench}
              title="Nenhuma OS atribuída"
              subtitle="Quando houver ordens, elas aparecerão aqui"
            />
          ) : (
            <>
              {/* Atrasadas */}
              {atrasadas.length > 0 && !busca.trim() && (
                <Section label="Atrasadas" icon={AlertTriangle} color={colors.danger} count={atrasadas.length}>
                  <div style={{
                    background: colors.dangerBg,
                    borderRadius: radius.xl,
                    padding: 10,
                    border: `1px solid ${colors.dangerBorder}`,
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    {atrasadas.map(os => (
                      <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(os.Id_Ordem)} />
                    ))}
                  </div>
                </Section>
              )}

              {/* Hoje */}
              {!busca.trim() && (
                <Section label="Hoje" icon={Clock} count={deHoje.length}>
                  {deHoje.length === 0 ? (
                    <EmptyState icon={Clock} title="Nenhuma OS para hoje" />
                  ) : (
                    deHoje.map(os => (
                      <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(os.Id_Ordem)} />
                    ))
                  )}
                </Section>
              )}

              {/* Futuras */}
              {futuras.length > 0 && !busca.trim() && (
                <Section label="Próximos dias" icon={Calendar} color={colors.info} count={futuras.length}>
                  {futuras.map(os => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(os.Id_Ordem)} />
                  ))}
                </Section>
              )}

              {/* Outras fases (aguardando peças, cliente, orçamento, etc.) */}
              {outrasFases.length > 0 && !busca.trim() && (
                <Section label="Outras fases" icon={Info} color={colors.textMuted} count={outrasFases.length}>
                  {outrasFases.map(os => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(os.Id_Ordem)} />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ ABA ENVIADAS ═══ */}
      {aba === 'enviadas' && <OsEnviadasTab nome={nome} />}

      {/* ═══ ABA PARA VOCÊ ═══ */}
      {aba === 'paravoce' && (
        <OsParaVoceTab
          ordens={ordensRaw}
          enviadas={enviadas}
          cidadeMap={cidadeMap}
          agendaMap={agendaMap}
          loading={loading}
        />
      )}

      <div style={{ height: 80 }} />
    </div>
  )
}

/* ═══ Sub-aba Enviadas ═══ */
function OsEnviadasTab({ nome }: { nome: string }) {
  const { data: ordens, loading } = useCached(
    `os-enviadas:${nome}`,
    async () => {
      const { data } = await supabase
        .from('Ordem_Servico_Tecnicos')
        .select('*')
        .ilike('TecResp1', nome)
        .eq('Status', 'enviado')
        .order('Data', { ascending: false })
      return (data || []) as { id: number; Ordem_Servico: string; TecResp1: string; Data: string; TipoServico: string; Status: string }[]
    },
    { skip: !nome },
  )

  if (loading) return <PageSpinner />

  if (!ordens || ordens.length === 0) {
    return (
      <EmptyState
        icon={Send}
        title="Nenhuma OS enviada"
        subtitle="Suas ordens preenchidas aparecerão aqui"
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ordens.map((os) => (
        <ListRow
          key={os.id ?? os.Ordem_Servico}
          href={`/os-enviadas/${os.Ordem_Servico}`}
          icon={CheckCircle2}
          iconColor={colors.success}
          iconBg={colors.successBg}
          badge={
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: colors.primary }}>{os.Ordem_Servico}</span>
              <Badge status="enviada">Enviada</Badge>
            </div>
          }
          title={os.TipoServico || 'Ordem de Serviço'}
          subtitle={os.Data ? new Date(os.Data).toLocaleDateString('pt-BR') : undefined}
        />
      ))}
    </div>
  )
}

/* ═══ Sub-aba "Ordens para você" — separada por dia ═══ */
function OsParaVoceTab({
  ordens: ordensRaw,
  enviadas,
  cidadeMap,
  agendaMap,
  loading,
}: {
  ordens: OrdemServico[]
  enviadas: Set<string>
  cidadeMap: Record<string, string>
  agendaMap: Record<string, string[]>
  loading: boolean
}) {
  const [pecasMap, setPecasMap] = useState<Record<string, PecaPPV[]>>({})
  const [carregandoPecas, setCarregandoPecas] = useState(false)

  const hoje = getHoje()

  // Ordens não enviadas, agrupadas por data de execução
  const ordensPorDia = useMemo(() => {
    const ords = ordensRaw.filter(o => !enviadas.has(o.Id_Ordem))
    const mapa: Record<string, OrdemServico[]> = {}

    ords.forEach(o => {
      const datas = agendaMap[o.Id_Ordem] || []
      const datasFuturas = datas.filter(d => d >= hoje).sort()
      const prev = o.Previsao_Execucao?.trim?.() || ''

      // Pega todas as datas relevantes (hoje e futuras)
      const datasParaMostrar = datasFuturas.length > 0 ? datasFuturas : (prev && prev >= hoje ? [prev] : [hoje])

      datasParaMostrar.forEach(data => {
        if (!mapa[data]) mapa[data] = []
        // Evita duplicar a mesma OS no mesmo dia
        if (!mapa[data].some(existing => existing.Id_Ordem === o.Id_Ordem)) {
          mapa[data].push(o)
        }
      })
    })

    // Ordenar por data
    return Object.entries(mapa).sort(([a], [b]) => a.localeCompare(b))
  }, [ordensRaw, enviadas, agendaMap, hoje])

  // Buscar peças dos PPVs
  useEffect(() => {
    const ppvIds = [...new Set(ordensRaw.filter(o => o.ID_PPV).map(o => o.ID_PPV))]
    if (ppvIds.length === 0) return

    let cancelled = false
    setCarregandoPecas(true)
    ;(async () => {
      const { data } = await supabase
        .from('movimentacoes')
        .select('Id_PPV, CodProduto, Descricao, Qtde, Preco')
        .in('Id_PPV', ppvIds)
      if (cancelled) return
      const mapa: Record<string, PecaPPV[]> = {}
      data?.forEach((p: PecaPPV & { Id_PPV: string }) => {
        if (!mapa[p.Id_PPV]) mapa[p.Id_PPV] = []
        mapa[p.Id_PPV].push({ CodProduto: p.CodProduto, Descricao: p.Descricao, Qtde: p.Qtde, Preco: p.Preco })
      })
      setPecasMap(mapa)
      setCarregandoPecas(false)
    })()
    return () => { cancelled = true }
  }, [ordensRaw])

  if (loading) return <PageSpinner />

  if (ordensPorDia.length === 0) {
    return (
      <EmptyState
        icon={Calendar}
        title="Nenhuma ordem agendada"
        subtitle="Suas próximas ordens aparecerão aqui"
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {ordensPorDia.map(([data, ords]) => {
        const isHoje = data === hoje
        return (
          <div key={data}>
            {/* Header do dia */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
              padding: '8px 12px',
              background: isHoje ? colors.primaryBg : colors.surfaceAlt,
              borderRadius: radius.md,
              border: `1px solid ${isHoje ? colors.primaryBorder : colors.border}`,
            }}>
              <Calendar size={15} color={isHoje ? colors.primary : colors.textMuted} />
              <span style={{
                fontSize: 14, fontWeight: 700,
                color: isHoje ? colors.primary : colors.text,
                textTransform: 'capitalize',
              }}>
                {isHoje ? 'Hoje' : formatarDataCompleta(data)}
              </span>
              <Badge
                bg={isHoje ? colors.primaryBg : colors.border}
                color={isHoje ? colors.primary : colors.textMuted}
              >
                {ords.length} OS
              </Badge>
            </div>

            {/* Cards detalhados */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ords.map(os => (
                <OsCardDetalhado
                  key={os.Id_Ordem}
                  os={os}
                  cidade={cidadeMap[os.Cnpj_Cliente]}
                  pecas={os.ID_PPV ? pecasMap[os.ID_PPV] : undefined}
                  carregandoPecas={carregandoPecas && !!os.ID_PPV}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
