'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase } from '@/lib/supabase'
import { colors, shadow } from '@/lib/ui'
import {
  Camera, ChevronRight, ChevronLeft, Check, AlertCircle,
  Share2, Download, X, Car, Shield, Clock, History,
} from 'lucide-react'
import Link from 'next/link'
import { PageSpinner } from '@/components/ui'

interface CheckItem {
  key: string; cat: string; titulo: string; desc: string
}
interface HistoricoItem {
  id: string; status: string; mes_referencia: string | null; share_token: string | null
  score_confianca: number | null; titulo: string | null; km: number | null
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

const TIMEOUT_MS = 15000

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) },
    )
  })
}

async function obterLocalizacao(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null
  try {
    const pos = await withTimeout(
      new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, maximumAge: 60000 }),
      ),
      7000,
    )
    return { lat: pos.coords.latitude, lng: pos.coords.longitude }
  } catch {
    return null
  }
}

const LIMITE_UPLOAD = 3.5 * 1024 * 1024

/** Reduz para JPEG ~1920px só quando a foto passa do limite seguro de upload. */
async function reduzirFotoGrande(file: File): Promise<File> {
  if (file.size <= LIMITE_UPLOAD || !file.type.startsWith('image/')) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    const escala = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85))
    return blob ? new File([blob], `checklist-${Date.now()}.jpg`, { type: 'image/jpeg' }) : file
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function lerJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const j = await res.json()
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

