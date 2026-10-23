'use client'
import { numeroBR } from '@/lib/numero'
import { hojeBR } from '@/lib/hoje'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { use } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import type { OrdemServico } from '@/lib/types'
import { getCachedOS, getCachedOSTec, getCachedTecnicos, getCachedVeiculos, getCachedPPV } from '@/lib/prefetch'
import { offlineSet, addPendingPdf, removePendingPdf, queueSync } from '@/lib/offlineCache'
import { diasDoRegistro, buscarRelatorioDaOS, minutosDoDia, horasTexto, horasDecimais, atualizarCacheRelatorio } from '@/lib/diasRelatorio'
import { downloadFotoRelatorio, cidadeDoCliente } from '@/lib/gerarEAnexarRelatorio'
import FotoUpload from '@/components/FotoUpload'
import SignaturePad from '@/components/SignaturePad'
import { ArrowLeft, Plus, Minus, CheckCircle, Send, Truck, Camera, Package, AlertTriangle, FileDown, ImagePlus, X, Video, Check, ClipboardList, FileText, MapPin, Tractor, Wrench } from 'lucide-react'
import Link from 'next/link'
import { colors } from '@/lib/ui'
import { gerarPdfRelatorio } from '@/lib/gerarPdfRelatorio'
import { gerarEAnexarRelatorio } from '@/lib/gerarEAnexarRelatorio'
import { notificarPortalOS } from '@/lib/notificarPortal'
import { criarGarantia, listarPecasOS } from '@/lib/garantias/client'
import type { PecaOS } from '@/lib/garantias/types'
import { ShieldCheck, CheckCircle2 } from 'lucide-react'
import EscolherVeiculo, { useCarrosFrota } from '@/components/EscolherVeiculo'
import { equipamentoDaOS } from '@/lib/equipamentoDaOS'
import DitadoRelatorio from '@/components/relatorio/DitadoRelatorio'
import GpsDoDia from '@/components/relatorio/GpsDoDia'
import EscolherFazenda from '@/components/relatorio/EscolherFazenda'
import LeituraFoto from '@/components/relatorio/LeituraFoto'
import ResumoEnvio from '@/components/relatorio/ResumoEnvio'
import AssinaturaTecnico from '@/components/relatorio/AssinaturaTecnico'
import NotificacaoObrigatoria from '@/components/NotificacaoObrigatoria'

const VIDEO_EXTS = /\.(mp4|mov|webm|avi|mkv|3gp)(\?|$)/i
function isVideo(url: string): boolean {
  if (!url) return false
  if (url.startsWith('data:video/')) return true
  if (url.startsWith('blob:')) return false // can't tell from blob URL alone
  return VIDEO_EXTS.test(url)
}
const MAX_VIDEO_MB = 50

const TIPOS_SERVICO_GRUPOS = [
  {
    grupo: 'Trator',
    itens: ['Revisão Trator', 'Manutenção Trator', 'Entrega Técnica Trator', 'Inspeção Pré Entrega Trator', 'Garantia Trator'],
  },
  {
    grupo: 'Implemento',
    itens: ['Revisão Implemento', 'Manutenção Implemento', 'Montagem Implemento', 'Entrega Técnica Implemento', 'Inspeção Pré Entrega Implemento', 'Garantia Implemento'],
  },
]
const HORAS_REVISAO = ['50', '300', '600', '900', '1200', '1500', '1800', '2100', '2400', '2700', '3000']

// Almoços lançados na OS pelo pós-vendas (campo Alimentacoes). Só os de valor > R$1
// exigem a foto da nota. Devolve {data, valor} ordenado por data.
function parseAlmocosOS(raw: unknown): { data: string; valor: number }[] {
  let arr: unknown[] = []
  if (Array.isArray(raw)) arr = raw
  else if (typeof raw === 'string') { try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p } catch {} }
  return arr
    .map((a) => {
      const o = (a || {}) as Record<string, unknown>
      return { data: String(o.data || '').slice(0, 10), valor: Number(o.valor) || 0 }
    })
    .filter((a) => a.data && a.valor > 1)
    .sort((a, b) => a.data.localeCompare(b.data))
}

interface DiaForm {
  data: string
  horaInicio: string
  horaFim: string
  kmTotal: string
  /** fim antes do início confirmado como virada da meia-noite (José, 23/10/2026) */
  virouNoite?: boolean
}

/** foto/vídeo extra com id fixo — por índice, apagar uma foto enquanto outra subia trocava as duas de lugar */
interface FotoExtra { id: string; v: string }
const novoId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const paraExtras = (lista: unknown): FotoExtra[] => (Array.isArray(lista) ? lista : [])
  .map((x) => (typeof x === 'string' ? { id: novoId(), v: x } : (x && typeof x === 'object' && typeof (x as FotoExtra).v === 'string' ? { id: String((x as FotoExtra).id || novoId()), v: (x as FotoExtra).v } : null)))
  .filter((x): x is FotoExtra => !!x && !!x.v)

/** quantidade digitada ("2,5" ou "2.5") */
const qtdNum = (v: unknown) => parseFloat(String(v ?? '').replace(',', '.')) || 0

/* Fases ANTES do relatório: só nelas o envio sobe a OS para 'Relatório Concluído' (José, 23/10/2026).
   Lógica invertida: a lista do "depois" não casava com o banco ("Enviar Omie", "Cobrando Cliente") e reeditar
   voltava a OS de fase. Fase desconhecida fica como está.
   Status distintos em Ordem_Servico (REST, 23/10/2026): Aguardando ordem Técnico (21), Cancelada (182),
   Cobrando Cliente (2), Concluída (609), Enviar Omie (15), Execução (2), Execução aguardando peças
   (em transporte) (2), Orçamento enviado para o cliente e aguardando (3), Preenchido Garantia (21),
   Relatório Concluído (2). Ordem das fases: lib/constants FASES_OS. */
const normFase = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
const FASES_ANTES_DO_RELATORIO = new Set([
  '', 'Orçamento', 'Orçamento enviado para o cliente e aguardando', 'Execução', 'Execução Procurando peças',
  'Execução aguardando peças (em transporte)', 'Aguardando outros', 'Aguardando ordem Técnico',
].map(normFase))

interface PecaInfo {
  descricao: string
  codigo: string
  qtdUsada: string
  devolvida: boolean
  qtdDevolvida: string
  origem: 'ppv' | 'manual'
  qtdOriginal: string
  naoUsada: boolean
  revisado: boolean
  /** chave fixa da peça (garantia marca por ela, não pela posição na lista) */
  uid?: string
}

/** chave fixa: peça do PPV = código; extra = uid criado na hora */
const chavePeca = (p: PecaInfo) => (p.origem === 'ppv' && p.codigo ? `ppv:${p.codigo}` : (p.uid || `m:${p.codigo || p.descricao}`))
const comUid = (lista: PecaInfo[]) => lista.map((p) => (p.uid ? p : { ...p, uid: p.origem === 'ppv' && p.codigo ? `ppv:${p.codigo}` : `m:${novoId()}` }))

interface MovimentacaoPPV {
  Id: number
  Id_PPV: string
  CodProduto: string
  Descricao: string
  Qtde: string
  Preco: number
  TipoMovimento: string
}

