'use client'
import { useState, useEffect, useMemo } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { useDebounce } from '@/hooks/useDebounce'
import { supabase } from '@/lib/supabase'
import type { OrdemServico } from '@/lib/types'
import {
  Wrench, FileText, AlertTriangle, FileCheck, MapPin, CheckCircle2, Send,
  Calendar,
} from 'lucide-react'
import {
  PageHeader, StatCard, TabBar, ListRow, EmptyState, PageSpinner,
  Badge, Section, SearchInput,
} from '@/components/ui'
import { colors, radius } from '@/lib/ui'

/* ═══ Tipos ═══ */
interface OsData {
  ordens: OrdemServico[]
  preenchidas: Set<string>
  enviadas: Set<string>
  cidadeMap: Record<string, string>
  enviadasCount: number
  agendaMap: Record<string, string[]> // Id_Ordem → datas agendadas
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
      .or(`TecResp1.ilike.%${nome}%,TecResp2.ilike.%${nome}%`)
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
      preenchidas = new Set(preenchRes.data.map((p: { Ordem_Servico: string }) => String(p.Ordem_Servico)))
      enviadas = new Set(
        preenchRes.data
          .filter((p: { Status: string }) => p.Status === 'enviado')
          .map((p: { Ordem_Servico: string }) => String(p.Ordem_Servico)),
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

/* ═══ Página principal ═══ */
export default function OrdensHub() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const { data, loading, refreshing } = useCached<OsData>(
    `os:${nome}`,
    () => fetchOsData(nome),
    { skip: !user },
  )

  const [aba, setAba] = useState<'preencher' | 'abertas' | 'enviadas'>('preencher')
  const [busca, setBusca] = useState('')
  const buscaDebounced = useDebounce(busca, 300)
  const [resultadoBusca, setResultadoBusca] = useState<OrdemServico[]>([])
  const [buscando, setBuscando] = useState(false)
  const [buscaCidadeMap, setBuscaCidadeMap] = useState<Record<string, string>>({})

  const { ordens: ordensRaw = [], preenchidas = new Set<string>(), enviadas = new Set<string>(), cidadeMap = {}, enviadasCount = 0, agendaMap = {} } = data || {}

  const hoje = getHoje()

  // Separar: preencher (atrasadas) vs abertas (não vencidas) — exclui enviadas
  const { preencher, abertas, pendentesCount } = useMemo(() => {
    const ords = ordensRaw.filter(o => !enviadas.has(String(o.Id_Ordem)))

    const prn: OrdemServico[] = [] // preencher = atrasadas (previsão vencida)
    const abt: OrdemServico[] = [] // abertas = não vencidas

    ords.forEach(o => {
      const prev = o.Previsao_Execucao?.trim?.() || ''
      const datas = agendaMap[o.Id_Ordem] || []
      const datasOrdenadas = [...datas].sort()

      if (prev && prev < hoje && !datasOrdenadas.some(d => d >= hoje)) {
        // Previsão vencida — vai para Preencher
        prn.push(o)
      } else {
        // Ainda não venceu — vai para Abertas
        abt.push(o)
      }
    })

    const pend = ords.filter(o => !preenchidas.has(String(o.Id_Ordem))).length
    return { preencher: prn, abertas: abt, pendentesCount: pend }
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
        <StatCard value={preencher.length} label="Preencher" tone="danger" />
        <StatCard value={abertas.length} label="Abertas" tone="warning" />
        <StatCard value={enviadasCount} label="Enviadas" tone="success" />
      </div>

      {/* Tabs */}
      <TabBar
        value={aba}
        onChange={setAba}
        options={[
          { value: 'preencher', label: 'Preencher', icon: AlertTriangle },
          { value: 'abertas', label: 'Abertas', icon: Wrench },
          { value: 'enviadas', label: 'Enviadas', icon: FileCheck },
        ]}
      />

      {/* ═══ ABA PREENCHER (atrasadas) ═══ */}
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
                    preenchida={preenchidas.has(String(os.Id_Ordem))}
                  />
                ))
              )}
            </Section>
          )}

          {loading ? (
            <PageSpinner />
          ) : preencher.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="Nenhuma OS atrasada"
              subtitle="Você está em dia!"
            />
          ) : (
            !busca.trim() && (
              <Section label="Atrasadas" icon={AlertTriangle} color={colors.danger} count={preencher.length}>
                <div style={{
                  background: colors.dangerBg,
                  borderRadius: radius.xl,
                  padding: 10,
                  border: `1px solid ${colors.dangerBorder}`,
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  {preencher.map(os => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} />
                  ))}
                </div>
              </Section>
            )
          )}
        </div>
      )}

      {/* ═══ ABA ABERTAS (não vencidas) ═══ */}
      {aba === 'abertas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading ? (
            <PageSpinner />
          ) : abertas.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="Nenhuma OS aberta"
              subtitle="Quando houver ordens, elas aparecerão aqui"
            />
          ) : (
            abertas.map(os => (
              <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} />
            ))
          )}
        </div>
      )}

      {/* ═══ ABA ENVIADAS (histórico) ═══ */}
      {aba === 'enviadas' && <OsEnviadasTab nome={nome} />}

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
        .or(`TecResp1.ilike.%${nome}%,TecResp2.ilike.%${nome}%`)
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

