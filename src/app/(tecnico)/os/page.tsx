'use client'
import { hojeBR } from '@/lib/hoje'
import { useState, useEffect, useMemo } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { useDebounce } from '@/hooks/useDebounce'
import { supabase } from '@/lib/supabase'
import { offlineGet } from '@/lib/offlineCache'
import { primeiroNomeIlike } from '@/lib/prefetch'
import type { OrdemServico } from '@/lib/types'
import {
  FileText, FileCheck, Send, ChevronDown, AlertTriangle, ClipboardList, Wrench, Hourglass, Layers, ChevronRight,
  Search, X, Globe, Users, Building2, type LucideIcon,
} from 'lucide-react'
import {
  OsCard, FASES_ORCAMENTO, FASES_EXECUCAO, SITUACAO, situacaoOS, clarinho, nomeBonito, numeroOS,
  semAcento, numeroBuscado, maquinaDaOS, ehInterna, tecnicoNoCampo,
} from '@/components/OsCardTecnico'
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

/** tira o que quebra o filtro .or() do PostgREST (vírgula, parênteses) e os coringas do ilike */
const limparBusca = (t: string) => t.replace(/[,()%*]/g, ' ').replace(/\s+/g, ' ').trim()

/** só as letras do 1º nome — a consulta traz um pouco a mais e o filtro fino é o mesmoNome (José, 23/10/2026:
 *  "ilike %nome%" pegava técnicos de nome parecido) */
const primeiroNome = (nome: string) => primeiroNomeIlike(limparBusca(nome)) // vogais viram '_' (ilike não ignora acento)

/** a OS é deste técnico? (Os_Tecnico ou Os_Tecnico2) */
const ehMinha = (o: { Os_Tecnico?: unknown; Os_Tecnico2?: unknown }, nome: string) =>
  tecnicoNoCampo(o.Os_Tecnico, nome) || tecnicoNoCampo(o.Os_Tecnico2, nome)

const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

