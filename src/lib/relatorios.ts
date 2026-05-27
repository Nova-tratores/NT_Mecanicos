import { supabase } from '@/lib/supabase'
import type {
  RelatorioMes,
  ResumoOficina,
  RankingItem,
  DesempenhoPessoal,
  OSItem,
  PVItem,
  ReqDespesaItem,
  InfracaoItem,
} from '@/lib/types'

// =================================================================
// Normalização e nome canônico (replica cleanName / normalizeForList do OMIE)
// =================================================================

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')

// Prefixos de cargo que vêm no nome (Omie / AppSheet) e devem ser removidos
const RE_PREFIXO_CARGO = /^(T[ÉE]CNICOS?|MEC[ÂA]NICOS?|MOTORISTAS?|VENDEDOR(ES)?|AUX(ILIARES)?|EXTERNO|PECAS|PEÇAS)[:\s]+/i

// Conectivos / preposições que devem virar espaço dentro do nome
const RE_CONECTIVOS = /\b(DE|DA|DO|DOS|DAS|E|OU|SR|SRA)\b/g

// Splitter de múltiplos técnicos numa única OS ("A // B", "A / B", "A & B", "A E B")
const RE_SPLIT_TECNICOS = /[/&]|\sE\s|\/\//

// Limpa um nome cru para forma canônica (UPPER, sem acentos, sem prefixo, sem conectivos).
// Retorna null se for considerado "lixo" (muito curto ou marcador de sistema).
export function cleanName(str: string | null | undefined): string | null {
  if (!str) return null
  let s = String(str).toUpperCase().normalize('NFD').replace(DIACRITICS, '').trim()
  s = s.replace(RE_PREFIXO_CARGO, '')
  s = s.replace(RE_CONECTIVOS, ' ')
  s = s.replace(/[^A-Z0-9 ]/g, ' ').trim().replace(/\s+/g, ' ')

  // Unificações conhecidas (espelha as do OMIE — server.js:48-66, 88-91)
  if (s.includes('PAULO') && (s.includes('JOAQUIM') || s.includes('MOTTA') || s.includes('MOTA'))) {
    return 'PAULO MOTTA'
  }
  if (s === 'JOSE OLIVEIRA' || s === 'JOSE ANTONIO OLIVEIRA') return 'JOSE ANTONIO OLIVEIRA'
  // "LUIZ FERNANDO" sozinho NÃO é unificado: pode ser Souza ou Sanches.
  // Só identificamos quando vem com o sobrenome.
  if (s.includes('SANCHES')) return 'LUIZ FERNANDO SANCHES'
  // "JOAQUIM" sozinho NÃO é unificado pois pode ser Paulo Joaquim (técnico),
  // não o vendedor Joaquim Fernando Leme. Só normaliza quando vem com "FERNANDO".
  if (s === 'FERNANDO DIRETOR' || s === 'JOAQUIM FERNANDO') return 'JOAQUIM FERNANDO LEME'
  if (s === 'MATHEUS DE MELO' || s === 'MATHEUS MELO') return 'MATHEUS MELO'
  if (s.includes('GABRIEL GOMES') || s.includes('GABRIEL MORAES')) return 'GABRIEL MORAES'

  if (s.length < 3) return null
  if (s.includes('FINALIZEI') || s.includes('TRANSFERENCIA') || s.includes('VIA API')) return null

  return s
}

// Capitaliza um nome canônico em UPPER para exibição amigável ("Paulo Motta")
function toTitulo(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase())
}

