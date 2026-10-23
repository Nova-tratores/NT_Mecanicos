'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase } from '@/lib/supabase'
import { colors } from '@/lib/ui'
import {
  Camera, ChevronRight, ChevronLeft, Check, AlertCircle,
  Share2, Download, X, Car, Shield, Clock, History,
} from 'lucide-react'
import Link from 'next/link'
import { PageSpinner } from '@/components/ui'

interface CheckItem {
  key: string; cat: string; titulo: string; desc: string
}
interface SavedItem {
  item_key: string; resposta: string; observacao: string; foto_url: string | null
}

const MOLDES: Record<string, { svg: string; dica: string }> = {
  crlv: {
    dica: 'Enquadre o documento na área',
    svg: `<rect x="15" y="20" width="70" height="60" rx="3" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="4 2" opacity="0.7"/><text x="50" y="16" text-anchor="middle" fill="white" font-size="4.5" opacity="0.8">CRLV</text>`,
  },
  lataria_frente: {
    dica: 'Enquadre a frente do veículo',
    svg: `<rect x="10" y="25" width="80" height="55" rx="4" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="4 2" opacity="0.6"/><line x1="50" y1="25" x2="50" y2="80" stroke="white" stroke-width="0.4" opacity="0.3"/><text x="50" y="20" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Frente — capô, faróis, para-choque</text>`,
  },
  lataria_traseira: {
    dica: 'Enquadre a traseira do veículo',
    svg: `<rect x="10" y="25" width="80" height="55" rx="4" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="4 2" opacity="0.6"/><text x="50" y="20" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Traseira — lanternas, para-choque</text>`,
  },
  lataria_esquerda: {
    dica: 'Enquadre toda a lateral esquerda',
    svg: `<rect x="5" y="30" width="90" height="45" rx="4" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="4 2" opacity="0.6"/><text x="50" y="25" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Lateral esquerda completa</text>`,
  },
  lataria_direita: {
    dica: 'Enquadre toda a lateral direita',
    svg: `<rect x="5" y="30" width="90" height="45" rx="4" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="4 2" opacity="0.6"/><text x="50" y="25" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Lateral direita completa</text>`,
  },
  pneu_de: {
    dica: 'Aproxime do pneu mostrando a banda',
    svg: `<ellipse cx="50" cy="50" rx="28" ry="35" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/><text x="50" y="10" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Pneu dianteiro esquerdo</text>`,
  },
  pneu_dd: {
    dica: 'Aproxime do pneu mostrando a banda',
    svg: `<ellipse cx="50" cy="50" rx="28" ry="35" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/><text x="50" y="10" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Pneu dianteiro direito</text>`,
  },
  pneu_te: {
    dica: 'Aproxime do pneu mostrando a banda',
    svg: `<ellipse cx="50" cy="50" rx="28" ry="35" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/><text x="50" y="10" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Pneu traseiro esquerdo</text>`,
  },
  pneu_td: {
    dica: 'Aproxime do pneu mostrando a banda',
    svg: `<ellipse cx="50" cy="50" rx="28" ry="35" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/><text x="50" y="10" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Pneu traseiro direito</text>`,
  },
  estepe: {
    dica: 'Mostre o estepe e sua condição',
    svg: `<ellipse cx="50" cy="50" rx="28" ry="35" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/><text x="50" y="10" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Estepe</text>`,
  },
  parabrisa: {
    dica: 'De dentro para fora, mostre trincas',
    svg: `<rect x="10" y="15" width="80" height="70" rx="5" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="4 2" opacity="0.6"/><text x="50" y="10" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Para-brisa (de dentro para fora)</text>`,
  },
  oleo_motor: {
    dica: 'Fotografe a vareta de óleo',
    svg: `<rect x="30" y="20" width="40" height="65" rx="3" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/><text x="50" y="14" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Vareta de óleo</text>`,
  },
  arrefecimento: {
    dica: 'Mostre o nível no reservatório',
    svg: `<rect x="25" y="20" width="50" height="60" rx="3" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/><line x1="25" y1="55" x2="75" y2="55" stroke="white" stroke-width="0.5" opacity="0.5"/><text x="50" y="14" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Reservatório — nível visível</text>`,
  },
  bateria: {
    dica: 'Mostre terminais e fixação',
    svg: `<rect x="20" y="22" width="60" height="56" rx="3" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/><text x="50" y="16" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Bateria — terminais visíveis</text>`,
  },
  painel: {
    dica: 'Ligue o veículo e fotografe o painel',
    svg: `<rect x="10" y="25" width="80" height="50" rx="4" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="4 2" opacity="0.6"/><text x="50" y="20" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Painel ligado — luzes visíveis</text>`,
  },
  hodometro: {
    dica: 'Enquadre o hodômetro com a KM legível',
    svg: `<rect x="20" y="30" width="60" height="40" rx="3" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/><text x="50" y="25" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Hodômetro — km legível</text>`,
  },
  limpeza_interna: {
    dica: 'Mostre bancos, tapetes e interior',
    svg: `<rect x="8" y="15" width="84" height="70" rx="4" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="4 2" opacity="0.6"/><text x="50" y="10" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Interior — bancos e tapetes</text>`,
  },
  extintor: {
    dica: 'Mostre a etiqueta de validade',
    svg: `<rect x="25" y="15" width="50" height="70" rx="3" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/><text x="50" y="10" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Extintor — validade visível</text>`,
  },
  triangulo: {
    dica: 'Fotografe o triângulo',
    svg: `<polygon points="50,20 20,75 80,75" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/><text x="50" y="85" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Triângulo</text>`,
  },
  macaco_chave: {
    dica: 'Mostre o macaco e a chave juntos',
    svg: `<rect x="10" y="25" width="80" height="50" rx="4" fill="none" stroke="white" stroke-width="0.8" stroke-dasharray="4 2" opacity="0.6"/><text x="50" y="20" text-anchor="middle" fill="white" font-size="4" opacity="0.8">Macaco + chave de roda</text>`,
  },
}

