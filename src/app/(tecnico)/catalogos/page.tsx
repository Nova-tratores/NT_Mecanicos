'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { colors, radius, shadow } from '@/lib/ui'
import {
  ChevronLeft, Search, X, ChevronRight,
  Layers, Package, Cog, BookOpen, ShoppingCart, Plus, Minus, Trash2,
  Send, FileDown, MessageCircle, Clock, Archive, RotateCcw,
  Link2, FolderOpen, User, Maximize2, Download, Pencil,
} from 'lucide-react'
import jsPDF from 'jspdf'

type Vista = 'marcas' | 'modelos' | 'secoes' | 'figuras' | 'figura' | 'busca' | 'carrinhos' | 'carrinho_detalhe'

interface Marca { nome: string; slug: string; logo_url: string | null; modelos: number; tipos: string[] }
interface Modelo { slug: string; nome: string; image_url: string | null; marca: string; tipo: string; familia: string | null; figuras?: number; manual_url?: string | null; manual_nome?: string | null }
interface Secao { secao: string; ordem: number; figuras: number; thumb: string | null }
interface Figura { id: string; code: string; name: string; secao: string; thumb_url: string | null; image_url: string | null; ordem: number }
interface Peca { id: number; code: string; name: string; reference: string; qtd: string | null; unit: string | null; compravel: boolean }
interface Hotspot { reference: string; x: number; y: number }
interface FiguraDetalhe extends Figura { pecas: Peca[]; hotspots?: Hotspot[] }

interface PecaBusca {
  id: number; code: string; name: string; reference: string; qtd: string | null; figura_id: string
  figura: { id: string; code: string; name: string; secao: string; thumb_url: string | null } | null
}

interface CarrinhoDB {
  id: string; nome: string; criado_por: string; status: string
  share_token: string; created_at: string; updated_at: string
  catalogo_carrinho_itens: { count: number }[]
}

interface ItemCarrinhoDB {
  id: string; carrinho_id: string; peca_id: number
  peca_code: string; peca_name: string; peca_reference: string
  qtd: number; figura_code: string; figura_name: string; created_at: string
}

interface HistoricoEntry {
  id: string; acao: string; descricao: string; quem: string; created_at: string
}

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/catalogo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}

