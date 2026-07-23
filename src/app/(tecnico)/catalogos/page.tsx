'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { colors, radius, shadow } from '@/lib/ui'
import {
  ChevronLeft, Search, X, ChevronRight, ZoomIn, ZoomOut,
  Layers, Package, Cog, BookOpen, ShoppingCart, Plus, Minus, Trash2,
  Send, FileDown, MessageCircle, Clock, Archive, RotateCcw,
  Link2, FolderOpen, User,
} from 'lucide-react'
import jsPDF from 'jspdf'

type Vista = 'marcas' | 'modelos' | 'secoes' | 'figuras' | 'figura' | 'busca' | 'carrinhos' | 'carrinho_detalhe'

interface Marca { nome: string; slug: string; logo_url: string | null; modelos: number; tipos: string[] }
interface Modelo { slug: string; nome: string; image_url: string | null; marca: string; tipo: string; familia: string | null; figuras?: number }
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

  const [toast, setToast] = useState('')
  const searchParams = useSearchParams()
  const totalCarrinho = itensAtivos.reduce((s, i) => s + i.qtd, 0)

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
    loadMarcas()
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

  async function selecionarMarca(marca: string) {
    setMarcaSel(marca); setVista('modelos'); setLoading(true)
    setModelos(await api({ action: 'modelos', marca }))
    setLoading(false)
  }

  async function selecionarModelo(modelo: string) {
    setModeloSel(modelo); setVista('secoes'); setLoading(true)
    setSecoes(await api({ action: 'secoes', modelo }))
    setLoading(false)
  }

  async function selecionarSecao(secao: string) {
    setSecaoSel(secao); setVista('figuras'); setLoading(true)
    setFiguras(await api({ action: 'figuras', modelo: modeloSel, secao }))
    setLoading(false)
  }

  async function selecionarFigura(id: string) {
    setVista('figura'); setLoading(true)
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

  const handlePointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    setPan({ x: dragStart.current.panX + (e.clientX - dragStart.current.x), y: dragStart.current.panY + (e.clientY - dragStart.current.y) })
  }
  const handlePointerUp = () => setDragging(false)

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
    if (vista === 'carrinho_detalhe') { setVista('carrinhos'); loadCarrinhos(tabCarrinhos); return }
    if (vista === 'carrinhos') { setVista(vistaAntes.current); return }
    if (vista === 'busca') { setBuscaAberta(false); setBusca(''); setVista(secaoSel ? 'figuras' : modeloSel ? 'secoes' : marcaSel ? 'modelos' : 'marcas'); return }
    if (vista === 'figura') { setVista('figuras'); setFigDetalhe(null); return }
    if (vista === 'figuras') { setVista('secoes'); setSecaoSel(''); return }
    if (vista === 'secoes') { setVista('modelos'); setModeloSel(''); return }
    if (vista === 'modelos') { setVista('marcas'); setMarcaSel(''); return }
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
          <span onClick={() => { setVista('marcas'); setMarcaSel(''); setModeloSel(''); setSecaoSel('') }}
            style={{ cursor: 'pointer', textDecoration: 'underline' }}>Catálogo</span>
          {marcaSel && <>
            <ChevronRight size={12} />
            <span onClick={() => { setVista('modelos'); setModeloSel(''); setSecaoSel('') }}
              style={{ cursor: 'pointer', textDecoration: 'underline' }}>{marcaSel}</span>
          </>}
          {modeloSel && <>
            <ChevronRight size={12} />
            <span onClick={() => { setVista('secoes'); setSecaoSel('') }}
              style={{ cursor: 'pointer', textDecoration: 'underline' }}>{modeloSel}</span>
          </>}
          {secaoSel && <>
            <ChevronRight size={12} />
            <span onClick={() => setVista('figuras')}
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
          <div style={{
            position: 'relative', width: '100%',
            background: '#fff', borderRadius: radius.lg, overflow: 'hidden',
            border: `1px solid ${colors.border}`, marginBottom: 8, touchAction: 'none',
          }}
            ref={imgContainerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {figDetalhe.image_url && (
              <img src={figDetalhe.image_url} alt={figDetalhe.name}
                onLoad={e => {
                  const img = e.target as HTMLImageElement
                  setImgDim({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
                }}
                style={{
                  width: '100%', display: 'block',
                  transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                  transition: dragging ? 'none' : 'transform 0.2s',
                  cursor: zoom > 1 ? 'grab' : 'default',
                }}
                draggable={false}
              />
            )}
            {(figDetalhe.hotspots || []).map((h, i) => {
              const ativo = refHover === h.reference || pecaSel?.reference === h.reference
              return (
                <button key={`${h.reference}-${i}`}
                  onClick={e => {
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

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'center' }}>
            <button onClick={() => { setZoom(z => Math.max(0.5, z - 0.5)); setPan({ x: 0, y: 0 }) }} style={{
              background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.sm,
              width: 40, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}>
              <ZoomOut size={18} color={colors.textMuted} />
            </button>
            <span style={{
              fontSize: 13, fontWeight: 600, color: colors.textMuted,
              display: 'flex', alignItems: 'center', minWidth: 50, justifyContent: 'center',
            }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(4, z + 0.5))} style={{
              background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.sm,
              width: 40, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}>
              <ZoomIn size={18} color={colors.textMuted} />
            </button>
            {zoom !== 1 && (
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} style={{
                background: colors.primaryBg, border: `1px solid ${colors.primaryBorder}`, borderRadius: radius.sm,
                padding: '0 12px', height: 36, fontSize: 12, fontWeight: 600, color: colors.primary, cursor: 'pointer',
              }}>Reset</button>
            )}
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
