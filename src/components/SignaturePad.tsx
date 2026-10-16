'use client'
import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Eraser, Camera, Image as ImageIcon, Pen, Maximize2, Check, X, RotateCcw } from 'lucide-react'

interface SignaturePadProps {
  label: string
  value: string
  onSave: (dataUrl: string) => void
  allowPhoto?: boolean
}

const STROKE = '#111827'
const FOTO_MAX_LADO = 1280
const FOTO_QUALIDADE = 0.8

/** Desenha `src` centralizado (contain) dentro de w x h, sem distorcer. */
function desenharContido(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource & { width: number; height: number },
  w: number, h: number,
) {
  const sw = src.width
  const sh = src.height
  if (!sw || !sh || !w || !h) return
  const escala = Math.min(w / sw, h / sh)
  const dw = sw * escala
  const dh = sh * escala
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

/**
 * Reduz a foto (câmera costuma gerar 3-8 MB) para JPEG ~1280px.
 * Um data URL gigante estoura a cota do localStorage e faz o backup
 * automático do formulário inteiro falhar silenciosamente.
 */
function comprimirFoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const escala = Math.min(1, FOTO_MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * escala))
        const h = Math.max(1, Math.round(img.naturalHeight * escala))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) throw new Error('canvas indisponível')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL('image/jpeg', FOTO_QUALIDADE))
      } catch (e) {
        reject(e)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('imagem inválida'))
    }
    img.src = url
  })
}

function lerComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function SignaturePad({ label, value, onSave, allowPhoto }: SignaturePadProps) {
  const fsCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const hasDrawnRef = useRef(false)
  const [hasDrawn, setHasDrawnState] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [modoEscolhido, setModoEscolhido] = useState<'signature' | 'photo'>('signature')
  const [processandoFoto, setProcessandoFoto] = useState(false)

  const temAssinatura = !!value && value.startsWith('data:image/png')
  // O modo é derivado do valor quando há um valor (ex.: restaurado do backup
  // depois da montagem); sem valor, vale a escolha do usuário.
  const mode: 'signature' | 'photo' = value ? (temAssinatura ? 'signature' : 'photo') : modoEscolhido
  const photoPreview = mode === 'photo' ? value : ''

  const setHasDrawn = useCallback((v: boolean) => {
    hasDrawnRef.current = v
    setHasDrawnState(v)
  }, [])

  /** Ajusta o buffer do canvas ao tamanho exibido x devicePixelRatio. */
  const configurarCanvas = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.strokeStyle = STROKE
    ctx.fillStyle = STROKE
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    return { ctx, w: rect.width, h: rect.height }
  }, [])

  // Configura o canvas de tela cheia quando abre
  useEffect(() => {
    if (!fullscreen) return
    const canvas = fsCanvasRef.current
    if (!canvas) return
    const cfg = configurarCanvas(canvas)
    if (!cfg) return
    setHasDrawn(false)

    let cancelado = false
    // Carrega assinatura existente para poder continuar/ajustar
    if (temAssinatura) {
      const img = new Image()
      img.onload = () => {
        if (cancelado || !fsCanvasRef.current) return
        const rect = fsCanvasRef.current.getBoundingClientRect()
        desenharContido(cfg.ctx, img, rect.width, rect.height)
        setHasDrawn(true)
      }
      img.src = value
    }

    // Girar o celular/redimensionar muda o tamanho do canvas: sem isso o
    // buffer é zerado (apaga a assinatura) e as coordenadas ficam distorcidas.
    let ultimo = { w: cfg.w, h: cfg.h }
    const onResize = () => {
      const c = fsCanvasRef.current
      if (!c) return
      const rect = c.getBoundingClientRect()
      if (Math.abs(rect.width - ultimo.w) < 1 && Math.abs(rect.height - ultimo.h) < 1) return
      ultimo = { w: rect.width, h: rect.height }
      let copia: HTMLCanvasElement | null = null
      if (hasDrawnRef.current && c.width > 0 && c.height > 0) {
        copia = document.createElement('canvas')
        copia.width = c.width
        copia.height = c.height
        copia.getContext('2d')?.drawImage(c, 0, 0)
      }
      const novo = configurarCanvas(c)
      if (novo && copia) desenharContido(novo.ctx, copia, novo.w, novo.h)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)

    // Evita que a página de trás role/“puxe para atualizar” enquanto assina
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      cancelado = true
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      document.body.style.overflow = overflowAnterior
    }
    // `value`/`temAssinatura` só importam no momento em que a tela abre
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, configurarCanvas, setHasDrawn])

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    drawingRef.current = true
    const pos = getPos(e)
    // Ponto inicial (um toque simples também marca)
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    if (!hasDrawnRef.current) setHasDrawn(true)
  }

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
  }

  const endDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  const limparCanvas = () => {
    const canvas = fsCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    setHasDrawn(false)
  }

  const concluir = () => {
    const canvas = fsCanvasRef.current
    if (!canvas) { setFullscreen(false); return }
    onSave(hasDrawnRef.current ? canvas.toDataURL('image/png') : '')
    setFullscreen(false)
  }

  const limparTudo = () => {
    // Mantém o modo atual (ex.: foto restaurada do backup) depois de limpar
    setModoEscolhido(mode)
    onSave('')
    setHasDrawn(false)
  }

  const trocarModo = (novo: 'signature' | 'photo') => {
    // Tocar no modo que já está ativo não deve apagar a assinatura/foto
    if (novo === mode) return
    if (value) onSave('')
    setModoEscolhido(novo)
  }

  const handlePhoto = async (file: File) => {
    setProcessandoFoto(true)
    try {
      let dataUrl: string
      try {
        dataUrl = await comprimirFoto(file)
      } catch {
        dataUrl = await lerComoDataUrl(file)
      }
      if (dataUrl) {
        setModoEscolhido('photo')
        onSave(dataUrl)
      }
    } catch {
      alert('Não foi possível ler a foto. Tente novamente.')
    } finally {
      setProcessandoFoto(false)
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Permite escolher o mesmo arquivo de novo depois de "Limpar"
    e.target.value = ''
    if (file) void handlePhoto(file)
  }

  const btnModo = (ativo: boolean): React.CSSProperties => ({
    minHeight: 36, padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
    background: ativo ? '#fff' : 'transparent',
    color: ativo ? '#1F2937' : '#6B7280',
    boxShadow: ativo ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
    display: 'flex', alignItems: 'center', gap: 4,
  })

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
        gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#374151', minWidth: 0 }}>{label}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          {allowPhoto && (
            <div style={{ display: 'flex', gap: 4, background: '#F3F4F6', borderRadius: 8, padding: 2 }}>
              <button type="button" onClick={() => trocarModo('signature')} aria-pressed={mode === 'signature'}
                style={btnModo(mode === 'signature')}>
                <Pen size={13} /> Assinar
              </button>
              <button type="button" onClick={() => trocarModo('photo')} aria-pressed={mode === 'photo'}
                style={btnModo(mode === 'photo')}>
                <Camera size={13} /> Foto
              </button>
            </div>
          )}
          {(mode === 'photo' ? !!photoPreview : temAssinatura) && (
            <button
              type="button"
              onClick={limparTudo}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, minHeight: 36, padding: '6px 8px',
                fontSize: 12, color: '#EF4444', background: 'none',
                border: 'none', cursor: 'pointer', fontWeight: 600,
              }}
            >
              <Eraser size={14} /> Limpar
            </button>
          )}
        </div>
      </div>

      {mode === 'signature' ? (
        // Preview que abre a tela cheia ao tocar
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          style={{
            width: '100%', height: 150, borderRadius: 12, padding: 0,
            border: temAssinatura ? '2px solid #E5E7EB' : '2px dashed #D1D5DB',
            background: '#fff', cursor: 'pointer', position: 'relative', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {temAssinatura ? (
            <>
              <img src={value} alt={label} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              <span style={{
                position: 'absolute', top: 8, right: 8, background: 'rgba(17,24,39,0.75)', color: '#fff',
                borderRadius: 8, padding: '4px 8px', fontSize: 10, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Maximize2 size={11} /> Refazer
              </span>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#9CA3AF' }}>
              <Maximize2 size={24} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Toque para assinar em tela cheia</span>
            </div>
          )}
        </button>
      ) : (
        photoPreview ? (
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '2px solid #E5E7EB' }}>
            <img src={photoPreview} alt={label} style={{ width: '100%', height: 150, objectFit: 'contain', background: '#fff', display: 'block' }} />
          </div>
        ) : processandoFoto ? (
          <div style={{
            height: 150, borderRadius: 12, border: '2px dashed #D1D5DB', background: '#FAFAFA',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontSize: 12, color: '#6B7280', fontWeight: 600,
          }}>
            <div className="spinner" style={{ width: 18, height: 18 }} /> Processando foto...
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, height: 150 }}>
            <label style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 6, borderRadius: 12, cursor: 'pointer',
              border: '2px dashed #D1D5DB', background: '#FAFAFA',
            }}>
              <Camera size={28} color="#9CA3AF" />
              <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>Tirar foto</span>
              <input type="file" accept="image/*" capture="environment"
                onChange={onFileChange}
                style={{ display: 'none' }} />
            </label>
            <label style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 6, borderRadius: 12, cursor: 'pointer',
              border: '2px dashed #D1D5DB', background: '#FAFAFA',
            }}>
              <ImageIcon size={28} color="#9CA3AF" />
              <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>Galeria</span>
              <input type="file" accept="image/*"
                onChange={onFileChange}
                style={{ display: 'none' }} />
            </label>
          </div>
        )
      )}

      {/* ═══ Tela cheia de assinatura ═══ */}
      {fullscreen && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: '#F5F6F8',
            display: 'flex', flexDirection: 'column',
            overscrollBehavior: 'contain',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            padding: '10px 12px',
            paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))',
            paddingLeft: 'calc(12px + env(safe-area-inset-left, 0px))',
            paddingRight: 'calc(12px + env(safe-area-inset-right, 0px))',
            background: '#fff', borderBottom: '1px solid #F3F4F6', flexShrink: 0,
          }}>
            <button type="button" onClick={() => setFullscreen(false)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
              color: '#6B7280', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              minHeight: 44, padding: '0 6px', flexShrink: 0,
            }}>
              <X size={20} /> Cancelar
            </button>
            <span style={{
              fontSize: 15, fontWeight: 600, color: '#1F2937', minWidth: 0, flex: 1, textAlign: 'center',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{label}</span>
            <button type="button" onClick={limparCanvas} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
              color: '#EF4444', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              minHeight: 44, padding: '0 6px', flexShrink: 0,
            }}>
              <RotateCcw size={18} /> Limpar
            </button>
          </div>

          {/* Area de assinatura */}
          <div style={{
            flex: 1, position: 'relative', padding: 16, minHeight: 0,
            paddingLeft: 'calc(16px + env(safe-area-inset-left, 0px))',
            paddingRight: 'calc(16px + env(safe-area-inset-right, 0px))',
          }}>
            <canvas
              ref={fsCanvasRef}
              onPointerDown={startDraw}
              onPointerMove={draw}
              onPointerUp={endDraw}
              onPointerCancel={endDraw}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                width: '100%', height: '100%', borderRadius: 16,
                border: '2px solid #E5E7EB', background: '#fff',
                touchAction: 'none', cursor: 'crosshair', display: 'block',
                userSelect: 'none', WebkitUserSelect: 'none',
              }}
            />
            {!hasDrawn && (
              <div style={{
                position: 'absolute', inset: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none', color: '#D1D5DB', flexDirection: 'column', gap: 10,
              }}>
                <Pen size={34} />
                <span style={{ fontSize: 15, fontWeight: 600 }}>Assine aqui</span>
                <span style={{ fontSize: 12, color: '#9CA3AF' }}>Vire o celular para mais espaço</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '12px 16px',
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
            paddingLeft: 'calc(16px + env(safe-area-inset-left, 0px))',
            paddingRight: 'calc(16px + env(safe-area-inset-right, 0px))',
            background: '#fff', borderTop: '1px solid #F3F4F6', flexShrink: 0,
          }}>
            <button type="button" onClick={concluir} style={{
              width: '100%', padding: '15px 0', borderRadius: 14, border: 'none',
              background: hasDrawn ? '#1E3A5F' : '#9CA3AF', color: '#fff',
              fontSize: 16, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <Check size={18} /> {hasDrawn ? 'Confirmar assinatura' : 'Concluir'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