/** datas da OS marcadas no POS: Dias_Execucao ("2026-10-21 08:00-12:00, …") — a mesma leitura do feed */
function diasDaOS(o: Record<string, unknown>): string[] {
  return String(o.Dias_Execucao || '').split(',')
    .map((s) => /^(\d{4}-\d{2}-\d{2})/.exec(s.trim())?.[1])
    .filter((d): d is string => !!d)
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
  const p1 = primeiroNome(nome)
  const filtroTec = `Os_Tecnico.ilike.%${p1}%,Os_Tecnico2.ilike.%${p1}%`
  const [osAtivasRes, osTodasRes] = await Promise.all([
    supabase
      .from('Ordem_Servico')
      .select('*')
      .not('Status', 'in', '("Concluída","Cancelada","Concluida","cancelada")')
      .or(filtroTec)
      .order('Id_Ordem', { ascending: false }),
    supabase
      .from('Ordem_Servico')
      .select('Id_Ordem, Status, Os_Tecnico, Os_Tecnico2')
      .or(filtroTec)
      .limit(3000),
  ])

  if (osAtivasRes.error) throw new Error(osAtivasRes.error.message)

  const todas = ((osAtivasRes.data || []) as OrdemServico[]).filter((o) => ehMinha(o as unknown as Record<string, unknown>, nome))
  const todasGlobal = ((osTodasRes.data || []) as { Id_Ordem: string; Status: string; Os_Tecnico?: string; Os_Tecnico2?: string }[])
    .filter((o) => ehMinha(o, nome))

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
    const hoje = hojeBR()
    const [preenchRes, cliRes, lousaRes, enviadasAllRes] = await Promise.all([
      supabase.from('Ordem_Servico_Tecnicos').select('Ordem_Servico, Status').in('Ordem_Servico', idsAtivas),
      // cadastro de clientes do Omie no portal (a tabela "Clientes" não existe)
      cnpjs.length > 0
        ? supabase.from('portal_nt_clientes_cadastro_omie').select('cnpj_cpf, cidade').in('cnpj_cpf', cnpjs)
        : Promise.resolve({ data: null }),
      // agenda do técnico = Lousa (lousa_servicos, tipo 'servico'), de hoje em diante
      supabase
        .from('lousa_servicos')
        .select('data, cliente_cnpj, cliente_nome, tecnico_nome, tecnico_acompanhante')
        .eq('tipo', 'servico')
        .gte('data', hoje)
        .limit(1000)
        .then((r) => r, () => ({ data: null })),
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
    ;(cliRes.data as { cnpj_cpf: string; cidade: string | null }[] | null)?.forEach((c) => {
      if (c.cidade) cidadeMap[c.cnpj_cpf] = c.cidade
    })

    // Datas agendadas: os dias marcados na própria OS (Dias_Execucao, como o feed) + os lançamentos da Lousa
    // do mesmo cliente com este técnico (a Lousa não guarda o nº da OS: liga pelo CNPJ — ou nome — do cliente)
    const lousa = ((lousaRes as { data: unknown }).data || []) as {
      data: string; cliente_cnpj: string | null; cliente_nome: string | null; tecnico_nome: string | null; tecnico_acompanhante: string | null
    }[]
    const minhasLousa = lousa.filter((l) => tecnicoNoCampo(l.tecnico_nome, nome) || tecnicoNoCampo(l.tecnico_acompanhante, nome))
    for (const o of todas) {
      const datas = new Set(diasDaOS(o as unknown as Record<string, unknown>))
      const cnpj = soDigitos(o.Cnpj_Cliente)
      const cli = semAcento(o.Os_Cliente || '').trim()
      for (const l of minhasLousa) {
        const mesmoCliente = (cnpj && soDigitos(l.cliente_cnpj) === cnpj) || (!l.cliente_cnpj && !!cli && semAcento(l.cliente_nome || '').trim() === cli)
        if (mesmoCliente && l.data) datas.add(String(l.data).slice(0, 10))
      }
      if (datas.size) agendaMap[o.Id_Ordem] = [...datas].sort()
    }
  }

  return { ordens: todas, preenchidas, enviadas, cidadeMap, enviadasCount: enviadas.size, agendaMap }
}

/* ═══ Helpers ═══ */
function getHoje() {
  return hojeBR()
}

/* ═══ Agrupar e buscar (José, 22/10/2026: "difícil achar as ordens") ═══ */
type Agrupar = 'situacao' | 'cliente' | 'nenhum'
const AGRUPAR_LS = 'nt-os-agrupar'
interface Grupo { k: string; rot: string; icon: LucideIcon; cor: string; lista: OrdemServico[]; semContagem?: boolean }

/** a OS bate com a busca? cliente, máquina (Projeto/modelo/chassi), nº da OS ("846", "0846", "OS-0846") e PPV —
 *  sem acento e sem maiúscula */
function casaBusca(o: OrdemServico, q: string): boolean {
  const num = numeroBuscado(q)
  if (num && String(o.Id_Ordem).replace(/\D/g, '').replace(/^0+/, '').includes(num)) return true
  const t = semAcento(q).trim()
  if (!t) return true
  return [o.Os_Cliente, o.ID_PPV, o.Id_Ordem, maquinaDaOS(o as unknown as Record<string, unknown>)]
    .some((c) => semAcento(c).includes(t))
}

/** "2026-10-21" ou ISO → "21/10/2026" (data pura sem cair no dia anterior pelo fuso) */
function dataBR(d: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim())
  return m ? `${m[3]}/${m[2]}/${m[1]}` : new Date(d).toLocaleDateString('pt-BR')
}

function formatarData(d: string) {
  const [ano, mes, dia] = d.split('-')
  return `${dia}/${mes}`
}