// Quebra um nome cru de OS em partes individuais já cleaned.
// Ex: "Técnicos: Danilo de Souza // José Antonio de Oliveira"
//   → [{ canonico: 'DANILO SOUZA', raw: 'Danilo de Souza' }, ...]
interface ParteTecnico {
  canonico: string
  raw: string
}
export function splitTecnicos(raw: string | null | undefined): {
  partes: ParteTecnico[]
  temPrefixoTecnico: boolean
} {
  if (!raw) return { partes: [], temPrefixoTecnico: false }
  const s = String(raw)
  const temPrefixoTecnico = /^\s*(T[ÉE]CNICOS?|MEC[ÂA]NICOS?|MOTORISTAS?)[:\s]/i.test(s)
  // Remove prefixo só pro split — cada parte ainda passa por cleanName que tira de novo
  const semPrefixo = s.replace(RE_PREFIXO_CARGO, '')
  const cruas = semPrefixo.split(RE_SPLIT_TECNICOS).map(p => p.trim()).filter(p => p.length > 2)
  const partes: ParteTecnico[] = []
  for (const c of cruas) {
    const canonico = cleanName(c)
    if (canonico) partes.push({ canonico, raw: c })
  }
  return { partes, temPrefixoTecnico }
}

// =================================================================
// Matching contra o usuário logado (compara nome canônico)
// =================================================================

interface ProfileNomes {
  nome_pos: string | null
  tecnico_nome: string
}

// Compara dois nomes JÁ em forma canônica (cleanName aplicado).
// Match exato OU bidirecional palavra-a-palavra — tolera 1 nome ter mais palavras
// que outro (ex: "PEDRO MOTTA" casa com "PEDRO HENRIQUE MOTTA").
function canonicoBate(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const palA = a.split(' ').filter(w => w.length >= 3)
  const palB = b.split(' ').filter(w => w.length >= 3)
  if (palA.length === 0 || palB.length === 0) return false
  return palA.every(w => palB.includes(w)) || palB.every(w => palA.includes(w))
}

function nomesCanonicosUsuario(profile: ProfileNomes): Set<string> {
  const set = new Set<string>()
  const a = cleanName(profile.nome_pos || '')
  const b = cleanName(profile.tecnico_nome || '')
  if (a) set.add(a)
  if (b) set.add(b)
  return set
}

// =================================================================
// Período
// =================================================================

export function mesAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export interface MesOpcao {
  value: string
  label: string
}

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export function mesesOpcoes(n = 12): MesOpcao[] {
  const out: MesOpcao[] = []
  const hoje = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${MESES_PT[d.getMonth()]}/${d.getFullYear()}`
    out.push({ value, label })
  }
  return out
}

function rangeMes(ym: string): { firstISO: string; lastISO: string; mes: string; ano: string } {
  const [ano, mes] = ym.split('-')
  const lastDay = new Date(parseInt(ano), parseInt(mes), 0).getDate()
  return {
    firstISO: `${ano}-${mes}-01`,
    lastISO: `${ano}-${mes}-${String(lastDay).padStart(2, '0')}`,
    mes,
    ano,
  }
}

// =================================================================
// Detectores de "faturado" / cancelado
// Replica regras do OMIE — OS (server.js:5930-5931) e PV (server.js:6025-6034)
// =================================================================

// OS faturada: etapa contém palavra de finalização. INTERNO/CORTESIA é separado
// (custo absorvido, não receita produtiva).
const RE_OS_FATURADO = /FATURAD|FINALIZAD|ENTREGUE|CONCLU|ENCERRADO/i
const RE_OS_INTERNO = /INTERNO|CORTESIA/i

// PV faturado: também aceita códigos numéricos "60"/"70" porque o Omie devolve
// a etapa às vezes como código sem o rótulo.
const RE_PV_FATURADO = /FATURAD|FINALIZAD|ENTREGUE|CONCLU|\b60\b|\b70\b/i
// PV cancelado: "CANCELAD" textual ou código "80".
const RE_PV_CANCELADO = /CANCELAD|\b80\b/i

function isCancelada(flag: string | null | undefined): boolean {
  const v = String(flag || '').trim().toUpperCase()
  return v === 'SIM' || v.startsWith('S')
}

// Cliente é a própria empresa = venda interna (descartar)
function ehVendaInterna(cliente: string | null | undefined): boolean {
  const c = String(cliente || '').toUpperCase()
  return c.includes('NOVA TRATORES') || c.includes('CASTRO MAQUINAS') || c.includes('CASTRO MÁQUINAS')
}

function parseDataBR(s: string | null | undefined): number | null {
  if (!s) return null
  const str = String(s).trim().split(' ')[0]
  if (str.includes('/')) {
    const [d, m, y] = str.split('/')
    if (d && m && y) return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T12:00:00`).getTime()
  }
  if (str.includes('-')) {
    return new Date(`${str}T12:00:00`).getTime()
  }
  return null
}

