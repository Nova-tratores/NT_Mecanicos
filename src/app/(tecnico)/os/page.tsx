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
  const [osRes] = await Promise.all([
    supabase
      .from('Ordem_Servico')
      .select('*')
      .not('Status', 'in', '("Concluída","Cancelada","Concluida","cancelada")')
      .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
      .order('Id_Ordem', { ascending: false }),
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
    // OS com status concluído pelo técnico também contam como enviadas
    const FASES_CONCLUIDAS_TECNICO = ['Relatório Concluído', 'Executada aguardando comercial']
    for (const o of todas) {
      if (FASES_CONCLUIDAS_TECNICO.includes(o.Status)) {
        enviadas.add(String(o.Id_Ordem))
      }
    }
    cliRes.data?.forEach((c: { cnpj_cpf: string; cidade: string | null }) => {
      if (c.cidade) cidadeMap[c.cnpj_cpf] = c.cidade
    })
    agendaRes.data?.forEach((a: { id_ordem: string; data_agendada: string }) => {
      if (!agendaMap[a.id_ordem]) agendaMap[a.id_ordem] = []
      agendaMap[a.id_ordem].push(a.data_agendada)
    })
  }

  return { ordens: todas, preenchidas, enviadas, cidadeMap, enviadasCount: enviadas.size, agendaMap }
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
const FASES_ORCAMENTO = ['Orçamento', 'Orçamento enviado para o cliente e aguardando']
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

  // Separar: preencher vs abertas — exclui enviadas
  // Atrasada = "Aguardando ordem Técnico" não preenchida, previsão vencida > 1 dia
  // Preencher = "Aguardando ordem Técnico" não preenchida, previsão vencida (mas <= 1 dia)
  // Abertas = todas as outras (separadas por fase)
  const { atrasadas, preencher, abertasOrcamento, abertasExecucao, abertasOutras, pendentesCount } = useMemo(() => {
    const ords = ordensRaw.filter(o => !enviadas.has(String(o.Id_Ordem)))

    const atr: OrdemServico[] = []  // atrasadas
    const prn: OrdemServico[] = []  // preencher
    const orc: OrdemServico[] = []  // abertas — orçamento
    const exe: OrdemServico[] = []  // abertas — execução
    const out: OrdemServico[] = []  // abertas — outras fases

    ords.forEach(o => {
      const jaPreencheu = preenchidas.has(String(o.Id_Ordem))

      // Só aparece em Preencher/Atrasada se:
      // - Status é "Aguardando ordem Técnico"
      // - Técnico ainda NÃO preencheu
      // - Previsão vencida
      if (o.Status === 'Aguardando ordem Técnico' && !jaPreencheu) {
        const prev = o.Previsao_Execucao?.trim?.() || ''
        const datas = agendaMap[o.Id_Ordem] || []
        const datasOrdenadas = [...datas].sort()
        const previsaoVencida = prev && prev < hoje && !datasOrdenadas.some(d => d >= hoje)

        if (previsaoVencida) {
          const prevDate = new Date(prev + 'T00:00:00')
          const hojeDate = new Date(hoje + 'T00:00:00')
          const diffDias = Math.floor((hojeDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
          if (diffDias > 1) {
            atr.push(o)
          } else {
            prn.push(o)
          }
          return
        }
      }

      // Abertas — separar por fase
      if (FASES_ORCAMENTO.includes(o.Status)) {
        orc.push(o)
      } else if (FASES_EXECUCAO.includes(o.Status)) {
        exe.push(o)
      } else {
        out.push(o)
      }
    })

    const pend = ords.filter(o =>
      o.Status === 'Aguardando ordem Técnico' && !preenchidas.has(String(o.Id_Ordem))
    ).length
    return {
      atrasadas: atr,
      preencher: prn,
      abertasOrcamento: orc,
      abertasExecucao: exe,
      abertasOutras: out,
      pendentesCount: pend,
    }
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
        <StatCard value={atrasadas.length + preencher.length} label="Preencher" tone="danger" />
        <StatCard value={abertasOrcamento.length + abertasExecucao.length + abertasOutras.length} label="Abertas" tone="warning" />
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
                    preenchida={preenchidas.has(String(os.Id_Ordem))}
                  />
                ))
              )}
            </Section>
          )}

          {loading ? (
            <PageSpinner />
          ) : (atrasadas.length === 0 && preencher.length === 0) ? (
            <EmptyState
              icon={AlertTriangle}
              title="Nenhuma OS para preencher"
              subtitle="Voce esta em dia!"
            />
          ) : !busca.trim() && (
            <>
              {/* Atrasadas — Aguardando ordem Técnico > 1 dia */}
              {atrasadas.length > 0 && (
                <Section label="Atrasadas" icon={AlertTriangle} color={colors.danger} count={atrasadas.length}>
                  <div style={{
                    background: colors.dangerBg,
                    borderRadius: radius.xl,
                    padding: 10,
                    border: `1px solid ${colors.dangerBorder}`,
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    {atrasadas.map(os => (
                      <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} />
                    ))}
                  </div>
                </Section>
              )}

              {/* Preencher — previsão vencida, não atrasada */}
              {preencher.length > 0 && (
                <Section label="Preencher" icon={FileText} color={colors.warning} count={preencher.length}>
                  {preencher.map(os => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ ABA ABERTAS (separadas por fase) ═══ */}
      {aba === 'abertas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading ? (
            <PageSpinner />
          ) : (abertasExecucao.length === 0 && abertasOrcamento.length === 0 && abertasOutras.length === 0) ? (
            <EmptyState
              icon={Wrench}
              title="Nenhuma OS aberta"
              subtitle="Quando houver ordens, elas aparecerão aqui"
            />
          ) : (
            <>
              {/* Em Execução */}
              {abertasExecucao.length > 0 && (
                <Section label="Em Execução" icon={Wrench} color={colors.info} count={abertasExecucao.length}>
                  {abertasExecucao.map(os => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} />
                  ))}
                </Section>
              )}

              {/* Orçamento (Futuros) */}
              {abertasOrcamento.length > 0 && (
                <Section label="Futuros" icon={Calendar} color={colors.accent} count={abertasOrcamento.length}>
                  {abertasOrcamento.map(os => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} />
                  ))}
                </Section>
              )}

              {/* Outras fases */}
              {abertasOutras.length > 0 && (
                <Section label="Outras fases" icon={FileText} color={colors.textMuted} count={abertasOutras.length}>
                  {abertasOutras.map(os => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} />
                  ))}
                </Section>
              )}
            </>
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
      // 1. Buscar registros preenchidos pelo técnico (enviado ou rascunho)
      const { data: tecData } = await supabase
        .from('Ordem_Servico_Tecnicos')
        .select('*')
        .or(`TecResp1.ilike.%${nome}%,TecResp2.ilike.%${nome}%`)
        .in('Status', ['enviado', 'rascunho'])
        .order('Data', { ascending: false })
      const todosRegs = (tecData || []) as { id: number; Ordem_Servico: string; TecResp1: string; Data: string; TipoServico: string; Status: string; pdf_criado: boolean }[]

      // Buscar status da OS principal para cada registro
      const osIds = [...new Set(todosRegs.map(r => String(r.Ordem_Servico)))]
      let osStatusMap: Record<string, string> = {}
      if (osIds.length > 0) {
        const { data: osData } = await supabase
          .from('Ordem_Servico')
          .select('Id_Ordem, Status, Tipo_Servico, Os_Cliente, Data_Abertura')
          .in('Id_Ordem', osIds)
        if (osData) {
          for (const o of osData) {
            osStatusMap[String(o.Id_Ordem)] = o.Status
          }
        }
      }

      // Incluir se: registro 'enviado' OU OS principal já está concluída
      const FASES_CONCLUIDAS = ['Relatório Concluído', 'Executada aguardando comercial']
      const registros = todosRegs.filter(r =>
        r.Status === 'enviado' || FASES_CONCLUIDAS.includes(osStatusMap[String(r.Ordem_Servico)] || '')
      )
      const idsJaIncluidos = new Set(registros.map(r => String(r.Ordem_Servico)))

      // 2. Buscar OS concluídas que não têm registro na tabela do técnico
      const { data: osConc } = await supabase
        .from('Ordem_Servico')
        .select('Id_Ordem, Tipo_Servico, Os_Cliente, Data_Abertura')
        .in('Status', FASES_CONCLUIDAS)
        .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
      if (osConc) {
        for (const os of osConc) {
          if (!idsJaIncluidos.has(String(os.Id_Ordem))) {
            registros.push({
              id: 0,
              Ordem_Servico: String(os.Id_Ordem),
              TecResp1: nome,
              Data: os.Data_Abertura || '',
              TipoServico: os.Tipo_Servico || '',
              Status: 'enviado',
              pdf_criado: false,
            } as any)
          }
        }
      }

      return registros
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

