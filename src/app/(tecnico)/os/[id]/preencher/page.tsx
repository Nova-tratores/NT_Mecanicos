'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { use } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import type { OrdemServico } from '@/lib/types'
import { getCachedOS, getCachedOSTec, getCachedTecnicos, getCachedVeiculos, getCachedPPV } from '@/lib/prefetch'
import { offlineSet, addPendingPdf } from '@/lib/offlineCache'
import FotoUpload from '@/components/FotoUpload'
import SignaturePad from '@/components/SignaturePad'
import { ArrowLeft, Plus, Minus, CheckCircle, Send, Truck, Camera, Package, AlertTriangle, FileDown, ImagePlus, X } from 'lucide-react'
import Link from 'next/link'
import { gerarPdfRelatorio } from '@/lib/gerarPdfRelatorio'
import { gerarEAnexarRelatorio } from '@/lib/gerarEAnexarRelatorio'
import { notificarPortalOS } from '@/lib/notificarPortal'
import { criarGarantia, listarPecasOS } from '@/lib/garantias/client'
import type { PecaOS } from '@/lib/garantias/types'
import { ShieldCheck, CheckCircle2 } from 'lucide-react'

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
}

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
}

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
  const [tipoRev, setTipoRev] = useState('')
  const [projeto, setProjeto] = useState('')
  const [chassis, setChassis] = useState('')
  const [marca, setMarca] = useState('')
  const [modelo, setModelo] = useState('')
  const [horimetro, setHorimetro] = useState('')
  const [numPlaca, setNumPlaca] = useState('')
  const [nomResp, setNomResp] = useState('')
  const [fazenda, setFazenda] = useState('')
  const [cidadeLocal, setCidadeLocal] = useState('')
  const [naOficina, setNaOficina] = useState(false) // serviço realizado na oficina

  // Dias (dinâmico)
  const [dias, setDias] = useState<DiaForm[]>([{ data: '', horaInicio: '', horaFim: '', kmTotal: '' }])

  // Peças informadas pelo técnico
  const [pecas, setPecas] = useState<PecaInfo[]>([])
  const pecasRef = useRef<PecaInfo[]>([])
  pecasRef.current = pecas
  const [loadingPPV, setLoadingPPV] = useState(false)
  const [ppvRevisado, setPpvRevisado] = useState(false)
  const [justificativaPecaExtra, setJustificativaPecaExtra] = useState('')

  // Garantia — peças solicitadas (índices em `pecas` que entram na requisição de garantia)
  const [pecasGarantia, setPecasGarantia] = useState<Set<number>>(new Set())
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
  const [fotoExtra1, setFotoExtra1] = useState('')
  const [fotoExtra2, setFotoExtra2] = useState('')
  const [fotoExtra3, setFotoExtra3] = useState('')
  const [fotoExtra4, setFotoExtra4] = useState('')
  const [fotoExtra5, setFotoExtra5] = useState('')

  // Almoço: os dias/valores vêm da OS (Alimentacoes, lançados pelo pós-vendas).
  // O técnico anexa a foto da nota de cada dia com valor > R$1. { data → foto }
  const [almocosOS, setAlmocosOS] = useState<{ data: string; valor: number }[]>([])
  const [fotosAlmoco, setFotosAlmoco] = useState<Record<string, string>>({})

  // Assinaturas
  const [assCliente, setAssCliente] = useState('')
  const [assTecnico, setAssTecnico] = useState('')
  const [erroValidacao, setErroValidacao] = useState('')

  const carregarProdutosPPV = async (idPPV: string, pecasAtuais?: PecaInfo[]) => {
    setLoadingPPV(true)
    let movs: MovimentacaoPPV[] | null = null
    const ppvTimeout = <T,>(p: PromiseLike<T>): Promise<T> =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))])
    try {
      const res = await ppvTimeout(supabase
        .from('movimentacoes')
        .select('*')
        .eq('Id_PPV', idPPV))
      if (res.error || !res.data) {
        const cached = await getCachedPPV(idPPV)
        movs = cached as MovimentacaoPPV[] | null
      } else {
        movs = res.data as MovimentacaoPPV[] | null
        if (movs) offlineSet(`prefetch:ppv:${idPPV}`, movs) // cache-on-read
      }
    } catch {
      const cached = await getCachedPPV(idPPV)
      movs = cached as MovimentacaoPPV[] | null
    }
    const existentes = pecasAtuais || []
    const manuais = existentes.filter(p => p.origem === 'manual')

    if (movs && movs.length > 0) {
      // Agregar movimentações por CodProduto — soma quantidades, evita duplicatas
      const agrupado = new Map<string, { descricao: string; codigo: string; qtdTotal: number }>()
      for (const m of movs) {
        const cod = (m.CodProduto || '').trim()
        if (!cod) continue
        const existing = agrupado.get(cod)
        const qty = parseFloat(m.Qtde) || 0
        if (existing) {
          existing.qtdTotal += qty
          if (m.Descricao) existing.descricao = m.Descricao
        } else {
          agrupado.set(cod, {
            descricao: m.Descricao || cod,
            codigo: cod,
            qtdTotal: qty,
          })
        }
      }

      const pecasPPV = Array.from(agrupado.values()).map(a => ({
        descricao: a.descricao,
        codigo: a.codigo,
        qtdOriginal: a.qtdTotal > 0 ? String(a.qtdTotal) : '1',
      }))

      // Map de peças já preenchidas pelo técnico (por código)
      const ppvExistentes = new Map<string, PecaInfo>()
      for (const p of existentes.filter(p => p.origem === 'ppv')) {
        ppvExistentes.set(p.codigo, p)
      }

      // PPV é a fonte de verdade: só aparecem peças que existem no PPV atual
      const merged: PecaInfo[] = pecasPPV.map((ppv) => {
        const jaExiste = ppvExistentes.get(ppv.codigo)
        if (jaExiste) {
          // Atualiza descrição e quantidade do PPV, preserva revisão do técnico
          return { ...jaExiste, descricao: ppv.descricao, qtdOriginal: ppv.qtdOriginal }
        }
        return {
          descricao: ppv.descricao,
          codigo: ppv.codigo,
          qtdUsada: ppv.qtdOriginal,
          devolvida: false,
          qtdDevolvida: '',
          origem: 'ppv' as const,
          qtdOriginal: ppv.qtdOriginal,
          naoUsada: false,
          revisado: false,
        }
      })

      setPecas([...merged, ...manuais])
    } else {
      setPecas(manuais)
    }
    setLoadingPPV(false)
  }

  useEffect(() => {
    const carregar = async () => {
      try {
      // Se offline, carregar do cache prefetch + backup do form
      if (!navigator.onLine) {
        const [cachedOs, cachedTec, cachedTecnicos, cachedVeiculos] = await Promise.all([
          getCachedOS(id),
          getCachedOSTec(id),
          getCachedTecnicos(),
          getCachedVeiculos(),
        ])

        if (cachedOs) {
          setOs(cachedOs as unknown as OrdemServico)
          if (cachedOs.Projeto) setProjeto(cachedOs.Projeto as string)
          if (cachedOs.Tipo_Servico) setTipoServico(cachedOs.Tipo_Servico as string)
          setAlmocosOS(parseAlmocosOS((cachedOs as Record<string, unknown>).Alimentacoes))
        }
        if (cachedTecnicos) setTecnicos(cachedTecnicos.map(t => t.UsuNome).filter(Boolean))
        if (cachedVeiculos) setVeiculos(cachedVeiculos)

        if (cachedTec) {
          setExistingId(cachedTec.IdOs as number)
          setTecResp1((cachedTec.TecResp1 as string) || '')
          setTemTec2((cachedTec.TemTec as boolean) || false)
          setTecResp2((cachedTec.TecResp2 as string) || '')
          setDiagnostico((cachedTec.Motivo as string) || '')
          setServicoRealizado((cachedTec.ServicoRealizado as string) || '')
          if (cachedTec.TipoServico) setTipoServico(cachedTec.TipoServico as string)
          if (cachedTec.TipoRev) setTipoRev(cachedTec.TipoRev as string)
          if (cachedTec.Projeto) setProjeto(cachedTec.Projeto as string)
          setChassis((cachedTec.Chassis as string) || '')
          setMarca((cachedTec.Marca as string) || '')
          setModelo((cachedTec.Modelo as string) || '')
          setHorimetro((cachedTec.Horimetro as string) || '')
          setNumPlaca((cachedTec.NumPlaca as string) || '')
          setNomResp((cachedTec.NomResp as string) || '')
          setFazenda(cachedTec.Fazenda === 'Oficina' ? '' : ((cachedTec.Fazenda as string) || ''))
          setCidadeLocal(cachedTec.Cidade === 'Oficina' ? '' : ((cachedTec.Cidade as string) || ''))
          setNaOficina(cachedTec.Fazenda === 'Oficina' && cachedTec.Cidade === 'Oficina')
        } else if (user) {
          setTecResp1(user.tecnico_nome)
        }

        // PPV offline
        if (cachedOs?.ID_PPV) {
          const cachedMovs = await getCachedPPV(cachedOs.ID_PPV as string)
          if (cachedMovs && cachedMovs.length > 0) {
            const pecasPPV = cachedMovs.map((m: Record<string, unknown>) => ({
              descricao: (m.Descricao as string) || (m.CodProduto as string),
              codigo: (m.CodProduto as string) || '',
              qtdUsada: (m.Qtde as string) || '1',
              devolvida: false,
              qtdDevolvida: '',
              origem: 'ppv' as const,
              qtdOriginal: (m.Qtde as string) || '1',
              naoUsada: false,
              revisado: false,
            }))
            setPecas(pecasPPV)
          }
        }

        return
      }

      const timeoutMs = 5000
      const withTimeout = <T,>(p: PromiseLike<T>): Promise<T> =>
        Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))])

      const [osRes, { data: tecData }, { data: veicData }, { data: existing }] = await Promise.all([
        withTimeout(supabase.from('Ordem_Servico').select('*').eq('Id_Ordem', id).single()),
        withTimeout(supabase.from('Tecnicos_Appsheet').select('UsuNome').order('UsuNome')),
        withTimeout(supabase.from('SupaPlacas').select('IdPlaca, NumPlaca').order('NumPlaca')),
        withTimeout(supabase.from('Ordem_Servico_Tecnicos').select('*').eq('Ordem_Servico', id).maybeSingle()),
      ])

      // Se a query principal falhou (rede instável), fallback para cache offline
      if (osRes.error && !osRes.data) {
        console.warn('[preencher] Query falhou, usando cache offline...')
        const [cachedOs, cachedTecnicos, cachedVeiculos] = await Promise.all([
          getCachedOS(id), getCachedTecnicos(), getCachedVeiculos(),
        ])
        if (cachedOs) {
          setOs(cachedOs as unknown as OrdemServico)
          if (cachedOs.Projeto) setProjeto(cachedOs.Projeto as string)
          if (cachedOs.Tipo_Servico) setTipoServico(cachedOs.Tipo_Servico as string)
          setAlmocosOS(parseAlmocosOS((cachedOs as Record<string, unknown>).Alimentacoes))
        }
        if (cachedTecnicos) setTecnicos(cachedTecnicos.map(t => t.UsuNome).filter(Boolean))
        if (cachedVeiculos) setVeiculos(cachedVeiculos)
        if (user) setTecResp1(user.tecnico_nome)
        return
      }
      const osData = osRes.data

      if (osData) {
        setOs(osData as OrdemServico)
        offlineSet(`prefetch:os:${id}`, osData) // cache-on-read p/ abrir offline
        if (osData.Projeto) setProjeto(osData.Projeto)
        if (osData.Tipo_Servico) setTipoServico(osData.Tipo_Servico)
        setAlmocosOS(parseAlmocosOS((osData as Record<string, unknown>).Alimentacoes))
      }
      if (tecData) { setTecnicos(tecData.map((t: { UsuNome: string }) => t.UsuNome).filter(Boolean)); offlineSet('prefetch:tecnicos', tecData) }
      if (veicData) { setVeiculos(veicData as { IdPlaca: number; NumPlaca: string }[]); offlineSet('prefetch:veiculos', veicData) }

      if (existing) {
        offlineSet(`prefetch:os-tec:${id}`, existing)
        setExistingId(existing.IdOs)
        setTecResp1(existing.TecResp1 || '')
        setTemTec2(existing.TemTec || false)
        setTecResp2(existing.TecResp2 || '')
        setDiagnostico(existing.Motivo || '')
        setServicoRealizado(existing.ServicoRealizado || '')
        setTipoServico(existing.TipoServico || osData?.Tipo_Servico || '')
        setTipoRev(existing.TipoRev || '')
        setProjeto(existing.Projeto || osData?.Projeto || '')
        setChassis(existing.Chassis || '')
        setMarca(existing.Marca || '')
        setModelo(existing.Modelo || '')
        setHorimetro(existing.Horimetro || '')
        setNumPlaca(existing.NumPlaca || '')
        setNomResp(existing.NomResp || '')
        setFazenda(existing.Fazenda === 'Oficina' ? '' : (existing.Fazenda || ''))
        setCidadeLocal(existing.Cidade === 'Oficina' ? '' : (existing.Cidade || ''))
        setNaOficina(existing.Fazenda === 'Oficina' && existing.Cidade === 'Oficina')
        setFotoHorimetro(existing.FotoHorimetro || '')
        setFotoChassis(existing.FotoChassis || '')
        setFotoFrente(existing.FotoFrente || '')
        setFotoDireita(existing.FotoDireita || '')
        setFotoEsquerda(existing.FotoEsquerda || '')
        setFotoTraseira(existing.FotoTraseira || '')
        setFotoVolante(existing.FotoVolante || '')
        setFotoFalha1(existing.FotoFalha1 || '')
        setFotoFalha2(existing.FotoFalha2 || '')
        setFotoFalha3(existing.FotoFalha3 || '')
        setFotoFalha4(existing.FotoFalha4 || '')
        setFotoPecaNova1(existing.FotoPecaNova1 || '')
        setFotoPecaNova2(existing.FotoPecaNova2 || '')
        setFotoPecaInstalada1(existing.FotoPecaInstalada1 || '')
        setFotoPecaInstalada2(existing.FotoPecaInstalada2 || '')
        setFotoExtra1(existing.FotoExtra1 || '')
        setFotoExtra2(existing.FotoExtra2 || '')
        setFotoExtra3(existing.FotoExtra3 || '')
        setFotoExtra4(existing.FotoExtra4 || '')
        setFotoExtra5(existing.FotoExtra5 || '')
        setAssCliente(existing.AssCliente || '')
        setAssTecnico(existing.AssTecnico || '')
        setJustificativaPecaExtra(existing.JustificativaPecaExtra || '')
        // Fotos de almoço já enviadas (coluna AlmocosFotos = [{data, foto}]).
        const _fa: Record<string, string> = {}
        try {
          const _raw = (existing as Record<string, unknown>).AlmocosFotos
          const _arr = Array.isArray(_raw) ? _raw : (typeof _raw === 'string' ? JSON.parse(_raw) : [])
          for (const _x of (_arr || [])) {
            const _o = (_x || {}) as Record<string, unknown>
            if (_o.data && _o.foto) _fa[String(_o.data).slice(0, 10)] = String(_o.foto)
          }
        } catch {}
        // Compat com o almoço único antigo: mapeia FotoAlmoco pro 1º dia de almoço da OS.
        if (Object.keys(_fa).length === 0 && existing.FotoAlmoco) {
          const _primeiro = parseAlmocosOS((osData as Record<string, unknown> | null)?.Alimentacoes)[0]
          if (_primeiro) _fa[_primeiro.data] = existing.FotoAlmoco
        }
        setFotosAlmoco(_fa)

        const diasLoaded: DiaForm[] = []
        if (existing.DataInicio) {
          diasLoaded.push({
            data: existing.DataInicio, horaInicio: existing.InicioHora || '',
            horaFim: existing.FinalHora || '', kmTotal: existing.InicioKm || existing.TotalKm || '',
          })
        }
        if (existing.AdicionarData2 && existing.DataInicio2) {
          diasLoaded.push({
            data: existing.DataInicio2, horaInicio: existing.InicioHora2 || '',
            horaFim: existing.FinalHora2 || '', kmTotal: existing.InicioKm2 || '',
          })
        }
        if (existing.AdicionarData3 && existing.DataInicio3) {
          diasLoaded.push({
            data: existing.DataInicio3, horaInicio: existing.InicioHora3 || '',
            horaFim: existing.FinaHora3 || '', kmTotal: existing.InicioKm3 || '',
          })
        }
        if (diasLoaded.length > 0) setDias(diasLoaded)

        if (existing.PecasInfo) {
          try {
            const parsed = JSON.parse(existing.PecasInfo)
            const pecasLoaded: PecaInfo[] = parsed.map((p: Partial<PecaInfo>) => ({
              descricao: p.descricao || '', codigo: p.codigo || '', qtdUsada: p.qtdUsada || '',
              devolvida: p.devolvida || false, qtdDevolvida: p.qtdDevolvida || '',
              origem: p.origem || 'manual', qtdOriginal: p.qtdOriginal || '',
              naoUsada: p.naoUsada || false, revisado: p.revisado !== undefined ? p.revisado : true,
            }))
            if (osData?.ID_PPV) {
              await carregarProdutosPPV(osData.ID_PPV, pecasLoaded)
            } else {
              setPecas(pecasLoaded)
            }
          } catch { /* ignore */ }
        } else if (osData?.ID_PPV) {
          await carregarProdutosPPV(osData.ID_PPV)
        }
      } else {
        if (user) setTecResp1(user.tecnico_nome)
        if (osData?.ID_PPV) {
          await carregarProdutosPPV(osData.ID_PPV)
        }
      }

    } catch {
      // Rede falhou (onLine=true mas sem internet real) — fallback para cache
      console.warn('[preencher] Rede falhou, tentando cache offline...')
      try {
        const [cachedOs, cachedTecnicos, cachedVeiculos] = await Promise.all([
          getCachedOS(id), getCachedTecnicos(), getCachedVeiculos(),
        ])
        if (cachedOs) setOs(cachedOs as unknown as OrdemServico)
        if (cachedTecnicos) setTecnicos(cachedTecnicos.map(t => t.UsuNome).filter(Boolean))
        if (cachedVeiculos) setVeiculos(cachedVeiculos)
        if (user) setTecResp1(user.tecnico_nome)
      } catch (e) {
        console.error('[preencher] Fallback de cache falhou:', e)
      }
    } finally {
      setLoading(false)
    }
    }
    carregar()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.tecnico_nome])

  // Polling automático do PPV (a cada 30s)
  useEffect(() => {
    if (!os?.ID_PPV) return
    const interval = setInterval(() => {
      carregarProdutosPPV(os.ID_PPV, pecasRef.current)
    }, 30000)
    return () => clearInterval(interval)
  }, [os?.ID_PPV])

  // Backup automático do formulário
  const getFormData = useCallback(() => ({
    tecResp1, temTec2, tecResp2, diagnostico, servicoRealizado,
    tipoServico, tipoRev, projeto, chassis, marca, modelo, horimetro, numPlaca, nomResp,
    fazenda, cidadeLocal, naOficina,
    dias, pecas, ppvRevisado, justificativaPecaExtra,
    fotoHorimetro, fotoChassis, fotoFrente, fotoDireita, fotoEsquerda,
    fotoTraseira, fotoVolante, fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4,
    fotoPecaNova1, fotoPecaNova2, fotoPecaInstalada1, fotoPecaInstalada2,
    fotoExtra1, fotoExtra2, fotoExtra3, fotoExtra4, fotoExtra5,
    fotosAlmoco,
    assCliente, assTecnico,
  }), [
    tecResp1, temTec2, tecResp2, diagnostico, servicoRealizado,
    tipoServico, tipoRev, projeto, chassis, marca, modelo, horimetro, numPlaca, nomResp,
    fazenda, cidadeLocal, naOficina,
    dias, pecas, ppvRevisado, justificativaPecaExtra,
    fotoHorimetro, fotoChassis, fotoFrente, fotoDireita, fotoEsquerda,
    fotoTraseira, fotoVolante, fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4,
    fotoPecaNova1, fotoPecaNova2, fotoPecaInstalada1, fotoPecaInstalada2,
    fotoExtra1, fotoExtra2, fotoExtra3, fotoExtra4, fotoExtra5,
    fotosAlmoco,
    assCliente, assTecnico,
  ])

  const setFormData = useCallback((data: Record<string, unknown>) => {
    if (data.tecResp1 !== undefined) setTecResp1(data.tecResp1 as string)
    if (data.temTec2 !== undefined) setTemTec2(data.temTec2 as boolean)
    if (data.tecResp2 !== undefined) setTecResp2(data.tecResp2 as string)
    if (data.diagnostico !== undefined) setDiagnostico(data.diagnostico as string)
    if (data.servicoRealizado !== undefined) setServicoRealizado(data.servicoRealizado as string)
    if (data.tipoServico !== undefined) setTipoServico(data.tipoServico as string)
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
    if (data.dias !== undefined) setDias(data.dias as DiaForm[])
    if (data.pecas !== undefined) setPecas(data.pecas as PecaInfo[])
    if (data.ppvRevisado !== undefined) setPpvRevisado(data.ppvRevisado as boolean)
    if (data.justificativaPecaExtra !== undefined) setJustificativaPecaExtra(data.justificativaPecaExtra as string)
    if (data.fotoHorimetro !== undefined) setFotoHorimetro(data.fotoHorimetro as string)
    if (data.fotoChassis !== undefined) setFotoChassis(data.fotoChassis as string)
    if (data.fotoFrente !== undefined) setFotoFrente(data.fotoFrente as string)
    if (data.fotoDireita !== undefined) setFotoDireita(data.fotoDireita as string)
    if (data.fotoEsquerda !== undefined) setFotoEsquerda(data.fotoEsquerda as string)
    if (data.fotoTraseira !== undefined) setFotoTraseira(data.fotoTraseira as string)
    if (data.fotoVolante !== undefined) setFotoVolante(data.fotoVolante as string)
    if (data.fotoFalha1 !== undefined) setFotoFalha1(data.fotoFalha1 as string)
    if (data.fotoFalha2 !== undefined) setFotoFalha2(data.fotoFalha2 as string)
    if (data.fotoFalha3 !== undefined) setFotoFalha3(data.fotoFalha3 as string)
    if (data.fotoFalha4 !== undefined) setFotoFalha4(data.fotoFalha4 as string)
    if (data.fotoPecaNova1 !== undefined) setFotoPecaNova1(data.fotoPecaNova1 as string)
    if (data.fotoPecaNova2 !== undefined) setFotoPecaNova2(data.fotoPecaNova2 as string)
    if (data.fotoPecaInstalada1 !== undefined) setFotoPecaInstalada1(data.fotoPecaInstalada1 as string)
    if (data.fotoPecaInstalada2 !== undefined) setFotoPecaInstalada2(data.fotoPecaInstalada2 as string)
    if (data.fotoExtra1 !== undefined) setFotoExtra1(data.fotoExtra1 as string)
    if (data.fotoExtra2 !== undefined) setFotoExtra2(data.fotoExtra2 as string)
    if (data.fotoExtra3 !== undefined) setFotoExtra3(data.fotoExtra3 as string)
    if (data.fotoExtra4 !== undefined) setFotoExtra4(data.fotoExtra4 as string)
    if (data.fotoExtra5 !== undefined) setFotoExtra5(data.fotoExtra5 as string)
    if (data.fotosAlmoco !== undefined) setFotosAlmoco(data.fotosAlmoco as Record<string, string>)
    if (data.assCliente !== undefined) setAssCliente(data.assCliente as string)
    if (data.assTecnico !== undefined) setAssTecnico(data.assTecnico as string)
  }, [])

  const { restore: restoreBackup, clear: clearBackup, saveNow } = useFormBackup(`os-preencher-${id}`, getFormData, setFormData)

  // Restaurar backup DEPOIS que os dados do Supabase carregaram
  // Isso garante que edições locais do técnico sobrescrevem dados do servidor
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!loading && !restoredRef.current) {
      restoredRef.current = true
      restoreBackup()
    }
  }, [loading, restoreBackup])

  const comprimirImagem = async (file: File | Blob): Promise<Blob> => {
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
    const ext = (file instanceof File ? file.name.split('.').pop() : 'jpg') || 'jpg'
    const fileToUpload = await comprimirImagem(file)
    const path = `os-tecnicos/${id}/${campo}_${Date.now()}.${ext}`
    // Tentar até 2 vezes
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const { error } = await supabase.storage.from('requisicoes').upload(path, fileToUpload, { upsert: true })
      if (!error) {
        const { data } = supabase.storage.from('requisicoes').getPublicUrl(path)
        return data.publicUrl
      }
      console.error(`[foto] Upload tentativa ${tentativa + 1} falhou para ${campo}:`, error.message)
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

  const handleFoto = async (setter: (v: string) => void, campo: string, file: File) => {
    const preview = URL.createObjectURL(file)
    setter(preview)
    const compressed = await comprimirImagem(file)
    const url = await uploadFoto(compressed, campo)
    if (url) {
      setter(url)
      setErrosFoto(prev => prev.filter(e => e !== campo))
    } else {
      // Offline: salvar como base64 para persistir no localStorage via useFormBackup
      const base64 = await fileToBase64(compressed)
      if (base64) {
        setter(base64)
        setErrosFoto(prev => prev.filter(e => e !== campo))
        console.log(`[foto] ${campo} salva localmente (offline)`)
      } else {
        setErrosFoto(prev => [...prev.filter(e => e !== campo), campo])
        alert(`Erro ao salvar foto "${campo}".`)
      }
    }
  }

  // Slots de foto do serviço em ordem: as 2 primeiras alimentam Horimetro/Chassis,
  // o resto vira Extra1..5 (total de 7). O tecnico so anexa fotos.
  const fotoSlots = (): { v: string; set: (v: string) => void; campo: string }[] => [
    { v: fotoHorimetro, set: setFotoHorimetro, campo: 'FotoHorimetro' },
    { v: fotoChassis, set: setFotoChassis, campo: 'FotoChassis' },
    { v: fotoExtra1, set: setFotoExtra1, campo: 'FotoExtra1' },
    { v: fotoExtra2, set: setFotoExtra2, campo: 'FotoExtra2' },
    { v: fotoExtra3, set: setFotoExtra3, campo: 'FotoExtra3' },
    { v: fotoExtra4, set: setFotoExtra4, campo: 'FotoExtra4' },
    { v: fotoExtra5, set: setFotoExtra5, campo: 'FotoExtra5' },
  ]

  // Adiciona uma ou várias fotos de uma vez nos slots vazios (até 7)
  const addFotos = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const vazios = fotoSlots().filter(s => !s.v)
    if (vazios.length === 0) {
      alert('Você já anexou o máximo de 7 fotos.')
      return
    }
    Array.from(files).slice(0, vazios.length).forEach((file, k) => {
      handleFoto(vazios[k].set, vazios[k].campo, file)
    })
  }

  const calcTotalHoras = () => {
    let total = 0
    for (const d of dias) {
      if (d.horaInicio && d.horaFim) {
        const [hi, mi] = d.horaInicio.split(':').map(Number)
        const [hf, mf] = d.horaFim.split(':').map(Number)
        let diff = (hf * 60 + mf) - (hi * 60 + mi)
        if (diff < 0) diff += 24 * 60 // passou da meia-noite
        total += diff
      }
    }
    if (total <= 0) return ''
    const h = Math.floor(total / 60)
    const m = total % 60
    return `${h}h${m > 0 ? `${m}m` : ''}`
  }

  const calcTotalKm = () => {
    let total = 0
    for (const d of dias) {
      total += parseFloat(d.kmTotal) || 0
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

  const enviar = async () => {
    if (!user) return

    // Validar campos obrigatórios com scroll
    if (!chassis.trim()) {
      mostrarErro('Preencha o campo Chassis.', 'campo-chassis')
      return
    }
    if (!marca.trim()) {
      mostrarErro('Preencha o campo Marca.', 'campo-marca')
      return
    }
    if (!modelo.trim()) {
      mostrarErro('Preencha o campo Modelo.', 'campo-modelo')
      return
    }

    // Fazenda/Cidade só são obrigatórias quando o serviço NÃO foi na oficina
    if (!naOficina) {
      if (!fazenda.trim()) {
        mostrarErro('Preencha o nome da Fazenda.', 'campo-fazenda')
        return
      }
      if (!cidadeLocal.trim()) {
        mostrarErro('Preencha a Cidade.', 'campo-cidade')
        return
      }
    }

    // Fotos: garantia tem seções próprias. Implemento exige só 1 (o chassis);
    // trator exige no mínimo 2.
    if (!tipoServico.includes('Garantia')) {
      const fotosAnexadas = [
        fotoHorimetro, fotoChassis, fotoExtra1, fotoExtra2, fotoExtra3, fotoExtra4, fotoExtra5,
      ].filter(f => f && !f.startsWith('blob:'))
      const minFotos = tipoServico.includes('Implemento') ? 1 : 2
      if (fotosAnexadas.length < minFotos) {
        mostrarErro(
          minFotos === 1 ? 'Anexe a foto do chassis do implemento.' : 'Anexe pelo menos 2 fotos do serviço.',
          'secao-fotos',
        )
        return
      }
    }

    // Validar km total de cada dia
    const diaKmVazio = dias.findIndex(d => !d.kmTotal.trim())
    if (diaKmVazio >= 0) {
      mostrarErro(`Preencha o Total KM do dia ${diaKmVazio + 1}.`, 'secao-dias')
      return
    }

    if (os?.ID_PPV && !todosRevisados) {
      mostrarErro(`Revise todos os produtos do PPV antes de enviar. ${ppvItems.filter(p => !p.revisado).length} produto(s) pendente(s).`, 'secao-ppv')
      return
    }

    // Avisar se tem fotos com erro de upload
    if (errosFoto.length > 0) {
      const continuar = confirm(`${errosFoto.length} foto(s) não foram enviadas (${errosFoto.join(', ')}). Deseja enviar mesmo assim sem essas fotos?`)
      if (!continuar) return
    }

    // Validar almoços: cada dia com valor > R$1 lançado na OS precisa da foto da nota.
    for (const _alm of almocosOS) {
      const _f = fotosAlmoco[_alm.data]
      const _valida = _f && !_f.startsWith('blob:')
      if (!_valida) {
        const [, _m, _d] = _alm.data.split('-')
        mostrarErro(`Anexe a nota do almoço do dia ${_d}/${_m}.`, 'secao-almoco')
        return
      }
    }

    // Validar justificativa se tem peças extras
    if (manualItems.length > 0 && !justificativaPecaExtra.trim()) {
      mostrarErro('Você adicionou peças/serviços extras. Justifique por que não avisou antes.', 'secao-extras')
      return
    }

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
      // Se offline ou upload falhou, manter base64 para o offlineWrite guardar
      return valor
    }

    const [
      fotoHorimetroFinal, fotoChassisFinal, fotoFrenteFinal, fotoDireitaFinal,
      fotoEsquerdaFinal, fotoTraseiraFinal, fotoVolanteFinal,
      fotoFalha1Final, fotoFalha2Final, fotoFalha3Final, fotoFalha4Final,
      fotoPecaNova1Final, fotoPecaNova2Final, fotoPecaInstalada1Final, fotoPecaInstalada2Final,
      fotoExtra1Final, fotoExtra2Final, fotoExtra3Final, fotoExtra4Final, fotoExtra5Final,
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
      resolverFoto(fotoExtra1, 'FotoExtra1'),
      resolverFoto(fotoExtra2, 'FotoExtra2'),
      resolverFoto(fotoExtra3, 'FotoExtra3'),
      resolverFoto(fotoExtra4, 'FotoExtra4'),
      resolverFoto(fotoExtra5, 'FotoExtra5'),
    ])

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
      FotoExtra1: fotoExtra1Final,
      FotoExtra2: fotoExtra2Final,
      FotoExtra3: fotoExtra3Final,
      FotoExtra4: fotoExtra4Final,
      FotoExtra5: fotoExtra5Final,
      AlmocosFotos: almocosFotos,
      TemAlmoco: almocosFotos.length > 0,
      ValorAlmoco: almocosFotos[0]?.valor ?? null,
      FotoAlmoco: almocosFotos[0]?.foto ?? null,
      AssCliente: assCliente, AssTecnico: assTecnico,
      PecasInfo: JSON.stringify(pecas),
      JustificativaPecaExtra: justificativaPecaExtra || null,
      Data: new Date().toISOString().split('T')[0],
      Status: 'enviado',
      pdf_criado: false,
    }

    let queued = false

    if (existingId) {
      const res = await offlineWrite({
        table: 'Ordem_Servico_Tecnicos', action: 'update',
        data: payload, match: { IdOs: existingId },
      })
      if (!res.ok) { setSaving(false); alert('Erro ao salvar: ' + (res.error || 'Erro desconhecido')); return }
      queued = res.queued
    } else {
      const res = await offlineWrite({ table: 'Ordem_Servico_Tecnicos', action: 'insert', data: payload })
      if (!res.ok) { setSaving(false); alert('Erro ao salvar: ' + (res.error || 'Erro desconhecido')); return }
      if (!res.queued) {
        const { data } = await supabase.from('Ordem_Servico_Tecnicos').select('IdOs').eq('Ordem_Servico', id).order('IdOs', { ascending: false }).limit(1).single()
        if (data) setExistingId(data.IdOs)
      }
      queued = res.queued
    }

    // Atualizar status da OS — SEMPRE, mesmo offline (será enfileirado)
    await offlineWrite({
      table: 'Ordem_Servico', action: 'update',
      data: { Status: 'Relatório Concluído' }, match: { Id_Ordem: id },
    })

    // Notificar o portal — SEMPRE (online envia na hora; offline enfileira e
    // sobe ao reconectar). Antes só rodava online e se perdia no envio offline.
    notificarPortalOS(id, user?.tecnico_nome || '', os?.Os_Cliente || '')

    if (queued) {
      // Marca para gerar/anexar o PDF ao reconectar (offline não gera PDF aqui).
      await addPendingPdf(id)
      setSaving(false)
      setSucesso(true)
      clearBackup()
      return
    }

    // Gerar PDF, fazer upload e vincular à OS no portal (com retry)
    let pdfOk = false
    for (let tentativa = 1; tentativa <= 3 && !pdfOk; tentativa++) {
      try {
        if (tentativa === 1) {
          let cidade = ''
          if (os?.Cnpj_Cliente) {
            const { data: cli } = await supabase
              .from('Clientes')
              .select('cidade')
              .eq('cnpj_cpf', os.Cnpj_Cliente)
              .maybeSingle()
            cidade = cli?.cidade || ''
          }

          const downloadFoto = async (url: string): Promise<string | null> => {
            if (!url) return null
            let path: string | null = null
            const match = url.match(/\/(?:object|storage)\/(?:v1\/)?(?:public|sign)\/requisicoes\/(.+?)(\?|$)/)
            if (match) {
              path = decodeURIComponent(match[1])
            } else if (url.includes('/requisicoes/')) {
              const idx = url.indexOf('/requisicoes/')
              path = decodeURIComponent(url.substring(idx + '/requisicoes/'.length).split('?')[0])
            }
            if (path) {
              const { data: blob, error } = await supabase.storage.from('requisicoes').download(path)
              if (!error && blob) {
                return new Promise((resolve) => {
                  const reader = new FileReader()
                  reader.onloadend = () => resolve(reader.result as string)
                  reader.onerror = () => resolve(null)
                  reader.readAsDataURL(blob)
                })
              }
            }
            try {
              const resp = await fetch(url)
              if (resp.ok) {
                const blob = await resp.blob()
                return new Promise((resolve) => {
                  const reader = new FileReader()
                  reader.onloadend = () => resolve(reader.result as string)
                  reader.onerror = () => resolve(null)
                  reader.readAsDataURL(blob)
                })
              }
            } catch { /* ignore */ }
            return null
          }

          const pdfBlob = await gerarPdfRelatorio({
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
            fotoHorimetro, fotoChassis,
            fotoFrente, fotoDireita, fotoEsquerda, fotoTraseira, fotoVolante,
            fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4,
            fotoPecaNova1, fotoPecaNova2,
            fotoPecaInstalada1, fotoPecaInstalada2,
            assCliente, assTecnico,
            nomResp, fazenda: naOficina ? 'Oficina' : fazenda, cidadeServico: naOficina ? 'Oficina' : cidadeLocal,
            data: new Date().toISOString().split('T')[0],
            apenasBlob: true,
            downloadFoto,
          })

          if (pdfBlob) {
            const pdfPath = `relatorios-os/${id}/Relatorio_${id}_${Date.now()}.pdf`
            const pdfFile = new File([pdfBlob], `Relatorio_${id}.pdf`, { type: 'application/pdf' })
            const { error: upErr } = await supabase.storage.from('requisicoes').upload(pdfPath, pdfFile)

            if (!upErr) {
              const { data: urlData } = supabase.storage.from('requisicoes').getPublicUrl(pdfPath)
              const pdfUrl = urlData.publicUrl

              await Promise.all([
                supabase.from('Ordem_Servico').update({
                  ID_Relatorio_Final: pdfUrl,
                }).eq('Id_Ordem', id),
                supabase.from('Ordem_Servico_Tecnicos').update({ pdf_criado: true }).eq('Ordem_Servico', id),
              ])

              const { data: osData } = await supabase.from('Ordem_Servico').select('ID_PPV').eq('Id_Ordem', id).limit(1)
              const ppvStr = osData?.[0]?.ID_PPV
              if (ppvStr) {
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
          // Tentativas 2 e 3: usa gerarEAnexarRelatorio (relê do banco)
          await new Promise(r => setTimeout(r, 2000))
          pdfOk = await gerarEAnexarRelatorio(id)
        }
      } catch (err) {
        console.error(`Erro PDF tentativa ${tentativa}/3:`, err)
      }
    }
    if (!pdfOk) {
      await addPendingPdf(id)
      console.warn('PDF enfileirado para retry em background')
    }

    // Cria a requisição de garantia se for o caso (best-effort — não bloqueia o envio da OS)
    // Permitido sem peças (caso de garantia só com mão de obra / deslocamento).
    if (tipoServico.includes('Garantia')) {
      try {
        let pecasParaGarantia: PecaOS[] = []
        if (pecasGarantia.size > 0) {
          // Busca os preços das peças via listarPecasOS (PPV/movimentacoes + PecasInfo)
          const pecasComPreco = await listarPecasOS(id)
          const ppvIdsStr = String(os?.ID_PPV || '')
          const primeiroPPV = ppvIdsStr.split(',').map(s => s.trim()).filter(Boolean)[0] || null

          pecasParaGarantia = [...pecasGarantia].map((i) => {
            const p = pecas[i]
            // Tenta cruzar pelo código de produto, com fallback por descrição
            const fonte = pecasComPreco.find(
              (x) => (p.codigo && x.cod_produto === p.codigo) || x.descricao === p.descricao,
            )
            return {
              cod_produto: p.codigo || null,
              descricao: p.descricao,
              quantidade: Number(p.qtdUsada) || 1,
              preco_unitario: fonte ? fonte.preco_unitario : 0,
              origem: p.origem === 'ppv' ? 'ppv' : 'pecasinfo_manual',
              fonte_ppv_id: p.origem === 'ppv' ? (fonte?.fonte_ppv_id || primeiroPPV) : null,
            }
          })
        }
        const res = await criarGarantia({
          id_ordem: id,
          tecnico_nome: user?.nome_pos || user?.tecnico_nome || tecResp1,
          tecnico_horas: calcTotalHoras(),
          tecnico_km: calcTotalKm(),
          tecnico_obs: garantiaObs || undefined,
          pecas: pecasParaGarantia,
        })
        if (res.erro) console.warn('[garantia] criação falhou:', res.erro)
      } catch (err) {
        console.error('[garantia] erro ao criar requisição:', err)
      }
    }

    setSaving(false)
    setSucesso(true)
    clearBackup()
  }

  const [gerandoPdf, setGerandoPdf] = useState(false)

  const handleGerarPdf = async () => {
    setGerandoPdf(true)
    try {
      let cidade = ''
      if (os?.Cnpj_Cliente) {
        const { data: cli } = await supabase
          .from('Clientes')
          .select('cidade')
          .eq('cnpj_cpf', os.Cnpj_Cliente)
          .maybeSingle()
        cidade = cli?.cidade || ''
      }

      await gerarPdfRelatorio({
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
        fotoHorimetro, fotoChassis,
        fotoFrente, fotoDireita, fotoEsquerda, fotoTraseira, fotoVolante,
        fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4,
        fotoPecaNova1, fotoPecaNova2,
        fotoPecaInstalada1, fotoPecaInstalada2,
        assCliente, assTecnico,
        nomResp, fazenda: naOficina ? 'Oficina' : fazenda, cidadeServico: naOficina ? 'Oficina' : cidadeLocal,
        data: new Date().toISOString().split('T')[0],
      })
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
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20,
      }}>
        <div style={{
          width: 90, height: 90, borderRadius: '50%', background: '#D1FAE5',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
        }}>
          <CheckCircle size={48} color="#10B981" />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937', marginBottom: 8 }}>OS Enviada!</h2>
        <p style={{ fontSize: 15, color: '#6B7280', marginBottom: 28 }}>Os dados foram salvos com sucesso.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 300 }}>
          <button onClick={handleGerarPdf} disabled={gerandoPdf} style={{
            background: '#1E3A5F', color: '#fff', borderRadius: 14,
            padding: '16px 40px', fontSize: 16, fontWeight: 700, border: 'none',
            cursor: gerandoPdf ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <FileDown size={20} />
            {gerandoPdf ? 'Gerando PDF...' : 'Baixar PDF'}
          </button>
          <Link href="/os" style={{
            background: '#C41E2A', color: '#fff', borderRadius: 14,
            padding: '16px 40px', fontSize: 16, fontWeight: 700, textDecoration: 'none',
            textAlign: 'center',
          }}>
            Voltar às Ordens
          </Link>
        </div>
      </div>
    )
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '14px 16px', borderRadius: 12,
    border: '2px solid #E5E7EB', fontSize: 15, outline: 'none', background: '#fff',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 14, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6,
  }
  const sectionStyle: React.CSSProperties = {
    background: '#fff', borderRadius: 20, padding: 18,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: 14,
    border: '1px solid #F3F4F6',
    animation: 'hbIn 0.42s cubic-bezier(0.16, 1, 0.3, 1) backwards',
  }
  // Cabeçalho de seção com barra de acento colorida (estilo remap)
  const sectionTitle = (text: string, color = '#C41E2A') => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <div style={{ width: 4, height: 18, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>{text}</span>
    </div>
  )

  const updateDia = (index: number, field: keyof DiaForm, value: string) => {
    setDias(prev => prev.map((d, i) => i === index ? { ...d, [field]: value } : d))
  }

  return (
    <div>
      {erroValidacao && (
        <div style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, background: '#DC2626', color: '#fff',
          padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)', maxWidth: '90vw', textAlign: 'center',
          animation: 'fadeIn 0.2s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} />
            {erroValidacao}
          </div>
        </div>
      )}

      <Link href={`/os/${id}`} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        color: '#C41E2A', fontSize: 15, fontWeight: 600,
        textDecoration: 'none', marginBottom: 16, padding: '8px 0',
      }}>
        <ArrowLeft size={20} /> Voltar
      </Link>

      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937', marginBottom: 4 }}>
        OS Técnica — {id}
      </h1>
      {os && (
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>
          {os.Os_Cliente} • {os.Tipo_Servico}
        </p>
      )}

      {/* INFO DO POS (somente leitura) */}
      {os && (
        <div style={{ ...sectionStyle, background: '#F9FAFB', borderLeft: '4px solid #1E3A5F' }}>
          {sectionTitle('Dados do POS', '#1E3A5F')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            <div><strong>Cliente:</strong> {os.Os_Cliente}</div>
            <div><strong>CPF/CNPJ:</strong> {os.Cnpj_Cliente || '—'}</div>
            <div><strong>Endereço:</strong> {os.Endereco_Cliente || '—'}</div>
            <div style={{ display: 'flex', gap: 20 }}>
              <span><strong>Horas POS:</strong> {os.Qtd_HR || 0}h</span>
              <span><strong>KM POS:</strong> {os.Qtd_KM || 0} km</span>
            </div>
            {os.Serv_Solicitado && <div><strong>Descrição:</strong> {os.Serv_Solicitado}</div>}
            {os.Projeto && <div><strong>Projeto:</strong> {os.Projeto}</div>}
            {os.ID_PPV && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: '#DBEAFE', borderRadius: 10, padding: '10px 14px', marginTop: 6,
              }}>
                <Package size={18} color="#2563EB" />
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1D4ED8' }}>
                  PPV: {os.ID_PPV}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 1. TÉCNICO */}
      <div style={sectionStyle}>
        {sectionTitle('Técnico Responsável')}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Técnico Principal</label>
          <input type="text" value={tecResp1} readOnly style={{ ...inputStyle, background: '#F3F4F6', color: '#6B7280' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: temTec2 ? 12 : 0 }}>
          <button type="button" onClick={() => { setTemTec2(!temTec2); setTecResp2('') }} style={{
            padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700,
            border: `2px solid ${temTec2 ? '#C41E2A' : '#E5E7EB'}`,
            background: temTec2 ? '#FFF5F5' : '#fff',
            color: temTec2 ? '#C41E2A' : '#6B7280', cursor: 'pointer',
          }}>
            {temTec2 ? <Minus size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> : <Plus size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />}
            {temTec2 ? 'Remover 2º Técnico' : 'Adicionar 2º Técnico'}
          </button>
        </div>

        {temTec2 && (
          <div>
            <label style={labelStyle}>Segundo Técnico</label>
            <select value={tecResp2} onChange={(e) => setTecResp2(e.target.value)} style={inputStyle}>
              <option value="">Selecione...</option>
              {tecnicos.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* 2. DIAGNÓSTICO E SERVIÇO */}
      <div style={sectionStyle}>
        {sectionTitle('Diagnóstico e Serviço', '#1E3A5F')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Diagnóstico (o que estava acontecendo?)</label>
            <textarea value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} rows={3}
              placeholder="Descreva o problema encontrado..." style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div>
            <label style={labelStyle}>Serviço Realizado</label>
            <textarea value={servicoRealizado} onChange={(e) => setServicoRealizado(e.target.value)} rows={3}
              placeholder="Descreva o que foi feito..." style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div>
            <label style={labelStyle}>Tipo de Serviço</label>
            <select value={tipoServico} onChange={(e) => setTipoServico(e.target.value)} style={inputStyle}>
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
          {tipoServico.includes('Revisão') && (
            <div>
              <label style={labelStyle}>Revisão de quantas horas?</label>
              <select value={tipoRev} onChange={(e) => setTipoRev(e.target.value)} style={inputStyle}>
                <option value="">Selecione...</option>
                {HORAS_REVISAO.map((h) => <option key={h} value={`${h} horas`}>{h} horas</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* 3. IDENTIFICAÇÃO DO EQUIPAMENTO */}
      <div style={sectionStyle}>
        {sectionTitle('Identificação do Equipamento', '#1E3A5F')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {os?.Projeto && (
            <div>
              <label style={labelStyle}>Projeto</label>
              <input type="text" value={projeto} onChange={(e) => setProjeto(e.target.value)} style={inputStyle} />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div id="campo-marca">
              <label style={labelStyle}>Marca <span style={{ color: '#C41E2A' }}>*</span></label>
              <input type="text" value={marca} onChange={(e) => setMarca(e.target.value)}
                style={inputStyle} placeholder="Ex: Valtra" />
            </div>
            <div id="campo-modelo">
              <label style={labelStyle}>Modelo <span style={{ color: '#C41E2A' }}>*</span></label>
              <input type="text" value={modelo} onChange={(e) => setModelo(e.target.value)}
                style={inputStyle} placeholder="Ex: BH 180" />
            </div>
          </div>
          <div id="campo-chassis">
            <label style={labelStyle}>Final do Chassis (escrito) <span style={{ color: '#C41E2A' }}>*</span></label>
            <input type="text" value={chassis} onChange={(e) => setChassis(e.target.value)}
              style={inputStyle} placeholder="Últimos dígitos do chassis" />
          </div>
          <div>
            <label style={labelStyle}>Horímetro (escrito)</label>
            <input type="text" value={horimetro} onChange={(e) => setHorimetro(e.target.value)}
              style={inputStyle} placeholder="Ex: 2.450" />
          </div>
        </div>
      </div>

      {/* 4. DATAS / HORAS / DESLOCAMENTO */}
      <div id="secao-dias" style={sectionStyle}>
        {sectionTitle('Datas / Horas / Deslocamento', '#1E3A5F')}
        {dias[0]?.data && dias[0]?.horaInicio && (
          <div style={{
            background: '#D1FAE5', borderRadius: 10, padding: '8px 12px',
            marginBottom: 12, fontSize: 12, color: '#065F46',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <CheckCircle size={14} color="#059669" />
            Horários pré-preenchidos a partir do registro de visita. Você pode ajustá-los se necessário.
          </div>
        )}

        {dias.map((dia, i) => (
          <div key={i} style={{ marginBottom: i < dias.length - 1 ? 16 : 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>Dia {i + 1}</span>
              {i > 0 && (
                <button type="button" onClick={() => setDias(prev => prev.filter((_, idx) => idx !== i))}
                  style={{ fontSize: 12, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  Remover
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Data</label>
                <input type="date" value={dia.data} onChange={(e) => updateDia(i, 'data', e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Hora Início</label>
                  <input type="time" value={dia.horaInicio} onChange={(e) => updateDia(i, 'horaInicio', e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Hora Fim</label>
                  <input type="time" value={dia.horaFim} onChange={(e) => updateDia(i, 'horaFim', e.target.value)} style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Total KM</label>
                <input type="text" inputMode="numeric" value={dia.kmTotal} onChange={(e) => updateDia(i, 'kmTotal', e.target.value)} style={inputStyle} placeholder="0" />
              </div>
            </div>
            {i < dias.length - 1 && <div style={{ height: 1, background: '#E5E7EB', margin: '16px 0' }} />}
          </div>
        ))}

        {dias.length < 3 && (
          <button type="button" onClick={() => setDias(prev => [...prev, { data: '', horaInicio: '', horaFim: '', kmTotal: '' }])} style={{
            marginTop: 14, padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700,
            border: '2px solid #E5E7EB', background: '#fff', color: '#6B7280', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Plus size={14} /> Adicionar mais um dia
          </button>
        )}

        {/* Totais calculados */}
        <div style={{ height: 1, background: '#E5E7EB', margin: '16px 0' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ background: '#F9FAFB', borderRadius: 10, padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>Total Horas</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>{calcTotalHoras() || '—'}</div>
          </div>
          <div style={{ background: '#F9FAFB', borderRadius: 10, padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>Total KM</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F' }}>{calcTotalKm() || '—'}</div>
          </div>
        </div>

        {/* Almoço — anexar a nota de cada dia lançado na OS (valor > R$1) */}
        <div id="secao-almoco" style={{ height: 1, background: '#E5E7EB', margin: '16px 0' }} />
        {almocosOS.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
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
      <div style={sectionStyle}>
        {sectionTitle('Veículo', '#1E3A5F')}
        <div>
          <label style={labelStyle}><Truck size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Veículo Utilizado</label>
          <select value={numPlaca} onChange={(e) => setNumPlaca(e.target.value)} style={inputStyle}>
            <option value="">Selecione a placa...</option>
            <option value="OFICINA">Oficina</option>
            {veiculos.map((v) => <option key={v.IdPlaca} value={v.NumPlaca}>{v.NumPlaca}</option>)}
          </select>
        </div>
      </div>

      {/* 6. FOTOS */}
      <div id="secao-fotos" style={sectionStyle}>
        {sectionTitle('Fotos')}
        <p style={{ fontSize: 13, color: '#6B7280', margin: '-6px 0 12px', lineHeight: 1.5 }}>
          {tipoServico.includes('Implemento') ? (
            <>Anexe a foto do <strong style={{ color: '#374151' }}>chassis</strong> do implemento (obrigatória).</>
          ) : (
            <>Anexe pelo menos <strong style={{ color: '#374151' }}>2 fotos</strong> do serviço.
              Não esqueça o <strong style={{ color: '#374151' }}>chassis</strong> e o <strong style={{ color: '#374151' }}>horímetro</strong>.</>
          )}
        </p>
        {(() => {
          const slots = fotoSlots()
          const anexadas = slots.filter(s => s.v)
          const podeMais = anexadas.length < 7
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {slots.map((s) => s.v ? (
                  <div key={s.campo} className="foto-pop" style={{
                    position: 'relative', aspectRatio: '1', borderRadius: 14, overflow: 'hidden',
                    border: '2px solid #E5E7EB', background: '#F9FAFB',
                  }}>
                    <img src={s.v} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {s.v.startsWith('blob:') && (
                      <div style={{
                        position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <div className="spinner" style={{ width: 22, height: 22 }} />
                      </div>
                    )}
                    <button type="button" onClick={() => s.set('')} style={{
                      position: 'absolute', top: 5, right: 5, width: 26, height: 26, borderRadius: '50%',
                      border: 'none', background: 'rgba(17,24,39,0.7)', color: '#fff', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <X size={15} />
                    </button>
                  </div>
                ) : null)}

                {podeMais && (
                  <>
                    <label className="foto-add" style={{
                      aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 6, borderRadius: 14, cursor: 'pointer',
                      border: '2px dashed #C7D2FE', background: '#EFF6FF', color: '#2563EB',
                    }}>
                      <Camera size={26} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Câmera</span>
                      <input type="file" accept="image/*" capture="environment"
                        onChange={(e) => { addFotos(e.target.files); e.target.value = '' }}
                        style={{ display: 'none' }} />
                    </label>
                    <label className="foto-add" style={{
                      aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 6, borderRadius: 14, cursor: 'pointer',
                      border: '2px dashed #D1D5DB', background: '#FAFAFA', color: '#6B7280',
                    }}>
                      <ImagePlus size={26} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Galeria</span>
                      <input type="file" accept="image/*" multiple
                        onChange={(e) => { addFotos(e.target.files); e.target.value = '' }}
                        style={{ display: 'none' }} />
                    </label>
                  </>
                )}
              </div>
              <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 8, textAlign: 'right' }}>
                {anexadas.length}/7 fotos
              </p>
            </>
          )
        })()}
      </div>

      {/* 7. GARANTIA — Peças solicitadas + Fotos (só aparece se tipo = Garantia) */}
      {tipoServico.includes('Garantia') && (
        <>
          {/* Seleção de peças que entram na requisição de garantia */}
          <div style={{ ...sectionStyle, borderLeft: '4px solid #C41E2A' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <ShieldCheck size={18} color="#C41E2A" />
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1F2937' }}>
                Peças solicitadas em garantia
              </h3>
            </div>
            <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 10 }}>
              Marque quais peças que você usou nesta OS devem ir para análise da fábrica.
            </p>
            {(() => {
              const candidatas = pecas
                .map((p, i) => ({ p, i }))
                .filter(({ p }) => !p.naoUsada && p.descricao)
              if (candidatas.length === 0) {
                return (
                  <p style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', padding: '12px 0', margin: 0 }}>
                    Nenhuma peça usada nesta OS — adicione/marque as peças acima antes de solicitar garantia.
                  </p>
                )
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {candidatas.map(({ p, i }) => {
                    const sel = pecasGarantia.has(i)
                    return (
                      <button
                        key={`gpeca-${i}`}
                        type="button"
                        onClick={() => {
                          setPecasGarantia(prev => {
                            const n = new Set(prev)
                            if (n.has(i)) n.delete(i); else n.add(i)
                            return n
                          })
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px', borderRadius: 10,
                          border: `2px solid ${sel ? '#C41E2A' : '#E5E7EB'}`,
                          background: sel ? '#FEF2F2' : '#fff',
                          cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <div
                          style={{
                            width: 22, height: 22, borderRadius: 6,
                            border: `2px solid ${sel ? '#C41E2A' : '#CBD5E1'}`,
                            background: sel ? '#C41E2A' : '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {sel && <CheckCircle2 size={14} color="#fff" />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1F2937' }}>
                            {p.codigo ? `${p.codigo} · ` : ''}{p.descricao}
                          </div>
                          <div style={{ fontSize: 11, color: '#9CA3AF' }}>
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
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 10,
                      border: '2px solid #E5E7EB', fontSize: 13, outline: 'none',
                      background: '#fff', boxSizing: 'border-box', resize: 'vertical',
                      fontFamily: 'inherit', marginTop: 4,
                    }}
                  />
                  <p style={{ fontSize: 11, color: '#6B7280', margin: 0 }}>
                    A requisição de garantia será criada automaticamente quando você enviar a OS.
                  </p>
                </div>
              )
            })()}
          </div>

          <div style={sectionStyle}>
            {sectionTitle('Fotos do Equipamento', '#1E3A5F')}
            <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 10 }}>Obrigatório para garantia</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <FotoUpload label="Frente" value={fotoFrente} onChange={(f) => handleFoto(setFotoFrente, 'FotoFrente', f)} onRemove={() => setFotoFrente('')} obrigatorio />
              <FotoUpload label="Direita" value={fotoDireita} onChange={(f) => handleFoto(setFotoDireita, 'FotoDireita', f)} onRemove={() => setFotoDireita('')} obrigatorio />
              <FotoUpload label="Esquerda" value={fotoEsquerda} onChange={(f) => handleFoto(setFotoEsquerda, 'FotoEsquerda', f)} onRemove={() => setFotoEsquerda('')} obrigatorio />
              <FotoUpload label="Traseira" value={fotoTraseira} onChange={(f) => handleFoto(setFotoTraseira, 'FotoTraseira', f)} onRemove={() => setFotoTraseira('')} obrigatorio />
              <FotoUpload label="Volante" value={fotoVolante} onChange={(f) => handleFoto(setFotoVolante, 'FotoVolante', f)} onRemove={() => setFotoVolante('')} obrigatorio />
            </div>
          </div>

          <div style={sectionStyle}>
            {sectionTitle('Fotos da Falha', '#C41E2A')}
            <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 10 }}>Pelo menos 1 foto obrigatória</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <FotoUpload label="Falha 1" value={fotoFalha1} onChange={(f) => handleFoto(setFotoFalha1, 'FotoFalha1', f)} onRemove={() => setFotoFalha1('')} obrigatorio />
              <FotoUpload label="Falha 2" value={fotoFalha2} onChange={(f) => handleFoto(setFotoFalha2, 'FotoFalha2', f)} onRemove={() => setFotoFalha2('')} />
              <FotoUpload label="Falha 3" value={fotoFalha3} onChange={(f) => handleFoto(setFotoFalha3, 'FotoFalha3', f)} onRemove={() => setFotoFalha3('')} />
              <FotoUpload label="Falha 4" value={fotoFalha4} onChange={(f) => handleFoto(setFotoFalha4, 'FotoFalha4', f)} onRemove={() => setFotoFalha4('')} />
            </div>
          </div>

          <div style={sectionStyle}>
            {sectionTitle('Fotos das Peças', '#C41E2A')}
            <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 10 }}>Pelo menos 1 foto obrigatória</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <FotoUpload label="Peça Nova 1" value={fotoPecaNova1} onChange={(f) => handleFoto(setFotoPecaNova1, 'FotoPecaNova1', f)} onRemove={() => setFotoPecaNova1('')} obrigatorio />
              <FotoUpload label="Peça Nova 2" value={fotoPecaNova2} onChange={(f) => handleFoto(setFotoPecaNova2, 'FotoPecaNova2', f)} onRemove={() => setFotoPecaNova2('')} />
              <FotoUpload label="Instalada 1" value={fotoPecaInstalada1} onChange={(f) => handleFoto(setFotoPecaInstalada1, 'FotoPecaInstalada1', f)} onRemove={() => setFotoPecaInstalada1('')} obrigatorio />
              <FotoUpload label="Instalada 2" value={fotoPecaInstalada2} onChange={(f) => handleFoto(setFotoPecaInstalada2, 'FotoPecaInstalada2', f)} onRemove={() => setFotoPecaInstalada2('')} />
            </div>
          </div>
        </>
      )}

      {/* 8. ASSINATURAS */}
      <div style={sectionStyle}>
        {sectionTitle('Assinaturas')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <SignaturePad label="Assinatura do Cliente" value={assCliente} onSave={(v) => setAssCliente(v)} allowPhoto />
          <SignaturePad label="Assinatura do Técnico" value={assTecnico} onSave={(v) => setAssTecnico(v)} />
        </div>
      </div>

      {/* 9. RESPONSÁVEL E LOCAL */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Nome do Responsável pelo Trator (cliente)</label>
        <input type="text" value={nomResp} onChange={(e) => setNomResp(e.target.value)} style={inputStyle}
          placeholder="Nome de quem é responsável pelo equipamento" />

        {/* Serviço realizado na oficina? */}
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Onde o serviço foi realizado?</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setNaOficina(false)} style={{
              flex: 1, padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              border: `2px solid ${!naOficina ? '#1E3A5F' : '#E5E7EB'}`,
              background: !naOficina ? '#1E3A5F' : '#fff', color: !naOficina ? '#fff' : '#6B7280',
            }}>
              No cliente
            </button>
            <button type="button" onClick={() => setNaOficina(true)} style={{
              flex: 1, padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              border: `2px solid ${naOficina ? '#059669' : '#E5E7EB'}`,
              background: naOficina ? '#059669' : '#fff', color: naOficina ? '#fff' : '#6B7280',
            }}>
              Na oficina
            </button>
          </div>
        </div>

        {naOficina ? (
          <div style={{
            marginTop: 12, padding: '12px 14px', borderRadius: 12,
            background: '#ECFDF5', border: '1px solid #A7F3D0',
            fontSize: 13, color: '#059669', fontWeight: 500,
          }}>
            Serviço interno na oficina — não é necessário informar fazenda e cidade.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
            <div id="campo-fazenda">
              <label style={labelStyle}>Nome da Fazenda <span style={{ color: '#C41E2A' }}>*</span></label>
              <input type="text" value={fazenda} onChange={(e) => setFazenda(e.target.value)}
                style={inputStyle} placeholder="Ex: Fazenda São José" />
            </div>
            <div id="campo-cidade">
              <label style={labelStyle}>Cidade <span style={{ color: '#C41E2A' }}>*</span></label>
              <input type="text" value={cidadeLocal} onChange={(e) => setCidadeLocal(e.target.value)}
                style={inputStyle} placeholder="Ex: Ribeirão Preto" />
            </div>
          </div>
        )}
      </div>

      {/* 10. PEÇAS / SERVIÇOS EXTRAS (no final, não obrigatório) */}
      <div id="secao-extras" style={sectionStyle}>
        {sectionTitle('Peças ou Serviços Extras', '#D97706')}
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 14, lineHeight: 1.5 }}>
          Se você usou uma peça a mais ou contratou um serviço de terceiro que não estava previsto, informe aqui. Este campo não é obrigatório.
        </p>

        {manualItems.length > 0 && (
          <>
            {pecas.map((peca, i) => {
              if (peca.origem !== 'manual') return null
              return (
                <div key={i} style={{
                  background: '#FFFBEB', borderRadius: 12, padding: 14, marginBottom: 10,
                  border: '1.5px solid #FDE68A',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: '#FEF3C7', color: '#D97706' }}>
                      EXTRA
                    </span>
                    <button type="button" onClick={() => setPecas(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ fontSize: 12, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                      Remover
                    </button>
                  </div>
                  <input type="text" value={peca.descricao} placeholder="Descrição do produto/serviço"
                    onChange={(e) => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, descricao: e.target.value } : p))}
                    style={{ ...inputStyle, marginBottom: 8 }} />
                  <div>
                    <label style={{ fontSize: 11, color: '#6B7280' }}>Qtd</label>
                    <input type="text" inputMode="numeric" value={peca.qtdUsada}
                      onChange={(e) => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, qtdUsada: e.target.value } : p))}
                      style={inputStyle} placeholder="1" />
                  </div>
                </div>
              )
            })}

            {/* Justificativa obrigatória se tem extras */}
            <div style={{
              background: '#FEF2F2', borderRadius: 12, padding: 14, marginBottom: 10,
              border: '2px solid #FECACA',
            }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#DC2626', display: 'block', marginBottom: 6 }}>
                <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Por que não avisou antes?
              </label>
              <textarea
                value={justificativaPecaExtra}
                onChange={(e) => setJustificativaPecaExtra(e.target.value)}
                rows={2}
                placeholder="Justifique o motivo de usar peça/serviço sem aviso prévio..."
                style={{ ...inputStyle, resize: 'vertical', borderColor: '#FECACA' }}
              />
            </div>
          </>
        )}

        <button type="button" onClick={() => setPecas(prev => [...prev, {
          descricao: '', codigo: '', qtdUsada: '1', devolvida: false, qtdDevolvida: '',
          origem: 'manual', qtdOriginal: '', naoUsada: false, revisado: true,
        }])} style={{
          padding: '12px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700,
          border: '2px dashed #FDE68A', background: '#FFFBEB', color: '#D97706', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center',
        }}>
          <Plus size={14} /> Adicionar peça/serviço extra
        </button>
      </div>

      {/* REVISÃO DO PPV — sempre visível, sem cascata */}
      {os?.ID_PPV && (
        <div id="secao-ppv" style={{
          ...sectionStyle, borderLeft: '4px solid #3B82F6',
          background: '#F8FAFC',
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1D4ED8', marginBottom: 6 }}>
            Revisão de Peças — PPV {os.ID_PPV}
          </div>
          <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
            Revise cada produto: confirme se usou, informe se devolveu ou não utilizou. Todos devem ser revisados para enviar a OS.
          </p>

          {loadingPPV ? (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
              <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 8 }}>Carregando produtos...</div>
            </div>
          ) : ppvItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, fontSize: 13, color: '#9CA3AF' }}>
              Nenhum produto encontrado no PPV.
            </div>
          ) : (
            <>
              {(() => {
                const revisados = ppvItems.filter(p => p.revisado).length
                const total = ppvItems.length
                return (
                  <div style={{
                    background: revisados === total ? '#D1FAE5' : '#FEF3C7',
                    borderRadius: 10, padding: '10px 14px', marginBottom: 14,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    {revisados === total
                      ? <CheckCircle size={16} color="#059669" />
                      : <AlertTriangle size={16} color="#D97706" />
                    }
                    <span style={{
                      fontSize: 13, fontWeight: 700,
                      color: revisados === total ? '#059669' : '#D97706',
                    }}>
                      {revisados === total
                        ? 'Todos os produtos revisados!'
                        : `${revisados} de ${total} produtos revisados`}
                    </span>
                  </div>
                )
              })()}

              {pecas.map((peca, i) => {
                if (peca.origem !== 'ppv') return null
                return (
                  <div key={i} style={{
                    background: peca.revisado
                      ? (peca.naoUsada ? '#FEF2F2' : '#F0FDF4')
                      : '#fff',
                    borderRadius: 12, padding: 14, marginBottom: 10,
                    border: `2px solid ${peca.revisado
                      ? (peca.naoUsada ? '#FECACA' : '#BBF7D0')
                      : '#FDE68A'}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1F2937', marginBottom: 2 }}>
                          {peca.descricao}
                        </div>
                        {peca.codigo && (
                          <div style={{ fontSize: 11, color: '#6B7280' }}>Cód: {peca.codigo}</div>
                        )}
                        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                          Qtd separada: <strong>{peca.qtdOriginal}</strong>
                        </div>
                      </div>
                      {peca.revisado ? (
                        <CheckCircle size={20} color={peca.naoUsada ? '#DC2626' : '#10B981'} />
                      ) : (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                          background: '#FEF3C7', color: '#D97706',
                        }}>
                          Pendente
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Usou?</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" onClick={() => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, naoUsada: false, revisado: true } : p))}
                          style={{ padding: '7px 16px', borderRadius: 8, border: `2px solid ${!peca.naoUsada && peca.revisado ? '#10B981' : '#E5E7EB'}`, background: !peca.naoUsada && peca.revisado ? '#D1FAE5' : '#fff', color: !peca.naoUsada && peca.revisado ? '#059669' : '#6B7280', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                          Sim
                        </button>
                        <button type="button" onClick={() => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, naoUsada: true, devolvida: false, qtdDevolvida: '', revisado: true } : p))}
                          style={{ padding: '7px 16px', borderRadius: 8, border: `2px solid ${peca.naoUsada ? '#EF4444' : '#E5E7EB'}`, background: peca.naoUsada ? '#FEE2E2' : '#fff', color: peca.naoUsada ? '#DC2626' : '#6B7280', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                          Não usou
                        </button>
                      </div>
                    </div>

                    {peca.revisado && !peca.naoUsada && (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 11, color: '#6B7280' }}>Qtd utilizada</label>
                            <input type="text" inputMode="numeric" value={peca.qtdUsada}
                              onChange={(e) => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, qtdUsada: e.target.value } : p))}
                              style={inputStyle} placeholder="0" />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: '#6B7280' }}>Devolveu?</label>
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                              <button type="button" onClick={() => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, devolvida: false, qtdDevolvida: '' } : p))}
                                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `2px solid ${!peca.devolvida ? '#1E3A5F' : '#E5E7EB'}`, background: !peca.devolvida ? '#1E3A5F' : '#fff', color: !peca.devolvida ? '#fff' : '#6B7280', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                                Não
                              </button>
                              <button type="button" onClick={() => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, devolvida: true } : p))}
                                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `2px solid ${peca.devolvida ? '#10B981' : '#E5E7EB'}`, background: peca.devolvida ? '#D1FAE5' : '#fff', color: peca.devolvida ? '#059669' : '#6B7280', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                                Sim
                              </button>
                            </div>
                          </div>
                        </div>
                        {peca.devolvida && (
                          <div style={{ marginTop: 8 }}>
                            <label style={{ fontSize: 11, color: '#6B7280' }}>Qtd devolvida</label>
                            <input type="text" inputMode="numeric" value={peca.qtdDevolvida}
                              onChange={(e) => setPecas(prev => prev.map((p, idx) => idx === i ? { ...p, qtdDevolvida: e.target.value } : p))}
                              style={inputStyle} placeholder="0" />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* BOTÃO ENVIAR */}
      <div style={{ marginBottom: 30 }}>
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
                width: '100%', padding: '18px 0', borderRadius: 16,
                background: bloqueado ? '#9CA3AF' : '#C41E2A',
                color: '#fff',
                fontSize: 17, fontWeight: 600, border: 'none',
                cursor: (saving || bloqueado) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: bloqueado ? 'none' : '0 6px 20px rgba(196,30,42,0.3)',
              }}
            >
              <Send size={18} />
              {saving ? 'Enviando...' : motivo || 'Enviar OS'}
            </button>
          )
        })()}
      </div>
    </div>
  )
}