// =================================================================
// Tipos internos
// =================================================================

interface OSRow {
  numero_os: string
  nome_vendedor: string | null
  valor_total: number | null
  data_emissao: string | null
  data_abertura: string | null
  nome_etapa: string | null
  status_cancelada: string | null
  nome_cliente: string | null
  numero_contrato: string | null
}

interface PVRow {
  numero_venda: string
  vendedor: string | null
  valor_total: number | null
  data_emissao: string | null
  data_abertura: string | null
  etapa: string | null
  cancelada: string | null
  devolvido: string | null
  cliente: string | null
}

interface DespesaRow {
  id: string
  data_iso: string | null
  data: string | null
  vendedor: string | null
  descricao: string | null
  fornecedor: string | null
  valor: number | null
  origem: string | null
  tipo: string | null
  subtipo: string | null
  veiculo: string | null
  setor: string | null
  fase: string | null
}

interface ConfigVendedorRow {
  nome: string
  salario: number | null
  encargos: number | null
  cargo: string | null
}

// Cargos do config que classificam alguém como técnico/mecânico
function ehCargoTecnico(cargo: string | null | undefined): boolean {
  const c = String(cargo || 'PADRAO').toUpperCase()
  return c === 'PADRAO' || c.includes('TECNICO') || c.includes('MECANICO') || c === 'MOTORISTA'
}

// =================================================================
// Fetcher principal
// =================================================================