export default function PreencherOS({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user } = useCurrentUser()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sucesso, setSucesso] = useState(false)
  const [naFila, setNaFila] = useState(false) // enviado sem internet: guardado no celular (José, 23/10/2026)
  const [os, setOs] = useState<OrdemServico | null>(null)
  const [tecnicos, setTecnicos] = useState<string[]>([])
  const [veiculos, setVeiculos] = useState<{ IdPlaca: number; NumPlaca: string }[]>([])
  const [existingId, setExistingId] = useState<number | null>(null)

  // Form state
  const [tecResp1, setTecResp1] = useState('')
  const [temTec2, setTemTec2] = useState(false)
  const [tecResp2, setTecResp2] = useState('')
  const [diagnostico, setDiagnostico] = useState('')
  const [servicoRealizado, setServicoRealizado] = useState('')
  const [tipoServico, setTipoServico] = useState('')
  // "É GARANTIA?" — resposta EXPLÍCITA e obrigatória antes de enviar: os
  // técnicos esqueciam de marcar o tipo Garantia perdido no meio do dropdown
  // (pedido do usuário, 22/07/2026). null = ainda não respondeu.
  const [ehGarantia, setEhGarantia] = useState<'sim' | 'nao' | null>(null)
  const [tipoRev, setTipoRev] = useState('')
  const [projeto, setProjeto] = useState('')
  const [chassis, setChassis] = useState('')
  const [marca, setMarca] = useState('')
  const [modelo, setModelo] = useState('')
  const [horimetro, setHorimetro] = useState('')
  const [numPlaca, setNumPlaca] = useState('')
  // seções completas recolhidas (as que abrem completas já vêm recolhidas; tocar no título abre/fecha)
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set())
  const recolheuInicio = useRef(false)
  const linhaTempoRef = useRef<HTMLDivElement>(null)
  const passosRef = useRef<{ k: string; ok: boolean; alvo?: string }[]>([])
  const equipDaOSRef = useRef(false)
  const alternarSecao = (k: string) => setRecolhidas((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n })
  // "Confira antes de enviar"
  const [resumoAberto, setResumoAberto] = useState(false)
  const resumoConfirmado = useRef(false)
  // carros da frota (foto, busca, ficha) e o carro vinculado ao técnico
  const carrosFrota = useCarrosFrota()
  // marca/modelo/chassi preenchidos a partir da OS (o técnico confere e troca)
  const [equipDaOS, setEquipDaOS] = useState(false)
  /** relatório sem marca/modelo/chassi: usa o que a OS já tem (Projeto + cabeçalho da solicitação) */
  const preencherEquipDaOS = (osData: Record<string, unknown> | null | undefined, salvo?: Record<string, unknown> | null) => {
    if (!osData || (salvo && (salvo.Marca || salvo.Modelo || salvo.Chassis))) return
    const eq = equipamentoDaOS(osData.Projeto, osData.Serv_Solicitado)
    if (!eq.marca && !eq.modelo && !eq.chassi) return
    setMarca(eq.marca); setModelo(eq.modelo); setChassis(eq.chassi)
    if (eq.horimetro && !(salvo && salvo.Horimetro)) setHorimetro(eq.horimetro)
    setEquipDaOS(true)
  }
  const [nomResp, setNomResp] = useState('')
  const [fazenda, setFazenda] = useState('')
  const [cidadeLocal, setCidadeLocal] = useState('')
  const [naOficina, setNaOficina] = useState(false) // serviço realizado na oficina

  // mantém a resposta "É garantia?" coerente com o tipo escolhido no dropdown:
  // tipo Garantia = SIM automático; saiu de Garantia = volta a perguntar
  useEffect(() => {
    if (tipoServico.includes('Garantia')) setEhGarantia('sim')
    else setEhGarantia(prev => (prev === 'sim' ? null : prev))
  }, [tipoServico])

  // Dias (dinâmico)
  const [dias, setDias] = useState<DiaForm[]>([{ data: '', horaInicio: '', horaFim: '', kmTotal: '' }])
  const diasFromDBRef = useRef(false)
  // dias como vieram do banco: o rascunho do celular só vale se foi feito em cima destes mesmos dias
  const diasBaseRef = useRef('')

  // Peças informadas pelo técnico
  const [pecas, setPecas] = useState<PecaInfo[]>([])
  const pecasRef = useRef<PecaInfo[]>([])
  pecasRef.current = pecas
  const [loadingPPV, setLoadingPPV] = useState(false)
  const [ppvRevisado, setPpvRevisado] = useState(false)
  const [justificativaPecaExtra, setJustificativaPecaExtra] = useState('')

  // Garantia — peças solicitadas (índices em `pecas` que entram na requisição de garantia)
  const [pecasGarantia, setPecasGarantia] = useState<Set<string>>(new Set())
  const [garantiaObs, setGarantiaObs] = useState('')

  // Fotos
  const [fotoHorimetro, setFotoHorimetro] = useState('')
  const [fotoChassis, setFotoChassis] = useState('')
  const [fotoFrente, setFotoFrente] = useState('')
  const [fotoDireita, setFotoDireita] = useState('')
  const [fotoEsquerda, setFotoEsquerda] = useState('')
  const [fotoTraseira, setFotoTraseira] = useState('')
  const [fotoVolante, setFotoVolante] = useState('')
  const [fotoFalha1, setFotoFalha1] = useState('')
  const [fotoFalha2, setFotoFalha2] = useState('')
  const [fotoFalha3, setFotoFalha3] = useState('')
  const [fotoFalha4, setFotoFalha4] = useState('')
  const [fotoPecaNova1, setFotoPecaNova1] = useState('')
  const [fotoPecaNova2, setFotoPecaNova2] = useState('')
  const [fotoPecaInstalada1, setFotoPecaInstalada1] = useState('')
  const [fotoPecaInstalada2, setFotoPecaInstalada2] = useState('')
  const [fotosExtras, setFotosExtras] = useState<FotoExtra[]>([])

  // Almoço: os dias/valores vêm da OS (Alimentacoes, lançados pelo pós-vendas).
  // O técnico anexa a foto da nota de cada dia com valor > R$1. { data → foto }
  const [almocosOS, setAlmocosOS] = useState<{ data: string; valor: number }[]>([])
  const [fotosAlmoco, setFotosAlmoco] = useState<Record<string, string>>({})

  // Assinaturas
  const [assCliente, setAssCliente] = useState('')
  const [assTecnico, setAssTecnico] = useState('')
  const [erroValidacao, setErroValidacao] = useState('')

  /** lê as movimentações do PPV: banco (com tempo máximo) → cache. null = não veio dado nenhum. */
  const lerMovsPPV = async (idPPV: string): Promise<MovimentacaoPPV[] | null> => {
    const ppvTimeout = <T,>(p: PromiseLike<T>): Promise<T> =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))])
    if (navigator.onLine) {
      try {
        const res = await ppvTimeout(supabase.from('movimentacoes').select('*').eq('Id_PPV', idPPV))
        if (!res.error && res.data) {
          offlineSet(`prefetch:ppv:${idPPV}`, res.data) // cache-on-read
          return res.data as MovimentacaoPPV[]
        }
      } catch { /* cai no cache */ }
    }
    return ((await getCachedPPV(idPPV)) as MovimentacaoPPV[] | null) || null
  }

  /** junta o PPV (fonte de verdade das peças separadas) com o que o técnico já respondeu */
  const mesclarPPV = (existentes: PecaInfo[], movs: MovimentacaoPPV[]): PecaInfo[] => {
    const manuais = existentes.filter(p => p.origem === 'manual')
    // Agregar movimentações por CodProduto — soma quantidades, evita duplicatas
    const agrupado = new Map<string, { descricao: string; codigo: string; qtdTotal: number }>()
    for (const m of movs) {
      const cod = (m.CodProduto || '').trim()
      if (!cod) continue
      const existing = agrupado.get(cod)
      const q = qtdNum(m.Qtde)
      const qty = /devolu/i.test(m.TipoMovimento || '') ? -q : q
      if (existing) {
        existing.qtdTotal += qty
        if (m.Descricao) existing.descricao = m.Descricao
      } else {
        agrupado.set(cod, { descricao: m.Descricao || cod, codigo: cod, qtdTotal: qty })
      }
    }
    // só o que ainda está separado no PPV (item todo devolvido some da lista)
    const pecasPPV = Array.from(agrupado.values()).filter(a => a.qtdTotal > 0).map(a => ({
      descricao: a.descricao, codigo: a.codigo, qtdOriginal: String(Math.round(a.qtdTotal * 1000) / 1000),
    }))
    const ppvExistentes = new Map<string, PecaInfo>()
    for (const p of existentes.filter(p => p.origem === 'ppv')) ppvExistentes.set(p.codigo, p)
    const merged: PecaInfo[] = pecasPPV.map((ppv) => {
      const jaExiste = ppvExistentes.get(ppv.codigo)
      if (jaExiste) {
        // Atualiza descrição e quantidade do PPV, preserva a resposta do técnico;
        // quantidade usada nunca passa do que está separado
        const usada = qtdNum(jaExiste.qtdUsada)
        const max = qtdNum(ppv.qtdOriginal)
        return { ...jaExiste, descricao: ppv.descricao, qtdOriginal: ppv.qtdOriginal, qtdUsada: usada > max ? ppv.qtdOriginal : jaExiste.qtdUsada }
      }
      return {
        descricao: ppv.descricao, codigo: ppv.codigo, qtdUsada: ppv.qtdOriginal, devolvida: false, qtdDevolvida: '',
        origem: 'ppv' as const, qtdOriginal: ppv.qtdOriginal, naoUsada: false, revisado: false, uid: `ppv:${ppv.codigo}`,
      }
    })
    return comUid([...merged, ...manuais])
  }

  /**
   * Carrega/atualiza as peças do PPV. silencioso = atualização automática: sem spinner, mescla sobre o que
   * está na tela AGORA (não apaga o que foi digitado nem peças já respondidas) e não mexe em nada quando não
   * vem dado (José, 23/10/2026).
   */
  const carregarProdutosPPV = async (idPPV: string, pecasAtuais?: PecaInfo[], silencioso = false) => {
    if (!silencioso) setLoadingPPV(true)
    try {
      const movs = await lerMovsPPV(idPPV)
      if (silencioso) {
        if (movs && movs.length > 0) setPecas((prev) => mesclarPPV(prev, movs))
        return
      }
      const existentes = pecasAtuais || []
      if (movs === null) setPecas(comUid(existentes)) // sem dado: fica o que já tinha
      else setPecas(mesclarPPV(existentes, movs))
    } finally {
      if (!silencioso) setLoadingPPV(false)
    }
  }

  /** peças salvas no relatório (PecasInfo) */
  const lerPecasInfo = (raw: unknown): PecaInfo[] | null => {
    if (!raw) return null
    try {
      const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<PecaInfo>[]
      if (!Array.isArray(parsed)) return null
      return comUid(parsed.map((p) => ({
        descricao: p.descricao || '', codigo: p.codigo || '', qtdUsada: p.qtdUsada || '',
        devolvida: p.devolvida || false, qtdDevolvida: p.qtdDevolvida || '',
        origem: p.origem || 'manual', qtdOriginal: p.qtdOriginal || '',
        naoUsada: p.naoUsada || false, revisado: p.revisado !== undefined ? p.revisado : true,
        uid: p.uid,
      })))
    } catch { return null }
  }

  /** aplica na tela a OS (Ordem_Servico) — do banco ou do cache */
  const aplicarOS = (osData: Record<string, unknown> | null) => {
    if (!osData) return
    setOs(osData as unknown as OrdemServico)
    if (osData.Projeto) setProjeto(osData.Projeto as string)
    if (osData.Tipo_Servico) setTipoServico(osData.Tipo_Servico as string)
    setAlmocosOS(parseAlmocosOS(osData.Alimentacoes))
  }

  /** aplica na tela o relatório já salvo — o MESMO caminho online e offline (antes o offline/fallback pulava
   *  metade dos campos e reenviava fotos/dias vazios). */
  const aplicarRelatorio = async (t: Record<string, unknown>, osData: Record<string, unknown> | null) => {
    const str = (k: string) => (t[k] as string) || ''
    setExistingId((t.IdOs as number) || null)
    setTecResp1(str('TecResp1'))
    setTemTec2(!!t.TemTec)
    setTecResp2(str('TecResp2'))
    setDiagnostico(str('Motivo'))
    setServicoRealizado(str('ServicoRealizado'))
    setTipoServico(str('TipoServico') || (osData?.Tipo_Servico as string) || '')
    // relatório já preenchido antes = "É garantia?" já foi respondida
    if (t.TipoServico) setEhGarantia(String(t.TipoServico).includes('Garantia') ? 'sim' : 'nao')
    setTipoRev(str('TipoRev'))
    setProjeto(str('Projeto') || (osData?.Projeto as string) || '')
    setChassis(str('Chassis'))
    setMarca(str('Marca'))
    setModelo(str('Modelo'))
    setHorimetro(str('Horimetro'))
    preencherEquipDaOS(osData, t)
    setNumPlaca(str('NumPlaca'))
    setNomResp(str('NomResp'))
    setFazenda(t.Fazenda === 'Oficina' ? '' : str('Fazenda'))
    setCidadeLocal(t.Cidade === 'Oficina' ? '' : str('Cidade'))
    setNaOficina(t.Fazenda === 'Oficina' && t.Cidade === 'Oficina')
    setFotoHorimetro(str('FotoHorimetro')); setFotoChassis(str('FotoChassis'))
    setFotoFrente(str('FotoFrente')); setFotoDireita(str('FotoDireita')); setFotoEsquerda(str('FotoEsquerda'))
    setFotoTraseira(str('FotoTraseira')); setFotoVolante(str('FotoVolante'))
    setFotoFalha1(str('FotoFalha1')); setFotoFalha2(str('FotoFalha2')); setFotoFalha3(str('FotoFalha3')); setFotoFalha4(str('FotoFalha4'))
    setFotoPecaNova1(str('FotoPecaNova1')); setFotoPecaNova2(str('FotoPecaNova2'))
    setFotoPecaInstalada1(str('FotoPecaInstalada1')); setFotoPecaInstalada2(str('FotoPecaInstalada2'))
    const extrasJson = Array.isArray(t.FotosExtras) ? (t.FotosExtras as unknown[]).filter(Boolean) : []
    setFotosExtras(paraExtras(extrasJson.length ? extrasJson : ['FotoExtra1', 'FotoExtra2', 'FotoExtra3', 'FotoExtra4', 'FotoExtra5'].map(str).filter(Boolean)))
    setAssCliente(str('AssCliente'))
    setAssTecnico(str('AssTecnico'))
    setJustificativaPecaExtra(str('JustificativaPecaExtra'))
    // Fotos de almoço já enviadas (coluna AlmocosFotos = [{data, foto}]).
    const fa: Record<string, string> = {}
    try {
      const raw = t.AlmocosFotos
      const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? JSON.parse(raw) : [])
      for (const x of (arr || []) as Record<string, unknown>[]) if (x?.data && x?.foto) fa[String(x.data).slice(0, 10)] = String(x.foto)
    } catch { /* sem fotos de almoço */ }
    // Compat com o almoço único antigo: mapeia FotoAlmoco pro 1º dia de almoço da OS.
    if (Object.keys(fa).length === 0 && t.FotoAlmoco) {
      const primeiro = parseAlmocosOS(osData?.Alimentacoes)[0]
      if (primeiro) fa[primeiro.data] = String(t.FotoAlmoco)
    }
    setFotosAlmoco(fa)

    const diasLoaded: DiaForm[] = diasDoRegistro(t).map((d) => ({ ...d }))
    if (diasLoaded.length > 0) {
      setDias(diasLoaded)
      diasFromDBRef.current = true
      diasBaseRef.current = JSON.stringify(diasLoaded.map((d) => [d.data, d.horaInicio, d.horaFim, d.kmTotal]))
    }

    const pecasLoaded = lerPecasInfo(t.PecasInfo)
    if (osData?.ID_PPV) await carregarProdutosPPV(osData.ID_PPV as string, pecasLoaded || [])
    else if (pecasLoaded) setPecas(pecasLoaded)
  }

  useEffect(() => {
    const timeoutMs = 6000
    const withTimeout = <T,>(p: PromiseLike<T>): Promise<T> =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))])

    /** sem internet (ou o celular diz que tem mas não tem): tudo do cache, como no offline */
    const carregarDoCache = async () => {
      const [cachedOs, cachedTec, cachedTecnicos, cachedVeiculos] = await Promise.all([
        getCachedOS(id), getCachedOSTec(id), getCachedTecnicos(), getCachedVeiculos(),
      ])
      const osData = (cachedOs as Record<string, unknown> | null) || null
      aplicarOS(osData)
      if (cachedTecnicos) setTecnicos(cachedTecnicos.map(t => t.UsuNome).filter(Boolean))
      if (cachedVeiculos) setVeiculos(cachedVeiculos)
      if (cachedTec) {
        await aplicarRelatorio(cachedTec as Record<string, unknown>, osData)
      } else {
        if (user) setTecResp1(user.tecnico_nome)
        preencherEquipDaOS(osData, null)
        if (osData?.ID_PPV) await carregarProdutosPPV(osData.ID_PPV as string)
      }
    }

    const carregar = async () => {
      try {
        if (!navigator.onLine) { await carregarDoCache(); return }

        const [osRes, tecRes, veicRes, relRes] = await Promise.allSettled([
          withTimeout(supabase.from('Ordem_Servico').select('*').eq('Id_Ordem', id).single()),
          withTimeout(supabase.from('Tecnicos_Appsheet').select('UsuNome').order('UsuNome')),
          withTimeout(supabase.from('SupaPlacas').select('IdPlaca, NumPlaca').order('NumPlaca')),
          buscarRelatorioDaOS(id, '*', timeoutMs),
        ])

        // A OS não veio (rede instável / estourou o tempo): tudo do cache
        const osOk = osRes.status === 'fulfilled' && !osRes.value.error && osRes.value.data
        if (!osOk) {
          console.warn('[preencher] Consulta falhou, usando cache offline...')
          await carregarDoCache()
          return
        }
        const osData = osRes.value.data as Record<string, unknown>
        aplicarOS(osData)
        offlineSet(`prefetch:os:${id}`, osData) // cache-on-read p/ abrir offline

        if (tecRes.status === 'fulfilled' && tecRes.value.data) {
          const tecData = tecRes.value.data as { UsuNome: string }[]
          setTecnicos(tecData.map(t => t.UsuNome).filter(Boolean)); offlineSet('prefetch:tecnicos', tecData)
        } else {
          const c = await getCachedTecnicos(); if (c) setTecnicos(c.map(t => t.UsuNome).filter(Boolean))
        }
        if (veicRes.status === 'fulfilled' && veicRes.value.data) {
          setVeiculos(veicRes.value.data as { IdPlaca: number; NumPlaca: string }[]); offlineSet('prefetch:veiculos', veicRes.value.data)
        } else {
          const c = await getCachedVeiculos(); if (c) setVeiculos(c)
        }

        // relatório: do banco; se a consulta falhou, o do cache (nunca abrir vazio por cima do salvo)
        let existing: Record<string, unknown> | null = null
        if (relRes.status === 'fulfilled' && !relRes.value.error) {
          existing = relRes.value.data
          if (existing) offlineSet(`prefetch:os-tec:${id}`, existing)
        } else {
          existing = ((await getCachedOSTec(id)) as Record<string, unknown> | null) || null
        }

        if (existing) {
          await aplicarRelatorio(existing, osData)
        } else {
          if (user) setTecResp1(user.tecnico_nome)
          preencherEquipDaOS(osData, null)
          if (osData.ID_PPV) await carregarProdutosPPV(osData.ID_PPV as string)
        }
      } catch {
        // Rede falhou (onLine=true mas sem internet real) — fallback para cache
        console.warn('[preencher] Rede falhou, tentando cache offline...')
        try { await carregarDoCache() } catch (e) { console.error('[preencher] Fallback de cache falhou:', e) }
      } finally {
        setLoading(false)
      }
    }
    carregar()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.tecnico_nome])

  // Depois de carregar (relatório salvo e rascunho já aplicados): o que estiver VAZIO vem da OS / da Frota
  useEffect(() => {
    if (loading || recolheuInicio.current) return
    recolheuInicio.current = true
    const t = setTimeout(() => setRecolhidas(new Set(passosRef.current.filter((p) => p.ok && !(p.k === 'equip' && equipDaOSRef.current)).map((p) => p.k))), 1200)
    return () => clearTimeout(t)
  }, [loading])

  const proximoK = passosRef.current.find((p) => !p.ok)?.k
  useEffect(() => {
    const box = linhaTempoRef.current
    const el = proximoK && box ? box.querySelector(`[data-passo="${proximoK}"]`) as HTMLElement | null : null
    if (box && el) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' })
  }, [proximoK])
  const okAntes = useRef<Record<string, boolean>>({})
  const aRecolher = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (loading) return
    for (const p of passosRef.current) {
      if (p.ok && okAntes.current[p.k] === false) aRecolher.current.add(p.k)
      if (!p.ok) aRecolher.current.delete(p.k)
      okAntes.current[p.k] = p.ok
    }
  })
  useEffect(() => {
    const fora = (e: Event) => {
      if (!aRecolher.current.size) return
      const alvo = e.target as Node | null
      const fechar: string[] = []
      for (const k of aRecolher.current) {
        const p = passosRef.current.find((x) => x.k === k)
        const sec = p?.alvo ? document.getElementById(p.alvo) : null
        if (sec && alvo && !sec.contains(alvo)) fechar.push(k)
      }
      if (!fechar.length) return
      for (const k of fechar) aRecolher.current.delete(k)
      setRecolhidas((prev) => { const n = new Set(prev); for (const k of fechar) n.add(k); return n })
    }
    document.addEventListener('pointerdown', fora, true)
    document.addEventListener('focusin', fora, true)
    return () => { document.removeEventListener('pointerdown', fora, true); document.removeEventListener('focusin', fora, true) }
  }, [])

  // carro vazio = o carro vinculado ao técnico na Frota (a tela carrega 2x; por isso vale sempre que estiver vazio)
  useEffect(() => {
    if (!loading && !numPlaca && carrosFrota?.meu) setNumPlaca(carrosFrota.meu)
  }, [loading, numPlaca, carrosFrota])

  // Atualização automática do PPV (a cada 30 s): sem spinner, mescla sobre a tela, pausa sem sinal e com o
  // app em segundo plano (José, 23/10/2026)
  useEffect(() => {
    if (!os?.ID_PPV) return
    const interval = setInterval(() => {
      if (!navigator.onLine || document.visibilityState !== 'visible') return
      void carregarProdutosPPV(os.ID_PPV, undefined, true)
    }, 30000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [os?.ID_PPV])

  // Backup automático do formulário
  // lista memorizada: recriada a cada chamada fazia o backup regravar tudo a cada 1 s (José, 23/10/2026)
  const pecasGarantiaLista = useMemo(() => [...pecasGarantia], [pecasGarantia])
  const getFormData = useCallback(() => ({
    tecResp1, temTec2, tecResp2, diagnostico, servicoRealizado,
    tipoServico, ehGarantia, tipoRev, projeto, chassis, marca, modelo, horimetro, numPlaca, nomResp,
    fazenda, cidadeLocal, naOficina,
    dias, diasBase: diasBaseRef.current, pecas, ppvRevisado, justificativaPecaExtra,
    pecasGarantia: pecasGarantiaLista, garantiaObs,
    fotoHorimetro, fotoChassis, fotoFrente, fotoDireita, fotoEsquerda,
    fotoTraseira, fotoVolante, fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4,
    fotoPecaNova1, fotoPecaNova2, fotoPecaInstalada1, fotoPecaInstalada2,
    fotosExtras,
    fotosAlmoco,
    assCliente, assTecnico,
  }), [
    tecResp1, temTec2, tecResp2, diagnostico, servicoRealizado,
    tipoServico, ehGarantia, tipoRev, projeto, chassis, marca, modelo, horimetro, numPlaca, nomResp,
    fazenda, cidadeLocal, naOficina,
    dias, pecas, ppvRevisado, justificativaPecaExtra,
    pecasGarantiaLista, garantiaObs,
    fotoHorimetro, fotoChassis, fotoFrente, fotoDireita, fotoEsquerda,
    fotoTraseira, fotoVolante, fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4,
    fotoPecaNova1, fotoPecaNova2, fotoPecaInstalada1, fotoPecaInstalada2,
    fotosExtras,
    fotosAlmoco,
    assCliente, assTecnico,
  ])

  // foto que estava subindo (blob:) não sobrevive a fechar o app: no rascunho ela não volta
  const semBlob = (v: unknown) => (typeof v === 'string' && v.startsWith('blob:') ? '' : (v as string))
  const setFormData = useCallback((data: Record<string, unknown>) => {
    if (data.tecResp1 !== undefined) setTecResp1(data.tecResp1 as string)
    if (data.temTec2 !== undefined) setTemTec2(data.temTec2 as boolean)
    if (data.tecResp2 !== undefined) setTecResp2(data.tecResp2 as string)
    if (data.diagnostico !== undefined) setDiagnostico(data.diagnostico as string)
    if (data.servicoRealizado !== undefined) setServicoRealizado(data.servicoRealizado as string)
    if (data.tipoServico !== undefined) setTipoServico(data.tipoServico as string)
    if (data.ehGarantia === 'sim' || data.ehGarantia === 'nao') setEhGarantia(data.ehGarantia)
    if (data.tipoRev !== undefined) setTipoRev(data.tipoRev as string)
    if (data.projeto !== undefined) setProjeto(data.projeto as string)
    if (data.chassis !== undefined) setChassis(data.chassis as string)
    if (data.marca !== undefined) setMarca(data.marca as string)
    if (data.modelo !== undefined) setModelo(data.modelo as string)
    if (data.horimetro !== undefined) setHorimetro(data.horimetro as string)
    if (data.numPlaca !== undefined) setNumPlaca(data.numPlaca as string)
    if (data.nomResp !== undefined) setNomResp(data.nomResp as string)
    if (data.fazenda !== undefined) setFazenda(data.fazenda as string)
    if (data.cidadeLocal !== undefined) setCidadeLocal(data.cidadeLocal as string)
    if (data.naOficina !== undefined) setNaOficina(data.naOficina as boolean)
    // Dias do rascunho: valem quando o banco não tem dias OU quando o rascunho foi feito em cima dos MESMOS
    // dias do banco (antes, havendo dias no banco, a edição do técnico era sempre jogada fora). Se os horários
    // mudaram no banco depois (tela da OS), o banco ganha.
    if (Array.isArray(data.dias) && data.dias.length && (!diasFromDBRef.current || data.diasBase === diasBaseRef.current)) {
      setDias(data.dias as DiaForm[])
    }
    if (Array.isArray(data.pecas)) setPecas(comUid(data.pecas as PecaInfo[]))
    if (data.ppvRevisado !== undefined) setPpvRevisado(data.ppvRevisado as boolean)
    if (data.justificativaPecaExtra !== undefined) setJustificativaPecaExtra(data.justificativaPecaExtra as string)
    if (Array.isArray(data.pecasGarantia)) setPecasGarantia(new Set((data.pecasGarantia as unknown[]).map(String)))
    if (data.garantiaObs !== undefined) setGarantiaObs(data.garantiaObs as string)
    if (data.fotoHorimetro !== undefined) setFotoHorimetro(semBlob(data.fotoHorimetro))
    if (data.fotoChassis !== undefined) setFotoChassis(semBlob(data.fotoChassis))
    if (data.fotoFrente !== undefined) setFotoFrente(semBlob(data.fotoFrente))
    if (data.fotoDireita !== undefined) setFotoDireita(semBlob(data.fotoDireita))
    if (data.fotoEsquerda !== undefined) setFotoEsquerda(semBlob(data.fotoEsquerda))
    if (data.fotoTraseira !== undefined) setFotoTraseira(semBlob(data.fotoTraseira))
    if (data.fotoVolante !== undefined) setFotoVolante(semBlob(data.fotoVolante))
    if (data.fotoFalha1 !== undefined) setFotoFalha1(semBlob(data.fotoFalha1))
    if (data.fotoFalha2 !== undefined) setFotoFalha2(semBlob(data.fotoFalha2))
    if (data.fotoFalha3 !== undefined) setFotoFalha3(semBlob(data.fotoFalha3))
    if (data.fotoFalha4 !== undefined) setFotoFalha4(semBlob(data.fotoFalha4))
    if (data.fotoPecaNova1 !== undefined) setFotoPecaNova1(semBlob(data.fotoPecaNova1))
    if (data.fotoPecaNova2 !== undefined) setFotoPecaNova2(semBlob(data.fotoPecaNova2))
    if (data.fotoPecaInstalada1 !== undefined) setFotoPecaInstalada1(semBlob(data.fotoPecaInstalada1))
    if (data.fotoPecaInstalada2 !== undefined) setFotoPecaInstalada2(semBlob(data.fotoPecaInstalada2))
    if (data.fotosExtras !== undefined) setFotosExtras(paraExtras(data.fotosExtras).filter((f) => !f.v.startsWith('blob:')))
    if (data.fotosAlmoco !== undefined && data.fotosAlmoco && typeof data.fotosAlmoco === 'object') {
      setFotosAlmoco(Object.fromEntries(Object.entries(data.fotosAlmoco as Record<string, string>).filter(([, v]) => v && !String(v).startsWith('blob:'))))
    }
    if (data.assCliente !== undefined) setAssCliente(data.assCliente as string)
    if (data.assTecnico !== undefined) setAssTecnico(data.assTecnico as string)
  }, [])

  const { restore: restoreBackup, clear: clearBackup, aviso: avisoBackup } = useFormBackup(`os-preencher-${id}`, getFormData, setFormData)

  // Restaurar backup DEPOIS que os dados do Supabase carregaram
  // Isso garante que edições locais do técnico sobrescrevem dados do servidor
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!loading && !restoredRef.current) {
      restoredRef.current = true
      void restoreBackup()
    }
  }, [loading, restoreBackup])

  const comprimirImagem = async (file: File | Blob): Promise<Blob> => {
    if ((file as File).type?.startsWith('video/')) return file
    if (file.size <= 500_000) return file
    try {
      const bitmap = await createImageBitmap(file as Blob)
      const canvas = document.createElement('canvas')
      const maxDim = 1200
      let w = bitmap.width, h = bitmap.height
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim }
        else { w = Math.round(w * maxDim / h); h = maxDim }
      }
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0, w, h)
      return await new Promise<Blob>((resolve) => canvas.toBlob(b => resolve(b!), 'image/jpeg', 0.8))
    } catch { return file }
  }

  const fileToBase64 = (blob: File | Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  }

  const uploadFoto = async (file: File | Blob, campo: string): Promise<string> => {
    const isVid = (file as File).type?.startsWith('video/')
    const ext = (file instanceof File ? file.name.split('.').pop() : (isVid ? 'mp4' : 'jpg')) || 'jpg'
    const fileToUpload = await comprimirImagem(file)
    const path = `os-tecnicos/${id}/${campo}_${Date.now()}.${ext}`
    // tempo máximo: sem ele, com "sinal" mas sem internet, a foto ficava girando para sempre
    const limite = isVid ? 180_000 : 40_000
    // Tentar até 2 vezes
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      if (!navigator.onLine) return ''
      try {
        const { error } = await Promise.race([
          supabase.storage.from('requisicoes').upload(path, fileToUpload, { upsert: true }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), limite)),
        ])
        if (!error) {
          const { data } = supabase.storage.from('requisicoes').getPublicUrl(path)
          return data.publicUrl
        }
        console.error(`[foto] Upload tentativa ${tentativa + 1} falhou para ${campo}:`, error.message)
      } catch (e) {
        console.error(`[foto] Upload tentativa ${tentativa + 1} estourou para ${campo}:`, e)
      }
      if (tentativa === 0) await new Promise(r => setTimeout(r, 1000))
    }
    return ''
  }

  // Upload de uma foto que está em base64 (pendente de offline)
  const uploadBase64 = async (base64: string, campo: string): Promise<string> => {
    try {
      const res = await fetch(base64)
      const blob = await res.blob()
      return await uploadFoto(blob, campo)
    } catch { return '' }
  }

  const [errosFoto, setErrosFoto] = useState<string[]>([])

  const [videoSlots, setVideoSlots] = useState<Set<string>>(new Set())

  const handleFoto = async (setter: (v: string) => void, campo: string, file: File) => {
    const isVid = file.type.startsWith('video/')

    if (isVid && file.size > MAX_VIDEO_MB * 1024 * 1024) {
      alert(`Vídeo muito grande (${(file.size / 1024 / 1024).toFixed(0)}MB). Máximo: ${MAX_VIDEO_MB}MB.`)
      setter('')
      return
    }

    if (isVid) setVideoSlots(prev => new Set(prev).add(campo))
    else setVideoSlots(prev => { const n = new Set(prev); n.delete(campo); return n })

    const preview = URL.createObjectURL(file)
    setter(preview)
    const compressed = await comprimirImagem(file)
    // sem sinal: nem tenta subir — a foto fica no celular (base64) e a fila sobe depois
    const url = navigator.onLine ? await uploadFoto(compressed, campo) : ''
    if (url) {
      setter(url)
      setErrosFoto(prev => prev.filter(e => e !== campo))
      return
    }
    if (!isVid) {
      const base64 = await fileToBase64(compressed)
      if (base64) {
        setter(base64)
        setErrosFoto(prev => prev.filter(e => e !== campo))
        console.log(`[foto] ${campo} salva localmente (offline)`)
      } else {
        setter('')
        setErrosFoto(prev => [...prev.filter(e => e !== campo), campo])
        alert('Não foi possível guardar a foto. Tente de novo.')
      }
      return
    }
    // Vídeo sem internet: não dá para guardar no celular (pesado demais) — tira o quadro que ficava girando
    setter('')
    setVideoSlots(prev => { const n = new Set(prev); n.delete(campo); return n })
    alert('O vídeo precisa de internet para subir. Anexe de novo quando tiver sinal (as fotos funcionam sem internet).')
  }

  const MAX_FOTOS = 20

  /** fotos da grade: horímetro, chassis e as extras (cada extra com id fixo) */
  const fotoSlots = (): { v: string; set: (v: string) => void; campo: string }[] => {
    const slots: { v: string; set: (v: string) => void; campo: string }[] = [
      { v: fotoHorimetro, set: setFotoHorimetro, campo: 'FotoHorimetro' },
      { v: fotoChassis, set: setFotoChassis, campo: 'FotoChassis' },
    ]
    for (const f of fotosExtras) {
      const fid = f.id
      slots.push({
        v: f.v,
        set: (v: string) => setFotosExtras(prev => (v ? prev.map((x) => (x.id === fid ? { ...x, v } : x)) : prev.filter((x) => x.id !== fid))),
        campo: `FotoExtra_${fid}`,
      })
    }
    return slots
  }

  const addFotos = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const totalAtual = 2 + fotosExtras.length
    const restante = MAX_FOTOS - totalAtual
    if (restante <= 0) {
      alert(`Você já anexou o máximo de ${MAX_FOTOS} arquivos.`)
      return
    }
    const arquivos = Array.from(files).slice(0, restante)
    const novos = arquivos.map((file) => ({ file, id: novoId() }))
    // entra vazio (quadro "subindo") e cada upload acha o SEU quadro pelo id
    setFotosExtras(prev => [...prev, ...novos.map(({ id: fid }) => ({ id: fid, v: '' }))])
    novos.forEach(({ file, id: fid }) => {
      handleFoto(
        (v: string) => setFotosExtras(prev => (v ? prev.map((x) => (x.id === fid ? { ...x, v } : x)) : prev.filter((x) => x.id !== fid))),
        `FotoExtra_${fid}`,
        file,
      )
    })
  }

  // Horas: fim antes do início só conta como virada da meia-noite se o técnico confirmar (José, 23/10/2026)
  const minutosValidos = (d: DiaForm) => {
    const r = minutosDoDia(d.horaInicio, d.horaFim)
    return r.virou && !d.virouNoite ? 0 : r.min
  }
  const totalMin = () => dias.reduce((s, d) => s + minutosValidos(d), 0)
  const calcTotalHoras = () => horasTexto(totalMin())

  const calcTotalKm = () => {
    let total = 0
    for (const d of dias) {
      total += numeroBR(d.kmTotal) || 0
    }
    return total > 0 ? String(total) : ''
  }

  const ppvItems = pecas.filter(p => p.origem === 'ppv')
  const manualItems = pecas.filter(p => p.origem === 'manual')
  const todosRevisados = ppvItems.length === 0 || ppvItems.every(p => p.revisado)
  if (todosRevisados !== ppvRevisado) {
    setTimeout(() => setPpvRevisado(todosRevisados), 0)
  }

  const scrollParaCampo = (id: string) => {
    // o campo pode estar numa seção recolhida: abre ela primeiro
    const el0 = document.getElementById(id)
    const dono = passosRef.current.find((p) => { const sec = document.getElementById((p as { alvo?: string }).alvo || ''); return !!sec && !!el0 && sec.contains(el0) })
    if (dono) setRecolhidas((prev) => { if (!prev.has(dono.k)) return prev; const n = new Set(prev); n.delete(dono.k); return n })
    setTimeout(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }

  const mostrarErro = (msg: string, campoId: string) => {
    setErroValidacao(msg)
    scrollParaCampo(campoId)
    setTimeout(() => setErroValidacao(''), 4000)
  }

  /** todas as fotos da tela (para contar as que ainda estão subindo) */
  const todasFotos = (): string[] => [
    fotoHorimetro, fotoChassis, fotoFrente, fotoDireita, fotoEsquerda, fotoTraseira, fotoVolante,
    fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4, fotoPecaNova1, fotoPecaNova2, fotoPecaInstalada1, fotoPecaInstalada2,
    ...fotosExtras.map((f) => f.v), ...Object.values(fotosAlmoco),
  ].filter(Boolean)
  const subindo = () => todasFotos().filter((f) => f.startsWith('blob:')).length

  /**
   * O que falta para enviar, na ordem da tela (José, 23/10/2026). A MESMA lista serve para o botão Enviar
   * (vai até o primeiro campo que falta) e para o resumo "Confira antes de enviar".
   */
  const pendencias = (): { msg: string; alvo: string }[] => {
    const p: { msg: string; alvo: string }[] = []
    const tem = (f: string) => !!f && !f.startsWith('blob:')
    if (!naOficina) {
      if (!fazenda.trim()) p.push({ msg: 'Preencha o nome da fazenda.', alvo: 'campo-fazenda' })
      if (!cidadeLocal.trim()) p.push({ msg: 'Preencha a cidade.', alvo: 'campo-cidade' })
    }
    dias.forEach((d, i) => {
      const alvo = `dia-${i}`
      if (!d.data) p.push({ msg: `Preencha a data do dia ${i + 1}.`, alvo })
      if (!d.horaInicio || !d.horaFim) p.push({ msg: `Preencha a hora de início e de fim do dia ${i + 1}.`, alvo })
      else if (minutosDoDia(d.horaInicio, d.horaFim).virou && !d.virouNoite) {
        p.push({ msg: `Dia ${i + 1}: a hora fim está antes do início. Corrija ou confirme que passou da meia-noite.`, alvo })
      }
      if (!d.kmTotal.trim()) p.push({ msg: `Preencha o total de km do dia ${i + 1}.`, alvo })
    })
    for (const alm of almocosOS) {
      if (!tem(fotosAlmoco[alm.data] || '')) {
        const [, m, d] = alm.data.split('-')
        p.push({ msg: `Anexe a nota do almoço do dia ${d}/${m}.`, alvo: 'secao-almoco' })
      }
    }
    if (!diagnostico.trim()) p.push({ msg: 'Escreva o diagnóstico (o que estava acontecendo).', alvo: 'passo-diag' })
    if (!servicoRealizado.trim()) p.push({ msg: 'Escreva o serviço realizado.', alvo: 'passo-diag' })
    if (!tipoServico.trim()) p.push({ msg: 'Selecione o tipo de serviço.', alvo: 'campo-garantia' })
    // A pergunta "É GARANTIA?" é obrigatória (tipo Garantia no dropdown conta como SIM)
    else if (!tipoServico.includes('Garantia') && ehGarantia !== 'nao') p.push({ msg: 'Responda: este serviço é garantia? (sim ou não)', alvo: 'campo-garantia' })
    if (!tipoServico.includes('Garantia')) {
      const anexadas = [fotoHorimetro, fotoChassis, ...fotosExtras.map((f) => f.v)].filter(tem)
      const minFotos = tipoServico.includes('Implemento') ? 1 : 2
      if (anexadas.length < minFotos) {
        p.push({ msg: minFotos === 1 ? 'Anexe a foto do chassis do implemento.' : 'Anexe pelo menos 2 fotos do serviço.', alvo: 'secao-fotos' })
      }
    }
    if (!marca.trim()) p.push({ msg: 'Preencha a marca.', alvo: 'campo-marca' })
    if (!modelo.trim()) p.push({ msg: 'Preencha o modelo.', alvo: 'campo-modelo' })
    if (!chassis.trim()) p.push({ msg: 'Preencha o chassis.', alvo: 'campo-chassis' })
    // Garantia: as fotos marcadas com * passam a ser cobradas (22/10/2026)
    if (tipoServico.includes('Garantia')) {
      const faltaTrator = ([['frente', fotoFrente], ['direita', fotoDireita], ['esquerda', fotoEsquerda], ['traseira', fotoTraseira], ['volante', fotoVolante]] as const)
        .filter(([, f]) => !tem(f)).map(([n]) => n)
      const faltas = [
        ...(faltaTrator.length ? [`do trator (${faltaTrator.join(', ')})`] : []),
        ...(![fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4].some(tem) ? ['da falha'] : []),
        ...(![fotoPecaNova1, fotoPecaNova2].some(tem) ? ['da peça nova'] : []),
        ...(![fotoPecaInstalada1, fotoPecaInstalada2].some(tem) ? ['da peça instalada'] : []),
      ]
      if (faltas.length) p.push({ msg: `Garantia: falta foto ${faltas.join(', ')}.`, alvo: 'passo-gar' })
    }
    if (os?.ID_PPV && !todosRevisados) {
      p.push({ msg: `Revise todos os produtos do PPV antes de enviar. ${ppvItems.filter(x => !x.revisado).length} produto(s) pendente(s).`, alvo: 'secao-ppv' })
    }
    if (manualItems.length > 0 && !justificativaPecaExtra.trim()) {
      p.push({ msg: 'Você adicionou peças/serviços extras. Justifique por que não avisou antes.', alvo: 'secao-extras' })
    }
    if (!assCliente) p.push({ msg: 'Falta a assinatura do cliente.', alvo: 'passo-ass' })
    if (!assTecnico) p.push({ msg: 'Falta a assinatura do técnico.', alvo: 'passo-ass' })
    const n = subindo()
    if (n > 0) p.push({ msg: `Aguarde ${n} foto${n > 1 ? 's' : ''} terminar${n > 1 ? 'em' : ''} de subir.`, alvo: 'secao-fotos' })
    return p
  }

  /** dados do PDF a partir da tela (fotos já resolvidas) */
  const dadosPdf = (f: {
    fotoHorimetro: string; fotoChassis: string; fotoFrente: string; fotoDireita: string; fotoEsquerda: string
    fotoTraseira: string; fotoVolante: string; fotoFalha1: string; fotoFalha2: string; fotoFalha3: string; fotoFalha4: string
    fotoPecaNova1: string; fotoPecaNova2: string; fotoPecaInstalada1: string; fotoPecaInstalada2: string; fotosExtras: string[]
  }, cidade: string) => ({
    ordemServico: id,
    cliente: os?.Os_Cliente || '',
    endereco: os?.Endereco_Cliente || '',
    cidade,
    tipoServico,
    projeto,
    idPPV: os?.ID_PPV || '',
    status: 'Enviado',
    tecResp1,
    temTec2,
    tecResp2,
    chassis,
    marca,
    modelo,
    horimetro,
    garantia: tipoServico.includes('Garantia'),
    numPlaca,
    tratorLocal1: '',
    tratorLocal2: '',
    diagnostico,
    servicoRealizado,
    tipoRev,
    dias,
    totalHora: calcTotalHoras(),
    totalKm: calcTotalKm(),
    pecas,
    ...f,
    assCliente, assTecnico,
    nomResp, fazenda: naOficina ? 'Oficina' : fazenda, cidadeServico: naOficina ? 'Oficina' : cidadeLocal,
    data: hojeBR(),
    downloadFoto: downloadFotoRelatorio,
  })

  // qualquer erro inesperado (celular sem espaço, cache) libera o botão e explica, em vez de ficar "Enviando..." (José, 23/10/2026)
  const enviar = async () => {
    try { await enviarDentro() } catch (e) {
      setSaving(false)
      alert(`Não deu para guardar o relatório: ${(e as Error)?.message || e}. Se o celular estiver sem espaço, libere espaço e toque em Enviar de novo — o que você preencheu continua na tela.`)
    }
  }
  const enviarDentro = async () => {
    if (!user) return

    // Validar campos obrigatórios: vai até o primeiro que falta
    const falta = pendencias()
    if (falta.length > 0) {
      mostrarErro(falta[0].msg, falta[0].alvo)
      return
    }

    // Avisar se tem fotos com erro de upload
    if (errosFoto.length > 0) {
      const continuar = confirm(`${errosFoto.length} foto(s) não foram enviadas. Deseja enviar mesmo assim sem essas fotos?`)
      if (!continuar) return
    }

    // tudo certo: mostra o resumo e só envia depois do "Confirmar e enviar"
    if (!resumoConfirmado.current) { setResumoAberto(true); return }
    resumoConfirmado.current = false
    setResumoAberto(false)
    setSaving(true)

    // Resolver fotos pendentes (base64 → upload para Supabase se online)
    const resolverFoto = async (valor: string, campo: string): Promise<string> => {
      if (!valor || valor.startsWith('blob:')) return ''
      if (!valor.startsWith('data:')) return valor // já é URL do Supabase
      // É base64 — tentar upload se estiver online
      if (navigator.onLine) {
        const url = await uploadBase64(valor, campo)
        if (url) return url
      }
      // Se offline ou upload falhou, manter base64 para a fila subir depois
      return valor
    }

    const [
      fotoHorimetroFinal, fotoChassisFinal, fotoFrenteFinal, fotoDireitaFinal,
      fotoEsquerdaFinal, fotoTraseiraFinal, fotoVolanteFinal,
      fotoFalha1Final, fotoFalha2Final, fotoFalha3Final, fotoFalha4Final,
      fotoPecaNova1Final, fotoPecaNova2Final, fotoPecaInstalada1Final, fotoPecaInstalada2Final,
    ] = await Promise.all([
      resolverFoto(fotoHorimetro, 'FotoHorimetro'),
      resolverFoto(fotoChassis, 'FotoChassis'),
      resolverFoto(fotoFrente, 'FotoFrente'),
      resolverFoto(fotoDireita, 'FotoDireita'),
      resolverFoto(fotoEsquerda, 'FotoEsquerda'),
      resolverFoto(fotoTraseira, 'FotoTraseira'),
      resolverFoto(fotoVolante, 'FotoVolante'),
      resolverFoto(fotoFalha1, 'FotoFalha1'),
      resolverFoto(fotoFalha2, 'FotoFalha2'),
      resolverFoto(fotoFalha3, 'FotoFalha3'),
      resolverFoto(fotoFalha4, 'FotoFalha4'),
      resolverFoto(fotoPecaNova1, 'FotoPecaNova1'),
      resolverFoto(fotoPecaNova2, 'FotoPecaNova2'),
      resolverFoto(fotoPecaInstalada1, 'FotoPecaInstalada1'),
      resolverFoto(fotoPecaInstalada2, 'FotoPecaInstalada2'),
    ])
    const fotosExtrasFinal = (await Promise.all(
      fotosExtras.map((f, i) => resolverFoto(f.v, `FotoExtra${i + 1}`))
    )).filter(Boolean)

    // Resolve as fotos de almoço (uma por dia lançado na OS).
    const almocosFotos: { data: string; valor: number; foto: string }[] = []
    for (const _alm of almocosOS) {
      const _foto = await resolverFoto(fotosAlmoco[_alm.data] || '', `FotoAlmoco_${_alm.data}`)
      if (_foto) almocosFotos.push({ data: _alm.data, valor: _alm.valor, foto: _foto })
    }

    const payload: Record<string, unknown> = {
      Ordem_Servico: id,
      TecResp1: tecResp1,
      TemTec: temTec2,
      TecResp2: temTec2 ? tecResp2 : '',
      Motivo: diagnostico,
      ServicoRealizado: servicoRealizado,
      TipoServico: tipoServico,
      TipoRev: tipoRev,
      Projeto: projeto,
      Chassis: chassis,
      Marca: marca,
      Modelo: modelo,
      Garantia: tipoServico.includes('Garantia'),
      Horimetro: horimetro,
      NumPlaca: numPlaca,
      TratorLocal1: '',
      TratorLocal2: '',
      NomResp: nomResp,
      Fazenda: naOficina ? 'Oficina' : fazenda,
      Cidade: naOficina ? 'Oficina' : cidadeLocal,
      TotalHora: calcTotalHoras(),
      TotalKm: calcTotalKm(),
      DataInicio: dias[0]?.data || '',
      DataFinal: dias[dias.length - 1]?.data || dias[0]?.data || '',
      InicioHora: dias[0]?.horaInicio || '',
      FinalHora: dias[0]?.horaFim || '',
      InicioKm: dias[0]?.kmTotal || '',
      FinalKm: '',
      AdicionarData2: dias.length >= 2,
      DataInicio2: dias[1]?.data || '',
      InicioHora2: dias[1]?.horaInicio || '',
      FinalHora2: dias[1]?.horaFim || '',
      InicioKm2: dias[1]?.kmTotal || '',
      FinalKm2: '',
      AdicionarData3: dias.length >= 3,
      DataInicio3: dias[2]?.data || '',
      InicioHora3: dias[2]?.horaInicio || '',
      FinaHora3: dias[2]?.horaFim || '',
      InicioKm3: dias[2]?.kmTotal || '',
      FinalKm3: '',
      DiasExecucao: dias,
      FotoHorimetro: fotoHorimetroFinal,
      FotoChassis: fotoChassisFinal,
      FotoFrente: fotoFrenteFinal,
      FotoDireita: fotoDireitaFinal,
      FotoEsquerda: fotoEsquerdaFinal,
      FotoTraseira: fotoTraseiraFinal,
      FotoVolante: fotoVolanteFinal,
      FotoFalha1: fotoFalha1Final,
      FotoFalha2: fotoFalha2Final,
      FotoFalha3: fotoFalha3Final,
      FotoFalha4: fotoFalha4Final,
      FotoPecaNova1: fotoPecaNova1Final,
      FotoPecaNova2: fotoPecaNova2Final,
      FotoPecaInstalada1: fotoPecaInstalada1Final,
      FotoPecaInstalada2: fotoPecaInstalada2Final,
      FotoExtra1: fotosExtrasFinal[0] || '',
      FotoExtra2: fotosExtrasFinal[1] || '',
      FotoExtra3: fotosExtrasFinal[2] || '',
      FotoExtra4: fotosExtrasFinal[3] || '',
      FotoExtra5: fotosExtrasFinal[4] || '',
      FotosExtras: fotosExtrasFinal,
      AlmocosFotos: almocosFotos,
      TemAlmoco: almocosFotos.length > 0,
      ValorAlmoco: almocosFotos[0]?.valor ?? null,
      FotoAlmoco: almocosFotos[0]?.foto ?? null,
      AssCliente: assCliente, AssTecnico: assTecnico,
      PecasInfo: JSON.stringify(pecas),
      JustificativaPecaExtra: justificativaPecaExtra || null,
      Data: hojeBR(),
      Status: 'enviado',
      pdf_criado: false,
    }

    // Um relatório por OS: o offlineWrite grava por Ordem_Servico (update se já existe, senão insert)
    const res = await offlineWrite({
      table: 'Ordem_Servico_Tecnicos',
      action: existingId ? 'update' : 'insert',
      data: payload,
      match: existingId ? { IdOs: existingId } : undefined,
    })
    if (!res.ok) { setSaving(false); alert('Erro ao salvar: ' + (res.error || 'Erro desconhecido')); return }
    if (res.idOs) setExistingId(res.idOs)
    const queued = res.queued

    // Status da OS — SEMPRE, mesmo offline (será enfileirado). Mas reeditar dentro de 48 h NÃO volta a OS para
    // 'Relatório Concluído' se ela já passou dessa fase (comercial, faturada…) — José, 23/10/2026.
    // Garantia marcada pelo técnico REFLETE na OS mãe: o POS, o módulo de
    // garantias e o faturamento leem Ordem_Servico.Tipo_Servico (pedido 03/08).
    let statusAtual = String(os?.Status || '')
    if (!queued && navigator.onLine) {
      try {
        const r = await Promise.race([
          supabase.from('Ordem_Servico').select('Status').eq('Id_Ordem', id).limit(1),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
        ])
        const st = (r.data?.[0] as { Status?: string } | undefined)?.Status
        if (st) statusAtual = st
      } catch { /* fica o status da tela */ }
    }
    const osUpdate: Record<string, unknown> = {}
    // OS que já passou do relatório (faturada, cobrando…): nem a fase da OS nem o pedido do PPV voltam (José, 23/10/2026)
    const antesDoRelatorio = FASES_ANTES_DO_RELATORIO.has(normFase(statusAtual))
    if (antesDoRelatorio) osUpdate.Status = 'Relatório Concluído'
    if (tipoServico.includes('Garantia')) osUpdate.Tipo_Servico = tipoServico
    if (Object.keys(osUpdate).length > 0) {
      if (queued) {
        // relatório foi para a fila: o Status vai para a fila DEPOIS dele (não tenta online agora) — José, 23/10/2026
        await queueSync({ table: 'Ordem_Servico', action: 'update', data: osUpdate, match: { Id_Ordem: id } })
      } else {
        await offlineWrite({
          table: 'Ordem_Servico', action: 'update',
          data: osUpdate, match: { Id_Ordem: id },
        })
      }
    }

    // Cache local com o relatório ENVIADO (senão, sem internet, a OS reabria como rascunho)
    await atualizarCacheRelatorio(id, { ...payload, ...(res.idOs ? { IdOs: res.idOs } : {}) }, {
      nome: user.nome_pos || user.tecnico_nome,
      statusOS: (osUpdate.Status as string | undefined) || null,
    })

    // Notificar o portal — SEMPRE (online envia na hora; offline enfileira e
    // sobe ao reconectar). Antes só rodava online e se perdia no envio offline.
    notificarPortalOS(id, user?.tecnico_nome || '', os?.Os_Cliente || '')

    // Cria a solicitação de garantia ANTES do PDF e do return offline — o
    // claim é o que faz a OS aparecer pro garantista; rodando por último ele
    // se perdia quando o envio era offline ou o PDF derrubava o fluxo (caso
    // real: OS-0633, 31/07). Best-effort: nunca bloqueia o envio da OS.
    // Offline o claim ainda não nasce aqui — a varredura do Portal cobre.
    if (!queued && tipoServico.includes('Garantia')) {
      try {
        let pecasParaGarantia: PecaOS[] = []
        const escolhidas = pecas.filter((p) => pecasGarantia.has(chavePeca(p)))
        if (escolhidas.length > 0) {
          // Busca os preços das peças via listarPecasOS (PPV/movimentacoes + PecasInfo)
          const pecasComPreco = await listarPecasOS(id)
          const ppvIdsStr = String(os?.ID_PPV || '')
          const primeiroPPV = ppvIdsStr.split(',').map(s => s.trim()).filter(Boolean)[0] || null

          pecasParaGarantia = escolhidas.map((p) => {
            // Tenta cruzar pelo código de produto, com fallback por descrição
            const fonte = pecasComPreco.find(
              (x) => (p.codigo && x.cod_produto === p.codigo) || x.descricao === p.descricao,
            )
            return {
              cod_produto: p.codigo || null,
              descricao: p.descricao,
              // "1.125" é decimal (veio de qtdOriginal); numeroBR lia como 1125 (José, 23/10/2026)
              quantidade: qtdNum(p.qtdUsada) || 1,
              preco_unitario: fonte ? fonte.preco_unitario : 0,
              origem: p.origem === 'ppv' ? 'ppv' : 'pecasinfo_manual',
              fonte_ppv_id: p.origem === 'ppv' ? (fonte?.fonte_ppv_id || primeiroPPV) : null,
            }
          })
        }
        const resGar = await criarGarantia({
          id_ordem: id,
          tecnico_nome: user?.nome_pos || user?.tecnico_nome || tecResp1,
          // horas em número (3.5) — "3h30m" virava 0 na garantia (José, 23/10/2026)
          tecnico_horas: horasDecimais(totalMin()),
          tecnico_km: numeroBR(calcTotalKm()) || 0,
          tecnico_obs: garantiaObs || undefined,
          pecas: pecasParaGarantia,
        })
        if (resGar.erro) console.warn('[garantia] criação falhou:', resGar.erro)
      } catch (err) {
        console.error('[garantia] erro ao criar requisição:', err)
      }
    }

    // PDF fica marcado como pendente ANTES de gerar (fechou o app no meio = a fila gera depois) e sai da lista
    // só quando anexou.
    await addPendingPdf(id)

    if (queued) {
      // Offline o PDF é gerado/anexado ao reconectar, depois que a fila subir o relatório.
      setSaving(false)
      setNaFila(true)
      setSucesso(true)
      clearBackup(true) // enviado: o rascunho não volta
      return
    }

    // Gerar PDF, fazer upload e vincular à OS no portal (com retry)
    let pdfOk = false
    for (let tentativa = 1; tentativa <= 3 && !pdfOk; tentativa++) {
      try {
        if (tentativa === 1) {
          const cidade = await cidadeDoCliente(os?.Cnpj_Cliente)
          const pdfBlob = await gerarPdfRelatorio({
            ...dadosPdf({
              fotoHorimetro: fotoHorimetroFinal, fotoChassis: fotoChassisFinal,
              fotoFrente: fotoFrenteFinal, fotoDireita: fotoDireitaFinal, fotoEsquerda: fotoEsquerdaFinal,
              fotoTraseira: fotoTraseiraFinal, fotoVolante: fotoVolanteFinal,
              fotoFalha1: fotoFalha1Final, fotoFalha2: fotoFalha2Final, fotoFalha3: fotoFalha3Final, fotoFalha4: fotoFalha4Final,
              fotoPecaNova1: fotoPecaNova1Final, fotoPecaNova2: fotoPecaNova2Final,
              fotoPecaInstalada1: fotoPecaInstalada1Final, fotoPecaInstalada2: fotoPecaInstalada2Final,
              fotosExtras: fotosExtrasFinal,
            }, cidade),
            apenasBlob: true,
          })

          if (pdfBlob) {
            const pdfPath = `relatorios-os/${id}/Relatorio_${id}_${Date.now()}.pdf`
            const pdfFile = new File([pdfBlob], `Relatorio_${id}.pdf`, { type: 'application/pdf' })
            const { error: upErr } = await supabase.storage.from('requisicoes').upload(pdfPath, pdfFile)

            if (!upErr) {
              const { data: urlData } = supabase.storage.from('requisicoes').getPublicUrl(pdfPath)
              const pdfUrl = urlData.publicUrl

              // confere erro e linhas: 0 linhas = falha, o PDF continua pendente (José, 23/10/2026)
              const [rOs, rTec] = await Promise.all([
                supabase.from('Ordem_Servico').update({
                  ID_Relatorio_Final: pdfUrl,
                }).eq('Id_Ordem', id).select('Id_Ordem'),
                supabase.from('Ordem_Servico_Tecnicos').update({ pdf_criado: true }).eq('Ordem_Servico', id).select('IdOs'),
              ])
              if (rOs.error || !rOs.data?.length) throw new Error('PDF não vinculado à OS: ' + (rOs.error?.message || 'nenhuma linha'))
              if (rTec.error || !rTec.data?.length) throw new Error('pdf_criado não gravado: ' + (rTec.error?.message || 'nenhuma linha'))

              const { data: osData } = await supabase.from('Ordem_Servico').select('ID_PPV').eq('Id_Ordem', id).limit(1)
              const ppvStr = osData?.[0]?.ID_PPV
              if (ppvStr && antesDoRelatorio) {
                const ppvIds = String(ppvStr).split(',').map(s => s.trim()).filter(Boolean)
                if (ppvIds.length > 0) {
                  await supabase.from('pedidos').update({ status: 'Aguardando Para Faturar' })
                    .in('id_pedido', ppvIds).not('status', 'in', '("Fechado","Cancelado")')
                }
              }

              pdfOk = true
            } else {
              throw new Error(upErr.message)
            }
          } else {
            throw new Error('PDF blob vazio')
          }
        } else {
          // Tentativas 2 e 3: usa gerarEAnexarRelatorio (relê do banco, com as fotos extras; força mesmo
          // com pdf_criado antigo)
          await new Promise(r => setTimeout(r, 2000))
          pdfOk = await gerarEAnexarRelatorio(id, { forcar: true, mexerPedidos: antesDoRelatorio })
        }
      } catch (err) {
        console.error(`Erro PDF tentativa ${tentativa}/3:`, err)
      }
    }
    if (pdfOk) await removePendingPdf(id)
    else console.warn('PDF fica pendente para gerar em segundo plano')

    setSaving(false)
    setSucesso(true)
    clearBackup(true) // enviado: o rascunho não volta
  }

  const [gerandoPdf, setGerandoPdf] = useState(false)

  const handleGerarPdf = async () => {
    setGerandoPdf(true)
    try {
      const cidade = await cidadeDoCliente(os?.Cnpj_Cliente)
      await gerarPdfRelatorio(dadosPdf({
        fotoHorimetro, fotoChassis,
        fotoFrente, fotoDireita, fotoEsquerda, fotoTraseira, fotoVolante,
        fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4,
        fotoPecaNova1, fotoPecaNova2,
        fotoPecaInstalada1, fotoPecaInstalada2,
        fotosExtras: fotosExtras.map((f) => f.v).filter(Boolean),
      }, cidade))
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      alert('Erro ao gerar PDF. Tente novamente.')
    }
    setGerandoPdf(false)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  if (sucesso) {
    return (
      <div style={{
        minHeight: '60vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '20px 16px',
      }}>
        <div style={{
          background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16,
          padding: '28px 20px', width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', alignItems: 'center',
          boxShadow: '0 10px 24px -20px rgba(15,23,42,.5)',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18, background: colors.osFeita,
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}>
            <CheckCircle size={34} color="#fff" />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 500, color: colors.text, margin: '0 0 6px' }}>{naFila ? 'OS guardada no celular' : 'OS enviada!'}</h2>
          <p style={{ fontSize: 15, color: colors.textMuted, margin: '0 0 22px' }}>{naFila ? 'Sem internet agora. O relatório sobe sozinho quando o celular pegar sinal.' : 'Os dados foram salvos com sucesso.'}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
            <button onClick={handleGerarPdf} disabled={gerandoPdf} style={{
              background: gerandoPdf ? colors.textGhost : colors.primary, color: '#fff', borderRadius: 12,
              height: 48, fontSize: 16, fontWeight: 500, border: 'none',
              cursor: gerandoPdf ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <FileDown size={20} />
              {gerandoPdf ? 'Gerando PDF...' : 'Baixar PDF'}
            </button>
            <Link href="/os" style={{
              background: colors.surface, color: colors.text, borderRadius: 12, border: `1px solid ${colors.border}`,
              height: 48, fontSize: 16, fontWeight: 500, textDecoration: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              Voltar às ordens
            </Link>
          </div>
        </div>
      </div>
    )
  }

  /* ── Estilo POS NewPortal (22/10/2026): campos grandes, cartões brancos, passos numerados ── */
  const inputStyle: React.CSSProperties = {
    width: '100%', minHeight: 48, padding: '12px 14px', borderRadius: 12,
    border: `1px solid ${colors.border}`, fontSize: 16, outline: 'none', background: '#fff',
    boxSizing: 'border-box', color: colors.text, minWidth: 0, lineHeight: 1.35,
  }
  const textareaStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical', lineHeight: 1.5 }
  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 400, color: colors.textMuted, display: 'block', marginBottom: 6,
  }
  const sectionStyle: React.CSSProperties = {
    background: colors.surface, borderRadius: 16, padding: 16,
    border: `1px solid ${colors.border}`, marginBottom: 12, minWidth: 0,
    boxShadow: '0 10px 24px -20px rgba(15,23,42,.5)',
    animation: 'hbIn 0.42s cubic-bezier(0.16, 1, 0.3, 1) backwards',
  }
  const obrig = <span style={{ color: colors.danger }}>*</span>
  /** botão de escolha (Sim/Não, No cliente/Na oficina…): cheio na cor quando marcado */
  const escolha = (ativo: boolean, cor: string = colors.primary): React.CSSProperties => ({
    flex: 1, minWidth: 0, minHeight: 46, padding: '10px 8px', borderRadius: 12, cursor: 'pointer',
    fontSize: 15, fontWeight: ativo ? 500 : 400,
    border: `1px solid ${ativo ? cor : colors.border}`,
    background: ativo ? cor : '#fff',
    color: ativo ? '#fff' : colors.text,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  })

  // Passos numerados do relatório (só visual: mostra o que já está completo, não muda a validação)
  const ehGarantiaTipo = tipoServico.includes('Garantia')
  const fotosOk = (() => {
    const anex = [fotoHorimetro, fotoChassis, ...fotosExtras.map((f) => f.v)].filter(f => f && !f.startsWith('blob:'))
    return anex.length >= (tipoServico.includes('Implemento') ? 1 : 2)
  })()
  const passos: { k: string; t: string; ok: boolean; alvo: string }[] = [
    { k: 'tec', t: 'Técnico', ok: !!tecResp1 && (!temTec2 || !!tecResp2), alvo: 'passo-tec' },
    { k: 'local', t: 'Local', ok: naOficina || !!(fazenda.trim() && cidadeLocal.trim()), alvo: 'passo-local' },
    { k: 'dias', t: 'Datas e horas', ok: dias.every(d => d.data && d.horaInicio && d.horaFim && d.kmTotal.trim() && (!minutosDoDia(d.horaInicio, d.horaFim).virou || d.virouNoite)) && almocosOS.every(a => { const f = fotosAlmoco[a.data]; return !!f && !f.startsWith('blob:') }), alvo: 'secao-dias' },
    { k: 'veic', t: 'Veículo', ok: !!numPlaca, alvo: 'passo-veic' },
    { k: 'diag', t: 'Serviço', ok: !!tipoServico && (ehGarantiaTipo || ehGarantia === 'nao') && !!diagnostico.trim() && !!servicoRealizado.trim(), alvo: 'passo-diag' },
    { k: 'fotos', t: 'Fotos', ok: ehGarantiaTipo || fotosOk, alvo: 'secao-fotos' },
    { k: 'equip', t: 'Equipamento', ok: !!(marca.trim() && modelo.trim() && chassis.trim()), alvo: 'passo-equip' },
    ...(ehGarantiaTipo ? [{ k: 'gar', t: 'Garantia', ok: !!(fotoFrente && fotoFalha1 && fotoPecaNova1), alvo: 'passo-gar' }] : []),
    ...(os?.ID_PPV ? [{ k: 'ppv', t: 'Peças do PPV', ok: todosRevisados, alvo: 'secao-ppv' }] : []),
    { k: 'extras', t: 'Extras', ok: manualItems.length === 0 || !!justificativaPecaExtra.trim(), alvo: 'secao-extras' },
    { k: 'ass', t: 'Assinaturas', ok: !!(assCliente && assTecnico), alvo: 'passo-ass' },
  ]
  passosRef.current = passos
  equipDaOSRef.current = equipDaOS
  const proximoPasso = passos.find((p) => !p.ok)?.k
  const nPasso = (k: string) => passos.findIndex(p => p.k === k) + 1
  const resumoSecao = (k: string): string => {
    switch (k) {
      case 'tec': return [tecResp1, temTec2 ? tecResp2 : ''].filter(Boolean).join(' e ')
      case 'local': return naOficina ? 'Na oficina' : [fazenda, cidadeLocal].filter(Boolean).join(' · ')
      case 'dias': return `${dias.length} dia(s) · ${calcTotalHoras() || '—'} · ${calcTotalKm() || 0} km`
      case 'veic': return numPlaca === 'OFICINA' ? 'Oficina' : numPlaca
      case 'equip': return [marca, modelo, chassis ? '…' + chassis.slice(-6) : ''].filter(Boolean).join(' ')
      case 'diag': return tipoServico
      default: return ''
    }
  }
  const okPasso = (k: string) => !!passos.find(p => p.k === k)?.ok
  const feitos = passos.filter(p => p.ok).length

  // Cabeçalho de seção: número do passo (verde com ✓ quando completo) + título + ajuda
  const sectionTitle = (k: string, text: string, sub?: string) => {
    const ok = okPasso(k)
    const fechada = ok && recolhidas.has(k)
    return (
      <div onClick={ok ? () => alternarSecao(k) : undefined} data-recolhida={fechada ? '1' : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: fechada ? 0 : 14, minWidth: 0, cursor: ok ? 'pointer' : undefined }}>
        <span style={{
          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 500,
          background: ok ? colors.osFeita : `color-mix(in srgb, ${colors.primary} 9%, #FEFEFE)`,
          border: ok ? 'none' : `1px solid color-mix(in srgb, ${colors.primary} 16%, transparent)`,
          color: ok ? '#fff' : colors.primary,
        }}>
          {ok ? <Check size={19} strokeWidth={2.4} /> : nPasso(k)}
        </span>
        <div style={{ display: 'grid', minWidth: 0, lineHeight: 1.25 }}>
          <span style={{ fontSize: 16.5, fontWeight: 500, color: colors.text }}>{text}</span>
          {fechada
            ? <span style={{ fontSize: 13, color: colors.success, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resumoSecao(k) || 'completo'}</span>
            : sub && <span style={{ fontSize: 13, color: colors.textMuted }}>{sub}</span>}
        </div>
        {ok && <span style={{ marginLeft: 'auto', fontSize: 12.5, color: colors.primary, flexShrink: 0 }}>{fechada ? 'abrir' : 'recolher'}</span>}
      </div>
    )
  }
  // Cabeçalho de sub-bloco (dentro de um passo): ícone clarinho
  const subTitle = (Icon: typeof Camera, text: string, sub?: string, cor: string = colors.primary) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12, minWidth: 0 }}>
      <span style={{
        width: 36, height: 36, borderRadius: 11, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in srgb, ${cor} 9%, #FEFEFE)`, border: `1px solid color-mix(in srgb, ${cor} 16%, transparent)`, color: cor,
      }}>
        <Icon size={18} />
      </span>
      <div style={{ display: 'grid', minWidth: 0, lineHeight: 1.25 }}>
        <span style={{ fontSize: 15.5, fontWeight: 500, color: colors.text }}>{text}</span>
        {sub && <span style={{ fontSize: 13, color: colors.textMuted }}>{sub}</span>}
      </div>
    </div>
  )

  const updateDia = (index: number, field: keyof DiaForm, value: string) => {
    setDias(prev => prev.map((d, i) => i === index
      ? { ...d, [field]: value, ...(field === 'horaInicio' || field === 'horaFim' ? { virouNoite: false } : {}) }
      : d))
  }

  return (
    <NotificacaoObrigatoria>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0 }}>
      <style>{CSS_PREENCHER}</style>
      {avisoBackup && (
        <div style={{
          background: colors.warningBg, border: `1px solid ${colors.warningBorder}`, borderRadius: 12,
          padding: '10px 12px', marginBottom: 10, fontSize: 14, color: '#9A3412', lineHeight: 1.4,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} /> {avisoBackup}
        </div>
      )}
      {erroValidacao && (
        <div style={{
          position: 'fixed', top: 'calc(16px + env(safe-area-inset-top, 0px))', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, background: colors.danger, color: '#fff',
          padding: '12px 16px', borderRadius: 12, fontSize: 15, fontWeight: 500,
          boxShadow: '0 12px 28px -12px rgba(127,29,29,.6)', width: 'max-content', maxWidth: 'calc(100vw - 32px)', textAlign: 'left',
          animation: 'fadeIn 0.2s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={19} style={{ flexShrink: 0 }} />
            <span style={{ overflowWrap: 'anywhere' }}>{erroValidacao}</span>
          </div>
        </div>
      )}

      <Link href={`/os/${id}`} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, justifySelf: 'start',
        color: colors.primary, fontSize: 15, fontWeight: 500,
        textDecoration: 'none', marginBottom: 10, padding: '8px 0',
      }}>
        <ArrowLeft size={20} /> Voltar
      </Link>

      {/* Cabeçalho: relatório técnico da OS */}
      <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: colors.primary, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ClipboardList size={22} />
        </span>
        <div style={{ display: 'grid', gap: 3, minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18, fontWeight: 500, color: colors.text }}>Relatório técnico</span>
            <span style={{
              fontSize: 13, padding: '1px 8px', borderRadius: 8, color: colors.text, fontVariantNumeric: 'tabular-nums',
              background: colors.primaryBg, border: `1px solid ${colors.primaryBorder}`,
            }}>
              <span style={{ fontSize: 11, color: colors.primary, marginRight: 4 }}>OS</span>{String(id).replace(/^OS-?/i, '')}
            </span>
          </div>
          {os && (
            <span style={{ fontSize: 13.5, color: colors.textMuted, overflowWrap: 'anywhere' }}>
              {os.Os_Cliente}{os.Tipo_Servico ? ` · ${os.Tipo_Servico}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Passos: linha do tempo em blocos (toque para ir ao passo); o próximo que falta fica em destaque */}
      <div style={{ ...sectionStyle, padding: '14px 0 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, margin: '0 14px 10px' }}>
          <span style={{ fontSize: 15, fontWeight: 500, color: colors.text }}>Passos do relatório</span>
          <span style={{ fontSize: 13, color: feitos === passos.length ? colors.osFeita : colors.textMuted }}>{feitos} de {passos.length}</span>
        </div>
        <div ref={linhaTempoRef} className="osp-linha" style={{ display: 'flex', overflowX: 'auto', padding: '4px 14px 6px', scrollSnapType: 'x proximity' }}>
          {passos.map((p, i) => {
            const atual = p.k === proximoPasso
            const cor = p.ok ? colors.osFeita : atual ? colors.primary : colors.textGhost
            return (
              <div key={p.k} data-passo={p.k} style={{ display: 'flex', alignItems: 'flex-start', flexShrink: 0, scrollSnapAlign: 'center' }}>
                <button type="button" onClick={() => scrollParaCampo(p.alvo)} style={{
                  width: 86, minHeight: 74, padding: '8px 6px', borderRadius: 14, cursor: 'pointer', textAlign: 'center',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  border: `${atual ? 2 : 1}px solid ${p.ok ? colors.successBorder : atual ? colors.primary : colors.border}`,
                  background: p.ok ? colors.successBg : atual ? '#F0F8FD' : colors.surface,
                  boxShadow: atual ? '0 6px 16px -10px rgba(3,105,161,.6)' : 'none',
                }}>
                  <span style={{ width: 26, height: 26, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 12.5,
                    background: p.ok || atual ? cor : colors.surfaceAlt, color: p.ok || atual ? '#fefefe' : colors.textMuted }}>
                    {p.ok ? <Check size={14} strokeWidth={2.6} /> : i + 1}
                  </span>
                  <span style={{ fontSize: 12.5, lineHeight: 1.2, color: p.ok ? '#166534' : atual ? colors.primary : colors.textMuted }}>{p.t}</span>
                  {atual && <span style={{ fontSize: 10.5, color: colors.primary }}>agora</span>}
                </button>
                {i < passos.length - 1 && <span style={{ width: 14, height: 2, marginTop: 36, background: p.ok ? colors.osFeita : colors.border, flexShrink: 0 }} />}
              </div>
            )
          })}
        </div>
      </div>

      {/* INFO DO POS (somente leitura) */}
      {os && (
        <div style={{ ...sectionStyle, background: '#F8FAFC' }}>
          {subTitle(FileText, 'Dados do POS', 'Só para consulta — vem da ordem')}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, fontSize: 14 }}>
            {([
              ['Cliente', os.Os_Cliente],
              ['CPF/CNPJ', os.Cnpj_Cliente || '—'],
              ['Endereço', os.Endereco_Cliente || '—'],
            ] as [string, string][]).map(([r, v]) => (
              <div key={r} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: colors.textSubtle }}>{r}</div>
                <div style={{ color: colors.text, overflowWrap: 'anywhere' }}>{v}</div>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
              <div style={{ background: '#fff', border: `1px solid ${colors.border}`, borderRadius: 12, padding: '8px 12px' }}>
                <div style={{ fontSize: 12.5, color: colors.textSubtle }}>Horas POS</div>
                <div style={{ fontSize: 22, fontWeight: 500, color: colors.text }}>{os.Qtd_HR || 0}<span style={{ fontSize: 13, color: colors.textSubtle }}> h</span></div>
              </div>
              <div style={{ background: '#fff', border: `1px solid ${colors.border}`, borderRadius: 12, padding: '8px 12px' }}>
                <div style={{ fontSize: 12.5, color: colors.textSubtle }}>KM POS</div>
                <div style={{ fontSize: 22, fontWeight: 500, color: colors.text }}>{os.Qtd_KM || 0}<span style={{ fontSize: 13, color: colors.textSubtle }}> km</span></div>
              </div>
            </div>
            {os.Serv_Solicitado && (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: colors.textSubtle }}>Descrição</div>
                <div style={{ color: colors.text, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{os.Serv_Solicitado}</div>
              </div>
            )}
            {os.Projeto && (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: colors.textSubtle }}>Projeto</div>
                <div style={{ color: colors.text, overflowWrap: 'anywhere' }}>{os.Projeto}</div>
              </div>
            )}
            {os.ID_PPV && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: colors.primaryBg, border: `1px solid ${colors.primaryBorder}`, borderRadius: 12, padding: '10px 12px', marginTop: 2,
              }}>
                <Package size={18} color={colors.primary} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: 500, color: colors.text, overflowWrap: 'anywhere' }}>
                  PPV {os.ID_PPV}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 1. TÉCNICO */}
      <div id="passo-tec" style={sectionStyle} data-secao-recolhida={okPasso('tec') && recolhidas.has('tec') ? '1' : undefined}>
        {sectionTitle('tec', 'Técnico responsável')}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Técnico principal</label>
          <input type="text" value={tecResp1} readOnly style={{ ...inputStyle, background: colors.surfaceAlt, color: colors.textMuted }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: temTec2 ? 12 : 0 }}>
          <button type="button" onClick={() => { setTemTec2(!temTec2); setTecResp2('') }} style={{
            minHeight: 44, padding: '0 14px', borderRadius: 12, fontSize: 15, fontWeight: 400,
            border: `1px solid ${temTec2 ? colors.dangerBorder : colors.border}`,
            background: temTec2 ? colors.dangerBg : '#fff',
            color: temTec2 ? colors.danger : colors.primary, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            {temTec2 ? <Minus size={16} /> : <Plus size={16} />}
            {temTec2 ? 'Remover 2º técnico' : 'Adicionar 2º técnico'}
          </button>
        </div>

        {temTec2 && (
          <div>
            <label style={labelStyle}>Segundo técnico</label>
            <select value={tecResp2} onChange={(e) => setTecResp2(e.target.value)} className="osp-campo" style={inputStyle}>
              <option value="">Selecione...</option>
              {tecnicos.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* 9. RESPONSÁVEL E LOCAL */}
      <div id="passo-local" style={sectionStyle} data-secao-recolhida={okPasso('local') && recolhidas.has('local') ? '1' : undefined}>
        {sectionTitle('local', 'Responsável e local', 'Quem acompanhou e onde foi feito')}
        <label style={labelStyle}>Nome do responsável pelo trator (cliente)</label>
        <input type="text" value={nomResp} onChange={(e) => setNomResp(e.target.value)} className="osp-campo" style={inputStyle}
          placeholder="Nome de quem é responsável pelo equipamento" />

        {/* Serviço realizado na oficina? */}
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Onde o serviço foi realizado?</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setNaOficina(false)} style={escolha(!naOficina)}>
              <MapPin size={16} /> No cliente
            </button>
            <button type="button" onClick={() => setNaOficina(true)} style={escolha(naOficina)}>
              <Wrench size={16} /> Na oficina
            </button>
          </div>
        </div>

        {naOficina ? (
          <div style={{
            marginTop: 12, padding: '12px 14px', borderRadius: 12,
            background: colors.primaryBg, border: `1px solid ${colors.primaryBorder}`,
            fontSize: 14, color: colors.text, lineHeight: 1.4,
          }}>
            Serviço interno na oficina — não é necessário informar fazenda e cidade.
          </div>
        ) : (
          <>
          <EscolherFazenda osId={id} fazenda={fazenda} cidade={cidadeLocal} primeiroDia={dias.find((d) => d.data)?.data}
            onEscolher={(r) => { setFazenda(r.fazenda); if (r.cidade) setCidadeLocal(r.cidade) }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, marginTop: 12 }}>
            <div id="campo-fazenda" style={{ minWidth: 0 }}>
              <label style={labelStyle}>Nome da fazenda {obrig}</label>
              <input type="text" value={fazenda} onChange={(e) => setFazenda(e.target.value)} className="osp-campo"
                style={inputStyle} placeholder="Ex: Fazenda São José" />
            </div>
            <div id="campo-cidade" style={{ minWidth: 0 }}>
              <label style={labelStyle}>Cidade {obrig}</label>
              <input type="text" value={cidadeLocal} onChange={(e) => setCidadeLocal(e.target.value)} className="osp-campo"
                style={inputStyle} placeholder="Ex: Ribeirão Preto" />
            </div>
          </div>
          </>
        )}
      </div>

      {/* 4. DATAS / HORAS / DESLOCAMENTO */}
      <div id="secao-dias" style={sectionStyle} data-secao-recolhida={okPasso('dias') && recolhidas.has('dias') ? '1' : undefined}>
        {sectionTitle('dias', 'Datas, horas e deslocamento', 'Um bloco para cada dia de serviço')}
        {dias[0]?.data && dias[0]?.horaInicio && (
          <div style={{
            background: colors.successBg, border: `1px solid ${colors.successBorder}`, borderRadius: 12, padding: '10px 12px',
            marginBottom: 12, fontSize: 13.5, color: '#166534', lineHeight: 1.4,
            display: 'flex', alignItems: 'flex-start', gap: 8,
          }}>
            <CheckCircle size={16} color={colors.osFeita} style={{ flexShrink: 0, marginTop: 1 }} />
            Horários pré-preenchidos a partir do registro de visita. Você pode ajustá-los se necessário.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
          {dias.map((dia, i) => (
            <div key={i} id={`dia-${i}`} style={{ background: '#F8FAFC', border: `1px solid ${colors.border}`, borderRadius: 14, padding: 14, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{
                  fontSize: 13, fontWeight: 500, color: colors.primary, padding: '2px 10px', borderRadius: 999,
                  background: colors.primaryBg, border: `1px solid ${colors.primaryBorder}`,
                }}>Dia {i + 1}</span>
                {i > 0 && (
                  <button type="button" onClick={() => setDias(prev => prev.filter((_, idx) => idx !== i))}
                    style={{ fontSize: 14, color: colors.danger, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 2px' }}>
                    Remover
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Data</label>
                  <input type="date" value={dia.data} onChange={(e) => updateDia(i, 'data', e.target.value)} className="osp-campo" style={inputStyle} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <label style={labelStyle}>Hora início</label>
                    <input type="time" value={dia.horaInicio} onChange={(e) => updateDia(i, 'horaInicio', e.target.value)} className="osp-campo" style={inputStyle} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <label style={labelStyle}>Hora fim</label>
                    <input type="time" value={dia.horaFim} onChange={(e) => updateDia(i, 'horaFim', e.target.value)} className="osp-campo" style={inputStyle} />
                  </div>
                </div>
                {/* fim antes do início: avisa e só conta como virada da meia-noite se o técnico confirmar */}
                {minutosDoDia(dia.horaInicio, dia.horaFim).virou && (
                  <div style={{
                    background: dia.virouNoite ? colors.surfaceAlt : colors.warningBg, border: `1px solid ${dia.virouNoite ? colors.border : colors.warningBorder}`,
                    borderRadius: 12, padding: '10px 12px', fontSize: 14, color: colors.text, lineHeight: 1.4,
                  }}>
                    A hora fim está antes do início. Se o serviço passou da meia-noite, confirme; senão, corrija a hora.
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, minHeight: 36, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!dia.virouNoite} style={{ width: 20, height: 20 }}
                        onChange={(e) => setDias(prev => prev.map((d, k) => (k === i ? { ...d, virouNoite: e.target.checked } : d)))} />
                      Sim, passou da meia-noite ({horasTexto(minutosDoDia(dia.horaInicio, dia.horaFim).min)})
                    </label>
                  </div>
                )}
                <div>
                  <label style={labelStyle}>Total KM {obrig}</label>
                  <input type="text" inputMode="decimal" value={dia.kmTotal} onChange={(e) => updateDia(i, 'kmTotal', e.target.value)} className="osp-campo" style={inputStyle} placeholder="0" />
                </div>
                <GpsDoDia osId={id} data={dia.data} onUsar={(r) => setDias((prev) => prev.map((d, k) => (k === i ? { ...d, ...r } : d)))} />
              </div>
            </div>
          ))}
        </div>

        {dias.length < 10 && (
          <button type="button" onClick={() => setDias(prev => [...prev, { data: '', horaInicio: '', horaFim: '', kmTotal: '' }])} style={{
            marginTop: 10, minHeight: 46, borderRadius: 12, fontSize: 15, fontWeight: 400, width: '100%',
            border: `1px dashed ${colors.borderStrong}`, background: '#fff', color: colors.primary, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Plus size={17} /> Adicionar mais um dia
          </button>
        )}

        {/* Totais calculados */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8, marginTop: 12 }}>
          <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ fontSize: 13, color: colors.textMuted }}>Total de horas</div>
            <div style={{ fontSize: 24, fontWeight: 500, color: colors.text, lineHeight: 1.2 }}>{calcTotalHoras() || '—'}</div>
          </div>
          <div style={{ background: colors.surfaceAlt, borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ fontSize: 13, color: colors.textMuted }}>Total de KM</div>
            <div style={{ fontSize: 24, fontWeight: 500, color: colors.text, lineHeight: 1.2 }}>{calcTotalKm() || '—'}</div>
          </div>
        </div>

        {/* Almoço — anexar a nota de cada dia lançado na OS (valor > R$1) */}
        <div id="secao-almoco" style={{ height: 1, background: colors.border, margin: '16px 0' }} />
        {almocosOS.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 500, color: colors.text }}>
              Notas de almoço — anexe a nota de cada dia
            </span>
            {almocosOS.map((alm) => {
              const [, m, d] = alm.data.split('-')
              return (
                <div key={alm.data}>
                  <FotoUpload
                    label={`Nota do almoço — ${d}/${m} · R$ ${alm.valor.toFixed(2)}`}
                    value={fotosAlmoco[alm.data] || ''}
                    onChange={(f) => handleFoto((v) => setFotosAlmoco((prev) => ({ ...prev, [alm.data]: v })), `FotoAlmoco_${alm.data}`, f)}
                    onRemove={() => setFotosAlmoco((prev) => { const n = { ...prev }; delete n[alm.data]; return n })}
                    obrigatorio
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 5. VEÍCULO */}
      <div id="passo-veic" style={sectionStyle} data-secao-recolhida={okPasso('veic') && recolhidas.has('veic') ? '1' : undefined}>
        {sectionTitle('veic', 'Veículo', 'Placa do carro usado no deslocamento')}
        <div>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}><Truck size={15} /> Veículo utilizado</label>
          <EscolherVeiculo valor={numPlaca} onChange={setNumPlaca} lista={carrosFrota} legados={veiculos} />
        </div>
      </div>

      {/* 2. DIAGNÓSTICO E SERVIÇO */}
      <div id="passo-diag" style={sectionStyle} data-secao-recolhida={okPasso('diag') && recolhidas.has('diag') ? '1' : undefined}>
        {sectionTitle('diag', 'Diagnóstico e serviço', 'O que tinha e o que foi feito')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <DitadoRelatorio diagnostico={diagnostico} servico={servicoRealizado}
            onUsar={(r) => { if (r.diagnostico) setDiagnostico(r.diagnostico); if (r.servico) setServicoRealizado(r.servico) }} />
          <div>
            <label style={labelStyle}>Diagnóstico (o que estava acontecendo?)</label>
            <textarea value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} rows={4} className="osp-campo"
              placeholder="Descreva o problema encontrado..." style={textareaStyle} />
          </div>
          <div>
            <label style={labelStyle}>Serviço realizado</label>
            <textarea value={servicoRealizado} onChange={(e) => setServicoRealizado(e.target.value)} rows={4} className="osp-campo"
              placeholder="Descreva o que foi feito..." style={textareaStyle} />
          </div>
          <div>
            <label style={labelStyle}>Tipo de serviço {obrig}</label>
            <select value={tipoServico} onChange={(e) => setTipoServico(e.target.value)} className="osp-campo" style={inputStyle}>
              <option value="">Selecione...</option>
              {TIPOS_SERVICO_GRUPOS.map((g) => (
                <optgroup key={g.grupo} label={`━━ ${g.grupo.toUpperCase()} ━━`}>
                  {g.itens.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* É GARANTIA? — pergunta explícita e OBRIGATÓRIA (os técnicos
              esqueciam o tipo Garantia perdido no dropdown; sem responder,
              a OS não envia) */}
          <div id="campo-garantia" style={{
            padding: 14, borderRadius: 16, background: colors.surface,
            border: `1px solid ${ehGarantia ? colors.border : colors.warningBorder}`,
          }}>
            <div style={{ fontSize: 16, color: colors.text, marginBottom: 2 }}>Quem paga este serviço? {obrig}</div>
            <div style={{ fontSize: 13, color: colors.textSubtle, marginBottom: 12 }}>Defeito de fábrica = a fábrica paga (garantia).</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {([
                { v: 'nao', titulo: 'O cliente', sub: 'Serviço normal', cor: colors.primary, Icone: Wrench,
                  acao: () => { if (tipoServico.includes('Garantia')) setTipoServico(''); setEhGarantia('nao') } },
                { v: 'sim', titulo: 'A fábrica', sub: 'É garantia', cor: colors.osFeita, Icone: ShieldCheck,
                  acao: () => { if (!tipoServico.includes('Garantia')) setTipoServico(tipoServico.includes('Implemento') ? 'Garantia Implemento' : 'Garantia Trator'); setEhGarantia('sim') } },
              ] as const).map((o) => {
                const sel = ehGarantia === o.v
                return (
                  <button key={o.v} type="button" onClick={o.acao} aria-pressed={sel} style={{
                    position: 'relative', textAlign: 'left', padding: '12px 12px 12px', borderRadius: 14, cursor: 'pointer', font: 'inherit',
                    border: `${sel ? 2 : 1}px solid ${sel ? o.cor : colors.border}`, margin: sel ? 0 : 1,
                    background: sel ? `color-mix(in srgb, ${o.cor} 7%, #fefefe)` : colors.surface, outline: 'none',
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center',
                      color: sel ? '#fefefe' : o.cor, background: sel ? o.cor : `color-mix(in srgb, ${o.cor} 10%, #fefefe)` }}>
                      <o.Icone size={18} />
                    </span>
                    <span>
                      <span style={{ display: 'block', fontSize: 16, color: colors.text }}>{o.titulo}</span>
                      <span style={{ display: 'block', fontSize: 13, color: colors.textSubtle }}>{o.sub}</span>
                    </span>
                    {sel && <span style={{ position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 99, background: o.cor, color: '#fefefe', display: 'grid', placeItems: 'center' }}><Check size={14} /></span>}
                  </button>
                )
              })}
            </div>
            {ehGarantia === 'sim' && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13.5, color: colors.textMuted, marginBottom: 6 }}>Garantia de quê?</div>
                <div style={{ display: 'flex', gap: 6, background: colors.surfaceAlt, borderRadius: 12, padding: 4 }}>
                  {(['Garantia Trator', 'Garantia Implemento'] as const).map((t) => {
                    const sel = tipoServico === t
                    return (
                      <button key={t} type="button" onClick={() => setTipoServico(t)} style={{
                        flex: 1, padding: '9px 6px', borderRadius: 9, border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 14.5,
                        background: sel ? colors.surface : 'transparent', color: sel ? colors.text : colors.textMuted,
                        boxShadow: sel ? '0 1px 3px rgba(15,23,42,.15)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}>
                        {t === 'Garantia Trator' ? <Tractor size={16} /> : <Wrench size={16} />} {t.replace('Garantia ', '')}
                      </button>
                    )
                  })}
                </div>
                <div style={{ fontSize: 13, color: colors.textSubtle, marginTop: 8 }}>A solicitação de garantia é aberta sozinha quando você enviar a OS.</div>
              </div>
            )}
          </div>
          {tipoServico.includes('Revisão') && (
            <div>
              <label style={labelStyle}>Revisão de quantas horas?</label>
              <select value={tipoRev} onChange={(e) => setTipoRev(e.target.value)} className="osp-campo" style={inputStyle}>
                <option value="">Selecione...</option>
                {HORAS_REVISAO.map((h) => <option key={h} value={`${h} horas`}>{h} horas</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* 6. FOTOS */}
      <div id="secao-fotos" style={sectionStyle} data-secao-recolhida={okPasso('fotos') && recolhidas.has('fotos') ? '1' : undefined}>
        {sectionTitle('fotos', 'Fotos e vídeos')}
        <p style={{ fontSize: 14, color: colors.textMuted, margin: '-4px 0 12px', lineHeight: 1.5 }}>
          {tipoServico.includes('Implemento') ? (
            <>Anexe a foto do <span style={{ color: colors.text, fontWeight: 500 }}>chassis</span> do implemento (obrigatória) — use o quadro amarelo.</>
          ) : (
            <>Anexe pelo menos <span style={{ color: colors.text, fontWeight: 500 }}>2 fotos</span> do serviço.
              O <span style={{ color: colors.text, fontWeight: 500 }}>horímetro</span> e o <span style={{ color: colors.text, fontWeight: 500 }}>chassis</span> têm quadro próprio (amarelo) — a garantia e a fábrica dependem deles.</>
          )}
        </p>
        {(() => {
          const slots = fotoSlots()
          const anexadas = slots.filter(s => s.v)
          const podeMais = (2 + fotosExtras.length) < MAX_FOTOS
          // Slots nomeados vazios viram quadros próprios — a grade livre grava
          // tudo em FotosExtras e o chassi/horímetro nunca chegavam aos campos
          // que a garantia e o SG da fábrica leem (caso real: OS-0640).
          const ehImplemento = tipoServico.includes('Implemento')
          const nomeadosVazios: { campo: string; rotulo: string; set: (v: string) => void }[] = [
            ...(!ehImplemento && !fotoHorimetro ? [{ campo: 'FotoHorimetro', rotulo: 'Horímetro', set: setFotoHorimetro }] : []),
            ...(!fotoChassis ? [{ campo: 'FotoChassis', rotulo: 'Chassis', set: setFotoChassis }] : []),
          ]
          const quadroAdd: React.CSSProperties = {
            aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 6, borderRadius: 14, cursor: 'pointer', minWidth: 0, textAlign: 'center',
          }
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                {slots.map((s) => s.v ? (
                  <div key={s.campo} className="foto-pop" style={{
                    position: 'relative', aspectRatio: '1', borderRadius: 14, overflow: 'hidden',
                    border: `1px solid ${colors.border}`, background: colors.surfaceAlt, minWidth: 0,
                  }}>
                    {(videoSlots.has(s.campo) || isVideo(s.v)) ? (
                      <video src={s.v} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onLoadedData={(e) => { (e.target as HTMLVideoElement).currentTime = 0.5 }} />
                    ) : (
                      <img src={s.v} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    )}
                    {(videoSlots.has(s.campo) || isVideo(s.v)) && (
                      <div style={{
                        position: 'absolute', left: 6, bottom: 6, background: 'rgba(15,23,42,0.7)',
                        borderRadius: 7, padding: '2px 7px', display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        <Video size={12} color="#fff" />
                        <span style={{ fontSize: 11, color: '#fff' }}>Vídeo</span>
                      </div>
                    )}
                    {(s.campo === 'FotoHorimetro' || s.campo === 'FotoChassis') && (
                      <div style={{
                        position: 'absolute', left: 0, right: 0, bottom: 0, padding: '3px 0',
                        background: 'rgba(15,23,42,0.65)', color: '#fff',
                        fontSize: 11.5, textAlign: 'center',
                      }}>
                        {s.campo === 'FotoHorimetro' ? 'Horímetro' : 'Chassis'}
                      </div>
                    )}
                    {s.v.startsWith('blob:') && (
                      <div style={{
                        position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <div className="spinner" style={{ width: 22, height: 22 }} />
                      </div>
                    )}
                    <button type="button" aria-label="Remover" onClick={() => { s.set(''); setVideoSlots(prev => { const n = new Set(prev); n.delete(s.campo); return n }) }} style={{
                      position: 'absolute', top: 5, right: 5, width: 30, height: 30, borderRadius: '50%',
                      border: 'none', background: 'rgba(15,23,42,0.7)', color: '#fff', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <X size={16} />
                    </button>
                  </div>
                ) : null)}

                {nomeadosVazios.map((n) => (
                  <label key={n.campo} className="foto-add" style={{
                    ...quadroAdd,
                    border: '1.5px dashed #FCD34D', background: '#FFFBEB', color: '#B45309',
                  }}>
                    <Camera size={24} />
                    <span style={{ fontSize: 13 }}>{n.rotulo}</span>
                    <input type="file" accept="image/*"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFoto(n.set, n.campo, f); e.target.value = '' }}
                      style={{ display: 'none' }} />
                  </label>
                ))}

                {podeMais && (
                  <>
                    <label className="foto-add" style={{
                      ...quadroAdd,
                      border: `1.5px dashed ${colors.primaryBorder}`, background: colors.primaryBg, color: colors.primary,
                    }}>
                      <Camera size={26} />
                      <span style={{ fontSize: 13 }}>Foto</span>
                      <input type="file" accept="image/*" capture="environment"
                        onChange={(e) => { addFotos(e.target.files); e.target.value = '' }}
                        style={{ display: 'none' }} />
                    </label>
                    <label className="foto-add" style={{
                      ...quadroAdd,
                      border: `1.5px dashed ${colors.borderStrong}`, background: '#fff', color: colors.textMuted,
                    }}>
                      <Video size={26} />
                      <span style={{ fontSize: 13 }}>Vídeo</span>
                      <input type="file" accept="video/*" capture="environment"
                        onChange={(e) => { addFotos(e.target.files); e.target.value = '' }}
                        style={{ display: 'none' }} />
                    </label>
                    <label className="foto-add" style={{
                      ...quadroAdd,
                      border: `1.5px dashed ${colors.borderStrong}`, background: '#fff', color: colors.textMuted,
                    }}>
                      <ImagePlus size={26} />
                      <span style={{ fontSize: 13 }}>Galeria</span>
                      <input type="file" accept="image/*,video/*" multiple
                        onChange={(e) => { addFotos(e.target.files); e.target.value = '' }}
                        style={{ display: 'none' }} />
                    </label>
                  </>
                )}
              </div>
              <p style={{ fontSize: 12.5, color: colors.textSubtle, margin: '8px 0 0', textAlign: 'right' }}>
                {anexadas.length}/{MAX_FOTOS} fotos/vídeos
              </p>
            </>
          )
        })()}
      </div>

      {/* 3. IDENTIFICAÇÃO DO EQUIPAMENTO */}
      <div id="passo-equip" style={sectionStyle} data-secao-recolhida={okPasso('equip') && recolhidas.has('equip') ? '1' : undefined}>
        {sectionTitle('equip', 'Identificação do equipamento', 'Marca, modelo, chassis e horímetro')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {fotoHorimetro && <LeituraFoto foto={fotoHorimetro} tipo="horimetro" atual={horimetro} onUsar={setHorimetro} />}
          {fotoChassis && <LeituraFoto foto={fotoChassis} tipo="chassi" atual={chassis} chassiOS={equipamentoDaOS(os?.Projeto, (os as unknown as Record<string, unknown> | null)?.Serv_Solicitado).chassi} onUsar={setChassis} />}
          {equipDaOS && (marca || modelo || chassis) && (
            <div style={{ fontSize: 13, color: colors.primaryDark, background: colors.primaryBg, border: `1px solid ${colors.primaryBorder}`, borderRadius: 10, padding: '8px 12px' }}>
              Veio da OS — confira na máquina e troque se estiver diferente.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            <div id="campo-marca" style={{ minWidth: 0 }}>
              <label style={labelStyle}>Marca {obrig}</label>
              <input type="text" value={marca} onChange={(e) => setMarca(e.target.value)} className="osp-campo"
                style={inputStyle} placeholder="Ex: Valtra" />
            </div>
            <div id="campo-modelo" style={{ minWidth: 0 }}>
              <label style={labelStyle}>Modelo {obrig}</label>
              <input type="text" value={modelo} onChange={(e) => setModelo(e.target.value)} className="osp-campo"
                style={inputStyle} placeholder="Ex: BH 180" />
            </div>
          </div>
          <div id="campo-chassis">
            <label style={labelStyle}>Final do chassis (escrito) {obrig}</label>
            <input type="text" value={chassis} onChange={(e) => setChassis(e.target.value)} className="osp-campo"
              style={inputStyle} placeholder="Últimos dígitos do chassis" />
          </div>
          <div>
            <label style={labelStyle}>Horímetro (escrito)</label>
            <input type="text" value={horimetro} onChange={(e) => setHorimetro(e.target.value)} className="osp-campo"
              style={inputStyle} placeholder="Ex: 2.450" />
          </div>
        </div>
      </div>

      {/* 7. GARANTIA — Peças solicitadas + Fotos (só aparece se tipo = Garantia) */}
      {tipoServico.includes('Garantia') && (
        <>
          {/* Seleção de peças que entram na requisição de garantia */}
          <div id="passo-gar" style={sectionStyle} data-secao-recolhida={okPasso('gar') && recolhidas.has('gar') ? '1' : undefined}>
            {sectionTitle('gar', 'Garantia — peças solicitadas', 'Marque as peças que vão para análise da fábrica')}
            {(() => {
              const candidatas = pecas
                .map((p, i) => ({ p, i }))
                .filter(({ p }) => !p.naoUsada && p.descricao)
              if (candidatas.length === 0) {
                return (
                  <p style={{ fontSize: 14, color: colors.textSubtle, textAlign: 'center', padding: '12px 0', margin: 0, lineHeight: 1.45 }}>
                    Nenhuma peça usada nesta OS — adicione/marque as peças acima antes de solicitar garantia.
                  </p>
                )
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {candidatas.map(({ p }) => {
                    const chave = chavePeca(p)
                    const sel = pecasGarantia.has(chave)
                    return (
                      <button
                        key={`gpeca-${chave}`}
                        type="button"
                        onClick={() => {
                          setPecasGarantia(prev => {
                            const n = new Set(prev)
                            if (n.has(chave)) n.delete(chave); else n.add(chave)
                            return n
                          })
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 12px', borderRadius: 12, minHeight: 52,
                          border: `1px solid ${sel ? colors.successBorder : colors.border}`,
                          background: sel ? colors.successBg : '#fff',
                          cursor: 'pointer', textAlign: 'left', minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            width: 24, height: 24, borderRadius: 7,
                            border: `1.5px solid ${sel ? colors.osFeita : colors.borderStrong}`,
                            background: sel ? colors.osFeita : '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {sel && <CheckCircle2 size={15} color="#fff" />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14.5, color: colors.text, overflowWrap: 'anywhere' }}>
                            {p.codigo ? `${p.codigo} · ` : ''}{p.descricao}
                          </div>
                          <div style={{ fontSize: 12.5, color: colors.textSubtle }}>
                            Qtd usada: {p.qtdUsada || '—'} · {p.origem === 'ppv' ? 'PPV' : 'Manual'}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                  <textarea
                    value={garantiaObs}
                    onChange={(e) => setGarantiaObs(e.target.value)}
                    placeholder="Observações para o garantista (opcional)"
                    rows={2}
                    className="osp-campo"
                    style={{ ...textareaStyle, marginTop: 4, fontFamily: 'inherit' }}
                  />
                  <p style={{ fontSize: 13, color: colors.textMuted, margin: 0 }}>
                    A requisição de garantia será criada automaticamente quando você enviar a OS.
                  </p>
                </div>
              )
            })()}
          </div>

          <div style={sectionStyle}>
            {subTitle(Tractor, 'Fotos do equipamento', 'Obrigatório para garantia')}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
              <FotoUpload label="Frente" value={fotoFrente} onChange={(f) => handleFoto(setFotoFrente, 'FotoFrente', f)} onRemove={() => setFotoFrente('')} obrigatorio />
              <FotoUpload label="Direita" value={fotoDireita} onChange={(f) => handleFoto(setFotoDireita, 'FotoDireita', f)} onRemove={() => setFotoDireita('')} obrigatorio />
              <FotoUpload label="Esquerda" value={fotoEsquerda} onChange={(f) => handleFoto(setFotoEsquerda, 'FotoEsquerda', f)} onRemove={() => setFotoEsquerda('')} obrigatorio />
              <FotoUpload label="Traseira" value={fotoTraseira} onChange={(f) => handleFoto(setFotoTraseira, 'FotoTraseira', f)} onRemove={() => setFotoTraseira('')} obrigatorio />
              <FotoUpload label="Volante" value={fotoVolante} onChange={(f) => handleFoto(setFotoVolante, 'FotoVolante', f)} onRemove={() => setFotoVolante('')} obrigatorio />
            </div>
          </div>

          <div style={sectionStyle}>
            {subTitle(AlertTriangle, 'Fotos da falha', 'Pelo menos 1 foto obrigatória', colors.danger)}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
              <FotoUpload label="Falha 1" value={fotoFalha1} onChange={(f) => handleFoto(setFotoFalha1, 'FotoFalha1', f)} onRemove={() => setFotoFalha1('')} obrigatorio />
              <FotoUpload label="Falha 2" value={fotoFalha2} onChange={(f) => handleFoto(setFotoFalha2, 'FotoFalha2', f)} onRemove={() => setFotoFalha2('')} />
              <FotoUpload label="Falha 3" value={fotoFalha3} onChange={(f) => handleFoto(setFotoFalha3, 'FotoFalha3', f)} onRemove={() => setFotoFalha3('')} />
              <FotoUpload label="Falha 4" value={fotoFalha4} onChange={(f) => handleFoto(setFotoFalha4, 'FotoFalha4', f)} onRemove={() => setFotoFalha4('')} />
            </div>
          </div>

          <div style={sectionStyle}>
            {subTitle(Package, 'Fotos das peças', 'Pelo menos 1 foto obrigatória')}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
              <FotoUpload label="Peça nova 1" value={fotoPecaNova1} onChange={(f) => handleFoto(setFotoPecaNova1, 'FotoPecaNova1', f)} onRemove={() => setFotoPecaNova1('')} obrigatorio />
              <FotoUpload label="Peça nova 2" value={fotoPecaNova2} onChange={(f) => handleFoto(setFotoPecaNova2, 'FotoPecaNova2', f)} onRemove={() => setFotoPecaNova2('')} />
              <FotoUpload label="Instalada 1" value={fotoPecaInstalada1} onChange={(f) => handleFoto(setFotoPecaInstalada1, 'FotoPecaInstalada1', f)} onRemove={() => setFotoPecaInstalada1('')} obrigatorio />
              <FotoUpload label="Instalada 2" value={fotoPecaInstalada2} onChange={(f) => handleFoto(setFotoPecaInstalada2, 'FotoPecaInstalada2', f)} onRemove={() => setFotoPecaInstalada2('')} />
            </div>
          </div>
        </>
      )}

      {/* REVISÃO DO PPV — sempre visível, sem cascata */}
      {os?.ID_PPV && (
        <div id="secao-ppv" style={sectionStyle} data-secao-recolhida={okPasso('ppv') && recolhidas.has('ppv') ? '1' : undefined}>
          {sectionTitle('ppv', `Revisão de peças — PPV ${os.ID_PPV}`, 'Obrigatório para enviar')}
          <p style={{ fontSize: 14, color: colors.textMuted, margin: '-4px 0 14px', lineHeight: 1.5 }}>
            Revise cada produto: confirme se usou, informe se devolveu ou não utilizou. Todos devem ser revisados para enviar a OS.
          </p>

          {loadingPPV ? (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
              <div style={{ fontSize: 14, color: colors.textSubtle, marginTop: 8 }}>Carregando produtos...</div>
            </div>
          ) : ppvItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, fontSize: 14, color: colors.textSubtle }}>
              Nenhum produto encontrado no PPV.
            </div>
          ) : (
            <>
              {(() => {
                const revisados = ppvItems.filter(p => p.revisado).length
                const total = ppvItems.length
                const tudo = revisados === total
                return (
                  <div style={{
                    background: tudo ? colors.successBg : colors.warningBg,
                    border: `1px solid ${tudo ? colors.successBorder : colors.warningBorder}`,
                    borderRadius: 12, padding: '10px 12px', marginBottom: 12,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    {tudo
                      ? <CheckCircle size={17} color={colors.osFeita} />
                      : <AlertTriangle size={17} color={colors.osPecas} />
                    }
                    <span style={{ fontSize: 14.5, fontWeight: 500, color: tudo ? '#166534' : '#9A3412' }}>
                      {tudo
                        ? 'Todos os produtos revisados!'
                        : `${revisados} de ${total} produtos revisados`}
                    </span>
                  </div>
                )
              })()}

              {pecas.map((peca, i) => {
                if (peca.origem !== 'ppv') return null
                const corPeca = !peca.revisado ? colors.osPecas : peca.naoUsada ? colors.textSubtle : colors.osFeita
                return (
                  <div key={i} style={{
                    background: peca.revisado
                      ? (peca.naoUsada ? '#F8FAFC' : colors.successBg)
                      : '#fff',
                    borderRadius: 14, padding: 0, marginBottom: 10, overflow: 'hidden', minWidth: 0,
                    border: `1px solid ${peca.revisado
                      ? (peca.naoUsada ? colors.border : colors.successBorder)
                      : colors.warningBorder}`,
                  }}>
                    {/* faixa no topo com a situação do item */}
                    <div style={{ background: corPeca, color: '#fff', fontSize: 12.5, padding: '4px 14px' }}>
                      {!peca.revisado ? 'Pendente — revise' : peca.naoUsada ? 'Não usou' : 'Usou'}
                    </div>
                    <div style={{ padding: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 500, color: colors.text, marginBottom: 2, overflowWrap: 'anywhere' }}>
                            {peca.descricao}
                          </div>
                          {peca.codigo && (
                            <div style={{ fontSize: 12.5, color: colors.textSubtle, overflowWrap: 'anywhere' }}>Cód: {peca.codigo}</div>
                          )}
                          <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>
                            Qtd separada: <span style={{ color: colors.text, fontWeight: 500 }}>{peca.qtdOriginal}</span>
                          </div>
                        </div>
                        {peca.revisado && (
                          <CheckCircle size={22} color={peca.naoUsada ? colors.textSubtle : colors.osFeita} style={{ flexShrink: 0 }} />
                        )}
                      </div>

                      <label style={labelStyle}>Usou esta peça?</label>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        <button type="button" onClick={() => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, naoUsada: false, revisado: true } : p))}
                          style={escolha(!peca.naoUsada && peca.revisado, colors.osFeita)}>
                          Sim, usei
                        </button>
                        <button type="button" onClick={() => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, naoUsada: true, devolvida: false, qtdDevolvida: '', revisado: true } : p))}
                          style={escolha(peca.naoUsada, colors.textMuted)}>
                          Não usou
                        </button>
                      </div>

                      {peca.revisado && !peca.naoUsada && (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              <label style={labelStyle}>Qtd utilizada</label>
                              <input type="text" inputMode="decimal" value={peca.qtdUsada} className="osp-campo"
                                onChange={(e) => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, qtdUsada: e.target.value } : p))}
                                style={inputStyle} placeholder="0" />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <label style={labelStyle}>Devolveu?</label>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button type="button" onClick={() => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, devolvida: false, qtdDevolvida: '' } : p))}
                                  style={{ ...escolha(!peca.devolvida), minHeight: 48 }}>
                                  Não
                                </button>
                                <button type="button" onClick={() => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, devolvida: true } : p))}
                                  style={{ ...escolha(peca.devolvida), minHeight: 48 }}>
                                  Sim
                                </button>
                              </div>
                            </div>
                          </div>
                          {peca.devolvida && (
                            <div style={{ marginTop: 10 }}>
                              <label style={labelStyle}>Qtd devolvida</label>
                              <input type="text" inputMode="decimal" value={peca.qtdDevolvida} className="osp-campo"
                                onChange={(e) => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, qtdDevolvida: e.target.value } : p))}
                                style={inputStyle} placeholder="0" />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* 10. PEÇAS / SERVIÇOS EXTRAS (no final, não obrigatório) */}
      <div id="secao-extras" style={sectionStyle} data-secao-recolhida={okPasso('extras') && recolhidas.has('extras') ? '1' : undefined}>
        {sectionTitle('extras', 'Peças ou serviços extras', 'Opcional')}
        <p style={{ fontSize: 14, color: colors.textMuted, margin: '-4px 0 14px', lineHeight: 1.5 }}>
          Se você usou uma peça a mais ou contratou um serviço de terceiro que não estava previsto, informe aqui. Este campo não é obrigatório.
        </p>

        {manualItems.length > 0 && (
          <>
            {pecas.map((peca, i) => {
              if (peca.origem !== 'manual') return null
              return (
                <div key={i} style={{
                  background: colors.warningBg, borderRadius: 14, padding: 14, marginBottom: 10,
                  border: `1px solid ${colors.warningBorder}`, minWidth: 0,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, padding: '2px 10px', borderRadius: 999, background: colors.osPecas, color: '#fff' }}>
                      Extra
                    </span>
                    <button type="button" onClick={() => setPecas(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ fontSize: 14, color: colors.danger, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 2px' }}>
                      Remover
                    </button>
                  </div>
                  <label style={labelStyle}>Descrição</label>
                  <input type="text" value={peca.descricao} placeholder="Descrição do produto/serviço" className="osp-campo"
                    onChange={(e) => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, descricao: e.target.value } : p))}
                    style={{ ...inputStyle, marginBottom: 10 }} />
                  <div>
                    <label style={labelStyle}>Quantidade</label>
                    <input type="text" inputMode="decimal" value={peca.qtdUsada} className="osp-campo"
                      onChange={(e) => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, qtdUsada: e.target.value } : p))}
                      style={inputStyle} placeholder="1" />
                  </div>
                </div>
              )
            })}

            {/* Justificativa obrigatória se tem extras */}
            <div style={{
              background: colors.dangerBg, borderRadius: 14, padding: 14, marginBottom: 10,
              border: `1px solid ${colors.dangerBorder}`,
            }}>
              <label style={{ fontSize: 14.5, fontWeight: 500, color: '#991B1B', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <AlertTriangle size={16} color={colors.danger} />
                Por que não avisou antes? {obrig}
              </label>
              <textarea
                value={justificativaPecaExtra}
                onChange={(e) => setJustificativaPecaExtra(e.target.value)}
                rows={3}
                className="osp-campo"
                placeholder="Justifique o motivo de usar peça/serviço sem aviso prévio..."
                style={{ ...textareaStyle, borderColor: colors.dangerBorder }}
              />
            </div>
          </>
        )}

        <button type="button" onClick={() => setPecas(prev => [...prev, {
          descricao: '', codigo: '', qtdUsada: '1', devolvida: false, qtdDevolvida: '',
          origem: 'manual', qtdOriginal: '', naoUsada: false, revisado: true, uid: `m:${novoId()}`,
        }])} style={{
          minHeight: 46, borderRadius: 12, fontSize: 15, fontWeight: 400,
          border: `1px dashed ${colors.borderStrong}`, background: '#fff', color: colors.primary, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center',
        }}>
          <Plus size={17} /> Adicionar peça/serviço extra
        </button>
      </div>

      {/* 8. ASSINATURAS */}
      <div id="passo-ass" style={sectionStyle} data-secao-recolhida={okPasso('ass') && recolhidas.has('ass') ? '1' : undefined}>
        {sectionTitle('ass', 'Assinaturas', 'Cliente e técnico')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <SignaturePad label="Assinatura do cliente" value={assCliente} onSave={(v) => setAssCliente(v)} allowPhoto />
          <AssinaturaTecnico userId={user?.id} value={assTecnico} onChange={setAssTecnico} />
        </div>
      </div>

      {resumoAberto && (
        <ResumoEnvio
          itens={[
            ['Cliente', os?.Os_Cliente || ''],
            ['Técnico', resumoSecao('tec')],
            ['Onde', resumoSecao('local')],
            ['Dias', dias.filter((d) => d.data).map((d) => `${d.data.split('-').reverse().slice(0, 2).join('/')} ${d.horaInicio || '?'}–${d.horaFim || '?'} · ${d.kmTotal || 0} km`).join('\n')],
            ['Carro', resumoSecao('veic')],
            ['Equipamento', [marca, modelo].filter(Boolean).join(' ') + (chassis ? ` · chassi ${chassis}` : '') + (horimetro ? ` · ${horimetro} h` : '')],
            ['Serviço', tipoServico + (tipoRev ? ` · ${tipoRev}` : '')],
            ['Diagnóstico', diagnostico],
            ['O que foi feito', servicoRealizado],
            ['Fotos', (() => { const n = [fotoHorimetro, fotoChassis, ...fotosExtras.map((f) => f.v), fotoFrente, fotoDireita, fotoEsquerda, fotoTraseira, fotoVolante, fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4, fotoPecaNova1, fotoPecaNova2, fotoPecaInstalada1, fotoPecaInstalada2].filter(Boolean).length; return `${n} foto${n === 1 ? '' : 's'}/vídeo${n === 1 ? '' : 's'}` + (almocosOS.length ? ` + ${Object.values(fotosAlmoco).filter(Boolean).length} nota(s) de almoço` : '') })()],
          ]}
          assinaturas={[{ rotulo: 'Cliente', src: assCliente }, { rotulo: 'Técnico', src: assTecnico }]}
          enviando={saving}
          onVoltar={() => setResumoAberto(false)}
          onConfirmar={() => { resumoConfirmado.current = true; void enviar() }}
        />
      )}

      {/* BOTÃO ENVIAR */}
      <div style={{ marginBottom: 30, marginTop: 4, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {(() => {
          const bloqueado = !!os?.ID_PPV && !todosRevisados
          const motivo = (os?.ID_PPV && !todosRevisados)
            ? `Revise ${ppvItems.filter(p => !p.revisado).length} peça(s) do PPV para enviar`
            : null
          return (
            <button
              type="button"
              disabled={saving || bloqueado}
              onClick={enviar}
              className={bloqueado ? undefined : 'hb'}
              style={{
                width: '100%', minHeight: 52, padding: '12px 14px', borderRadius: 12,
                background: bloqueado ? colors.textGhost : saving ? '#7DA7C4' : colors.primary,
                color: bloqueado ? colors.textMuted : '#fff',
                fontSize: 17, fontWeight: 500, border: 'none',
                cursor: (saving || bloqueado) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center',
                boxShadow: bloqueado ? 'none' : '0 10px 22px -12px rgba(3,105,161,0.7)',
              }}
            >
              <Send size={19} style={{ flexShrink: 0 }} />
              {saving ? 'Enviando...' : motivo || 'Enviar OS'}
            </button>
          )
        })()}
      </div>
    </div>
    </NotificacaoObrigatoria>
  )
}

/* foco dos campos do relatório (borda azul-clara + anel), só nesta tela */
const CSS_PREENCHER = `
.osp-linha { scrollbar-width: none } .osp-linha::-webkit-scrollbar { display: none }
[data-secao-recolhida="1"] > *:not(:first-child) { display: none !important }
.osp-campo:focus { border-color: #38BDF8 !important; box-shadow: 0 0 0 3px rgba(14,165,233,.15) }
.osp-campo[type="date"], .osp-campo[type="time"] { -webkit-appearance: none; appearance: none; height: 48px }
select.osp-campo { height: 48px; padding-top: 0; padding-bottom: 0 }
.osp-campo::placeholder { color: #94A3B8 }
`