const LADO_MAX_FOTO = 1600

/** reduz a foto para no máximo 1600 px no lado maior (JPEG 0,85); se não der, devolve a original */
async function reduzirFoto(file: File): Promise<File> {
  try {
    const url = URL.createObjectURL(file)
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    URL.revokeObjectURL(url)
    const escala = Math.min(1, LADO_MAX_FOTO / Math.max(img.naturalWidth, img.naturalHeight))
    if (escala >= 1 && file.size < 1.5 * 1024 * 1024) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * escala)
    canvas.height = Math.round(img.naturalHeight * escala)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
    return blob ? new File([blob], `checklist-${Date.now()}.jpg`, { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

export default function ChecklistVeiculoPage() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const [veiculo, setVeiculo] = useState<{ placa: string } | null>(null)
  const [checklistId, setChecklistId] = useState<string | null>(null)
  const [items, setItems] = useState<CheckItem[]>([])
  const [savedItems, setSavedItems] = useState<Map<string, SavedItem>>(new Map())
  const [step, setStep] = useState(-1) // -1 = intro, 0..N = items, N+1 = resumo
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resultado, setResultado] = useState<{ status: string; score: number; alertas: string[]; shareToken?: string; titulo?: string } | null>(null)

  const [km, setKm] = useState('')
  const [historico, setHistorico] = useState<any[]>([])

  // Item state
  const [foto, setFoto] = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const [resposta, setResposta] = useState<string>('')
  const [obs, setObs] = useState('')
  const fotoRef = useRef<HTMLInputElement>(null)

  // Camera viewfinder state
  const [cameraAberta, setCameraAberta] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Load vehicle + existing checklist + history
  useEffect(() => {
    if (!nome) return
    ;(async () => {
      const { data: v } = await supabase
        .from('tecnico_veiculos')
        .select('placa')
        .eq('tecnico_nome', nome)
        .maybeSingle()
      if (v) setVeiculo(v)

      // Carregar histórico
      try {
        const res = await fetch('/api/checklist-veiculo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'listar', tecnico_nome: nome }),
        })
        if (res.ok) {
          const lista = await res.json()
          setHistorico(lista)
        }
      } catch {}

      setLoading(false)
    })()
  }, [nome])

  const iniciar = useCallback(async () => {
    if (!veiculo || !nome) return
    setLoading(true)
    let loc: { lat: number; lng: number } | null = null
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }),
      )
      loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
    } catch {}

    // confere a resposta: antes um erro caía no "Resumo 0/0" (José, 23/10/2026)
    let data: { id?: string; items?: CheckItem[]; itens?: SavedItem[]; error?: string }
    try {
      const res = await fetch('/api/checklist-veiculo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'iniciar', tecnico_nome: nome, placa: veiculo.placa, loc, km: km || null }),
      })
      data = await res.json().catch(() => ({}))
      if (!res.ok || !data.id || !(data.items || []).length) {
        alert(`Não foi possível iniciar o checklist: ${data.error || `erro ${res.status}`}. Tente de novo.`)
        setLoading(false)
        return
      }
    } catch {
      alert('Sem conexão. O checklist precisa de internet — tente de novo quando tiver sinal.')
      setLoading(false)
      return
    }
    setChecklistId(data.id!)
    setItems(data.items || [])
    const map = new Map<string, SavedItem>()
    for (const it of data.itens || []) map.set(it.item_key, it)
    setSavedItems(map)
    // Resume from first unanswered item
    const firstUnanswered = (data.items || []).findIndex((i: CheckItem) => !map.has(i.key))
    setStep(firstUnanswered >= 0 ? firstUnanswered : 0)
    setLoading(false)
  }, [nome, veiculo, km])

  const salvarItem = useCallback(async () => {
    if (!checklistId || step < 0 || step >= items.length) return
    const item = items[step]
    if (!foto && !savedItems.get(item.key)?.foto_url) return
    if (!resposta) return
    setSaving(true)

    const fd = new FormData()
    fd.append('action', 'salvar_item')
    fd.append('checklist_id', checklistId)
    fd.append('item_key', item.key)
    fd.append('categoria', item.cat)
    fd.append('titulo', item.titulo)
    fd.append('resposta', resposta)
    fd.append('observacao', obs)
    if (foto) fd.append('foto', foto)

    try {
      const res = await fetch('/api/checklist-veiculo', { method: 'POST', body: fd })
      const json = await res.json()

      if (!res.ok) {
        setSaving(false)
        alert(`Erro ao salvar item: ${json.error || 'Tente novamente'}`)
        return
      }

      setSavedItems(prev => {
        const next = new Map(prev)
        next.set(item.key, {
          item_key: item.key, resposta, observacao: obs,
          foto_url: json.foto_url || prev.get(item.key)?.foto_url || null,
        })
        return next
      })

      // Move to next
      setFoto(null)
      setFotoPreview(null)
      setResposta('')
      setObs('')
      if (step < items.length - 1) {
        setStep(step + 1)
      } else {
        setStep(items.length) // summary
      }
    } catch (err) {
      alert('Erro de conexão ao salvar. Verifique sua internet e tente novamente.')
    }
    setSaving(false)
  }, [checklistId, step, items, foto, resposta, obs, savedItems])

  const concluir = useCallback(async () => {
    if (!checklistId) return
    setSaving(true)
    let loc: { lat: number; lng: number } | null = null
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }),
      )
      loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
    } catch {}

    try {
      const res = await fetch('/api/checklist-veiculo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'concluir', checklist_id: checklistId, loc }),
      })
      const data = await res.json()

      if (!res.ok) {
        setSaving(false)
        alert(data.error || 'Erro ao concluir checklist')
        return
      }

      // Get share token
      const { data: cl } = await supabase
        .from('veiculo_checklist')
        .select('share_token')
        .eq('id', checklistId)
        .single()

      setResultado({ ...data, shareToken: cl?.share_token, titulo: data.titulo })
    } catch {
      alert('Erro de conexão. Verifique sua internet e tente novamente.')
    }
    setSaving(false)
  }, [checklistId])

  // Load saved data when step changes
  useEffect(() => {
    if (step < 0 || step >= items.length) return
    const item = items[step]
    const saved = savedItems.get(item.key)
    if (saved) {
      setResposta(saved.resposta || '')
      setObs(saved.observacao || '')
      setFotoPreview(saved.foto_url || null)
    } else {
      setResposta('')
      setObs('')
      setFotoPreview(null)
    }
    setFoto(null)
  }, [step, items, savedItems])

  // Plano B (câmera do sistema): a foto vem em resolução cheia (>4,5 MB dava 413 "Erro de conexão") —
  // reduz para ~1600 px antes de enviar (José, 23/10/2026)
  const handleFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const original = e.target.files?.[0]
    e.target.value = ''
    if (!original) return
    const file = await reduzirFoto(original)
    setFoto(file)
    setFotoPreview(URL.createObjectURL(file))
  }

  const abrirCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = stream
      setCameraAberta(true)
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      }, 50)
    } catch {
      fotoRef.current?.click()
    }
  }

  const fecharCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCameraAberta(false)
  }

  // saiu da tela com a câmera aberta: desliga (a luz da câmera ficava acesa) (José, 23/10/2026)
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const capturarFoto = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    const escala = Math.min(1, LADO_MAX_FOTO / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * escala)
    canvas.height = Math.round(video.videoHeight * escala)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], `checklist-${Date.now()}.jpg`, { type: 'image/jpeg' })
      setFoto(file)
      setFotoPreview(URL.createObjectURL(file))
      fecharCamera()
    }, 'image/jpeg', 0.85)
  }

  const compartilhar = () => {
    if (!resultado?.shareToken) return
    const url = `${window.location.origin}/checklist-veiculo/ver?token=${resultado.shareToken}`
    if (navigator.share) {
      navigator.share({ title: 'Checklist do Veículo', url })
    } else {
      navigator.clipboard.writeText(url)
      alert('Link copiado!')
    }
  }

  if (loading) return <PageSpinner />

  if (!veiculo) {
    return (
      <div style={{ background: colors.surface, border: `1px dashed ${colors.borderStrong}`, borderRadius: 16, padding: '30px 20px', textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 13, background: colors.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <Car size={24} color={colors.textSubtle} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 500, color: colors.text }}>Sem veículo atribuído</div>
        <div style={{ fontSize: 13.5, color: colors.textMuted, marginTop: 6, lineHeight: 1.45 }}>
          Você precisa ter um veículo atribuído para realizar o checklist
        </div>
        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', marginTop: 18, padding: '0 22px', height: 46, borderRadius: 12,
          background: colors.primary, color: '#fff', textDecoration: 'none', fontSize: 15, fontWeight: 500,
        }}>Voltar</Link>
      </div>
    )
  }

  // Resultado final
  if (resultado) {
    const scoreColor = resultado.score >= 70 ? colors.success : resultado.score >= 50 ? colors.warning : colors.danger
    const scoreLabel = resultado.score >= 70 ? 'Confiável' : resultado.score >= 50 ? 'Atenção' : 'Suspeito'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ textAlign: 'center', padding: '22px 16px', background: colors.surface, borderRadius: 16, border: `1px solid ${colors.border}` }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18, margin: '0 auto 14px',
            background: scoreColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {resultado.score >= 70 ? <Check size={32} color="#fff" /> : <AlertCircle size={32} color="#fff" />}
          </div>
          <div style={{ fontSize: 21, fontWeight: 500, color: colors.text }}>Checklist {resultado.status === 'completo' ? 'concluído' : 'enviado'}</div>
          {resultado.titulo && (
            <div style={{ fontSize: 14, color: colors.text, marginTop: 6 }}>{resultado.titulo}</div>
          )}
          <div style={{ fontSize: 13.5, color: colors.textMuted, marginTop: 4 }}>
            {Math.floor((resultado as any).duracao / 60)}min {(resultado as any).duracao % 60}s de duração
          </div>
        </div>

        <div style={{
          background: `color-mix(in srgb, ${scoreColor} 6%, #FEFEFE)`, borderRadius: 16, padding: 18,
          border: `1px solid color-mix(in srgb, ${scoreColor} 25%, #E2E8F0)`, textAlign: 'center',
        }}>
          <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 6 }}>Índice de confiança</div>
          <div style={{ fontSize: 44, fontWeight: 500, color: scoreColor, lineHeight: 1.1 }}>{resultado.score}</div>
          <span style={{ display: 'inline-block', marginTop: 6, fontSize: 13, fontWeight: 500, color: '#fff', background: scoreColor, padding: '2px 11px', borderRadius: 999 }}>{scoreLabel}</span>
        </div>

        {resultado.alertas.length > 0 && (
          <div style={{
            background: colors.warningBg, borderRadius: 16, padding: 14,
            border: `1px solid ${colors.warningBorder}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: colors.warning, marginBottom: 6 }}>
              <AlertCircle size={16} /> Observações da análise
            </div>
            {resultado.alertas.map((a, i) => (
              <div key={i} style={{ fontSize: 13.5, color: colors.text, padding: '3px 0', lineHeight: 1.4 }}>• {a}</div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={compartilhar} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            height: 46, padding: '0 14px', borderRadius: 12, border: `1px solid ${colors.border}`,
            background: colors.surface, cursor: 'pointer', fontSize: 15, fontWeight: 500, color: colors.text,
          }}>
            <Share2 size={16} /> Compartilhar
          </button>
          <Link href="/" style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            height: 46, padding: '0 14px', borderRadius: 12, background: colors.primary,
            color: '#fff', textDecoration: 'none', fontSize: 15, fontWeight: 500,
          }}>
            <Check size={16} /> Voltar
          </Link>
        </div>
      </div>
    )
  }

  // Intro screen
  if (step === -1) {
    const partes = veiculo.placa.split(' - ')
    const modelo = partes.length > 1 ? partes.slice(0, -1).join(' - ') : ''
    const placaNum = partes[partes.length - 1]
    const hoje = new Date()
    const mesLabel = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Link href="/" style={{ color: colors.primary, textDecoration: 'none', fontSize: 14, display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
          <ChevronLeft size={17} /> Voltar
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11, flexShrink: 0,
            background: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield size={22} color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 500, color: colors.text }}>Checklist do veículo</div>
            <div style={{ fontSize: 13, color: colors.textMuted, textTransform: 'capitalize' }}>{mesLabel}</div>
          </div>
        </div>

        <div style={{
          background: colors.surface, borderRadius: 16, padding: 14,
          border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: colors.primaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Car size={20} color={colors.primary} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: colors.text, overflowWrap: 'anywhere' }}>{modelo || veiculo.placa}</div>
            <div style={{ fontSize: 13, color: colors.textMuted }}>{placaNum}</div>
          </div>
        </div>

        {/* KM input */}
        <div style={{
          background: colors.surface, borderRadius: 16, padding: 14,
          border: `1px solid ${colors.border}`,
        }}>
          <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 6 }}>Quilometragem atual</div>
          <input
            type="number"
            inputMode="numeric"
            value={km}
            onChange={e => setKm(e.target.value)}
            placeholder="Ex: 45230"
            onFocus={e => { e.currentTarget.style.borderColor = '#38BDF8' }}
            onBlur={e => { e.currentTarget.style.borderColor = colors.border }}
            style={{
              width: '100%', height: 46, padding: '0 14px', borderRadius: 12,
              border: `1px solid ${colors.border}`, background: colors.surface,
              fontSize: 16, color: colors.text, outline: 'none', boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ fontSize: 12.5, color: colors.textSubtle, marginTop: 5 }}>
            Informe o KM do hodômetro
          </div>
        </div>

        <div style={{
          background: colors.surface, borderRadius: 16, padding: 14,
          border: `1px solid ${colors.border}`,
        }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: colors.text, marginBottom: 8 }}>Como funciona</div>
          <div style={{ fontSize: 13.5, color: colors.textMuted, lineHeight: 1.7 }}>
            {['São 20 itens para inspecionar', 'Cada item exige uma foto', 'Marque como OK ou Problema', 'Adicione observações quando necessário', 'Tempo estimado: 15-20 minutos'].map(t => (
              <div key={t}>• {t}</div>
            ))}
          </div>
        </div>

        <button onClick={iniciar} disabled={loading || !km} style={{
          width: '100%', height: 48, padding: '0 20px', borderRadius: 12,
          background: km ? colors.primary : colors.accentBg, color: km ? '#fff' : colors.textSubtle,
          border: km ? 'none' : `1px solid ${colors.border}`,
          fontSize: 15.5, fontWeight: 500, cursor: km ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Camera size={19} /> Iniciar checklist
        </button>

        {/* Histórico de checklists anteriores */}
        {historico.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '0 2px' }}>
              <History size={16} color={colors.textMuted} />
              <span style={{ fontSize: 16, fontWeight: 500, color: colors.text }}>Anteriores</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {historico.filter(h => h.status === 'completo' || h.status === 'suspeito').map(h => {
                const [y, m] = (h.mes_referencia || '').split('-')
                const mesNome = new Date(Number(y), Number(m) - 1)
                  .toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
                const sColor = (h.score_confianca ?? 0) >= 70 ? colors.success
                  : (h.score_confianca ?? 0) >= 50 ? colors.warning : colors.danger
                return (
                  <a
                    key={h.id}
                    href={`/checklist-veiculo/ver?token=${h.share_token}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                      borderRadius: 16, border: `1px solid ${colors.border}`,
                      background: colors.surface, textDecoration: 'none',
                    }}
                  >
                    <div style={{
                      width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                      background: sColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>{h.score_confianca ?? '—'}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 500, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {h.titulo || `Checklist de ${mesNome}`}
                      </div>
                      <div style={{ fontSize: 12.5, color: colors.textMuted, marginTop: 2 }}>
                        {mesNome}{h.km ? ` · ${Number(h.km).toLocaleString('pt-BR')} km` : ''}
                      </div>
                    </div>
                    <ChevronRight size={18} color="#94A3B8" style={{ flexShrink: 0 }} />
                  </a>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Summary screen
  if (step === items.length) {
    const total = items.length
    const respondidos = items.filter(i => savedItems.has(i.key)).length
    const problemas = items.filter(i => savedItems.get(i.key)?.resposta === 'problema').length
    const faltam = total - respondidos

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 500, color: colors.text }}>Resumo</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {[
            { label: 'Respondidos', value: respondidos, color: colors.success },
            { label: 'Problemas', value: problemas, color: colors.danger },
            { label: 'Faltam', value: faltam, color: colors.warning },
          ].map(s => (
            <div key={s.label} style={{
              background: `color-mix(in srgb, ${s.color} 7%, #FEFEFE)`, borderRadius: 16, padding: '10px 12px',
              border: `1px solid color-mix(in srgb, ${s.color} 22%, #E2E8F0)`,
            }}>
              <div style={{ fontSize: 12.5, color: colors.textMuted }}>{s.label}</div>
              <div style={{ fontSize: 26, fontWeight: 500, color: s.color, lineHeight: 1.15, marginTop: 2 }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((item, i) => {
            const saved = savedItems.get(item.key)
            return (
              <button
                key={item.key}
                onClick={() => setStep(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                  borderRadius: 12, border: `1px solid ${saved ? colors.border : colors.warningBorder}`,
                  background: saved ? colors.surface : colors.warningBg,
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: saved
                    ? (saved.resposta === 'ok' ? colors.success : colors.danger)
                    : colors.surface,
                  border: saved ? 'none' : `1px solid ${colors.warningBorder}`,
                }}>
                  {saved ? (
                    saved.resposta === 'ok'
                      ? <Check size={16} color="#fff" />
                      : <AlertCircle size={16} color="#fff" />
                  ) : (
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: colors.warning }}>{i + 1}</span>
                  )}
                </div>
                <span style={{ fontSize: 14, color: colors.text, flex: 1, minWidth: 0 }}>{item.titulo}</span>
                <ChevronRight size={16} color="#94A3B8" style={{ flexShrink: 0 }} />
              </button>
            )
          })}
        </div>

        {faltam > 0 ? (
          <div style={{
            background: colors.warningBg, borderRadius: 12, padding: 12, textAlign: 'center',
            border: `1px solid ${colors.warningBorder}`, fontSize: 14, color: colors.warning,
          }}>
            Faltam {faltam} {faltam === 1 ? 'item' : 'itens'} para concluir
          </div>
        ) : (
          <button onClick={concluir} disabled={saving} style={{
            width: '100%', height: 48, padding: '0 20px', borderRadius: 12,
            background: colors.primary, color: '#fff', border: 'none',
            fontSize: 15.5, fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: saving ? 0.6 : 1,
          }}>
            {saving ? (
              <><div className="spinner" style={{ width: 18, height: 18 }} /> Finalizando...</>
            ) : (
              <><Check size={19} /> Concluir checklist</>
            )}
          </button>
        )}
      </div>
    )
  }

  // Item step
  const item = items[step]
  if (!item) return <PageSpinner />
  const progresso = Math.round(((step + 1) / items.length) * 100)
  const saved = savedItems.get(item.key)
  const podeAvancar = (foto || fotoPreview) && resposta

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
          <button onClick={() => step > 0 ? setStep(step - 1) : setStep(-1)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 14, color: colors.textMuted,
          }}>
            <ChevronLeft size={17} /> {step > 0 ? 'Anterior' : 'Voltar'}
          </button>
          <span style={{ fontSize: 13, color: colors.textMuted, fontVariantNumeric: 'tabular-nums' }}>{step + 1} / {items.length}</span>
          <button onClick={() => setStep(items.length)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            fontSize: 14, color: colors.primary, fontWeight: 500,
          }}>
            Resumo
          </button>
        </div>
        {/* Progress bar */}
        <div style={{ height: 6, background: colors.accentBg, borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progresso}%`, background: colors.primary, borderRadius: 999, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '14px 0', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 14 }}>
          {/* Category badge */}
          <span style={{
            fontSize: 12, fontWeight: 500, color: colors.primary, background: colors.primaryBg,
            padding: '2px 9px', borderRadius: 999,
          }}>{item.cat}</span>
          <div style={{ fontSize: 19, fontWeight: 500, color: colors.text, marginTop: 8 }}>{item.titulo}</div>
          <div style={{ fontSize: 14, color: colors.textMuted, marginTop: 4, lineHeight: 1.5 }}>{item.desc}</div>
        </div>

        {/* Photo */}
        <input ref={fotoRef} type="file" accept="image/*" capture="environment" onChange={handleFoto} style={{ display: 'none' }} />
        {fotoPreview ? (
          <div style={{ position: 'relative' }}>
            <img src={fotoPreview} alt="" style={{
              width: '100%', borderRadius: 16, maxHeight: 260, objectFit: 'cover', display: 'block',
              border: `1px solid ${colors.border}`,
            }} />
            <button
              onClick={abrirCamera}
              style={{
                position: 'absolute', bottom: 10, right: 10, background: 'rgba(15,23,42,0.65)',
                color: '#fff', border: 'none', borderRadius: 10, padding: '7px 12px',
                fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              <Camera size={14} /> Refazer
            </button>
          </div>
        ) : (
          <button
            onClick={abrirCamera}
            style={{
              width: '100%', padding: '24px 16px', borderRadius: 16,
              border: `1px dashed ${colors.borderStrong}`, background: colors.surface,
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
            }}
          >
            <span style={{ width: 44, height: 44, borderRadius: 11, background: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Camera size={21} color="#fff" />
            </span>
            <span style={{ fontSize: 15, fontWeight: 500, color: colors.text }}>Tirar foto</span>
            {MOLDES[item.key] && (
              <span style={{ fontSize: 13, color: colors.primary }}>{MOLDES[item.key].dica}</span>
            )}
            <span style={{ fontSize: 12, color: colors.textSubtle }}>Obrigatório</span>
          </button>
        )}

        {/* Camera viewfinder with guide overlay */}
        {cameraAberta && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9999, background: '#000',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <video
                ref={videoRef}
                playsInline muted autoPlay
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {MOLDES[item.key] && (
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    pointerEvents: 'none',
                  }}
                  dangerouslySetInnerHTML={{ __html: MOLDES[item.key].svg }}
                />
              )}
              {MOLDES[item.key] && (
                <div style={{
                  position: 'absolute', bottom: 90, left: 0, right: 0,
                  textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: 500,
                  textShadow: '0 1px 6px rgba(0,0,0,0.8)',
                }}>
                  {MOLDES[item.key].dica}
                </div>
              )}
            </div>
            <div style={{
              padding: '16px 20px', background: 'rgba(0,0,0,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <button onClick={fecharCamera} style={{
                background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 12, padding: '10px 18px', color: '#fff', fontSize: 15, fontWeight: 500,
                cursor: 'pointer',
              }}>
                Cancelar
              </button>
              <button onClick={capturarFoto} style={{
                width: 68, height: 68, borderRadius: '50%',
                background: '#fff', border: '4px solid rgba(255,255,255,0.4)',
                cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
              }} />
              <div style={{ width: 80 }} />
            </div>
          </div>
        )}

        {/* Resposta */}
        <div>
          <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 6 }}>Estado</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { val: 'ok', label: 'OK', icon: <Check size={18} />, bg: colors.successBg, color: colors.success, border: colors.successBorder || '#BBF7D0' },
              { val: 'problema', label: 'Problema', icon: <AlertCircle size={18} />, bg: colors.dangerBg, color: colors.danger, border: colors.dangerBorder || '#FECACA' },
            ].map(r => (
              <button
                key={r.val}
                onClick={() => setResposta(r.val)}
                style={{
                  flex: 1, height: 50, padding: '0 14px', borderRadius: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  border: `1px solid ${resposta === r.val ? r.color : colors.border}`,
                  background: resposta === r.val ? r.color : colors.surface,
                  fontSize: 15, fontWeight: 500, color: resposta === r.val ? '#fff' : colors.textMuted,
                }}
              >
                {r.icon} {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Observacao */}
        <div>
          <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 6 }}>
            Observação {resposta === 'problema' ? '' : '(opcional)'}
          </div>
          <textarea
            value={obs}
            onChange={e => setObs(e.target.value)}
            placeholder="Descreva o estado ou problema encontrado..."
            rows={3}
            onFocus={e => { e.currentTarget.style.borderColor = '#38BDF8' }}
            onBlur={e => { e.currentTarget.style.borderColor = colors.border }}
            style={{
              width: '100%', padding: '11px 14px', borderRadius: 12, border: `1px solid ${colors.border}`,
              background: colors.surface, fontSize: 15, color: colors.text, resize: 'none', outline: 'none',
              fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.5,
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 0', borderTop: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <button
          onClick={salvarItem}
          disabled={!podeAvancar || saving}
          style={{
            width: '100%', height: 48, padding: '0 20px', borderRadius: 12,
            background: podeAvancar ? colors.primary : colors.accentBg,
            color: podeAvancar ? '#fff' : colors.textSubtle,
            border: podeAvancar ? 'none' : `1px solid ${colors.border}`, fontSize: 15.5, fontWeight: 500, cursor: podeAvancar ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? (
            <><div className="spinner" style={{ width: 16, height: 16 }} /> Salvando...</>
          ) : step < items.length - 1 ? (
            <>Próximo <ChevronRight size={18} /></>
          ) : (
            <>Ver resumo <Check size={18} /></>
          )}
        </button>
      </div>
    </div>
  )
}