/* Fases e cartão de OS: components/OsCardTecnico.tsx */


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
  // busca em todas as OS sem internet: avisa e procura no que está guardado no celular
  const [buscaSemRede, setBuscaSemRede] = useState(false)
  // busca no banco (todas as OS, não só as do técnico) só quando ele pede
  const [buscarTodas, setBuscarTodas] = useState(false)
  // como agrupar a lista (lembrado no aparelho)
  const [agrupar, setAgruparState] = useState<Agrupar>(() => {
    try { const v = localStorage.getItem(AGRUPAR_LS); return v === 'cliente' || v === 'nenhum' ? v : 'situacao' } catch { return 'situacao' }
  })
  const setAgrupar = (v: Agrupar) => { setAgruparState(v); try { localStorage.setItem(AGRUPAR_LS, v) } catch { /* sem espaço */ } }
  const [fechados, setFechados] = useState<Set<string>>(() => new Set())
  const alternarGrupo = (k: string) => setFechados((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const mudarBusca = (v: string) => { setBusca(v); if (!v.trim()) setBuscarTodas(false) }

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

  // Busca no banco, em TODAS as OS (botão "Buscar em todas as OS") — com debounce
  useEffect(() => {
    // sem busca: a lista antiga não aparece (só é mostrada com buscarTodas + texto)
    if (!buscarTodas || !buscaDebounced.trim()) return
    let cancelled = false
    ;(async () => {
      setBuscando(true)
      // vírgula/parêntese/% quebravam o .or() (José, 23/10/2026)
      const termo = buscaDebounced.replace(/[,()%*]/g, ' ').replace(/\s+/g, ' ').trim()
      /** sem sinal: procura nas OS guardadas no celular */
      const buscarNoCelular = async () => {
        const guardadas = ((await offlineGet<OrdemServico[]>('prefetch:os-list')) || [])
        if (cancelled) return
        setBuscaSemRede(true)
        setResultadoBusca(guardadas.filter((o) => casaBusca(o, buscaDebounced)).slice(0, 20))
        setBuscando(false)
      }
      if (!termo) { setResultadoBusca([]); setBuscando(false); return }
      if (!navigator.onLine) { await buscarNoCelular(); return }
      try {
        const res = await Promise.race([
          supabase
            .from('Ordem_Servico')
            .select('*')
            .not('Status', 'in', '("Concluída","Cancelada","Concluida","cancelada")')
            .or(`Id_Ordem.ilike.%${termo}%,Os_Cliente.ilike.%${termo}%,ID_PPV.ilike.%${termo}%`)
            .limit(10),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
        ])
        if (cancelled) return
        if (res.error) throw new Error(res.error.message)
        setBuscaSemRede(false)
        const resultado = (res.data || []) as OrdemServico[]
        setResultadoBusca(resultado)
        const cnpjs = [...new Set(resultado.map(o => o.Cnpj_Cliente).filter(Boolean))]
        if (cnpjs.length > 0) {
          const { data: cliData } = await supabase.from('portal_nt_clientes_cadastro_omie').select('cnpj_cpf, cidade').in('cnpj_cpf', cnpjs)
          if (cancelled) return
          const mapa: Record<string, string> = {}
          cliData?.forEach((c: { cnpj_cpf: string; cidade: string | null }) => {
            if (c.cidade) mapa[c.cnpj_cpf] = c.cidade
          })
          setBuscaCidadeMap(mapa)
        }
        setBuscando(false)
      } catch {
        await buscarNoCelular()
      }
    })()
    return () => { cancelled = true }
  }, [buscaDebounced, buscarTodas])

  /* ── busca nas OS do próprio técnico (já carregadas), ao digitar ── */
  const todasAbertas = [...atrasadas, ...preencher, ...abertasExecucao, ...abertasOrcamento, ...abertasOutras]
  const q = busca.trim()
  const achadas = q ? todasAbertas.filter((o) => casaBusca(o, q)) : []
  const cartao = (os: OrdemServico, i: number, destaque?: string, cid?: string) => (
    // "Relatório preenchido" só com relatório ENVIADO (rascunho de horários não conta — José, 23/10/2026)
    <OsCard key={os.Id_Ordem} os={os} cidade={cid ?? cidadeMap[os.Cnpj_Cliente]} preenchida={enviadas.has(String(os.Id_Ordem))} index={i} destaque={destaque} />
  )

  /* ── grupos ── */
  const semInternas = (l: OrdemServico[]) => l.filter((o) => !ehInterna(o))
  const internas = todasAbertas.filter((o) => ehInterna(o))
  // Minhas OS = só as atrasadas e todas as abertas no nome dele; as enviadas têm o botão próprio na tela inicial
  // e o agrupar saiu (José, 23/10/2026)
  // atrasada = a mesma regra do cartão (previsão passou e a OS ainda está antes de feita), para a etiqueta e o grupo baterem
  const ehAtrasada = (o: OrdemServico) => { const p = (o.Previsao_Execucao || '').trim().slice(0, 10); return !!p && p < hoje && situacaoOS(o.Status, true, false) === SITUACAO.atrasada }
  const listaAtrasadas = todasAbertas.filter(ehAtrasada)
  const naoAtrasadas = todasAbertas.filter((o) => !ehAtrasada(o))
  const grupos: Grupo[] = [
    { k: 'atr', rot: 'Atrasadas', icon: AlertTriangle, cor: SITUACAO.atrasada.cor, lista: listaAtrasadas },
    { k: 'abe', rot: 'Abertas no seu nome', icon: FileText, cor: colors.primary, lista: naoAtrasadas },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {refreshing && <div className="refresh-bar" />}

      <PageHeader
        title="Ordens"
        subtitle={loading ? 'carregando…' : `${todasAbertas.length} abertas no seu nome${listaAtrasadas.length ? ` · ${listaAtrasadas.length} atrasada${listaAtrasadas.length > 1 ? 's' : ''}` : ''}`}
      />

      {/* ═══ ATRASADAS + ABERTAS ═══ */}
      {(
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* busca grande, fixa no topo ao rolar */}
          <div style={{
            position: 'sticky', top: 'calc(64px + env(safe-area-inset-top, 0px))', zIndex: 20, margin: '0 -16px', padding: '8px 16px 10px',
            background: colors.surfaceAlt, display: 'grid', gap: 8,
          }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 10, minHeight: 54, padding: '0 14px', borderRadius: 14,
              background: colors.surface, border: `1.5px solid ${q ? colors.primary : colors.border}`, cursor: 'text',
            }}>
              <Search size={21} color={q ? colors.primary : colors.textSubtle} style={{ flexShrink: 0 }} />
              <input
                value={busca}
                onChange={(e) => mudarBusca(e.target.value)}
                placeholder="Cliente, máquina, nº da OS ou PPV"
                inputMode="search"
                enterKeyHint="search"
                style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 17, color: colors.text, padding: '12px 0' }}
              />
              {busca && (
                <button type="button" onClick={() => mudarBusca('')} aria-label="limpar busca" style={{
                  width: 32, height: 32, borderRadius: 10, border: 'none', background: colors.surfaceAlt, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0,
                }}>
                  <X size={17} color={colors.textMuted} />
                </button>
              )}
            </label>
          </div>

          {q ? (
            /* ── resultado da busca ── */
            <>
              <div style={{ fontSize: 14, color: colors.textMuted, padding: '0 2px' }}>
                {loading ? 'carregando suas ordens…' : achadas.length === 0
                  ? <>Nenhuma das suas ordens abertas tem “{q}”.</>
                  : <><span style={{ color: colors.text, fontWeight: 500 }}>{achadas.length}</span> {achadas.length === 1 ? 'ordem encontrada' : 'ordens encontradas'} nas suas abertas</>}
              </div>
              {achadas.map((os, i) => cartao(os, i, q))}

              {!buscarTodas ? (
                <button type="button" onClick={() => setBuscarTodas(true)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px', borderRadius: 12,
                  background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontSize: 14, cursor: 'pointer',
                }}>
                  <Globe size={16} color={colors.primary} /> Buscar em todas as OS
                </button>
              ) : (
                <Section label="Em todas as OS" icon={Globe} color={colors.primary} count={buscando ? undefined : resultadoBusca.length}>
                  {buscaSemRede && !buscando && (
                    <div style={{ fontSize: 13.5, color: '#9A3412', background: colors.warningBg, border: `1px solid ${colors.warningBorder}`, borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
                      Sem internet: mostrando só as ordens guardadas no celular.
                    </div>
                  )}
                  {buscando ? (
                    <PageSpinner />
                  ) : resultadoBusca.length === 0 ? (
                    <EmptyState icon={FileText} title="Nenhuma OS encontrada" subtitle="A busca em todas as OS procura nº, cliente e PPV" />
                  ) : (
                    resultadoBusca.map((os, i) => cartao(os, i, q, buscaCidadeMap[os.Cnpj_Cliente]))
                  )}
                </Section>
              )}
            </>
          ) : loading ? (
            <PageSpinner />
          ) : todasAbertas.length === 0 ? (
            <EmptyState icon={FileText} title="Nenhuma OS aberta" subtitle="Você está em dia" />
          ) : (
            grupos.filter((g) => g.lista.length > 0).map((g) => {
              const aberto = !fechados.has(g.k)
              return (
                <div key={g.k} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                  <button type="button" onClick={() => alternarGrupo(g.k)} aria-expanded={aberto} style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', minWidth: 0, padding: '8px 10px', borderRadius: 12,
                    border: `1px solid ${colors.border}`, background: colors.surface, cursor: 'pointer', textAlign: 'left', color: colors.text,
                  }}>
                    <span style={{
                      width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
                      color: g.cor, background: clarinho(g.cor, 10),
                    }}><g.icon size={16} /></span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.rot}</span>
                    {!g.semContagem && (
                      <span style={{ fontSize: 13, padding: '1px 9px', borderRadius: 999, color: g.cor, background: clarinho(g.cor, 10), flexShrink: 0 }}>{g.lista.length}</span>
                    )}
                    <ChevronDown size={18} color={colors.textSubtle} style={{ flexShrink: 0, transition: 'transform .2s', transform: aberto ? 'rotate(180deg)' : 'none' }} />
                  </button>
                  {aberto && g.lista.map((os, i) => cartao(os, i))}
                </div>
              )
            })
          )}
        </div>
      )}


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
    `os-enviadas:v7:${nome}`,
    async () => {
      type RegTec = {
        IdOs: number; Ordem_Servico: string; TecResp1: string | null; TecResp2: string | null;
        Data: string; TipoServico: string | null; Status: string; pdf_criado: boolean; cliente?: string | null;
      }
      // Coluna se chama "Data" — NÃO "Data_Abertura" (esse era um nome inventado
      // que causava HTTP 400 silencioso e fazia a query inteira retornar []).
      type OS = { Id_Ordem: string; Status: string; Tipo_Servico: string | null; Os_Cliente: string | null; Data: string | null; Os_Tecnico?: string | null; Os_Tecnico2?: string | null }

      const FASES_FINALIZADAS = new Set([
        'Relatório Concluído', 'Relatorio Concluido',
        'Executada aguardando comercial',
        'Concluída', 'Concluida', 'Concluído', 'Concluido',
        'Faturada', 'Faturado',
        'Finalizada', 'Finalizado',
        'Enviado Para Omie', 'Enviado para Omie',
      ])

      // ESTRATÉGIA (espelha a do contador verde em fetchOsData):
      // 1) Busca OS onde o técnico aparece como Os_Tecnico OU Os_Tecnico2.
      // 2) Busca TODOS os registros dessas OS em Ordem_Servico_Tecnicos pelo ID,
      //    SEM filtrar por TecResp (cobre caso do TecResp2 preencher).
      // 3) Inclui qualquer OS que tenha registro 'enviado' OU OS principal já
      //    está em fase finalizada (Concluída/Faturada/etc.).
      const p1 = primeiroNome(nome)
      const { data: osList, error: osErr } = await supabase
        .from('Ordem_Servico')
        .select('Id_Ordem, Status, Tipo_Servico, Os_Cliente, Data, Os_Tecnico, Os_Tecnico2')
        .or(`Os_Tecnico.ilike.%${p1}%,Os_Tecnico2.ilike.%${p1}%`)
        .limit(3000)
      if (osErr) {
        console.warn('[os-enviadas] erro na query de OS:', osErr.message)
        return [] as RegTec[]
      }
      const osArr = ((osList || []) as OS[]).filter((o) => ehMinha(o, nome))
      if (osArr.length === 0) return [] as RegTec[]

      const ids = osArr.map(o => String(o.Id_Ordem))
      const { data: regsData, error: regsErr } = await supabase
        .from('Ordem_Servico_Tecnicos')
        .select('IdOs, Ordem_Servico, TecResp1, TecResp2, Data, TipoServico, Status, pdf_criado')
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
              IdOs: 0, Ordem_Servico: idOs, TecResp1: nome, TecResp2: null,
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

  const lista = (ordens || []) as Array<{ IdOs: number; Ordem_Servico: string; TipoServico: string | null; Data: string; cliente?: string | null }>
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
            const verde = SITUACAO.feita.cor
            return (
              <div
                key={os.Ordem_Servico}
                className="hb-in"
                style={{
                  background: clarinho(verde, 5), border: `1px solid ${clarinho(verde, 30, colors.border)}`,
                  borderRadius: 16, overflow: 'hidden', minWidth: 0,
                  animationDelay: `${Math.min(i * 45, 300)}ms`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 14px', background: verde, color: '#FEFEFE' }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Enviada</span>
                  <small style={{ fontSize: 12, opacity: 0.9 }}>{os.Data ? `relatório de ${dataBR(os.Data)}` : 'relatório enviado'}</small>
                </div>
                <button type="button" onClick={() => toggle(os.Ordem_Servico)} style={{
                  width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                  padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 11, color: colors.text,
                }}>
                  <span style={{
                    width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: verde,
                    display: 'grid', placeItems: 'center', color: '#FEFEFE',
                  }}>
                    <FileCheck size={18} />
                  </span>
                  <div style={{ display: 'grid', gap: 3, flex: 1, minWidth: 0 }}>
                    <span style={{
                      justifySelf: 'start', display: 'inline-flex', gap: 5, alignItems: 'baseline', fontSize: 13, padding: '0 8px',
                      borderRadius: 7, background: clarinho(verde, 8), border: `1px solid ${clarinho(verde, 20, 'transparent')}`,
                    }}>
                      <em style={{ fontStyle: 'normal', fontSize: 10.5, color: verde }}>OS</em>{numeroOS(os.Ordem_Servico)}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeBonito(os.cliente) || 'Sem cliente'}</span>
                    {os.TipoServico && <span style={{ fontSize: 13, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{os.TipoServico}</span>}
                  </div>
                  <ChevronDown size={18} color="#94A3B8" style={{ transition: 'transform 0.2s', transform: aberto ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
                </button>

                {aberto && (
                  <div style={{ padding: '0 14px 14px' }}>
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
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12,
                      padding: '10px 14px', borderRadius: 12, background: '#FEFEFE', border: `1px solid ${colors.border}`,
                      fontSize: 14, color: colors.text, textDecoration: 'none',
                    }}>Ver detalhes da ordem <ChevronRight size={16} color={colors.textSubtle} /></a>
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