async function apiCart(body: Record<string, unknown>) {
  const r = await fetch('/api/catalogo/carrinho', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}

function IconeSecao({ secao }: { secao: string }) {
  const s = secao.toLowerCase()
  if (s.includes('motor')) return <Cog size={20} color={colors.primary} />
  if (s.includes('transmiss')) return <Layers size={20} color="#7C3AED" />
  if (s.includes('hidr')) return <Package size={20} color="#0891B2" />
  return <BookOpen size={20} color={colors.accent} />
}

function tempoAtras(data: string) {
  const diff = Date.now() - new Date(data).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'Agora'
  if (min < 60) return `Há ${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `Há ${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'Ontem'
  return `Há ${d} dias`
}

export default function CatalogosPage() {
  const [vista, setVista] = useState<Vista>('marcas')
  const vistaAntes = useRef<Vista>('marcas')
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [secoes, setSecoes] = useState<Secao[]>([])
  const [figuras, setFiguras] = useState<Figura[]>([])
  const [figDetalhe, setFigDetalhe] = useState<FiguraDetalhe | null>(null)
  const [resultadosBusca, setResultadosBusca] = useState<PecaBusca[]>([])

  const [marcaSel, setMarcaSel] = useState('')
  const [modeloSel, setModeloSel] = useState('')
  const [modeloObj, setModeloObj] = useState<Modelo | null>(null)
  const [secaoSel, setSecaoSel] = useState('')

  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')
  const [buscaAberta, setBuscaAberta] = useState(false)
  const buscaRef = useRef<HTMLInputElement>(null)
  const buscaTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const imgContainerRef = useRef<HTMLDivElement>(null)
  const [imgDim, setImgDim] = useState({ w: 1, h: 1 })
  const [refHover, setRefHover] = useState<string | null>(null)

  const [pecaSel, setPecaSel] = useState<Peca | null>(null)
  const [sheetAberta, setSheetAberta] = useState(false)
  const [qtdSheet, setQtdSheet] = useState(1)

  const [nomeUsuario, setNomeUsuario] = useState('')
  const [carrinhoAtivo, setCarrinhoAtivo] = useState<{ id: string; nome: string; share_token: string } | null>(null)
  const [itensAtivos, setItensAtivos] = useState<ItemCarrinhoDB[]>([])
  const [carrinhos, setCarrinhos] = useState<CarrinhoDB[]>([])
  const [tabCarrinhos, setTabCarrinhos] = useState<'aberto' | 'fechado' | 'lixeira'>('aberto')
  const [historicoAtivo, setHistoricoAtivo] = useState<HistoricoEntry[]>([])
  const [abaDetalhe, setAbaDetalhe] = useState<'itens' | 'historico'>('itens')
  const [showCriarModal, setShowCriarModal] = useState(false)
  const [nomeNovo, setNomeNovo] = useState('')
  const [showNomeModal, setShowNomeModal] = useState(false)
  const [inputNome, setInputNome] = useState('')
  const pendingAdd = useRef<{ peca: Peca; figura: { code: string; name: string }; qtd: number } | null>(null)

  const [fullscreen, setFullscreen] = useState(false)
  const [desenhando, setDesenhando] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const desenhoRef = useRef<{ drawing: boolean; lastX: number; lastY: number }>({ drawing: false, lastX: 0, lastY: 0 })
  const undoStackRef = useRef<ImageData[]>([])
  const baseImageRef = useRef<HTMLImageElement | null>(null)
  const [toast, setToast] = useState('')
  const searchParams = useSearchParams()
  const totalCarrinho = itensAtivos.reduce((s, i) => s + i.qtd, 0)
  const skipPushRef = useRef(false)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 2500) }

  useEffect(() => {
    const saved = localStorage.getItem('catalogo_usuario')
    if (saved) setNomeUsuario(saved)
    const savedCart = localStorage.getItem('catalogo_carrinho_ativo')
    if (savedCart) {
      try {
        const c = JSON.parse(savedCart)
        if (c?.id) { setCarrinhoAtivo(c); recarregarCarrinho(c.id) }
      } catch { /* ignore */ }
    }

    const params = new URLSearchParams(window.location.search)
    const urlMarca = params.get('marca')
    const urlModelo = params.get('modelo')
    const urlSecao = params.get('secao')
    const urlFigura = params.get('figura')

    if (urlMarca) {
      ;(async () => {
        setLoading(true)
        skipPushRef.current = true
        setMarcaSel(urlMarca)
        const mods: Modelo[] = await api({ action: 'modelos', marca: urlMarca })
        setModelos(mods)
        if (!urlModelo) { setVista('modelos'); setLoading(false); window.history.replaceState({ vista: 'modelos' }, '', window.location.href); return }
        skipPushRef.current = true
        setModeloSel(urlModelo)
        setModeloObj(mods.find(m => m.nome === urlModelo) || null)
        const secs: Secao[] = await api({ action: 'secoes', modelo: urlModelo })
        setSecoes(secs)
        if (!urlSecao) { setVista('secoes'); setLoading(false); window.history.replaceState({ vista: 'secoes' }, '', window.location.href); return }
        skipPushRef.current = true
        setSecaoSel(urlSecao)
        const figs: Figura[] = await api({ action: 'figuras', modelo: urlModelo, secao: urlSecao })
        setFiguras(figs)
        if (!urlFigura) { setVista('figuras'); setLoading(false); window.history.replaceState({ vista: 'figuras' }, '', window.location.href); return }
        skipPushRef.current = true
        setVista('figura')
        setZoom(1); setPan({ x: 0, y: 0 })
        setFigDetalhe(await api({ action: 'figura', figuraId: urlFigura }))
        setLoading(false)
        window.history.replaceState({ vista: 'figura' }, '', window.location.href)
      })()
    } else {
      loadMarcas()
      window.history.replaceState({ vista: 'marcas' }, '', '/catalogos')
    }

    const onPop = (e: PopStateEvent) => {
      const st = e.state
      if (!st) return
      if (wasZoomedRef.current) {
        setZoom(1); setPan({ x: 0, y: 0 }); wasZoomedRef.current = false
        return
      }
      if (st.vista) {
        skipPushRef.current = true
        setVista(st.vista)
        if (st.vista !== 'figura') setFigDetalhe(null)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) return
    ;(async () => {
      const data = await apiCart({ action: 'carregar', token })
      if (data.carrinho) {
        const c = { id: data.carrinho.id, nome: data.carrinho.nome, share_token: data.carrinho.share_token }
        setCarrinhoAtivo(c)
        localStorage.setItem('catalogo_carrinho_ativo', JSON.stringify(c))
        setItensAtivos(data.itens || [])
        setHistoricoAtivo(data.historico || [])
        setVista('carrinho_detalhe')
        setAbaDetalhe('itens')
        if (!localStorage.getItem('catalogo_usuario')) setShowNomeModal(true)
      }
    })()
  }, [searchParams])

  useEffect(() => {
    if (carrinhoAtivo) localStorage.setItem('catalogo_carrinho_ativo', JSON.stringify(carrinhoAtivo))
  }, [carrinhoAtivo])

  async function recarregarCarrinho(id?: string) {
    const cid = id || carrinhoAtivo?.id
    if (!cid) return
    const data = await apiCart({ action: 'carregar', id: cid })
    if (data.error) {
      if (carrinhoAtivo?.id === cid) {
        setCarrinhoAtivo(null)
        localStorage.removeItem('catalogo_carrinho_ativo')
      }
      setItensAtivos([]); setHistoricoAtivo([])
      return
    }
    setItensAtivos(data.itens || [])
    setHistoricoAtivo(data.historico || [])
  }

  async function loadCarrinhos(status: string) {
    setLoading(true)
    const data = await apiCart({ action: 'listar', status })
    setCarrinhos(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  async function executarAdd(carrinhoId: string, usuario: string, peca: Peca, figura: { code: string; name: string }, qtd: number) {
    await apiCart({
      action: 'adicionar_item', carrinho_id: carrinhoId,
      peca: { id: peca.id, code: peca.code, name: peca.name, reference: peca.reference },
      figura, qtd, quem: usuario,
    })
    await recarregarCarrinho(carrinhoId)
    setSheetAberta(false); setPecaSel(null)
    showToast('Peça adicionada!')
  }

  function handleAddToCart() {
    if (!pecaSel || !figDetalhe) return
    const peca = pecaSel
    const figura = { code: figDetalhe.code, name: figDetalhe.name }
    const qtd = qtdSheet

    if (!nomeUsuario) {
      pendingAdd.current = { peca, figura, qtd }
      setShowNomeModal(true)
      return
    }
    if (!carrinhoAtivo) {
      pendingAdd.current = { peca, figura, qtd }
      setShowCriarModal(true)
      return
    }
    executarAdd(carrinhoAtivo.id, nomeUsuario, peca, figura, qtd)
  }

  async function handleNomeSubmit() {
    const nome = inputNome.trim()
    if (!nome) return
    setNomeUsuario(nome)
    localStorage.setItem('catalogo_usuario', nome)
    setShowNomeModal(false); setInputNome('')

    if (pendingAdd.current) {
      if (!carrinhoAtivo) { setShowCriarModal(true); return }
      const { peca, figura, qtd } = pendingAdd.current
      pendingAdd.current = null
      executarAdd(carrinhoAtivo.id, nome, peca, figura, qtd)
    }
  }

  async function handleCriarSubmit() {
    const nomeCar = nomeNovo.trim()
    if (!nomeCar) return
    const usuario = nomeUsuario
    const data = await apiCart({ action: 'criar', nome: nomeCar, criado_por: usuario })
    if (data.error) { showToast('Erro ao criar carrinho'); return }
    const novoCart = { id: data.id, nome: data.nome, share_token: data.share_token }
    setCarrinhoAtivo(novoCart)
    setShowCriarModal(false); setNomeNovo('')
    showToast('Carrinho criado!')

    if (pendingAdd.current) {
      const { peca, figura, qtd } = pendingAdd.current
      pendingAdd.current = null
      await executarAdd(data.id, usuario, peca, figura, qtd)
    }
  }

  async function removerItemCarrinho(itemId: string) {
    if (!carrinhoAtivo) return
    await apiCart({ action: 'remover_item', carrinho_id: carrinhoAtivo.id, item_id: itemId, quem: nomeUsuario || 'Visitante' })
    await recarregarCarrinho()
    showToast('Peça removida')
  }

  async function alterarQtdItem(itemId: string, novaQtd: number) {
    if (!carrinhoAtivo || novaQtd < 1) return
    await apiCart({ action: 'alterar_qtd', carrinho_id: carrinhoAtivo.id, item_id: itemId, qtd: novaQtd, quem: nomeUsuario || 'Visitante' })
    await recarregarCarrinho()
  }

  async function mudarStatus(carrinhoId: string, status: string) {
    await apiCart({ action: 'mudar_status', id: carrinhoId, status, quem: nomeUsuario || 'Sistema' })
    if (carrinhoAtivo?.id === carrinhoId && status !== 'aberto') {
      setCarrinhoAtivo(null)
      localStorage.removeItem('catalogo_carrinho_ativo')
      setItensAtivos([]); setHistoricoAtivo([])
    }
    if (vista === 'carrinho_detalhe') setVista('carrinhos')
    loadCarrinhos(tabCarrinhos)
    const label = status === 'fechado' ? 'Carrinho fechado' : status === 'lixeira' ? 'Movido para lixeira' : 'Carrinho reaberto'
    showToast(label)
  }

  async function excluirCarrinho(carrinhoId: string) {
    await apiCart({ action: 'excluir', id: carrinhoId })
    if (carrinhoAtivo?.id === carrinhoId) {
      setCarrinhoAtivo(null)
      localStorage.removeItem('catalogo_carrinho_ativo')
    }
    loadCarrinhos(tabCarrinhos)
    showToast('Carrinho excluído')
  }

  function selecionarCarrinho(c: CarrinhoDB) {
    const novoAtivo = { id: c.id, nome: c.nome, share_token: c.share_token }
    setCarrinhoAtivo(novoAtivo)
    recarregarCarrinho(c.id)
    setAbaDetalhe('itens')
    setVista('carrinho_detalhe')
  }

  async function loadMarcas() {
    setLoading(true)
    const result: Marca[] = await api({ action: 'marcas' })
    setMarcas(result)
    setLoading(false)
    if (result.length === 1) selecionarMarca(result[0].nome)
  }

  function catUrl(p: { marca?: string; modelo?: string; secao?: string; figura?: string }) {
    const sp = new URLSearchParams()
    if (p.marca) sp.set('marca', p.marca)
    if (p.modelo) sp.set('modelo', p.modelo)
    if (p.secao) sp.set('secao', p.secao)
    if (p.figura) sp.set('figura', p.figura)
    const qs = sp.toString()
    return '/catalogos' + (qs ? '?' + qs : '')
  }

  function pushVista(v: Vista, url: string) {
    if (!skipPushRef.current) {
      window.history.pushState({ vista: v }, '', url)
    }
    skipPushRef.current = false
  }

  async function selecionarMarca(marca: string) {
    setMarcaSel(marca); setVista('modelos')
    pushVista('modelos', catUrl({ marca }))
    setLoading(true)
    setModelos(await api({ action: 'modelos', marca }))
    setLoading(false)
  }

  async function selecionarModelo(modelo: string) {
    setModeloSel(modelo); setModeloObj(modelos.find(m => m.nome === modelo) || null)
    setVista('secoes')
    pushVista('secoes', catUrl({ marca: marcaSel, modelo }))
    setLoading(true)
    setSecoes(await api({ action: 'secoes', modelo }))
    setLoading(false)
  }

  async function selecionarSecao(secao: string) {
    setSecaoSel(secao); setVista('figuras')
    pushVista('figuras', catUrl({ marca: marcaSel, modelo: modeloSel, secao }))
    setLoading(true)
    setFiguras(await api({ action: 'figuras', modelo: modeloSel, secao }))
    setLoading(false)
  }

  async function selecionarFigura(id: string) {
    setVista('figura')
    pushVista('figura', catUrl({ marca: marcaSel, modelo: modeloSel, secao: secaoSel, figura: id }))
    setLoading(true)
    setZoom(1); setPan({ x: 0, y: 0 })
    setPecaSel(null); setSheetAberta(false)
    setFigDetalhe(await api({ action: 'figura', figuraId: id }))
    setLoading(false)
  }

  function abrirPeca(p: Peca) {
    setPecaSel(p); setQtdSheet(1); setSheetAberta(true)
  }

  const executarBusca = useCallback(async (q: string) => {
    if (q.length < 2) { setResultadosBusca([]); return }
    setLoading(true); setVista('busca')
    setResultadosBusca(await api({ action: 'busca', busca: q }))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!buscaAberta) return
    if (buscaTimer.current) clearTimeout(buscaTimer.current)
    buscaTimer.current = setTimeout(() => executarBusca(busca), 400)
    return () => { if (buscaTimer.current) clearTimeout(buscaTimer.current) }
  }, [busca, buscaAberta, executarBusca])

  const wasZoomedRef = useRef(false)
  useEffect(() => {
    if (zoom > 1 && !wasZoomedRef.current) {
      window.history.pushState({ vista: 'figura', zoom: true }, '')
      wasZoomedRef.current = true
    } else if (zoom <= 1 && wasZoomedRef.current) {
      wasZoomedRef.current = false
    }
  }, [zoom])

  const pinchRef = useRef({ dist: 0, zoom: 1, midX: 0, midY: 0 })
  const touchMovedRef = useRef(false)

  const handleTouchStart = (e: React.TouchEvent) => {
    touchMovedRef.current = false
    if (e.touches.length === 2) {
      e.preventDefault()
      const [a, b] = [e.touches[0], e.touches[1]]
      pinchRef.current = {
        dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        zoom,
        midX: (a.clientX + b.clientX) / 2,
        midY: (a.clientY + b.clientY) / 2,
      }
    } else if (e.touches.length === 1 && zoom > 1) {
      setDragging(true)
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, panX: pan.x, panY: pan.y }
    }
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    touchMovedRef.current = true
    if (e.touches.length === 2) {
      e.preventDefault()
      const [a, b] = [e.touches[0], e.touches[1]]
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
      const newZoom = Math.min(5, Math.max(1, pinchRef.current.zoom * (dist / pinchRef.current.dist)))
      setZoom(newZoom)
      if (newZoom <= 1) setPan({ x: 0, y: 0 })
    } else if (e.touches.length === 1 && dragging) {
      const t = e.touches[0]
      const dx = t.clientX - dragStart.current.x
      const dy = t.clientY - dragStart.current.y
      setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy })
    }
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) setDragging(false)
    if (e.touches.length < 2) pinchRef.current.dist = 0
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return
    if (zoom <= 1) return
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return
    if (!dragging) return
    setPan({ x: dragStart.current.panX + (e.clientX - dragStart.current.x), y: dragStart.current.panY + (e.clientY - dragStart.current.y) })
  }
  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return
    setDragging(false)
  }

  function gerarLinkCarrinho() {
    if (!carrinhoAtivo) return ''
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://mecanicos-nine.vercel.app'
    return `${base}/catalogos?token=${carrinhoAtivo.share_token}`
  }

  function gerarTextoCarrinho() {
    let txt = `*Lista de Peças — ${carrinhoAtivo?.nome || 'Catálogo NT Mecânicos'}*\n\n`
    itensAtivos.forEach((item, i) => {
      txt += `${i + 1}. *${item.peca_code}* — ${item.peca_name}\n`
      txt += `   Qtd: ${item.qtd} | Ref: ${item.peca_reference || '-'}\n`
      txt += `   Figura: ${item.figura_code} — ${item.figura_name}\n\n`
    })
    txt += `*Total: ${totalCarrinho} ${totalCarrinho === 1 ? 'peça' : 'peças'}*\n\n`
    txt += `Ver no catálogo:\n${gerarLinkCarrinho()}`
    return txt
  }

  function enviarWhatsApp(telefone: string) {
    const num = telefone.replace(/\D/g, '')
    const numCompleto = num.length <= 11 ? `55${num}` : num
    const texto = encodeURIComponent(gerarTextoCarrinho())
    window.open(`https://wa.me/${numCompleto}?text=${texto}`, '_blank')
  }

  function abrirFullscreen() {
    setFullscreen(true)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  function iniciarDesenho() {
    setDesenhando(true)
    undoStackRef.current = []
    setTimeout(() => {
      const canvas = canvasRef.current
      if (!canvas || !figDetalhe?.image_url) return
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0)
        baseImageRef.current = img
      }
      img.src = figDetalhe.image_url
    }, 100)
  }

  function handleCanvasTouch(e: React.TouchEvent | React.MouseEvent) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    const getPos = (ev: React.TouchEvent | React.MouseEvent) => {
      if ('touches' in ev && ev.touches.length > 0) {
        return { x: (ev.touches[0].clientX - rect.left) * scaleX, y: (ev.touches[0].clientY - rect.top) * scaleY }
      }
      const me = ev as React.MouseEvent
      return { x: (me.clientX - rect.left) * scaleX, y: (me.clientY - rect.top) * scaleY }
    }

    const ref = desenhoRef.current
    const type = e.type

    if (type === 'mousedown' || type === 'touchstart') {
      undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
      ref.drawing = true
      const pos = getPos(e)
      ref.lastX = pos.x
      ref.lastY = pos.y
      e.preventDefault()
    } else if ((type === 'mousemove' || type === 'touchmove') && ref.drawing) {
      const pos = getPos(e)
      ctx.strokeStyle = '#FF0000'
      ctx.lineWidth = Math.max(3, canvas.width / 200)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(ref.lastX, ref.lastY)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
      ref.lastX = pos.x
      ref.lastY = pos.y
      e.preventDefault()
    } else if (type === 'mouseup' || type === 'touchend' || type === 'mouseleave') {
      ref.drawing = false
    }
  }

  function desfazerRabisco() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const prev = undoStackRef.current.pop()
    if (prev) {
      ctx.putImageData(prev, 0, 0)
    }
  }

  function limparRabiscos() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx || !baseImageRef.current) return
    undoStackRef.current = []
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(baseImageRef.current, 0, 0)
  }

  function salvarDesenho() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${figDetalhe?.code || 'figura'}-anotado.jpg`
      a.click()
      URL.revokeObjectURL(url)
      setDesenhando(false)
      showToast('Imagem salva!')
    }, 'image/jpeg', 0.9)
  }

  function baixarFiguraPdf() {
    if (!figDetalhe?.image_url) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const isLandscape = img.naturalWidth > img.naturalHeight
      const doc = new jsPDF({ orientation: isLandscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
      const W = doc.internal.pageSize.getWidth()
      const H = doc.internal.pageSize.getHeight()
      const margin = 10
      const maxW = W - margin * 2
      const maxH = H - margin * 2 - 15
      const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight)
      const imgW = img.naturalWidth * ratio
      const imgH = img.naturalHeight * ratio
      const x = (W - imgW) / 2
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30, 58, 95)
      doc.text(`${figDetalhe.code} — ${figDetalhe.name}`, W / 2, 8, { align: 'center' })
      doc.addImage(img, 'JPEG', x, 12, imgW, imgH)
      const fileName = `${figDetalhe.code}-${figDetalhe.name}`
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase()
      doc.save(`${fileName}.pdf`)
      showToast('PDF baixado!')
    }
    img.src = figDetalhe.image_url
  }

  function copiarLink() {
    const link = gerarLinkCarrinho()
    if (!link) return
    navigator.clipboard?.writeText(link).then(() => showToast('Link copiado!'))
  }

  function baixarPdf() {
    if (itensAtivos.length === 0) return
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    let y = 20

    doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(196, 30, 42)
    doc.text(carrinhoAtivo?.nome || 'Lista de Peças', W / 2, y, { align: 'center' })
    y += 10

    doc.setFontSize(10); doc.setTextColor(100)
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, W / 2, y, { align: 'center' })
    y += 10

    const startX = 14
    doc.setFillColor(30, 58, 95)
    doc.rect(startX, y, W - 28, 8, 'F')
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(255)
    doc.text('REF', startX + 2, y + 5.5)
    doc.text('CÓDIGO', 50, y + 5.5)
    doc.text('DESCRIÇÃO', 90, y + 5.5)
    doc.text('QTD', W - 20, y + 5.5, { align: 'right' })
    y += 10

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)

    itensAtivos.forEach((item, i) => {
      if (y > 270) { doc.addPage(); y = 20 }
      if (i % 2 === 0) { doc.setFillColor(249, 250, 251); doc.rect(startX, y - 1, W - 28, 14, 'F') }

      doc.setTextColor(30, 58, 95); doc.setFont('helvetica', 'bold')
      doc.text(item.peca_reference || '-', startX + 2, y + 4)

      doc.setTextColor(50); doc.setFont('helvetica', 'bold')
      doc.text(item.peca_code, 50, y + 4)

      doc.setFont('helvetica', 'normal'); doc.setTextColor(80)
      const nome = doc.splitTextToSize(item.peca_name, 70)
      doc.text(nome[0] || '', 90, y + 4)

      doc.setTextColor(50); doc.setFont('helvetica', 'bold')
      doc.text(String(item.qtd), W - 20, y + 4, { align: 'right' })

      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(140)
      doc.text(`${item.figura_code} — ${item.figura_name}`, 50, y + 9)
      doc.setFontSize(8)
      y += 14
    })

    y += 6
    doc.setFillColor(239, 246, 255)
    doc.rect(startX, y, W - 28, 10, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30, 58, 95)
    doc.text(`Total: ${totalCarrinho} ${totalCarrinho === 1 ? 'peça' : 'peças'}`, W / 2, y + 7, { align: 'center' })

    const fileName = (carrinhoAtivo?.nome || 'lista-pecas')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase()
    doc.save(`${fileName}.pdf`)
  }

  function voltar() {
    if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }); wasZoomedRef.current = false; window.history.back(); return }
    if (vista === 'carrinho_detalhe') { setVista('carrinhos'); loadCarrinhos(tabCarrinhos); return }
    if (vista === 'carrinhos') { setVista(vistaAntes.current); return }
    if (vista === 'busca') {
      setBuscaAberta(false); setBusca('')
      const v = secaoSel ? 'figuras' : modeloSel ? 'secoes' : marcaSel ? 'modelos' : 'marcas'
      setVista(v)
      return
    }
    if (vista === 'figura') { setVista('figuras'); setFigDetalhe(null); window.history.back(); return }
    if (vista === 'figuras') { setVista('secoes'); setSecaoSel(''); window.history.back(); return }
    if (vista === 'secoes') { setVista('modelos'); setModeloSel(''); setModeloObj(null); window.history.back(); return }
    if (vista === 'modelos') { setVista('marcas'); setMarcaSel(''); window.history.back(); return }
  }

  function irParaCarrinhos() {
    vistaAntes.current = vista
    setVista('carrinhos')
    loadCarrinhos(tabCarrinhos)
  }

  function irParaCarrinhoDetalhe() {
    if (!carrinhoAtivo) return
    vistaAntes.current = vista
    setAbaDetalhe('itens')
    setVista('carrinho_detalhe')
  }

  const titulo = vista === 'marcas' ? 'Catálogo de Peças'
    : vista === 'modelos' ? marcaSel
    : vista === 'secoes' ? modeloSel
    : vista === 'figuras' ? secaoSel
    : vista === 'figura' ? (figDetalhe?.name || '')
    : vista === 'carrinhos' ? 'Meus Carrinhos'
    : vista === 'carrinho_detalhe' ? (carrinhoAtivo?.nome || 'Carrinho')
    : 'Busca'

  const showFloating = totalCarrinho > 0 && vista !== 'carrinho_detalhe' && vista !== 'carrinhos'

  return (
    <div style={{ paddingBottom: showFloating ? 70 : 0 }}>
      {/* ═══ HEADER ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {vista !== 'marcas' && (
          <button onClick={voltar} style={{
            background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.sm,
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <ChevronLeft size={20} color={colors.text} />
          </button>
        )}
        <h1 style={{
          fontSize: vista === 'figura' ? 16 : 20, fontWeight: 800, color: colors.primary, margin: 0, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{titulo}</h1>

        {vista !== 'carrinhos' && vista !== 'carrinho_detalhe' && (
          <button onClick={() => {
            setBuscaAberta(!buscaAberta)
            if (!buscaAberta) setTimeout(() => buscaRef.current?.focus(), 100)
            else { setBusca(''); if (vista === 'busca') voltar() }
          }} style={{
            background: buscaAberta ? colors.primary : colors.surface,
            border: `1px solid ${buscaAberta ? colors.primary : colors.border}`,
            borderRadius: radius.sm, width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            {buscaAberta ? <X size={18} color="#fff" /> : <Search size={18} color={colors.textMuted} />}
          </button>
        )}

        {vista !== 'carrinhos' && vista !== 'carrinho_detalhe' && (
          <button onClick={irParaCarrinhos} style={{
            position: 'relative', background: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: radius.sm, width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <ShoppingCart size={18} color={colors.textMuted} />
            {totalCarrinho > 0 && (
              <span style={{
                position: 'absolute', top: -6, right: -6,
                background: colors.primary, color: '#fff', fontSize: 10, fontWeight: 800,
                borderRadius: '50%', width: 18, height: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{totalCarrinho}</span>
            )}
          </button>
        )}

        {vista === 'carrinhos' && (
          <button onClick={() => {
            if (!nomeUsuario) { pendingAdd.current = null; setShowNomeModal(true); return }
            setShowCriarModal(true)
          }} style={{
            background: colors.primary, border: 'none', borderRadius: radius.sm,
            padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6,
            color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            <Plus size={16} /> Novo
          </button>
        )}
      </div>

      {/* ═══ BARRA DE BUSCA ═══ */}
      {buscaAberta && (
        <div style={{ marginBottom: 14 }}>
          <input ref={buscaRef} value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar peça por nome ou código..." style={{
              width: '100%', padding: '12px 14px', borderRadius: radius.md,
              border: `1px solid ${colors.borderStrong}`, fontSize: 15,
              outline: 'none', background: colors.surface,
            }} />
        </div>
      )}

      {/* ═══ BREADCRUMB ═══ */}
      {vista !== 'marcas' && vista !== 'busca' && vista !== 'carrinhos' && vista !== 'carrinho_detalhe' && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center',
          marginBottom: 12, fontSize: 11, color: colors.textSubtle,
        }}>
          <span onClick={() => { setVista('marcas'); setMarcaSel(''); setModeloSel(''); setModeloObj(null); setSecaoSel(''); window.history.pushState({ vista: 'marcas' }, '', '/catalogos') }}
            style={{ cursor: 'pointer', textDecoration: 'underline' }}>Catálogo</span>
          {marcaSel && <>
            <ChevronRight size={12} />
            <span onClick={() => { setVista('modelos'); setModeloSel(''); setModeloObj(null); setSecaoSel(''); window.history.pushState({ vista: 'modelos' }, '', catUrl({ marca: marcaSel })) }}
              style={{ cursor: 'pointer', textDecoration: 'underline' }}>{marcaSel}</span>
          </>}
          {modeloSel && <>
            <ChevronRight size={12} />
            <span onClick={() => { setVista('secoes'); setSecaoSel(''); window.history.pushState({ vista: 'secoes' }, '', catUrl({ marca: marcaSel, modelo: modeloSel })) }}
              style={{ cursor: 'pointer', textDecoration: 'underline' }}>{modeloSel}</span>
          </>}
          {secaoSel && <>
            <ChevronRight size={12} />
            <span onClick={() => { setVista('figuras'); window.history.pushState({ vista: 'figuras' }, '', catUrl({ marca: marcaSel, modelo: modeloSel, secao: secaoSel })) }}
              style={{ cursor: 'pointer', textDecoration: 'underline' }}>{secaoSel}</span>
          </>}
        </div>
      )}

      {/* ═══ LOADING ═══ */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      )}

      {/* ═══ MARCAS ═══ */}
      {!loading && vista === 'marcas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {marcas.map(m => (
            <button key={m.slug} onClick={() => selecionarMarca(m.nome)} className="hb" style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              background: colors.surface, borderRadius: radius.lg, border: `1px solid ${colors.border}`,
              boxShadow: shadow.sm, cursor: 'pointer', textAlign: 'left', width: '100%',
            }}>
              {m.logo_url ? (
                <img src={m.logo_url} alt={m.nome} style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: radius.sm }} />
              ) : (
                <div style={{
                  width: 48, height: 48, borderRadius: radius.sm, background: colors.accentBg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, fontWeight: 800, color: colors.accent,
                }}>{m.nome[0]}</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>{m.nome}</div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>
                  {m.modelos} modelo{m.modelos !== 1 ? 's' : ''} • {m.tipos.join(', ')}
                </div>
              </div>
              <ChevronRight size={20} color={colors.textSubtle} />
            </button>
          ))}
          {marcas.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: colors.textMuted, fontSize: 14 }}>
              Nenhum catálogo disponível
            </div>
          )}
        </div>
      )}

      {/* ═══ MODELOS ═══ */}
      {!loading && vista === 'modelos' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {modelos.map(m => (
            <button key={m.slug} onClick={() => selecionarModelo(m.nome)} className="hb" style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 12,
              background: colors.surface, borderRadius: radius.lg, border: `1px solid ${colors.border}`,
              boxShadow: shadow.sm, cursor: 'pointer', textAlign: 'center', width: '100%',
            }}>
              {m.image_url ? (
                <img src={m.image_url} alt={m.nome} style={{
                  width: '100%', height: 80, objectFit: 'contain', marginBottom: 8, borderRadius: radius.sm,
                }} />
              ) : (
                <div style={{
                  width: '100%', height: 80, borderRadius: radius.sm, background: colors.surfaceAlt,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8,
                }}>
                  <Package size={32} color={colors.textGhost} />
                </div>
              )}
              <div style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>{m.nome}</div>
              {m.tipo && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6, marginTop: 4,
                  background: m.tipo === 'Trator' ? '#DBEAFE' : m.tipo === 'Implemento' ? '#D1FAE5' : '#FEF3C7',
                  color: m.tipo === 'Trator' ? '#1E40AF' : m.tipo === 'Implemento' ? '#065F46' : '#92400E',
                }}>{m.tipo}</span>
              )}
              {typeof m.figuras === 'number' && (
                <div style={{ fontSize: 11, color: colors.textSubtle, marginTop: 4 }}>{m.figuras} figuras</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ═══ SEÇÕES ═══ */}
      {!loading && vista === 'secoes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {modeloObj?.manual_url && (
            <a href={modeloObj.manual_url} target="_blank" rel="noopener noreferrer" className="hb" style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              background: '#EFF6FF', borderRadius: radius.lg, border: '1px solid #BFDBFE',
              boxShadow: shadow.sm, cursor: 'pointer', textDecoration: 'none', width: '100%',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: radius.sm, background: '#DBEAFE',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <BookOpen size={22} color="#2563EB" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1E40AF' }}>Manual do Operador</div>
                <div style={{ fontSize: 12, color: '#3B82F6' }}>{modeloObj.manual_nome || modeloSel}</div>
              </div>
              <FileDown size={20} color="#3B82F6" />
            </a>
          )}
          {secoes.map(s => (
            <button key={s.secao} onClick={() => selecionarSecao(s.secao)} className="hb" style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              background: colors.surface, borderRadius: radius.lg, border: `1px solid ${colors.border}`,
              boxShadow: shadow.sm, cursor: 'pointer', textAlign: 'left', width: '100%',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: radius.sm, background: colors.surfaceAlt,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden',
              }}>
                {s.thumb ? (
                  <img src={s.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <IconeSecao secao={s.secao} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>{s.secao}</div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>{s.figuras} figura{s.figuras !== 1 ? 's' : ''}</div>
              </div>
              <ChevronRight size={20} color={colors.textSubtle} />
            </button>
          ))}
        </div>
      )}

      {/* ═══ FIGURAS ═══ */}
      {!loading && vista === 'figuras' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {figuras.map(f => (
            <button key={f.id} onClick={() => selecionarFigura(f.id)} className="hb" style={{
              display: 'flex', flexDirection: 'column', padding: 8,
              background: colors.surface, borderRadius: radius.lg, border: `1px solid ${colors.border}`,
              boxShadow: shadow.sm, cursor: 'pointer', textAlign: 'left', width: '100%',
            }}>
              <div style={{
                width: '100%', aspectRatio: '4/3', borderRadius: radius.sm, overflow: 'hidden',
                background: '#fff', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {(f.thumb_url || f.image_url) ? (
                  <img src={f.thumb_url || f.image_url || ''} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : (
                  <Layers size={28} color={colors.textGhost} />
                )}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: colors.primary }}>{f.code}</div>
              <div style={{
                fontSize: 12, fontWeight: 600, color: colors.text,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>{f.name}</div>
            </button>
          ))}
        </div>
      )}

      {/* ═══ FIGURA (detalhe) ═══ */}
      {!loading && vista === 'figura' && figDetalhe && (
        <div>
          {/* Fullscreen viewer */}
          {(fullscreen || zoom > 1) && (
            <div style={{
              position: 'fixed', inset: 0, zIndex: 80,
              background: '#000', touchAction: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}
              ref={imgContainerRef}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <div style={{
                transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                transformOrigin: 'center center',
                transition: dragging ? 'none' : 'transform 0.2s',
                position: 'relative',
                display: 'inline-block',
              }}>
                {figDetalhe.image_url && (
                  <img src={figDetalhe.image_url} alt={figDetalhe.name}
                    onLoad={e => {
                      const img = e.target as HTMLImageElement
                      setImgDim({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
                    }}
                    style={{
                      maxWidth: '100vw', maxHeight: '100vh',
                      cursor: zoom > 1 ? 'grab' : 'default', display: 'block',
                    }}
                    draggable={false}
                  />
                )}
                {(figDetalhe.hotspots || []).map((h, i) => {
                  const ativo = refHover === h.reference || pecaSel?.reference === h.reference
                  return (
                    <button key={`z-${h.reference}-${i}`}
                      onPointerUp={e => {
                        if (touchMovedRef.current) return
                        e.stopPropagation()
                        const p = figDetalhe.pecas.find(p => p.reference === h.reference)
                        if (p) abrirPeca(p)
                      }}
                      style={{
                        position: 'absolute',
                        left: `${(h.x / imgDim.w) * 100}%`,
                        top: `${(h.y / imgDim.h) * 100}%`,
                        transform: `translate(-50%,-50%) scale(${1 / zoom})`,
                        width: ativo ? 34 : 26, height: ativo ? 34 : 26,
                        borderRadius: '50%', border: '2px solid #fff',
                        background: ativo ? colors.primary : 'rgba(37,99,235,0.92)',
                        color: '#fff', fontSize: ativo ? 14 : 11, fontWeight: 700,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 2px 7px rgba(0,0,0,0.45)',
                        transition: 'all .12s', zIndex: ativo ? 3 : 2, padding: 0,
                      }}
                    >{h.reference}</button>
                  )
                })}
              </div>

              {/* Fullscreen controls */}
              <div style={{
                position: 'absolute', top: 16, left: 16, right: 16,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 82,
              }}>
                <span style={{
                  fontSize: 13, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.6)',
                  padding: '6px 12px', borderRadius: radius.md,
                }}>{Math.round(zoom * 100)}%</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setZoom(z => Math.min(5, z + 0.5))} style={{
                    background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: radius.md, width: 36, height: 36,
                    color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Plus size={18} />
                  </button>
                  <button onClick={() => { setZoom(z => { const nz = Math.max(1, z - 0.5); if (nz <= 1) setPan({ x: 0, y: 0 }); return nz }) }} style={{
                    background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: radius.md, width: 36, height: 36,
                    color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Minus size={18} />
                  </button>
                  <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setFullscreen(false) }} style={{
                    background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: radius.md, padding: '6px 14px',
                    fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <X size={16} /> Fechar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Drawing overlay */}
          {desenhando && (
            <div style={{
              position: 'fixed', inset: 0, zIndex: 85, background: '#000',
              display: 'flex', flexDirection: 'column',
            }}>
              {/* Barra superior */}
              <div style={{
                padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'rgba(0,0,0,0.85)', zIndex: 86, gap: 8,
              }}>
                <button onClick={() => setDesenhando(false)} style={{
                  background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: radius.md, padding: '6px 12px',
                  fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <X size={14} /> Sair
                </button>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', flex: 1, textAlign: 'center' }}>Rabiscar</span>
                <button onClick={salvarDesenho} style={{
                  background: colors.success, border: 'none',
                  borderRadius: radius.md, padding: '6px 12px',
                  fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <Download size={14} /> Salvar
                </button>
              </div>
              {/* Canvas */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: 8 }}>
                <canvas
                  ref={canvasRef}
                  style={{ maxWidth: '100%', maxHeight: '100%', touchAction: 'none', cursor: 'crosshair' }}
                  onMouseDown={handleCanvasTouch}
                  onMouseMove={handleCanvasTouch}
                  onMouseUp={handleCanvasTouch}
                  onMouseLeave={handleCanvasTouch}
                  onTouchStart={handleCanvasTouch}
                  onTouchMove={handleCanvasTouch}
                  onTouchEnd={handleCanvasTouch}
                />
              </div>
              {/* Barra inferior: Desfazer + Limpar tudo */}
              <div style={{
                padding: '10px 16px', display: 'flex', justifyContent: 'center', gap: 12,
                background: 'rgba(0,0,0,0.85)', zIndex: 86,
              }}>
                <button onClick={desfazerRabisco} style={{
                  background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: radius.md, padding: '8px 18px',
                  fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <RotateCcw size={16} /> Desfazer
                </button>
                <button onClick={limparRabiscos} style={{
                  background: 'rgba(220,38,38,0.25)', border: '1px solid rgba(220,38,38,0.5)',
                  borderRadius: radius.md, padding: '8px 18px',
                  fontSize: 13, fontWeight: 700, color: '#ff6b6b', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Trash2 size={16} /> Limpar tudo
                </button>
              </div>
            </div>
          )}

          {/* Normal inline image */}
          <div style={{
            position: 'relative', width: '100%',
            background: '#fff', borderRadius: radius.lg, overflow: 'hidden',
            border: `1px solid ${colors.border}`, marginBottom: 8, touchAction: 'none',
          }}
            {...(zoom <= 1 && !fullscreen ? { ref: imgContainerRef } : {})}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <div style={{ position: 'relative', width: '100%' }}>
              {figDetalhe.image_url && (
                <img src={figDetalhe.image_url} alt={figDetalhe.name}
                  onLoad={e => {
                    const img = e.target as HTMLImageElement
                    setImgDim({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
                  }}
                  style={{ width: '100%', display: 'block', cursor: 'default' }}
                  draggable={false}
                />
              )}
              {(figDetalhe.hotspots || []).map((h, i) => {
                const ativo = refHover === h.reference || pecaSel?.reference === h.reference
                return (
                  <button key={`n-${h.reference}-${i}`}
                    onClick={e => {
                      e.stopPropagation()
                      const p = figDetalhe.pecas.find(p => p.reference === h.reference)
                      if (p) abrirPeca(p)
                    }}
                    style={{
                      position: 'absolute',
                      left: `${(h.x / imgDim.w) * 100}%`,
                      top: `${(h.y / imgDim.h) * 100}%`,
                      transform: 'translate(-50%,-50%)',
                      width: ativo ? 34 : 26, height: ativo ? 34 : 26,
                      borderRadius: '50%', border: '2px solid #fff',
                      background: ativo ? colors.primary : 'rgba(37,99,235,0.92)',
                      color: '#fff', fontSize: ativo ? 14 : 11, fontWeight: 700,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 2px 7px rgba(0,0,0,0.45)',
                      transition: 'all .12s', zIndex: ativo ? 3 : 2, padding: 0,
                    }}
                  >{h.reference}</button>
                )
              })}
            </div>
          </div>

          {/* Action buttons row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button onClick={abrirFullscreen} style={{
              flex: 1, padding: '10px 0', borderRadius: radius.md,
              background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
              fontSize: 12, fontWeight: 700, color: colors.text, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Maximize2 size={14} /> Tela cheia
            </button>
            <button onClick={iniciarDesenho} style={{
              flex: 1, padding: '10px 0', borderRadius: radius.md,
              background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
              fontSize: 12, fontWeight: 700, color: colors.text, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Pencil size={14} /> Rabiscar
            </button>
            <button onClick={baixarFiguraPdf} style={{
              flex: 1, padding: '10px 0', borderRadius: radius.md,
              background: colors.surfaceAlt, border: `1px solid ${colors.border}`,
              fontSize: 12, fontWeight: 700, color: colors.text, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <FileDown size={14} /> PDF
            </button>
          </div>

          <div style={{
            background: colors.accentBg, borderRadius: radius.md, padding: '10px 14px', marginBottom: 12,
            border: `1px solid ${colors.accentBorder}`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.accent }}>{figDetalhe.code} — {figDetalhe.name}</div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>{figDetalhe.pecas.length} peça{figDetalhe.pecas.length !== 1 ? 's' : ''}</div>
          </div>

          {carrinhoAtivo && (
            <div style={{
              background: colors.successBg, borderRadius: radius.md, padding: '8px 14px', marginBottom: 12,
              border: `1px solid ${colors.successBorder}`, fontSize: 12, color: colors.success, fontWeight: 600,
            }}>
              <ShoppingCart size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Adicionando ao: {carrinhoAtivo.nome}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '36px 1fr 50px 40px',
              padding: '8px 10px', background: colors.accent, borderRadius: `${radius.sm}px ${radius.sm}px 0 0`,
              fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              <span>Ref</span><span>Peça</span><span style={{ textAlign: 'right' }}>Qtd</span><span></span>
            </div>
            {figDetalhe.pecas.map((p, i) => {
              const noCarrinho = itensAtivos.find(c => c.peca_id === p.id)
              const ativo = refHover === p.reference || pecaSel?.id === p.id
              return (
                <div key={p.id} onClick={() => abrirPeca(p)}
                  onPointerEnter={() => setRefHover(p.reference)}
                  onPointerLeave={() => setRefHover(null)}
                  style={{
                    display: 'grid', gridTemplateColumns: '36px 1fr 50px 40px',
                    padding: '10px 10px', cursor: 'pointer', alignItems: 'center',
                    background: ativo ? colors.primaryBg : i % 2 === 0 ? colors.surface : colors.surfaceAlt,
                    borderLeft: ativo ? `3px solid ${colors.primary}` : '3px solid transparent',
                    borderBottom: `1px solid ${colors.border}`,
                  }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: '50%',
                    background: ativo ? colors.primary : 'rgba(37,99,235,0.92)',
                    color: '#fff', fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid #fff', boxShadow: shadow.sm,
                  }}>{p.reference || '-'}</span>
                  <div style={{ minWidth: 0, paddingLeft: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{p.code}</div>
                    <div style={{
                      fontSize: 11, color: colors.textMuted,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{p.name}</div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: colors.text, textAlign: 'right' }}>
                    {p.qtd || '-'}
                  </span>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    {noCarrinho ? (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 6,
                        background: colors.successBg, color: colors.success, border: `1px solid ${colors.successBorder}`,
                      }}>{noCarrinho.qtd}x</span>
                    ) : (
                      <Plus size={16} color={colors.textSubtle} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ═══ BUSCA ═══ */}
      {!loading && vista === 'busca' && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.textMuted, marginBottom: 10 }}>
            {resultadosBusca.length} resultado{resultadosBusca.length !== 1 ? 's' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resultadosBusca.map(p => (
              <button key={`${p.id}-${p.figura_id}`}
                onClick={() => p.figura && selecionarFigura(p.figura.id)}
                className="hb" style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                  background: colors.surface, borderRadius: radius.md, border: `1px solid ${colors.border}`,
                  boxShadow: shadow.sm, cursor: 'pointer', textAlign: 'left', width: '100%',
                }}>
                {p.figura?.thumb_url && (
                  <img src={p.figura.thumb_url} alt="" style={{
                    width: 44, height: 44, objectFit: 'contain', borderRadius: radius.sm, background: '#fff', flexShrink: 0,
                  }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: colors.primary }}>{p.code}</div>
                  <div style={{
                    fontSize: 12, color: colors.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{p.name}</div>
                  {p.figura && (
                    <div style={{ fontSize: 11, color: colors.textSubtle, marginTop: 2 }}>
                      {p.figura.code} — {p.figura.secao}
                    </div>
                  )}
                </div>
                <ChevronRight size={18} color={colors.textSubtle} />
              </button>
            ))}
            {resultadosBusca.length === 0 && busca.length >= 2 && (
              <div style={{ textAlign: 'center', padding: 32, color: colors.textMuted, fontSize: 14 }}>
                Nenhuma peça encontrada
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ CARRINHOS (lista) ═══ */}
      {!loading && vista === 'carrinhos' && (
        <div>
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: radius.md, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
            {([['aberto', 'Abertos', FolderOpen], ['fechado', 'Fechados', Archive], ['lixeira', 'Lixeira', Trash2]] as const).map(([key, label, Icon]) => (
              <button key={key} onClick={() => { setTabCarrinhos(key); loadCarrinhos(key) }} style={{
                flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                background: tabCarrinhos === key ? colors.accent : colors.surface,
                color: tabCarrinhos === key ? '#fff' : colors.textMuted,
                fontSize: 12, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          {carrinhos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: colors.textMuted, fontSize: 14 }}>
              {tabCarrinhos === 'aberto' ? 'Nenhum carrinho aberto' : tabCarrinhos === 'fechado' ? 'Nenhum carrinho fechado' : 'Lixeira vazia'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {carrinhos.map(c => {
                const count = c.catalogo_carrinho_itens?.[0]?.count || 0
                const isAtivo = carrinhoAtivo?.id === c.id
                return (
                  <div key={c.id} style={{
                    background: colors.surface, borderRadius: radius.md, border: `1px solid ${isAtivo ? colors.success : colors.border}`,
                    padding: 14, boxShadow: shadow.sm, cursor: 'pointer',
                    borderLeft: isAtivo ? `4px solid ${colors.success}` : `4px solid transparent`,
                  }} onClick={() => selecionarCarrinho(c)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: colors.text, marginBottom: 4 }}>{c.nome}</div>
                        <div style={{ fontSize: 12, color: colors.textMuted }}>
                          {count} {count === 1 ? 'peça' : 'peças'} • {tempoAtras(c.updated_at)}
                        </div>
                        <div style={{ fontSize: 11, color: colors.textSubtle, marginTop: 2 }}>
                          <User size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                          {c.criado_por}
                        </div>
                      </div>
                      {isAtivo && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: radius.pill,
                          background: colors.successBg, color: colors.success, border: `1px solid ${colors.successBorder}`,
                          flexShrink: 0,
                        }}>Ativo</span>
                      )}
                    </div>

                    {tabCarrinhos === 'lixeira' && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => mudarStatus(c.id, 'aberto')} style={{
                          flex: 1, padding: '8px 0', borderRadius: radius.sm, border: `1px solid ${colors.successBorder}`,
                          background: colors.successBg, color: colors.success, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}>
                          <RotateCcw size={14} /> Restaurar
                        </button>
                        <button onClick={() => excluirCarrinho(c.id)} style={{
                          flex: 1, padding: '8px 0', borderRadius: radius.sm, border: `1px solid ${colors.dangerBorder}`,
                          background: colors.dangerBg, color: colors.danger, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}>
                          <Trash2 size={14} /> Excluir
                        </button>
                      </div>
                    )}

                    {tabCarrinhos === 'fechado' && (
                      <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => mudarStatus(c.id, 'aberto')} style={{
                          width: '100%', padding: '8px 0', borderRadius: radius.sm, border: `1px solid ${colors.infoBorder}`,
                          background: colors.infoBg, color: colors.info, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}>
                          <RotateCcw size={14} /> Reabrir
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ CARRINHO DETALHE ═══ */}
      {vista === 'carrinho_detalhe' && carrinhoAtivo && (
        <div>
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: radius.md, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
            <button onClick={() => setAbaDetalhe('itens')} style={{
              flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
              background: abaDetalhe === 'itens' ? colors.accent : colors.surface,
              color: abaDetalhe === 'itens' ? '#fff' : colors.textMuted,
              fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Package size={14} /> Itens ({itensAtivos.length})
            </button>
            <button onClick={() => setAbaDetalhe('historico')} style={{
              flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
              background: abaDetalhe === 'historico' ? colors.accent : colors.surface,
              color: abaDetalhe === 'historico' ? '#fff' : colors.textMuted,
              fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Clock size={14} /> Histórico
            </button>
          </div>

          {abaDetalhe === 'itens' && (
            <div>
              {itensAtivos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: colors.textMuted, fontSize: 14 }}>
                  Carrinho vazio — navegue pelo catálogo para adicionar peças
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {itensAtivos.map(item => (
                    <div key={item.id} style={{
                      background: colors.surface, borderRadius: radius.md, border: `1px solid ${colors.border}`,
                      padding: 14, boxShadow: shadow.sm,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            {item.peca_reference && (
                              <span style={{
                                width: 24, height: 24, borderRadius: '50%', background: 'rgba(37,99,235,0.92)',
                                color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>{item.peca_reference}</span>
                            )}
                            <div style={{ fontSize: 14, fontWeight: 700, color: colors.primary }}>{item.peca_code}</div>
                          </div>
                          <div style={{ fontSize: 13, color: colors.text }}>{item.peca_name}</div>
                          <div style={{ fontSize: 11, color: colors.textSubtle, marginTop: 2 }}>
                            {item.figura_code} — {item.figura_name}
                          </div>
                        </div>
                        <button onClick={() => removerItemCarrinho(item.id)} style={{
                          background: colors.dangerBg, border: `1px solid ${colors.dangerBorder}`, borderRadius: radius.sm,
                          width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', flexShrink: 0, marginLeft: 8,
                        }}>
                          <Trash2 size={14} color={colors.danger} />
                        </button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Qtd:</span>
                        <button onClick={() => alterarQtdItem(item.id, item.qtd - 1)} style={{
                          width: 32, height: 32, borderRadius: radius.sm, border: `1px solid ${colors.border}`,
                          background: colors.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        }}>
                          <Minus size={14} color={colors.text} />
                        </button>
                        <span style={{ fontSize: 16, fontWeight: 700, color: colors.text, minWidth: 30, textAlign: 'center' }}>
                          {item.qtd}
                        </span>
                        <button onClick={() => alterarQtdItem(item.id, item.qtd + 1)} style={{
                          width: 32, height: 32, borderRadius: radius.sm, border: `1px solid ${colors.border}`,
                          background: colors.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        }}>
                          <Plus size={14} color={colors.text} />
                        </button>
                      </div>
                    </div>
                  ))}

                  <div style={{
                    background: colors.accentBg, borderRadius: radius.md, padding: 14,
                    border: `1px solid ${colors.accentBorder}`, marginTop: 8,
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: colors.accent }}>
                      Total: {totalCarrinho} {totalCarrinho === 1 ? 'peça' : 'peças'}
                    </div>
                  </div>

                  <div style={{
                    background: colors.surface, borderRadius: radius.md, border: `1px solid ${colors.border}`,
                    padding: 14, marginTop: 4,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 10 }}>
                      Enviar ao Pós Vendas
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button onClick={() => enviarWhatsApp('1433516049')} style={{
                        width: '100%', padding: '12px 16px', borderRadius: radius.md,
                        background: '#25D366', color: '#fff', fontSize: 14, fontWeight: 700,
                        border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                        boxShadow: '0 2px 8px rgba(37,211,102,0.3)',
                      }}>
                        <MessageCircle size={18} /> Pós Vendas (14) 3351-6049
                      </button>
                      <button onClick={() => enviarWhatsApp('14997627413')} style={{
                        width: '100%', padding: '12px 16px', borderRadius: radius.md,
                        background: '#25D366', color: '#fff', fontSize: 14, fontWeight: 700,
                        border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                        boxShadow: '0 2px 8px rgba(37,211,102,0.3)',
                      }}>
                        <MessageCircle size={18} /> Zezo (14) 99762-7413
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button onClick={copiarLink} style={{
                      flex: 1, padding: '12px 16px', borderRadius: radius.md,
                      background: colors.infoBg, color: colors.info, fontSize: 13, fontWeight: 700,
                      border: `1px solid ${colors.infoBorder}`, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}>
                      <Link2 size={16} /> Copiar Link
                    </button>
                    <button onClick={baixarPdf} style={{
                      flex: 1, padding: '12px 16px', borderRadius: radius.md,
                      background: colors.accentBg, color: colors.accent, fontSize: 13, fontWeight: 700,
                      border: `1px solid ${colors.accentBorder}`, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}>
                      <FileDown size={16} /> Baixar PDF
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={() => mudarStatus(carrinhoAtivo.id, 'fechado')} style={{
                  flex: 1, padding: '12px 0', borderRadius: radius.md,
                  background: colors.successBg, color: colors.success, fontSize: 13, fontWeight: 700,
                  border: `1px solid ${colors.successBorder}`, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <Archive size={16} /> Fechar
                </button>
                <button onClick={() => mudarStatus(carrinhoAtivo.id, 'lixeira')} style={{
                  flex: 1, padding: '12px 0', borderRadius: radius.md,
                  background: colors.dangerBg, color: colors.danger, fontSize: 13, fontWeight: 700,
                  border: `1px solid ${colors.dangerBorder}`, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <Trash2 size={16} /> Lixeira
                </button>
              </div>
            </div>
          )}

          {abaDetalhe === 'historico' && (
            <div>
              {historicoAtivo.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: colors.textMuted, fontSize: 14 }}>
                  Nenhuma atividade registrada
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {historicoAtivo.map((h, i) => (
                    <div key={h.id} style={{
                      display: 'flex', gap: 12, padding: '12px 0',
                      borderBottom: i < historicoAtivo.length - 1 ? `1px solid ${colors.border}` : 'none',
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: h.acao === 'criou' ? colors.infoBg
                          : h.acao === 'adicionou' ? colors.successBg
                          : h.acao === 'removeu' ? colors.dangerBg
                          : h.acao === 'status' ? '#F5F3FF'
                          : colors.warningBg,
                      }}>
                        {h.acao === 'criou' && <FolderOpen size={14} color={colors.info} />}
                        {h.acao === 'adicionou' && <Plus size={14} color={colors.success} />}
                        {h.acao === 'removeu' && <Minus size={14} color={colors.danger} />}
                        {h.acao === 'alterou' && <Package size={14} color={colors.warning} />}
                        {h.acao === 'status' && <Archive size={14} color="#7C3AED" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: colors.text }}>{h.descricao}</div>
                        <div style={{ fontSize: 11, color: colors.textSubtle, marginTop: 2 }}>
                          {h.quem} • {tempoAtras(h.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ BARRA FLUTUANTE DO CARRINHO ═══ */}
      {showFloating && (
        <button onClick={irParaCarrinhoDetalhe} style={{
          position: 'fixed', bottom: 70, left: 16, right: 16,
          background: colors.primary, color: '#fff', borderRadius: radius.lg,
          padding: '14px 20px', border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(196,30,42,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          zIndex: 50,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShoppingCart size={20} />
            <span style={{ fontSize: 15, fontWeight: 700 }}>{carrinhoAtivo?.nome || 'Carrinho'}</span>
          </div>
          <span style={{
            background: '#fff', color: colors.primary, fontSize: 13, fontWeight: 800,
            borderRadius: radius.pill, padding: '4px 12px',
          }}>{totalCarrinho} {totalCarrinho === 1 ? 'item' : 'itens'}</span>
        </button>
      )}

      {/* ═══ BOTTOM SHEET — Detalhe da peça ═══ */}
      {sheetAberta && pecaSel && (
        <>
          <div onClick={() => { setSheetAberta(false); setPecaSel(null) }} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 90,
          }} />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 91,
            background: colors.surface, borderRadius: `${radius.xl}px ${radius.xl}px 0 0`,
            boxShadow: '0 -4px 24px rgba(0,0,0,0.15)', padding: '20px 20px 28px',
            maxHeight: '60vh', overflow: 'auto',
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: colors.textGhost, margin: '0 auto 16px' }} />

            {pecaSel.reference && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: '50%', background: colors.accent,
                color: '#fff', fontSize: 14, fontWeight: 800, marginBottom: 12,
              }}>{pecaSel.reference}</div>
            )}

            <div style={{ fontSize: 18, fontWeight: 800, color: colors.primary, marginBottom: 4 }}>{pecaSel.code}</div>
            <div style={{ fontSize: 14, color: colors.text, marginBottom: 12 }}>{pecaSel.name}</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              <div style={{
                background: colors.surfaceAlt, borderRadius: radius.sm, padding: '10px 12px',
                border: `1px solid ${colors.border}`,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', marginBottom: 2 }}>Qtd por máquina</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>{pecaSel.qtd || '-'}</div>
              </div>
              <div style={{
                background: colors.surfaceAlt, borderRadius: radius.sm, padding: '10px 12px',
                border: `1px solid ${colors.border}`,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: colors.textSubtle, textTransform: 'uppercase', marginBottom: 2 }}>Unidade</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>{pecaSel.unit || 'UN'}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Quantidade:</span>
              <button onClick={() => setQtdSheet(q => Math.max(1, q - 1))} style={{
                width: 36, height: 36, borderRadius: radius.sm, border: `1px solid ${colors.border}`,
                background: colors.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}>
                <Minus size={16} color={colors.text} />
              </button>
              <span style={{ fontSize: 20, fontWeight: 800, color: colors.primary, minWidth: 36, textAlign: 'center' }}>
                {qtdSheet}
              </span>
              <button onClick={() => setQtdSheet(q => q + 1)} style={{
                width: 36, height: 36, borderRadius: radius.sm, border: `1px solid ${colors.border}`,
                background: colors.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}>
                <Plus size={16} color={colors.text} />
              </button>
            </div>

            <button onClick={handleAddToCart} style={{
              width: '100%', padding: '14px 20px', borderRadius: radius.md,
              background: colors.primary, color: '#fff', fontSize: 15, fontWeight: 700,
              border: 'none', cursor: 'pointer', boxShadow: shadow.primary,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <ShoppingCart size={18} />
              {carrinhoAtivo ? `Adicionar a "${carrinhoAtivo.nome}"` : 'Adicionar ao Carrinho'}
            </button>
          </div>
        </>
      )}

      {/* ═══ MODAL — Criar carrinho ═══ */}
      {showCriarModal && (
        <>
          <div onClick={() => { setShowCriarModal(false); setNomeNovo(''); pendingAdd.current = null }} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
          }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: colors.surface, borderRadius: radius.xl, padding: 24,
            width: 'calc(100% - 48px)', maxWidth: 400, zIndex: 101, boxShadow: shadow.lg,
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: colors.text, marginBottom: 4 }}>Novo Carrinho</div>
            <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 16 }}>
              Dê um nome para identificar o carrinho
            </div>
            <input
              value={nomeNovo}
              onChange={e => setNomeNovo(e.target.value)}
              placeholder="Ex: Nome do Cliente - Serviço"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleCriarSubmit()}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: radius.md,
                border: `1px solid ${colors.borderStrong}`, fontSize: 15,
                outline: 'none', background: colors.surface, marginBottom: 16,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setShowCriarModal(false); setNomeNovo(''); pendingAdd.current = null }} style={{
                flex: 1, padding: '12px 0', borderRadius: radius.md,
                background: colors.surfaceAlt, color: colors.textMuted, fontSize: 14, fontWeight: 700,
                border: `1px solid ${colors.border}`, cursor: 'pointer',
              }}>Cancelar</button>
              <button onClick={handleCriarSubmit} style={{
                flex: 1, padding: '12px 0', borderRadius: radius.md,
                background: colors.primary, color: '#fff', fontSize: 14, fontWeight: 700,
                border: 'none', cursor: 'pointer', opacity: nomeNovo.trim() ? 1 : 0.5,
              }}>Criar</button>
            </div>
          </div>
        </>
      )}

      {/* ═══ MODAL — Nome do usuário ═══ */}
      {showNomeModal && (
        <>
          <div onClick={() => { setShowNomeModal(false); setInputNome(''); pendingAdd.current = null }} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
          }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: colors.surface, borderRadius: radius.xl, padding: 24,
            width: 'calc(100% - 48px)', maxWidth: 400, zIndex: 101, boxShadow: shadow.lg,
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: colors.text, marginBottom: 4 }}>
              <User size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              Seu Nome
            </div>
            <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 16 }}>
              Informe seu nome para registrar as alterações
            </div>
            <input
              value={inputNome}
              onChange={e => setInputNome(e.target.value)}
              placeholder="Seu nome..."
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleNomeSubmit()}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: radius.md,
                border: `1px solid ${colors.borderStrong}`, fontSize: 15,
                outline: 'none', background: colors.surface, marginBottom: 16,
                boxSizing: 'border-box',
              }}
            />
            <button onClick={handleNomeSubmit} style={{
              width: '100%', padding: '12px 0', borderRadius: radius.md,
              background: colors.primary, color: '#fff', fontSize: 14, fontWeight: 700,
              border: 'none', cursor: 'pointer', opacity: inputNome.trim() ? 1 : 0.5,
            }}>Confirmar</button>
          </div>
        </>
      )}

      {/* ═══ TOAST ═══ */}
      {toast && (
        <div style={{
          position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff', padding: '10px 20px', borderRadius: radius.md,
          fontSize: 14, fontWeight: 600, boxShadow: shadow.lg, zIndex: 200,
        }}>{toast}</div>
      )}
    </div>
  )
}
