'use client'
import { useState, useEffect, useMemo } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { useDebounce } from '@/hooks/useDebounce'
import { supabase } from '@/lib/supabase'
import type { OrdemServico } from '@/lib/types'
import Link from 'next/link'
import {
  FileText, FileCheck, MapPin, CheckCircle2, Send, ChevronDown, ChevronRight,
} from 'lucide-react'
import {
  PageHeader, TabBar, EmptyState, PageSpinner,
  Section, SearchInput,
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
  // Duas queries em paralelo:
  // (A) OS ATIVAS do técnico — alimenta as abas Preencher/Abertas (exclui já
  //     concluídas/canceladas pelo comercial pra não poluir a lista de trabalho)
  // (B) TODAS as OS do técnico (inclui Concluída/Faturada/Cancelada) —
  //     necessária pra o contador "Enviadas" bater com a sub-aba, que mostra
  //     TUDO que foi enviado ao longo da vida do técnico, não só o que ainda
  //     está ativo
  const [osAtivasRes, osTodasRes] = await Promise.all([
    supabase
      .from('Ordem_Servico')
      .select('*')
      .not('Status', 'in', '("Concluída","Cancelada","Concluida","cancelada")')
      .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
      .order('Id_Ordem', { ascending: false }),
    supabase
      .from('Ordem_Servico')
      .select('Id_Ordem, Status')
      .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
      .limit(2000),
  ])

  if (osAtivasRes.error) throw new Error(osAtivasRes.error.message)

  const todas = (osAtivasRes.data || []) as OrdemServico[]
  const todasGlobal = (osTodasRes.data || []) as { Id_Ordem: string; Status: string }[]

  let preenchidas = new Set<string>()
  let enviadas = new Set<string>()
  const cidadeMap: Record<string, string> = {}
  const agendaMap: Record<string, string[]> = {}

  // Status pós-relatório usados nos dois lados (lista + contador)
  const FASES_CONCLUIDAS_TECNICO = [
    'Relatório Concluído', 'Relatorio Concluido',
    'Executada aguardando comercial',
    'Concluída', 'Concluida', 'Concluído', 'Concluido',
    'Faturada', 'Faturado',
    'Finalizada', 'Finalizado',
    'Enviado Para Omie', 'Enviado para Omie',
  ]

  if (todas.length > 0) {
    const idsAtivas = todas.map(o => o.Id_Ordem)
    const idsAll = todasGlobal.map(o => String(o.Id_Ordem))
    const cnpjs = [...new Set(todas.map(o => o.Cnpj_Cliente).filter(Boolean))]
    const [preenchRes, cliRes, agendaRes, enviadasAllRes] = await Promise.all([
      supabase.from('Ordem_Servico_Tecnicos').select('Ordem_Servico, Status').in('Ordem_Servico', idsAtivas),
      cnpjs.length > 0
        ? supabase.from('Clientes').select('cnpj_cpf, cidade').in('cnpj_cpf', cnpjs)
        : Promise.resolve({ data: null }),
      supabase
        .from('agenda_tecnico')
        .select('id_ordem, data_agendada')
        .in('id_ordem', idsAtivas)
        .not('status', 'eq', 'cancelado'),
      // Conta registros 'enviado' em TODAS as OS do técnico (incluindo já
      // finalizadas). Sem isso o contador subestima — só conta OS ativas.
      idsAll.length > 0
        ? supabase
          .from('Ordem_Servico_Tecnicos')
          .select('Ordem_Servico')
          .in('Ordem_Servico', idsAll)
          .eq('Status', 'enviado')
        : Promise.resolve({ data: null }),
    ])
    if (preenchRes.data) {
      preenchidas = new Set(preenchRes.data.map((p: { Ordem_Servico: string }) => String(p.Ordem_Servico)))
    }
    // CONTADOR: usa a passada GLOBAL (registros 'enviado' em TODAS as OS,
    // independente do status atual da OS principal).
    enviadas = new Set(
      ((enviadasAllRes.data || []) as { Ordem_Servico: string }[])
        .map(r => String(r.Ordem_Servico)),
    )
    // + OS principal já em fase finalizada (também conta como enviada)
    for (const o of todasGlobal) {
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

/* Extrai o texto que vem depois de "Solicitação do Cliente:" na descrição.
   Ex.: "Modelo: Chassis: ... Solicitação do cliente: TRATOR AQUECENDO Serviço Realizado:"
   → "TRATOR AQUECENDO". Se não achar, retorna vazio. */
function extrairSolicitacao(serv?: string | null): string {
  if (!serv) return ''
  const txt = serv.replace(/\s+/g, ' ').trim()
  const m = txt.match(/solicita[çc][ãa]o do cliente\s*:?\s*(.*)/i)
  if (!m) return ''
  // Corta no próximo rótulo conhecido (Serviço Realizado)
  const val = m[1].split(/servi[çc]o\s+realizado/i)[0]
  return val.trim()
}

/* ═══ Card de OS (estilo remap) ═══ */
function OsCard({
  os,
  cidade,
  preenchida,
  index = 0,
}: {
  os: OrdemServico
  cidade?: string
  preenchida: boolean
  index?: number
}) {
  const fase = getFaseInfo(os.Status)
  const Icon = preenchida ? CheckCircle2 : FileText
  const iconBg = preenchida ? colors.success : colors.warning
  const solicitacao = extrairSolicitacao(os.Serv_Solicitado) || os.Tipo_Servico
  // Atrasada para preencher: previsão de execução vencida (a lista Abertas já exclui enviadas)
  const prev = os.Previsao_Execucao?.trim?.() || ''
  const atrasada = !!prev && prev < getHoje()

  return (
    <Link
      href={`/os/${os.Id_Ordem}`}
      className="hb"
      style={{
        position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none',
        background: colors.surface, borderRadius: 18, padding: 16,
        border: `1px solid ${atrasada ? colors.dangerBorder : colors.border}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        animationDelay: `${Math.min(index * 45, 300)}ms`,
      }}
    >
      {atrasada && (
        <span className="animate-pulse-alert" style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: colors.danger,
        }} />
      )}
      <div style={{
        width: 50, height: 50, borderRadius: 15, flexShrink: 0, background: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
      }}>
        <Icon size={24} color="#fff" strokeWidth={2.2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.primary }}>{os.Id_Ordem}</span>
          {atrasada && (
            <span className="animate-pulse-alert" style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
              background: colors.danger, color: '#fff',
            }}>
              ATRASADA
            </span>
          )}
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6,
            background: preenchida ? colors.successBg : colors.warningBg,
            color: preenchida ? colors.success : colors.warning,
          }}>
            {preenchida ? 'Preenchida' : 'Pendente'}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6,
            background: fase.bg, color: fase.color,
          }}>
            {fase.label}
          </span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {os.Os_Cliente}
        </div>
        <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {cidade && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: colors.accent }}>
              <MapPin size={11} /> {cidade}
            </span>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {solicitacao}{os.ID_PPV ? ` · ${os.ID_PPV}` : ''}
          </span>
        </div>
      </div>
      <ChevronRight size={18} color={colors.textSubtle} style={{ flexShrink: 0 }} />
    </Link>
  )
}

/* ═══ Página principal ═══ */
export default function OrdensHub() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const { data, loading, refreshing } = useCached<OsData>(
    `os:v2:${nome}`,
    () => fetchOsData(nome),
    { skip: !user },
  )

  const [aba, setAba] = useState<'abertas' | 'enviadas'>('abertas')
  const [busca, setBusca] = useState('')
  const buscaDebounced = useDebounce(busca, 300)
  const [resultadoBusca, setResultadoBusca] = useState<OrdemServico[]>([])
  const [buscando, setBuscando] = useState(false)
  const [buscaCidadeMap, setBuscaCidadeMap] = useState<Record<string, string>>({})

  // preenchidas/enviadas podem ser Set (online) ou Array (do IndexedDB serializado)
  const raw = data || {} as Partial<OsData>
  const ordensRaw = raw.ordens || []
  const preenchidas = raw.preenchidas instanceof Set ? raw.preenchidas : new Set<string>(raw.preenchidas as unknown as string[] || [])
  const enviadas = raw.enviadas instanceof Set ? raw.enviadas : new Set<string>(raw.enviadas as unknown as string[] || [])
  const cidadeMap = raw.cidadeMap || {}
  const enviadasCount = raw.enviadasCount || 0
  const agendaMap = raw.agendaMap || {}

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

      {/* Tabs */}
      <TabBar
        value={aba}
        onChange={setAba}
        options={[
          { value: 'abertas', label: 'Abertas', icon: FileText },
          { value: 'enviadas', label: 'Enviadas', icon: FileCheck },
        ]}
      />

      {/* ═══ ABA ABERTAS (preencher + abertas juntas) ═══ */}
      {aba === 'abertas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SearchInput value={busca} onChange={setBusca} placeholder="Buscar OS, cliente ou PPV..." />

          {busca.trim() ? (
            <Section label="Resultados">
              {buscando ? (
                <PageSpinner />
              ) : resultadoBusca.length === 0 ? (
                <EmptyState icon={FileText} title="Nenhuma OS encontrada" />
              ) : (
                resultadoBusca.map((os, i) => (
                  <OsCard key={os.Id_Ordem} os={os} cidade={buscaCidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} index={i} />
                ))
              )}
            </Section>
          ) : loading ? (
            <PageSpinner />
          ) : (atrasadas.length === 0 && preencher.length === 0 && abertasExecucao.length === 0 && abertasOrcamento.length === 0 && abertasOutras.length === 0) ? (
            <EmptyState icon={FileText} title="Nenhuma OS aberta" subtitle="Voce esta em dia" />
          ) : (
            <>
              {atrasadas.length > 0 && (
                <Section label="Atrasadas">
                  {atrasadas.map((os, i) => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} index={i} />
                  ))}
                </Section>
              )}
              {preencher.length > 0 && (
                <Section label="Preencher">
                  {preencher.map((os, i) => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} index={i} />
                  ))}
                </Section>
              )}
              {abertasExecucao.length > 0 && (
                <Section label="Em Execução">
                  {abertasExecucao.map((os, i) => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} index={i} />
                  ))}
                </Section>
              )}
              {abertasOrcamento.length > 0 && (
                <Section label="Futuros">
                  {abertasOrcamento.map((os, i) => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} index={i} />
                  ))}
                </Section>
              )}
              {abertasOutras.length > 0 && (
                <Section label="Outras fases">
                  {abertasOutras.map((os, i) => (
                    <OsCard key={os.Id_Ordem} os={os} cidade={cidadeMap[os.Cnpj_Cliente]} preenchida={preenchidas.has(String(os.Id_Ordem))} index={i} />
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

/* ═══ Fotos anexadas na OS (colunas de Ordem_Servico_Tecnicos) ═══ */
const FOTO_CAMPOS_ENV: Record<string, string> = {
  FotoHorimetro: 'Horimetro', FotoChassis: 'Chassis', FotoFrente: 'Frente',
  FotoDireita: 'Direita', FotoEsquerda: 'Esquerda', FotoTraseira: 'Traseira', FotoVolante: 'Volante',
  FotoFalha1: 'Falha 1', FotoFalha2: 'Falha 2', FotoFalha3: 'Falha 3', FotoFalha4: 'Falha 4',
  FotoPecaNova1: 'Peca Nova 1', FotoPecaNova2: 'Peca Nova 2',
  FotoPecaInstalada1: 'Peca Instalada 1', FotoPecaInstalada2: 'Peca Instalada 2', FotoAlmoco: 'Almoco',
}
const FOTO_KEYS_ENV = Object.keys(FOTO_CAMPOS_ENV)

/* ═══ Sub-aba Enviadas ═══ */
function OsEnviadasTab({ nome }: { nome: string }) {
  const [busca, setBusca] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  const [fotosPorOs, setFotosPorOs] = useState<Record<string, { label: string; url: string }[] | 'loading'>>({})

  const { data: ordens, loading } = useCached(
    `os-enviadas:v6:${nome}`,
    async () => {
      type RegTec = {
        id: number; Ordem_Servico: string; TecResp1: string | null; TecResp2: string | null;
        Data: string; TipoServico: string | null; Status: string; pdf_criado: boolean; cliente?: string | null;
      }
      // Coluna se chama "Data" — NÃO "Data_Abertura" (esse era um nome inventado
      // que causava HTTP 400 silencioso e fazia a query inteira retornar []).
      type OS = { Id_Ordem: string; Status: string; Tipo_Servico: string | null; Os_Cliente: string | null; Data: string | null }

      const FASES_FINALIZADAS = new Set([
        'Relatório Concluído', 'Relatorio Concluido',
        'Executada aguardando comercial',
        'Concluída', 'Concluida', 'Concluído', 'Concluido',
        'Faturada', 'Faturado',
        'Finalizada', 'Finalizado',
      ])

      // ESTRATÉGIA (espelha a do contador verde em fetchOsData):
      // 1) Busca OS onde o técnico aparece como Os_Tecnico OU Os_Tecnico2.
      // 2) Busca TODOS os registros dessas OS em Ordem_Servico_Tecnicos pelo ID,
      //    SEM filtrar por TecResp (cobre caso do TecResp2 preencher).
      // 3) Inclui qualquer OS que tenha registro 'enviado' OU OS principal já
      //    está em fase finalizada (Concluída/Faturada/etc.).
      const { data: osList, error: osErr } = await supabase
        .from('Ordem_Servico')
        .select('Id_Ordem, Status, Tipo_Servico, Os_Cliente, Data')
        .or(`Os_Tecnico.ilike.%${nome}%,Os_Tecnico2.ilike.%${nome}%`)
        .limit(1000)
      if (osErr) {
        console.warn('[os-enviadas] erro na query de OS:', osErr.message)
        return [] as RegTec[]
      }
      const osArr = (osList || []) as OS[]
      if (osArr.length === 0) return [] as RegTec[]

      const ids = osArr.map(o => String(o.Id_Ordem))
      const { data: regsData, error: regsErr } = await supabase
        .from('Ordem_Servico_Tecnicos')
        .select('id, Ordem_Servico, TecResp1, TecResp2, Data, TipoServico, Status, pdf_criado')
        .in('Ordem_Servico', ids)
        .order('Data', { ascending: false })
      if (regsErr) console.warn('[os-enviadas] erro na query de registros:', regsErr.message)
      const todosRegs = (regsData || []) as RegTec[]

      // Agrupa registros por Ordem_Servico
      const regsPorOs = new Map<string, RegTec[]>()
      for (const r of todosRegs) {
        const k = String(r.Ordem_Servico)
        const arr = regsPorOs.get(k) || []
        arr.push(r)
        regsPorOs.set(k, arr)
      }

      // Pra cada OS, decide se vai pra aba "enviadas"
      const finais: RegTec[] = []
      for (const os of osArr) {
        const idOs = String(os.Id_Ordem)
        const regs = regsPorOs.get(idOs) || []
        const algumEnviado = regs.find(r => r.Status === 'enviado')
        const osFinalizada = FASES_FINALIZADAS.has(os.Status)

        if (algumEnviado) {
          finais.push({ ...algumEnviado, cliente: os.Os_Cliente })
        } else if (osFinalizada) {
          finais.push({
            ...(regs[0] || {
              id: 0, Ordem_Servico: idOs, TecResp1: nome, TecResp2: null,
              Data: os.Data || '', TipoServico: os.Tipo_Servico, Status: 'enviado', pdf_criado: false,
            }),
            cliente: os.Os_Cliente,
          })
        }
      }

      return finais.sort((a, b) => (b.Data || '').localeCompare(a.Data || ''))
    },
    { skip: !nome },
  )

  const toggle = async (idOs: string) => {
    if (expandido === idOs) { setExpandido(null); return }
    setExpandido(idOs)
    if (!fotosPorOs[idOs]) {
      setFotosPorOs(p => ({ ...p, [idOs]: 'loading' }))
      const { data } = await supabase
        .from('Ordem_Servico_Tecnicos')
        .select(FOTO_KEYS_ENV.join(','))
        .eq('Ordem_Servico', idOs)
      const vistos = new Set<string>()
      const urls: { label: string; url: string }[] = []
      for (const row of (data || []) as unknown as Record<string, unknown>[]) {
        for (const k of FOTO_KEYS_ENV) {
          const u = String(row[k] || '').trim()
          if (u && !vistos.has(u)) { vistos.add(u); urls.push({ label: FOTO_CAMPOS_ENV[k], url: u }) }
        }
      }
      setFotosPorOs(p => ({ ...p, [idOs]: urls }))
    }
  }

  if (loading) return <PageSpinner />

  const lista = (ordens || []) as Array<{ id: number; Ordem_Servico: string; TipoServico: string | null; Data: string; cliente?: string | null }>
  const q = busca.trim().toLowerCase()
  const filtradas = q
    ? lista.filter(o => String(o.Ordem_Servico).toLowerCase().includes(q) || (o.cliente || '').toLowerCase().includes(q))
    : lista

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por OS ou cliente..." />

      {lista.length === 0 ? (
        <EmptyState icon={Send} title="Nenhuma OS enviada" subtitle="Suas ordens preenchidas aparecerão aqui" />
      ) : filtradas.length === 0 ? (
        <EmptyState icon={FileText} title="Nada encontrado" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtradas.map((os, i) => {
            const aberto = expandido === os.Ordem_Servico
            const fotos = fotosPorOs[os.Ordem_Servico]
            return (
              <div
                key={os.id ?? os.Ordem_Servico}
                className="hb-in"
                style={{
                  background: colors.surface, border: `1px solid ${colors.border}`,
                  borderRadius: 18, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  animationDelay: `${Math.min(i * 45, 300)}ms`,
                }}
              >
                <button onClick={() => toggle(os.Ordem_Servico)} style={{
                  width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                  padding: 16, display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <div style={{
                    width: 50, height: 50, borderRadius: 15, flexShrink: 0, background: colors.success,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
                  }}>
                    <FileCheck size={24} color="#fff" strokeWidth={2.2} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{os.cliente || 'Sem cliente'}</div>
                    <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                      OS {os.Ordem_Servico}{os.Data ? ` · ${new Date(os.Data).toLocaleDateString('pt-BR')}` : ''}
                    </div>
                  </div>
                  <ChevronDown size={18} color={colors.textSubtle} style={{ transition: 'transform 0.2s', transform: aberto ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
                </button>

                {aberto && (
                  <div style={{ padding: '0 16px 16px' }}>
                    {fotos === 'loading' || fotos === undefined ? (
                      <div style={{ fontSize: 13, color: colors.textMuted, padding: '8px 0' }}>Carregando fotos...</div>
                    ) : fotos.length === 0 ? (
                      <div style={{ fontSize: 13, color: colors.textMuted, padding: '8px 0' }}>Nenhuma foto anexada.</div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
                        {fotos.map((f, i) => (
                          <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                            <div style={{ aspectRatio: '1', borderRadius: radius.lg, overflow: 'hidden', border: `1px solid ${colors.border}`, background: colors.surfaceAlt }}>
                              <img src={f.url} alt={f.label} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            </div>
                            <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 3, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.label}</div>
                          </a>
                        ))}
                      </div>
                    )}
                    <a href={`/os-enviadas/${os.Ordem_Servico}`} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12,
                      fontSize: 13, color: colors.accent, textDecoration: 'none',
                    }}>Ver detalhes da ordem</a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