export async function fetchRelatorioMes(profile: ProfileNomes, ym: string): Promise<RelatorioMes> {
  const { firstISO, lastISO, mes, ano } = rangeMes(ym)
  const patternBR = `%/${mes}/${ano}`
  const patternISO = `${ano}-${mes}-%`

  const [osRes, pvRes, despRes, configRes, mecRes, tecAppRes, syncRes] = await Promise.all([
    supabase
      .from('ordens_servico_relatorio')
      .select('numero_os, nome_vendedor, valor_total, data_emissao, data_abertura, nome_etapa, status_cancelada, nome_cliente, numero_contrato')
      .or(
        `data_emissao.like.${patternBR},` +
        `data_emissao.like.${patternISO},` +
        `data_abertura.like.${patternBR},` +
        `data_abertura.like.${patternISO}`,
      )
      .limit(5000),

    supabase
      .from('pedidos_venda_relatorio')
      .select('numero_venda, vendedor, valor_total, data_emissao, data_abertura, etapa, cancelada, devolvido, cliente')
      .or(
        `data_emissao.like.${patternBR},` +
        `data_emissao.like.${patternISO},` +
        `data_abertura.like.${patternBR},` +
        `data_abertura.like.${patternISO}`,
      )
      .limit(5000),

    supabase
      .from('despesas_relatorio')
      .select('id, data_iso, data, vendedor, descricao, fornecedor, valor, origem, tipo, subtipo, veiculo, setor, fase')
      .gte('data_iso', firstISO)
      .lte('data_iso', lastISO)
      .limit(5000),

    supabase
      .from('config_vendedores_relatorio')
      .select('nome, salario, encargos, cargo'),

    // Técnicos cadastrados no portal NT_Mecanicos (fonte autoritativa local)
    supabase
      .from('mecanico_usuarios')
      .select('tecnico_nome')
      .eq('ativo', true),

    // Técnicos do POS/AppSheet (fonte autoritativa do sistema operacional)
    supabase
      .from('Tecnicos_Appsheet')
      .select('UsuNome'),

    supabase
      .from('ordens_servico_relatorio')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1),
  ])

  // ----- OS aprovadas (faturadas, não canceladas) -----
  const osAprovadas = ((osRes.data as OSRow[] | null) || []).filter(o => {
    const etapa = String(o.nome_etapa || '').toUpperCase()
    if (etapa.includes('CANCELAD')) return false
    if (isCancelada(o.status_cancelada)) return false
    return RE_OS_FATURADO.test(etapa)
  })

  // Separa OS produtivas (geram receita) das internas/cortesia (custo absorvido)
  const isOSInterna = (o: OSRow): boolean => {
    const contrato = String(o.numero_contrato || '').toUpperCase()
    if (RE_OS_INTERNO.test(contrato)) return true
    if (ehVendaInterna(o.nome_cliente)) return true
    return false
  }
  const osRows = osAprovadas.filter(o => !isOSInterna(o))
  const osInternasRows = osAprovadas.filter(isOSInterna)

  // ----- PV: faturado (texto ou códigos 60/70), não cancelado, não venda interna -----
  const pvRows = ((pvRes.data as PVRow[] | null) || []).filter(p => {
    const etapa = String(p.etapa || '').toUpperCase()
    if (RE_PV_CANCELADO.test(etapa)) return false
    if (isCancelada(p.cancelada) || isCancelada(p.devolvido)) return false
    if (!RE_PV_FATURADO.test(etapa)) return false
    if (ehVendaInterna(p.cliente)) return false
    return true
  })
  const despRows = ((despRes.data as DespesaRow[] | null) || [])
  const configRows = (configRes.data as ConfigVendedorRow[] | null) || []
  const mecRows = (mecRes.data as { tecnico_nome: string }[] | null) || []
  const tecAppRows = (tecAppRes.data as { UsuNome: string }[] | null) || []

  // ----- Universo de técnicos (união de 3 fontes) -----
  // 1) mecanico_usuarios — técnicos cadastrados no portal NT_Mecanicos
  // 2) Tecnicos_Appsheet — técnicos do POS/AppSheet
  // 3) config_vendedores_relatorio — config do OMIE (com cargo)
  // Vendedores (cargo=VENDEDOR no config) ficam de fora MESMO se aparecerem em outra fonte.
  const configByCanonico = new Map<string, ConfigVendedorRow>()
  const tecnicosConhecidos = new Set<string>()
  const vendedoresConhecidos = new Set<string>()
  const motoristasConhecidos = new Set<string>()

  for (const c of configRows) {
    const canonico = cleanName(c.nome)
    if (!canonico) continue
    configByCanonico.set(canonico, c)
    const cargoUpper = String(c.cargo || '').toUpperCase()
    // Motorista é técnico para fins de OS/PV, mas despesas vão pro comercial — registra separado
    if (cargoUpper === 'MOTORISTA') motoristasConhecidos.add(canonico)
    if (ehCargoTecnico(c.cargo)) {
      tecnicosConhecidos.add(canonico)
    } else if (cargoUpper === 'VENDEDOR') {
      vendedoresConhecidos.add(canonico)
    }
  }
  for (const m of mecRows) {
    const canonico = cleanName(m.tecnico_nome)
    if (canonico) tecnicosConhecidos.add(canonico)
  }
  for (const t of tecAppRows) {
    const canonico = cleanName(t.UsuNome)
    if (canonico) tecnicosConhecidos.add(canonico)
  }

  // Decide se um nome canônico (extraído de uma OS) conta como técnico.
  // - Cargo VENDEDOR no config: NUNCA (corta o comercial do ranking).
  // - Em qualquer das 3 fontes de técnicos: SIM.
  // - Raw com prefixo "Técnico:/Técnicos:/Mecânico:/Motorista:" mas sem cadastro: SIM (heurística).
  function ehTecnico(canonico: string, temPrefixoTecnico: boolean): boolean {
    if (vendedoresConhecidos.has(canonico)) return false
    if (tecnicosConhecidos.has(canonico)) return true
    return temPrefixoTecnico
  }

  // True se PELO MENOS UMA das partes do nome (após split) é técnico.
  // Usado para filtrar OS/PV cujo vendedor é da equipe técnica
  // (espelha NOMES_TECNICOS do OMIE em "Resumo Oficina Técnicos").
  function temAlgumTecnico(raw: string | null | undefined): boolean {
    const { partes, temPrefixoTecnico } = splitTecnicos(raw)
    if (partes.length === 0) return false
    return partes.some(p => ehTecnico(p.canonico, temPrefixoTecnico))
  }

  // ----- Totalizadores da oficina — SÓ produção dos técnicos -----
  // Espelha o "Resumo Oficina (Técnicos)" do OMIE: PVs comerciais (vendas de tratores
  // pelo time comercial) ficam fora; só entram OS/PV cujo vendedor é técnico.
  const osTec = osRows.filter(o => temAlgumTecnico(o.nome_vendedor))
  const pvTec = pvRows.filter(p => temAlgumTecnico(p.vendedor))
  // Despesa total da oficina — operacional aprovado, sem motorista nem loja.
  // Motoristas (caminhoneiros): despesas SEMPRE saem, mesmo se o pedido tiver
  // vindo da oficina (são custos do departamento de transporte/comercial).
  const despTec = despRows.filter(d => {
    const setor = String(d.setor || '').toUpperCase().replace(/[\s\-_]/g, '')
    if (setor.includes('TRATORLOJA')) return false

    const fase = String(d.fase || '').toUpperCase()
    if (['AGUARDANDO', 'COTACAO', 'COTAÇÃO', 'APROVACAO', 'APROVAÇÃO'].some(x => fase.includes(x))) return false

    // Despesas de motoristas (cargo MOTORISTA no config) → não contam pra oficina
    const canonico = cleanName(d.vendedor || '')
    if (canonico && motoristasConhecidos.has(canonico)) return false

    return true
  })

  const receitaOS = osTec.reduce((acc, o) => acc + Number(o.valor_total || 0), 0)
  const receitaPV = pvTec.reduce((acc, p) => acc + Number(p.valor_total || 0), 0)
  const despesaOperacional = despTec.reduce((acc, d) => acc + Number(d.valor || 0), 0)

  // Custo RH total da oficina — soma salário+encargos APENAS de técnicos/mecânicos
  // (cargo PADRAO, TECNICO ou MECANICO). Motoristas, vendedores e admin ficam de fora.
  const custoRHTotal = configRows.reduce((acc, c) => {
    const cargoUpper = String(c.cargo || 'PADRAO').toUpperCase()
    const ehMecanico =
      cargoUpper === 'PADRAO' ||
      cargoUpper.includes('TECNICO') ||
      cargoUpper.includes('MECANICO')
    if (!ehMecanico) return acc
    return acc + Number(c.salario || 0) + Number(c.encargos || 0)
  }, 0)

  const oficina: ResumoOficina = {
    receitaTotal: receitaOS + receitaPV,
    despesaTotal: despesaOperacional + custoRHTotal,
    despesaOperacional,
    custoRHTotal,
    qtdOS: osTec.length,
    qtdPV: pvTec.length,
    qtdDespesas: despTec.length,
  }

  // ----- Ranking (SOMENTE técnicos, SOMENTE OS, multi-técnico dividido) -----
  const ranking = new Map<string, { valor: number; qtd: number }>()

  for (const o of osRows) {
    const { partes, temPrefixoTecnico } = splitTecnicos(o.nome_vendedor)
    if (partes.length === 0) continue
    // Filtra só os técnicos da OS (descarta partes que sejam vendedor cadastrado)
    const tecnicos = partes.filter(p => ehTecnico(p.canonico, temPrefixoTecnico))
    if (tecnicos.length === 0) continue
    const valorPorTecnico = Number(o.valor_total || 0) / tecnicos.length
    for (const t of tecnicos) {
      const atual = ranking.get(t.canonico) || { valor: 0, qtd: 0 }
      atual.valor += valorPorTecnico
      atual.qtd += 1
      ranking.set(t.canonico, atual)
    }
  }

  const meusCanonicos = nomesCanonicosUsuario(profile)
  const rankingArr: RankingItem[] = Array.from(ranking.entries())
    .map(([canonico, agg]) => ({
      nome: toTitulo(canonico),
      valor: agg.valor,
      qtd: agg.qtd,
      isMe: meusCanonicos.has(canonico),
    }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 10)

  // ----- Desempenho pessoal -----
  const fmtDataLista = (s: string | null): string => {
    const ts = parseDataBR(s)
    if (!ts) return ''
    return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }

  // OS minhas (com split: se eu sou 1 de 2, recebo metade)
  const listaOS: OSItem[] = []
  let valorOS = 0
  for (const o of osRows) {
    const { partes, temPrefixoTecnico } = splitTecnicos(o.nome_vendedor)
    if (partes.length === 0) continue
    const tecnicos = partes.filter(p => ehTecnico(p.canonico, temPrefixoTecnico))
    if (tecnicos.length === 0) continue
    if (!tecnicos.some(t => meusCanonicos.has(t.canonico))) continue
    const minhaParte = Number(o.valor_total || 0) / tecnicos.length
    valorOS += minhaParte
    listaOS.push({
      numero: o.numero_os,
      cliente: o.nome_cliente || '',
      valor: minhaParte,
      data: fmtDataLista(o.data_emissao || o.data_abertura),
    })
  }
  listaOS.sort((a, b) => b.valor - a.valor)

  // OS internas / cortesia do técnico — custo absorvido pela empresa,
  // mostradas separadamente como "perda" no saldo pessoal.
  const listaOSInt: OSItem[] = []
  let valorOSInt = 0
  for (const o of osInternasRows) {
    const { partes, temPrefixoTecnico } = splitTecnicos(o.nome_vendedor)
    if (partes.length === 0) continue
    const tecnicos = partes.filter(p => ehTecnico(p.canonico, temPrefixoTecnico))
    if (tecnicos.length === 0) continue
    if (!tecnicos.some(t => meusCanonicos.has(t.canonico))) continue
    const minhaParte = Number(o.valor_total || 0) / tecnicos.length
    valorOSInt += minhaParte
    listaOSInt.push({
      numero: o.numero_os,
      cliente: o.nome_cliente || 'Interno / Cortesia',
      valor: minhaParte,
      data: fmtDataLista(o.data_emissao || o.data_abertura),
    })
  }
  listaOSInt.sort((a, b) => b.valor - a.valor)

  // PV meus (PV geralmente tem um único vendedor — split por garantia, sem rateio)
  const listaPV: PVItem[] = []
  let valorPV = 0
  for (const p of pvRows) {
    const { partes } = splitTecnicos(p.vendedor)
    if (partes.length === 0) continue
    if (!partes.some(x => meusCanonicos.has(x.canonico))) continue
    const v = Number(p.valor_total || 0)
    valorPV += v
    listaPV.push({
      numero: p.numero_venda,
      cliente: p.cliente || '',
      valor: v,
      data: fmtDataLista(p.data_emissao || p.data_abertura),
    })
  }
  listaPV.sort((a, b) => b.valor - a.valor)

  // Requisições no financeiro (origem=SUPABASE, vendedor casa com canônico do usuário)
  const listaReq: ReqDespesaItem[] = []
  let valorReq = 0
  // Combustível do veículo do técnico (tipo=Veicular + subtipo=Abastecimento, qualquer origem)
  const listaComb: ReqDespesaItem[] = []
  let valorComb = 0

  for (const d of despRows) {
    const canonico = cleanName(d.vendedor || '')
    if (!canonico || !meusCanonicos.has(canonico)) continue

    const v = Number(d.valor || 0)
    const tipoUpper = String(d.tipo || '').toUpperCase()
    const subUpper = String(d.subtipo || '').toUpperCase()
    const ehVeicular = tipoUpper === 'VEICULAR' || tipoUpper === 'ABASTECIMENTO'
    const ehAbastecimento = ehVeicular && subUpper.includes('ABASTECIMENTO')

    if (ehAbastecimento) {
      valorComb += v
      listaComb.push({
        id: d.id,
        descricao: d.descricao || (d.veiculo ? `Abastecimento ${d.veiculo}` : 'Abastecimento'),
        fornecedor: d.fornecedor || '',
        valor: v,
        data: fmtDataLista(d.data_iso || d.data),
      })
      continue
    }

    // Requisição = despesa não-veicular originada do app NT_Mecanicos
    if (String(d.origem || '').toUpperCase() === 'SUPABASE') {
      valorReq += v
      listaReq.push({
        id: d.id,
        descricao: d.descricao || '',
        fornecedor: d.fornecedor || '',
        valor: v,
        data: fmtDataLista(d.data_iso || d.data),
      })
    }
  }
  listaReq.sort((a, b) => b.valor - a.valor)
  listaComb.sort((a, b) => b.valor - a.valor)

  // Custo RH — busca config do próprio técnico via fuzzy match.
  // Match exato pode falhar quando o config tem nome completo (ex: "PEDRO HENRIQUE
  // MOTTA") e o login do app tem nome curto ("PEDRO MOTTA"). Bidirecional palavra
  // a palavra resolve esses casos.
  let custoRH: number | null = null
  outer: for (const cfg of configRows) {
    const canonicoCfg = cleanName(cfg.nome)
    if (!canonicoCfg) continue
    for (const meu of meusCanonicos) {
      if (canonicoBate(meu, canonicoCfg)) {
        custoRH = Number(cfg.salario || 0) + Number(cfg.encargos || 0)
        break outer
      }
    }
  }

  // Infrações de trânsito (Overpass API server-side, com cache de tiles)
  const infRes = await fetchInfracoesMes(profile, firstISO, lastISO)

  const pessoal: DesempenhoPessoal = {
    os: { qtd: listaOS.length, valor: valorOS, lista: listaOS },
    pv: { qtd: listaPV.length, valor: valorPV, lista: listaPV },
    requisicoes: { qtd: listaReq.length, valor: valorReq, lista: listaReq },
    combustivel: { qtd: listaComb.length, valor: valorComb, lista: listaComb },
    osInternas: { qtd: listaOSInt.length, valor: valorOSInt, lista: listaOSInt },
    infracoes: { qtd: infRes.lista.length, lista: infRes.lista, motivoVazio: infRes.motivoVazio },
    custoRH,
  }

  const syncRow = (syncRes.data as { updated_at: string }[] | null)?.[0]
  const ultimoSync = syncRow?.updated_at || null

  return {
    mes: ym,
    oficina,
    ranking: rankingArr,
    pessoal,
    ultimoSync,
  }
}