export default function ChecklistVeiculoPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const [veiculo, setVeiculo] = useState<{ placa: string } | null>(null)
  const [checklistId, setChecklistId] = useState<string | null>(null)
  const [items, setItems] = useState<CheckItem[]>([])
  const [savedItems, setSavedItems] = useState<Map<string, SavedItem>>(new Map())
  const [step, setStep] = useState(-1) // -1 = intro, 0..N = items, N+1 = resumo
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resultado, setResultado] = useState<{ status: string; score: number; alertas: string[]; duracao: number; shareToken?: string; titulo?: string } | null>(null)

  const [km, setKm] = useState('')
  const [historico, setHistorico] = useState<HistoricoItem[]>([])
  const [erroCarga, setErroCarga] = useState('')
  const [tentativa, setTentativa] = useState(0)
  // Trava síncrona contra toque duplo (o `disabled` só vale após o re-render)
  const enviandoRef = useRef(false)

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

  // Revoga object URLs de prévia ao trocar/desmontar (evita vazar memória com 20 fotos)
  useEffect(() => {
    if (!fotoPreview || !fotoPreview.startsWith('blob:')) return
    return () => URL.revokeObjectURL(fotoPreview)
  }, [fotoPreview])

  // Desliga a câmera se o usuário sair da página com o visor aberto
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  // Conecta o stream ao <video> depois que o visor é renderizado
  useEffect(() => {
    if (!cameraAberta) return
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) return
    video.srcObject = stream
    video.play().catch(() => { /* autoplay bloqueado: o atributo autoPlay tenta de novo */ })
  }, [cameraAberta])

  // Load vehicle + existing checklist + history
  useEffect(() => {
    if (!nome) {
      // Perfil carregado mas sem nome: não deixar a tela presa no spinner
      if (!userLoading) setLoading(false)
      return
    }
    let cancelado = false
    const cacheKey = `nt-checklist-veiculo:${nome}`
    ;(async () => {
      try {
        try {
          const { data: v, error } = await withTimeout(
            Promise.resolve(supabase
              .from('tecnico_veiculos')
              .select('placa')
              .eq('tecnico_nome', nome)
              .maybeSingle()),
          )
          if (error) throw error
          if (cancelado) return
          setVeiculo(v && v.placa ? v : null)
          try {
            if (v && v.placa) localStorage.setItem(cacheKey, JSON.stringify(v))
            else localStorage.removeItem(cacheKey)
          } catch { /* storage indisponível */ }
        } catch {
          // Sem sinal: usa o último veículo conhecido em vez de dizer "sem veículo"
          if (cancelado) return
          let cache: { placa: string } | null = null
          try { cache = JSON.parse(localStorage.getItem(cacheKey) || 'null') } catch { /* ignore */ }
          if (cache?.placa) setVeiculo(cache)
          else setErroCarga('Sem conexão. Não foi possível carregar o seu veículo. Tente novamente quando tiver sinal.')
        }

        // Carregar histórico
        try {
          const res = await withTimeout(fetch('/api/checklist-veiculo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'listar', tecnico_nome: nome }),
          }))
          if (res.ok) {
            const lista = await res.json()
            if (!cancelado && Array.isArray(lista)) setHistorico(lista)
          }
        } catch { /* histórico é opcional */ }
      } finally {
        if (!cancelado) setLoading(false)
      }
    })()
    return () => { cancelado = true }
  }, [nome, userLoading, tentativa])

  const iniciar = useCallback(async () => {
    if (!veiculo || !nome || enviandoRef.current) return
    enviandoRef.current = true
    setLoading(true)
    try {
      const loc = await obterLocalizacao()

      const res = await withTimeout(fetch('/api/checklist-veiculo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'iniciar', tecnico_nome: nome, placa: veiculo.placa, loc, km: km || null }),
      }))
      const data = await lerJson(res)
      const lista = Array.isArray(data.items) ? (data.items as CheckItem[]) : []
      if (!res.ok || !data.id || lista.length === 0) {
        alert(typeof data.error === 'string' && res.status < 500
          ? data.error
          : 'Não foi possível iniciar o checklist. Tente novamente.')
        return
      }
      setChecklistId(String(data.id))
      setItems(lista)
      const map = new Map<string, SavedItem>()
      for (const it of (Array.isArray(data.itens) ? data.itens : []) as SavedItem[]) map.set(it.item_key, it)
      setSavedItems(map)
      // Resume from first unanswered item
      const firstUnanswered = lista.findIndex(i => !map.has(i.key))
      setStep(firstUnanswered >= 0 ? firstUnanswered : lista.length)
    } catch {
      alert('Sem conexão para iniciar o checklist. Verifique sua internet e tente novamente.')
    } finally {
      enviandoRef.current = false
      setLoading(false)
    }
  }, [nome, veiculo, km])

  const salvarItem = useCallback(async () => {
    if (!checklistId || step < 0 || step >= items.length) return
    const item = items[step]
    if (!foto && !savedItems.get(item.key)?.foto_url) return
    if (!resposta) return
    if (enviandoRef.current) return
    enviandoRef.current = true
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
      // Upload em sinal fraco pode demorar; sem limite o botão ficaria "Salvando..." para sempre
      const res = await withTimeout(fetch('/api/checklist-veiculo', { method: 'POST', body: fd }), 90000)
      const json = await lerJson(res)

      if (!res.ok) {
        alert(res.status === 413
          ? 'A foto é muito grande para enviar. Tire a foto novamente.'
          : 'Não foi possível salvar este item. Verifique sua internet e tente novamente.')
        return
      }

      setSavedItems(prev => {
        const next = new Map(prev)
        next.set(item.key, {
          item_key: item.key, resposta, observacao: obs,
          foto_url: (typeof json.foto_url === 'string' ? json.foto_url : null) || prev.get(item.key)?.foto_url || null,
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
    } catch {
      alert('Erro de conexão ao salvar. Verifique sua internet e tente novamente.')
    } finally {
      enviandoRef.current = false
      setSaving(false)
    }
  }, [checklistId, step, items, foto, resposta, obs, savedItems])

  const concluir = useCallback(async () => {
    if (!checklistId || enviandoRef.current) return
    enviandoRef.current = true
    setSaving(true)
    try {
      const loc = await obterLocalizacao()

      const res = await withTimeout(fetch('/api/checklist-veiculo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'concluir', checklist_id: checklistId, loc }),
      }))
      const data = await lerJson(res)

      if (!res.ok) {
        alert(typeof data.error === 'string' && res.status < 500
          ? data.error
          : 'Não foi possível concluir o checklist. Tente novamente.')
        return
      }

      // Get share token (opcional — sem ele só não aparece o botão de compartilhar)
      let shareToken: string | undefined
      try {
        const { data: cl } = await withTimeout(Promise.resolve(supabase
          .from('veiculo_checklist')
          .select('share_token')
          .eq('id', checklistId)
          .maybeSingle()), 8000)
        shareToken = cl?.share_token || undefined
      } catch { /* ignore */ }

      setResultado({
        status: typeof data.status === 'string' ? data.status : 'completo',
        score: typeof data.score === 'number' ? data.score : 0,
        alertas: Array.isArray(data.alertas) ? (data.alertas as string[]) : [],
        duracao: typeof data.duracao === 'number' ? data.duracao : 0,
        titulo: typeof data.titulo === 'string' ? data.titulo : undefined,
        shareToken,
      })
    } catch {
      alert('Erro de conexão. Verifique sua internet e tente novamente.')
    } finally {
      enviandoRef.current = false
      setSaving(false)
    }
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

  const handleFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // Foto da câmera nativa pode passar de 4 MB e ser recusada no upload (limite do servidor)
    const final = await reduzirFotoGrande(file)
    setFoto(final)
    setFotoPreview(URL.createObjectURL(final))
  }

  const abrirCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('sem getUserMedia')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = stream
      setCameraAberta(true) // o stream é ligado ao <video> no efeito de `cameraAberta`
    } catch {
      fotoRef.current?.click()
    }
  }

  const fecharCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCameraAberta(false)
  }

  const capturarFoto = () => {
    const video = videoRef.current
    if (!video) return
    // Câmera ainda iniciando: sem dimensões o toBlob devolve null e nada acontece
    if (!video.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], `checklist-${Date.now()}.jpg`, { type: 'image/jpeg' })
      setFoto(file)
      setFotoPreview(URL.createObjectURL(file))
      fecharCamera()
    }, 'image/jpeg', 0.85)
  }

  const compartilhar = () => {
    if (!resultado?.shareToken) {
      alert('Link de compartilhamento indisponível no momento. Tente pelo histórico mais tarde.')
      return
    }
    const url = `${window.location.origin}/checklist-veiculo/ver?token=${resultado.shareToken}`
    if (navigator.share) {
      // Cancelar o menu de compartilhar rejeita a promise (AbortError)
      navigator.share({ title: 'Checklist do Veículo', url }).catch(() => {})
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => alert('Link copiado!'))
        .catch(() => window.prompt('Copie o link:', url))
    } else {
      window.prompt('Copie o link:', url)
    }
  }

  if (loading) return <PageSpinner />

  if (!veiculo) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Car size={48} color={colors.textMuted} style={{ margin: '40px auto 16px' }} />
        <div style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>
          {erroCarga ? 'Sem conexão' : 'Sem veículo atribuído'}
        </div>
        <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 6 }}>
          {erroCarga || 'Você precisa ter um veículo atribuído para realizar o checklist'}
        </div>
        {erroCarga && (
          <button
            type="button"
            onClick={() => { setErroCarga(''); setLoading(true); setTentativa(t => t + 1) }}
            style={{
              display: 'inline-block', marginTop: 20, marginRight: 8, padding: '10px 20px', borderRadius: 12,
              background: colors.surface, color: colors.text, border: `1px solid ${colors.borderStrong}`,
              fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Tentar novamente</button>
        )}
        <Link href="/" style={{
          display: 'inline-block', marginTop: 20, padding: '10px 20px', borderRadius: 12,
          background: colors.primary, color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 600,
        }}>Voltar</Link>
      </div>
    )
  }

  // Resultado final
  if (resultado) {
    const scoreColor = resultado.score >= 70 ? colors.success : resultado.score >= 50 ? colors.warning : colors.danger
    const scoreLabel = resultado.score >= 70 ? 'Confiável' : resultado.score >= 50 ? 'Atenção' : 'Suspeito'
    return (
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', margin: '0 auto 16px',
            background: scoreColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {resultado.score >= 70 ? <Check size={40} color="#fff" /> : <AlertCircle size={40} color="#fff" />}
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: colors.text }}>Checklist {resultado.status === 'completo' ? 'Concluído' : 'Enviado'}</div>
          {resultado.titulo && (
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginTop: 6 }}>{resultado.titulo}</div>
          )}
          <div style={{ fontSize: 14, color: colors.textMuted, marginTop: 4 }}>
            {Math.floor(resultado.duracao / 60)}min {resultado.duracao % 60}s de duração
          </div>
        </div>

        <div style={{
          background: colors.surfaceAlt, borderRadius: 16, padding: 20,
          border: `1px solid ${colors.border}`, textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, marginBottom: 8 }}>ÍNDICE DE CONFIANÇA</div>
          <div style={{ fontSize: 48, fontWeight: 800, color: scoreColor }}>{resultado.score}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: scoreColor }}>{scoreLabel}</div>
        </div>

        {resultado.alertas.length > 0 && (
          <div style={{
            background: colors.warningBg, borderRadius: 12, padding: 14,
            border: `1px solid ${colors.warningBorder}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.warning, marginBottom: 6 }}>Observações da análise</div>
            {resultado.alertas.map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: colors.text, padding: '3px 0' }}>• {a}</div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={compartilhar} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 14, border: `1px solid ${colors.border}`,
            background: colors.surface, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: colors.text,
          }}>
            <Share2 size={16} /> Compartilhar
          </button>
          <Link href="/" style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 14, background: colors.primary,
            color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 600,
          }}>
            <Check size={16} /> Voltar
          </Link>
        </div>
      </div>
    )
  }

  // Intro screen
  if (step === -1) {
    const partes = (veiculo.placa || '').split(' - ')
    const modelo = partes.length > 1 ? partes.slice(0, -1).join(' - ') : ''
    const placaNum = partes[partes.length - 1]
    const hoje = new Date()
    const mesLabel = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    return (
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Link href="/" style={{ color: colors.textMuted, textDecoration: 'none', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, minHeight: 40, alignSelf: 'flex-start' }}>
          <ChevronLeft size={16} /> Voltar
        </Link>

        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', margin: '0 auto 16px',
            background: colors.primaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield size={36} color={colors.primary} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: colors.text }}>Checklist do Veículo</div>
          <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 4, textTransform: 'capitalize' }}>{mesLabel}</div>
        </div>

        <div style={{
          background: colors.surfaceAlt, borderRadius: 16, padding: 16,
          border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Car size={24} color={colors.primary} style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, overflowWrap: 'anywhere' }}>{modelo || veiculo.placa}</div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>{placaNum}</div>
          </div>
        </div>

        {/* KM input */}
        <div style={{
          background: colors.surfaceAlt, borderRadius: 16, padding: 16,
          border: `1px solid ${colors.border}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 8 }}>Quilometragem atual:</div>
          <input
            type="number"
            inputMode="numeric"
            value={km}
            onChange={e => setKm(e.target.value)}
            placeholder="Ex: 45230"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              border: `1px solid ${colors.border}`, background: colors.surface,
              fontSize: 16, fontWeight: 600, color: colors.text,
              fontFamily: 'inherit',
            }}
          />
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
            Informe o KM do hodômetro
          </div>
        </div>

        <div style={{
          background: colors.surfaceAlt, borderRadius: 16, padding: 16,
          border: `1px solid ${colors.border}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 8 }}>Como funciona:</div>
          <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.8 }}>
            • São 20 itens para inspecionar{'\n'}
            • Cada item exige uma foto{'\n'}
            • Marque como OK ou Problema{'\n'}
            • Adicione observações quando necessário{'\n'}
            • Tempo estimado: 15-20 minutos
          </div>
        </div>

        <button type="button" onClick={iniciar} disabled={loading || !km} style={{
          width: '100%', padding: '14px 20px', borderRadius: 14,
          background: km ? colors.primary : colors.border, color: km ? '#fff' : colors.textMuted, border: 'none',
          fontSize: 16, fontWeight: 700, cursor: km ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Camera size={20} /> Iniciar Checklist
        </button>

        {/* Histórico de checklists anteriores */}
        {historico.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <History size={16} color={colors.textSubtle} />
              <span style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>Anteriores</span>
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
                      borderRadius: 12, border: `1px solid ${colors.border}`,
                      background: colors.surface, textDecoration: 'none',
                    }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: sColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{h.score_confianca ?? '—'}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {h.titulo || `Checklist de ${mesNome}`}
                      </div>
                      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                        {mesNome}{h.km ? ` · ${Number(h.km).toLocaleString('pt-BR')} km` : ''}
                      </div>
                    </div>
                    <ChevronRight size={16} color={colors.textSubtle} />
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
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>Resumo</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[
            { label: 'Respondidos', value: respondidos, color: colors.success },
            { label: 'Problemas', value: problemas, color: colors.danger },
            { label: 'Faltam', value: faltam, color: colors.warning },
          ].map(s => (
            <div key={s.label} style={{
              background: colors.surfaceAlt, borderRadius: 12, padding: 14, textAlign: 'center',
              border: `1px solid ${colors.border}`,
            }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>{s.label}</div>
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
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', minHeight: 48,
                  borderRadius: 10, border: `1px solid ${colors.border}`,
                  background: saved ? colors.surface : colors.warningBg,
                  cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: saved
                    ? (saved.resposta === 'ok' ? colors.successBg : colors.dangerBg)
                    : colors.warningBg,
                }}>
                  {saved ? (
                    saved.resposta === 'ok'
                      ? <Check size={14} color={colors.success} />
                      : <AlertCircle size={14} color={colors.danger} />
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, color: colors.warning }}>{i + 1}</span>
                  )}
                </div>
                <span style={{ fontSize: 13, color: colors.text, flex: 1, minWidth: 0 }}>{item.titulo}</span>
                <ChevronRight size={14} color={colors.textSubtle} />
              </button>
            )
          })}
        </div>

        {faltam > 0 ? (
          <div style={{
            background: colors.warningBg, borderRadius: 12, padding: 12, textAlign: 'center',
            fontSize: 13, color: colors.warning, fontWeight: 600,
          }}>
            Faltam {faltam} {faltam === 1 ? 'item' : 'itens'} para concluir
          </div>
        ) : (
          <button type="button" onClick={concluir} disabled={saving} style={{
            width: '100%', padding: '14px 20px', borderRadius: 14,
            background: colors.success, color: '#fff', border: 'none',
            fontSize: 16, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: saving ? 0.6 : 1,
          }}>
            {saving ? (
              <><div className="spinner" style={{ width: 18, height: 18 }} /> Finalizando...</>
            ) : (
              <><Check size={20} /> Concluir Checklist</>
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
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <button type="button" disabled={saving} onClick={() => step > 0 ? setStep(step - 1) : setStep(-1)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px 0 0', minHeight: 44, display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 14, color: colors.textMuted,
          }}>
            <ChevronLeft size={16} /> {step > 0 ? 'Anterior' : 'Voltar'}
          </button>
          <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle }}>{step + 1} / {items.length}</span>
          <button type="button" disabled={saving} onClick={() => setStep(items.length)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 8px', minHeight: 44,
            fontSize: 14, color: colors.primary, fontWeight: 600,
          }}>
            Resumo
          </button>
        </div>
        {/* Progress bar */}
        <div style={{ height: 4, background: colors.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progresso}%`, background: colors.primary, borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
        {/* Category badge */}
        <div>
          <span style={{
            fontSize: 10, fontWeight: 700, color: colors.primary, background: colors.primaryBg,
            padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>{item.cat}</span>
        </div>

        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>{item.titulo}</div>
          <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 1.5 }}>{item.desc}</div>
        </div>

        {/* Photo */}
        <input ref={fotoRef} type="file" accept="image/*" capture="environment" onChange={handleFoto} style={{ display: 'none' }} />
        {fotoPreview ? (
          <div style={{ position: 'relative' }}>
            <img src={fotoPreview} alt={item.titulo} style={{
              width: '100%', borderRadius: 16, maxHeight: 260, objectFit: 'cover', display: 'block',
              border: `2px solid ${colors.border}`,
            }} />
            <button
              onClick={abrirCamera}
              style={{
                position: 'absolute', bottom: 10, right: 10, background: 'rgba(0,0,0,0.6)',
                color: '#fff', border: 'none', borderRadius: 10, padding: '0 14px', minHeight: 40,
                fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Camera size={14} /> Refazer
            </button>
          </div>
        ) : (
          <button
            onClick={abrirCamera}
            style={{
              width: '100%', padding: '28px 20px', borderRadius: 16,
              border: `2px dashed ${colors.border}`, background: colors.surfaceAlt,
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}
          >
            <Camera size={32} color={colors.textMuted} />
            <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Tirar foto</span>
            {MOLDES[item.key] && (
              <span style={{ fontSize: 11, color: colors.primary, fontWeight: 600 }}>{MOLDES[item.key].dica}</span>
            )}
            <span style={{ fontSize: 11, color: colors.textMuted }}>Obrigatório</span>
          </button>
        )}

        {/* Camera viewfinder with guide overlay */}
        {cameraAberta && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9999, background: '#000',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
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
                  textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: 700,
                  textShadow: '0 1px 6px rgba(0,0,0,0.8)',
                }}>
                  {MOLDES[item.key].dica}
                </div>
              )}
            </div>
            <div style={{
              padding: '16px 20px', background: 'rgba(0,0,0,0.85)',
              paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
              paddingLeft: 'calc(20px + env(safe-area-inset-left, 0px))',
              paddingRight: 'calc(20px + env(safe-area-inset-right, 0px))',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <button type="button" onClick={fecharCamera} style={{
                background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 12, padding: '10px 18px', color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: 'pointer',
              }}>
                Cancelar
              </button>
              <button type="button" onClick={capturarFoto} aria-label="Capturar foto" style={{
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
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, marginBottom: 8 }}>Estado:</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { val: 'ok', label: 'OK', icon: <Check size={18} />, bg: colors.successBg, color: colors.success, border: colors.successBorder || '#BBF7D0' },
              { val: 'problema', label: 'Problema', icon: <AlertCircle size={18} />, bg: colors.dangerBg, color: colors.danger, border: colors.dangerBorder || '#FECACA' },
            ].map(r => (
              <button
                key={r.val}
                onClick={() => setResposta(r.val)}
                style={{
                  flex: 1, padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  border: resposta === r.val ? `2px solid ${r.color}` : `1px solid ${colors.border}`,
                  background: resposta === r.val ? r.bg : colors.surface,
                  fontSize: 14, fontWeight: 600, color: resposta === r.val ? r.color : colors.textMuted,
                }}
              >
                {r.icon} {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Observacao */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSubtle, marginBottom: 8 }}>
            Observação {resposta === 'problema' ? '' : '(opcional)'}:
          </div>
          <textarea
            value={obs}
            onChange={e => setObs(e.target.value)}
            placeholder="Descreva o estado ou problema encontrado..."
            rows={3}
            style={{
              width: '100%', padding: 12, borderRadius: 12, border: `1px solid ${colors.border}`,
              background: colors.surfaceAlt, fontSize: 16, color: colors.text, resize: 'none',
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <button
          type="button"
          onClick={salvarItem}
          disabled={!podeAvancar || saving}
          style={{
            width: '100%', padding: '14px 20px', borderRadius: 14,
            background: podeAvancar ? colors.primary : colors.border,
            color: podeAvancar ? '#fff' : colors.textMuted,
            border: 'none', fontSize: 15, fontWeight: 700, cursor: podeAvancar ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? (
            <><div className="spinner" style={{ width: 16, height: 16 }} /> Salvando...</>
          ) : step < items.length - 1 ? (
            <>Próximo <ChevronRight size={18} /></>
          ) : (
            <>Ver Resumo <Check size={18} /></>
          )}
        </button>
      </div>
    </div>
  )
}
