'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { use } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useFormBackup } from '@/hooks/useFormBackup'
import { supabase } from '@/lib/supabase'
import { offlineWrite } from '@/lib/offlineWrite'
import type { OrdemServico } from '@/lib/types'
import FotoUpload from '@/components/FotoUpload'
import SignaturePad from '@/components/SignaturePad'
import { ArrowLeft, Plus, Minus, CheckCircle, Send, Truck, Camera, ChevronDown, ChevronUp, Package, AlertTriangle, FileDown } from 'lucide-react'
import Link from 'next/link'
import { gerarPdfRelatorio } from '@/lib/gerarPdfRelatorio'
import { notificarPortalOS } from '@/lib/notificarPortal'

const TIPOS_SERVICO = ['Manutenção', 'Revisão', 'Montagem Implemento', 'Garantia', 'Entrega Técnica', 'Inspeção Pré Entrega']
const HORAS_REVISAO = ['50', '300', '600', '900', '1200', '1500', '1800', '2100', '2400', '2700', '3000']

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

  // Dias (dinâmico)
  const [dias, setDias] = useState<DiaForm[]>([{ data: '', horaInicio: '', horaFim: '', kmTotal: '' }])

  // Peças informadas pelo técnico
  const [pecas, setPecas] = useState<PecaInfo[]>([])
  const pecasRef = useRef<PecaInfo[]>([])
  pecasRef.current = pecas
  const [loadingPPV, setLoadingPPV] = useState(false)
  const [ppvAberto, setPpvAberto] = useState(false)
  const [ppvRevisado, setPpvRevisado] = useState(false)
  const [justificativaPecaExtra, setJustificativaPecaExtra] = useState('')

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

  // Almoço
  const [temAlmoco, setTemAlmoco] = useState(false)
  const [valorAlmoco, setValorAlmoco] = useState('')
  const [fotoAlmoco, setFotoAlmoco] = useState('')

  // Assinaturas
  const [assCliente, setAssCliente] = useState('')
  const [assTecnico, setAssTecnico] = useState('')
  const [erroValidacao, setErroValidacao] = useState('')

  const carregarProdutosPPV = async (idPPV: string, pecasAtuais?: PecaInfo[]) => {
    setLoadingPPV(true)
    const { data: movs } = await supabase
      .from('movimentacoes')
      .select('*')
      .eq('Id_PPV', idPPV)
    const existentes = pecasAtuais || []
    const manuais = existentes.filter(p => p.origem === 'manual')

    if (movs && movs.length > 0) {
      const pecasPPV = (movs as MovimentacaoPPV[]).map((m) => ({
        descricao: m.Descricao || m.CodProduto,
        codigo: m.CodProduto || '',
        qtdOriginal: m.Qtde || '1',
      }))
      const ppvExistentes = existentes.filter(p => p.origem === 'ppv')

      const merged: PecaInfo[] = pecasPPV.map((ppv) => {
        const jaExiste = ppvExistentes.find(p => p.codigo === ppv.codigo)
        if (jaExiste) {
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
      const [{ data: osData }, { data: tecData }, { data: veicData }, { data: existing }] = await Promise.all([
        supabase.from('Ordem_Servico').select('*').eq('Id_Ordem', id).single(),
        supabase.from('Tecnicos_Appsheet').select('UsuNome').order('UsuNome'),
        supabase.from('SupaPlacas').select('IdPlaca, NumPlaca').order('NumPlaca'),
        supabase.from('Ordem_Servico_Tecnicos').select('*').eq('Ordem_Servico', id).maybeSingle(),
      ])

      if (osData) {
        setOs(osData as OrdemServico)
        if (osData.Projeto) setProjeto(osData.Projeto)
        if (osData.Tipo_Servico) setTipoServico(osData.Tipo_Servico)
      }
      if (tecData) setTecnicos(tecData.map((t: { UsuNome: string }) => t.UsuNome).filter(Boolean))
      if (veicData) setVeiculos(veicData as { IdPlaca: number; NumPlaca: string }[])

      if (existing) {
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
        setFazenda(existing.Fazenda || '')
        setCidadeLocal(existing.Cidade || '')
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
        setAssCliente(existing.AssCliente || '')
        setAssTecnico(existing.AssTecnico || '')
        setJustificativaPecaExtra(existing.JustificativaPecaExtra || '')
        if (existing.TemAlmoco) setTemAlmoco(true)
        if (existing.ValorAlmoco) setValorAlmoco(String(existing.ValorAlmoco))
        if (existing.FotoAlmoco) setFotoAlmoco(existing.FotoAlmoco)

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

      setLoading(false)
    }
    carregar()
  }, [id, user])

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
    fazenda, cidadeLocal,
    dias, pecas, ppvRevisado, justificativaPecaExtra,
    fotoHorimetro, fotoChassis, fotoFrente, fotoDireita, fotoEsquerda,
    fotoTraseira, fotoVolante, fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4,
    fotoPecaNova1, fotoPecaNova2, fotoPecaInstalada1, fotoPecaInstalada2,
    temAlmoco, valorAlmoco, fotoAlmoco,
    assCliente, assTecnico,
  }), [
    tecResp1, temTec2, tecResp2, diagnostico, servicoRealizado,
    tipoServico, tipoRev, projeto, chassis, marca, modelo, horimetro, numPlaca, nomResp,
    fazenda, cidadeLocal,
    dias, pecas, ppvRevisado, justificativaPecaExtra,
    fotoHorimetro, fotoChassis, fotoFrente, fotoDireita, fotoEsquerda,
    fotoTraseira, fotoVolante, fotoFalha1, fotoFalha2, fotoFalha3, fotoFalha4,
    fotoPecaNova1, fotoPecaNova2, fotoPecaInstalada1, fotoPecaInstalada2,
    temAlmoco, valorAlmoco, fotoAlmoco,
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
    if (data.temAlmoco !== undefined) setTemAlmoco(data.temAlmoco as boolean)
    if (data.valorAlmoco !== undefined) setValorAlmoco(data.valorAlmoco as string)
    if (data.fotoAlmoco !== undefined) setFotoAlmoco(data.fotoAlmoco as string)
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

    if (!fazenda.trim()) {
      mostrarErro('Preencha o nome da Fazenda.', 'campo-fazenda')
      return
    }
    if (!cidadeLocal.trim()) {
      mostrarErro('Preencha a Cidade.', 'campo-cidade')
      return
    }

    // Validar km total de cada dia
    const diaKmVazio = dias.findIndex(d => !d.kmTotal.trim())
    if (diaKmVazio >= 0) {
      mostrarErro(`Preencha o Total KM do dia ${diaKmVazio + 1}.`, 'secao-dias')
      return
    }

    if (os?.ID_PPV && !todosRevisados) {
      mostrarErro(`Revise todos os produtos do PPV antes de enviar. ${ppvItems.filter(p => !p.revisado).length} produto(s) pendente(s).`, 'secao-ppv')
      setPpvAberto(true)
      return
    }

    // Avisar se tem fotos com erro de upload
    if (errosFoto.length > 0) {
      const continuar = confirm(`${errosFoto.length} foto(s) não foram enviadas (${errosFoto.join(', ')}). Deseja enviar mesmo assim sem essas fotos?`)
      if (!continuar) return
    }

    // Validar almoço — aceitar base64 (data:) como foto válida (salva offline)
    if (temAlmoco) {
      if (!valorAlmoco.trim()) {
        mostrarErro('Informe o valor do almoço.', 'secao-almoco')
        return
      }
      const fotoAlmocoValida = fotoAlmoco && !fotoAlmoco.startsWith('blob:')
      if (!fotoAlmocoValida) {
        mostrarErro('Anexe a foto da nota do almoço.', 'secao-almoco')
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
      fotoAlmocoFinal,
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
      temAlmoco ? resolverFoto(fotoAlmoco, 'FotoAlmoco') : Promise.resolve(null),
    ])

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
      Garantia: tipoServico === 'Garantia',
      Horimetro: horimetro,
      NumPlaca: numPlaca,
      TratorLocal1: '',
      TratorLocal2: '',
      NomResp: nomResp,
      Fazenda: fazenda,
      Cidade: cidadeLocal,
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
      TemAlmoco: temAlmoco,
      ValorAlmoco: temAlmoco ? parseFloat(valorAlmoco) || 0 : null,
      FotoAlmoco: fotoAlmocoFinal,
      AssCliente: assCliente, AssTecnico: assTecnico,
      PecasInfo: JSON.stringify(pecas),
      JustificativaPecaExtra: justificativaPecaExtra || null,
      Data: new Date().toISOString().split('T')[0],
      Status: 'enviado',
      pdf_criado: false,
    }

    if (existingId) {
      const res = await offlineWrite({
        table: 'Ordem_Servico_Tecnicos', action: 'update',
        data: payload, match: { IdOs: existingId },
      })
      if (!res.ok) { setSaving(false); alert('Erro ao salvar: ' + (res.error || 'Erro desconhecido')); return }
      if (res.queued) {
        // Dados salvos na fila offline — não tenta gerar PDF
        setSaving(false)
        setSucesso(true)
        clearBackup()
        return
      }
    } else {
      if (navigator.onLine) {
        const { data } = await supabase.from('Ordem_Servico_Tecnicos').insert(payload).select('IdOs').single()
        if (data) setExistingId(data.IdOs)
      } else {
        const res = await offlineWrite({ table: 'Ordem_Servico_Tecnicos', action: 'insert', data: payload })
        if (!res.ok) { setSaving(false); alert('Erro ao salvar: ' + (res.error || 'Erro desconhecido')); return }
        setSaving(false)
        setSucesso(true)
        clearBackup()
        return
      }
    }

    // Atualizar status da OS para 'Relatório Concluído' independente do PDF
    await offlineWrite({
      table: 'Ordem_Servico', action: 'update',
      data: { Status: 'Relatório Concluído' }, match: { Id_Ordem: id },
    })

    // Gerar PDF, fazer upload e vincular à OS no portal
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

      const downloadFoto = async (url: string): Promise<string | null> => {
        if (!url) return null
        // Tentar extrair path do Supabase Storage (vários formatos possíveis)
        let path: string | null = null
        const match = url.match(/\/(?:object|storage)\/(?:v1\/)?(?:public|sign)\/requisicoes\/(.+?)(\?|$)/)
        if (match) {
          path = decodeURIComponent(match[1])
        } else if (url.includes('/requisicoes/')) {
          // Fallback: pegar tudo depois de /requisicoes/
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
        // Fallback: fetch direto da URL
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
        garantia: tipoServico === 'Garantia',
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
        nomResp, fazenda, cidadeServico: cidadeLocal,
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

          // Notificar portal
          notificarPortalOS(id, user?.tecnico_nome || '', os?.Os_Cliente || '')
        }
      }
    } catch (err) {
      console.error('Erro ao gerar/enviar PDF:', err)
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
        garantia: tipoServico === 'Garantia',
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
        nomResp, fazenda, cidadeServico: cidadeLocal,
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
    fontSize: 14, fontWeight: 700, color: '#1F2937', display: 'block', marginBottom: 6,
  }
  const sectionStyle: React.CSSProperties = {
    background: '#fff', borderRadius: 16, padding: 18,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16,
  }
  const sectionTitle = (text: string, color = '#C41E2A') => (
    <div style={{ fontSize: 16, fontWeight: 700, color, marginBottom: 14 }}>{text}</div>
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

      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#C41E2A', marginBottom: 4 }}>
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
              <button id="secao-ppv" type="button" onClick={() => {
                if (!ppvAberto && pecas.filter(p => p.origem === 'ppv').length === 0) {
                  carregarProdutosPPV(os.ID_PPV)
                }
                setPpvAberto(!ppvAberto)
              }} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: ppvRevisado ? '#D1FAE5' : '#DBEAFE',
                border: `2px solid ${ppvRevisado ? '#10B981' : '#3B82F6'}`,
                borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
                marginTop: 6, width: '100%', textAlign: 'left',
              }}>
                <Package size={18} color={ppvRevisado ? '#059669' : '#2563EB'} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: ppvRevisado ? '#059669' : '#1D4ED8' }}>
                  PPV: {os.ID_PPV}
                </span>
                {ppvRevisado ? (
                  <CheckCircle size={18} color="#059669" />
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', background: '#FEE2E2', padding: '2px 8px', borderRadius: 6 }}>
                    Revisar
                  </span>
                )}
                {ppvAberto ? <ChevronUp size={18} color="#6B7280" /> : <ChevronDown size={18} color="#6B7280" />}
              </button>
            )}
          </div>
        </div>
      )}

      {/* PRODUTOS DO PPV (expandível) */}
      {os?.ID_PPV && ppvAberto && (
        <div style={{
          ...sectionStyle, borderLeft: '4px solid #3B82F6',
          background: '#F8FAFC', marginTop: -8,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1D4ED8', marginBottom: 6 }}>
            Produtos do PPV — {os.ID_PPV}
          </div>
          <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
            Revise cada produto: confirme se usou, informe se devolveu ou não utilizou. Todos devem ser revisados para enviar a OS.
          </p>

          {loadingPPV ? (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
              <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 8 }}>Carregando produtos...</div>
            </div>
          ) : (
            <>
              {pecas.filter(p => p.origem === 'ppv').length > 0 && (() => {
                const items = pecas.filter(p => p.origem === 'ppv')
                const revisados = items.filter(p => p.revisado).length
                const total = items.length
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
              {TIPOS_SERVICO.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {tipoServico === 'Revisão' && (
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

        {/* Almoço */}
        <div id="secao-almoco" style={{ height: 1, background: '#E5E7EB', margin: '16px 0' }} />
        <label style={{
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          padding: '10px 0',
        }}>
          <input
            type="checkbox"
            checked={temAlmoco}
            onChange={(e) => {
              setTemAlmoco(e.target.checked)
              if (!e.target.checked) { setValorAlmoco(''); setFotoAlmoco('') }
            }}
            style={{ width: 20, height: 20, accentColor: '#1E3A5F' }}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Teve almoço nesta OS?</span>
        </label>

        {temAlmoco && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4, display: 'block' }}>
                Valor do almoço (R$) <span style={{ color: '#C41E2A' }}>*</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={valorAlmoco}
                onChange={(e) => setValorAlmoco(e.target.value)}
                placeholder="Ex: 45.00"
                style={inputStyle}
              />
            </div>
            <div>
              <FotoUpload
                label="Nota do almoço"
                value={fotoAlmoco}
                onChange={(f) => handleFoto(setFotoAlmoco, 'FotoAlmoco', f)}
                onRemove={() => setFotoAlmoco('')}
                obrigatorio
              />
            </div>
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
            {veiculos.map((v) => <option key={v.IdPlaca} value={v.NumPlaca}>{v.NumPlaca}</option>)}
          </select>
        </div>
      </div>

      {/* 6. FOTOS */}
      <div style={sectionStyle}>
        {sectionTitle('Fotos')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FotoUpload label="Horímetro" value={fotoHorimetro} onChange={(f) => handleFoto(setFotoHorimetro, 'FotoHorimetro', f)} onRemove={() => setFotoHorimetro('')} obrigatorio />
          <FotoUpload label="Chassis" value={fotoChassis} onChange={(f) => handleFoto(setFotoChassis, 'FotoChassis', f)} onRemove={() => setFotoChassis('')} obrigatorio />
        </div>
      </div>

      {/* 7. FOTOS GARANTIA (só aparece se tipo = Garantia) */}
      {tipoServico === 'Garantia' && (
        <>
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

      {/* Aviso se PPV não revisado */}
      {os?.ID_PPV && !todosRevisados && (
        <div style={{
          background: '#FEF2F2', border: '2px solid #FECACA', borderRadius: 12,
          padding: '14px 16px', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertTriangle size={20} color="#DC2626" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#DC2626' }}>
              PPV não revisado
            </div>
            <div style={{ fontSize: 12, color: '#991B1B' }}>
              Clique no PPV acima e revise {ppvItems.filter(p => !p.revisado).length} produto(s) pendente(s) antes de enviar.
            </div>
          </div>
        </div>
      )}

      {/* BOTÃO ENVIAR */}
      <div style={{ marginBottom: 30 }}>
        {(() => {
          const bloqueado = !!os?.ID_PPV && !todosRevisados
          const motivo = (os?.ID_PPV && !todosRevisados)
            ? 'Revise o PPV para enviar'
            : null
          return (
            <button
              type="button"
              disabled={saving || bloqueado}
              onClick={enviar}
              style={{
                width: '100%', padding: '18px 0', borderRadius: 14,
                background: bloqueado ? '#9CA3AF' : '#C41E2A',
                color: '#fff',
                fontSize: 17, fontWeight: 700, border: 'none',
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