// =================================================================
// Infrações — chama o endpoint server-side
// =================================================================

interface InfracoesResp {
  infracoes?: InfracaoItem[]
  stats?: {
    totalPontos?: number
    motivo?: string
  }
}

async function fetchInfracoesMes(
  profile: ProfileNomes,
  firstISO: string,
  lastISO: string,
): Promise<{ lista: InfracaoItem[]; motivoVazio?: string }> {
  const motorista = profile.nome_pos || profile.tecnico_nome
  if (!motorista) return { lista: [], motivoVazio: 'Sem nome de motorista configurado no perfil.' }
  try {
    const url = `/api/infracoes?motorista=${encodeURIComponent(motorista)}&dataInicio=${firstISO}&dataFim=${lastISO}`
    const res = await fetch(url)
    if (!res.ok) return { lista: [], motivoVazio: `Endpoint retornou erro ${res.status}.` }
    const json = await res.json() as InfracoesResp
    const lista = json.infracoes || []
    if (lista.length === 0 && json.stats?.motivo) {
      return { lista, motivoVazio: json.stats.motivo }
    }
    return { lista }
  } catch (e) {
    console.warn('[relatorios] Falha ao buscar infrações:', e)
    return { lista: [], motivoVazio: 'Falha ao consultar o servidor (offline?).' }
  }
}

// =================================================================
// Formatadores compartilhados
// =================================================================

export function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
}

export function fmtBRLCompacto(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (Math.abs(n) >= 1_000) return `R$ ${(n / 1_000).toFixed(1).replace('.', ',')}k`
  return fmtBRL(n)
}
