'use client'
import { useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eraser, Camera, Image as ImageIcon, Pen, Maximize2, Check, X, RotateCcw } from 'lucide-react'

interface SignaturePadProps {
  label: string
  value: string
  onSave: (dataUrl: string) => void
  allowPhoto?: boolean
}

/** desenha a imagem inteira dentro de w×h mantendo a proporção (centralizada) */
function desenharContido(ctx: CanvasRenderingContext2D, img: HTMLImageElement | HTMLCanvasElement, w: number, h: number) {
  const iw = img instanceof HTMLImageElement ? img.naturalWidth : img.width
  const ih = img instanceof HTMLImageElement ? img.naturalHeight : img.height
  if (!iw || !ih) return
  const esc = Math.min(w / iw, h / ih)
  const dw = iw * esc, dh = ih * esc
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

export default function SignaturePad({ label, value, onSave, allowPhoto }: SignaturePadProps) {
  const fsCanvasRef = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [mode, setMode] = useState<'signature' | 'photo'>(value && !value.startsWith('data:image/png') ? 'photo' : 'signature')
  const [photoPreview, setPhotoPreview] = useState(value && !value.startsWith('data:image/png') ? value : '')

  const temAssinatura = !!value && value.startsWith('data:image/png')

  // valor que chega depois (rascunho restaurado, relatório do banco): mostra no modo certo
  useEffect(() => {
    if (!value) return
    if (value.startsWith('data:image/png')) { setMode('signature'); return }
    setMode('photo'); setPhotoPreview(value)
  }, [value])

  // Configura o canvas de tela cheia quando abre — e de novo ao girar o celular, sem distorcer o que já foi
  // desenhado (José, 23/10/2026: ao virar, o canvas mudava de tamanho e a assinatura esticava/sumia).
  const hasDrawnRef = useRef(false)
  hasDrawnRef.current = hasDrawn
  useEffect(() => {
    if (!fullscreen) return
    const canvas = fsCanvasRef.current
    if (!canvas) return

    const configurar = (desenho?: HTMLImageElement | HTMLCanvasElement | null) => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      canvas.width = Math.round(rect.width * 2)
      canvas.height = Math.round(rect.height * 2)
      ctx.setTransform(2, 0, 0, 2, 0, 0)
      ctx.strokeStyle = '#111827'
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (desenho) desenharContido(ctx, desenho, rect.width, rect.height)
    }

    configurar()
    setHasDrawn(false)

    // Carrega assinatura existente para poder continuar/ajustar
    if (temAssinatura) {
      const img = new Image()
      img.onload = () => {
        configurar(img)
        setHasDrawn(true)
      }
      img.src = value
    }

    let ultimo = { w: canvas.clientWidth, h: canvas.clientHeight }
    let timer: ReturnType<typeof setTimeout> | undefined
    const aoGirar = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (canvas.clientWidth === ultimo.w && canvas.clientHeight === ultimo.h) return
        ultimo = { w: canvas.clientWidth, h: canvas.clientHeight }
        if (!hasDrawnRef.current) { configurar(); return }
        // copia o desenho atual antes de redimensionar e redesenha proporcional
        const copia = document.createElement('canvas')
        copia.width = canvas.width; copia.height = canvas.height
        copia.getContext('2d')?.drawImage(canvas, 0, 0)
        configurar(copia)
      }, 150)
    }
    window.addEventListener('resize', aoGirar)
    window.addEventListener('orientationchange', aoGirar)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('resize', aoGirar)
      window.removeEventListener('orientationchange', aoGirar)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen])

  const getPos = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = fsCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    setDrawing(true)
    const ctx = fsCanvasRef.current?.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!drawing) return
    e.preventDefault()
    const ctx = fsCanvasRef.current?.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasDrawn(true)
  }

  const endDraw = () => setDrawing(false)

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
    limpouRef.current = true
  }

  // Concluir sem desenho (ou com a assinatura antiga ainda carregando) fecha SEM apagar a que já existe;
  // só apaga se o técnico tocou em limpar aqui dentro (José, 23/10/2026)
  const limpouRef = useRef(false)
  useEffect(() => { if (fullscreen) limpouRef.current = false }, [fullscreen])
  const concluir = () => {
    const canvas = fsCanvasRef.current
    if (canvas && hasDrawn) onSave(canvas.toDataURL('image/png'))
    else if (limpouRef.current) onSave('')
    setFullscreen(false)
  }

  const limparTudo = () => {
    if (mode === 'photo') {
      setPhotoPreview('')
      onSave('')
      return
    }
    onSave('')
    setHasDrawn(false)
  }

  const handlePhoto = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setPhotoPreview(dataUrl)
      onSave(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
        flexWrap: 'wrap', gap: 6,
      }}>
        <span style={{ fontSize: 15, fontWeight: 500, color: '#0F172A', minWidth: 0 }}>{label}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {allowPhoto && (
            <div style={{ display: 'flex', gap: 2, background: '#EEF2F6', borderRadius: 10, padding: 3 }}>
              <button type="button" onClick={() => { if (mode === 'signature') return; limparTudo(); setMode('signature') }}
                style={{
                  padding: '6px 10px', borderRadius: 8, fontSize: 13, fontWeight: mode === 'signature' ? 500 : 400, border: 'none', cursor: 'pointer',
                  background: mode === 'signature' ? '#fff' : 'transparent',
                  color: mode === 'signature' ? '#0F172A' : '#64748B',
                  boxShadow: mode === 'signature' ? '0 1px 3px rgba(15,23,42,0.1)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                <Pen size={13} /> Assinar
              </button>
              <button type="button" onClick={() => { if (mode === 'photo') return; limparTudo(); setMode('photo') }}
                style={{
                  padding: '6px 10px', borderRadius: 8, fontSize: 13, fontWeight: mode === 'photo' ? 500 : 400, border: 'none', cursor: 'pointer',
                  background: mode === 'photo' ? '#fff' : 'transparent',
                  color: mode === 'photo' ? '#0F172A' : '#64748B',
                  boxShadow: mode === 'photo' ? '0 1px 3px rgba(15,23,42,0.1)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                <Camera size={13} /> Foto
              </button>
            </div>
          )}
          {(mode === 'photo' ? !!photoPreview : temAssinatura) && (
            <button
              type="button"
              onClick={limparTudo}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 14, color: '#DC2626', background: 'none',
                border: 'none', cursor: 'pointer', fontWeight: 400, padding: '6px 2px',
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
            border: temAssinatura ? '1px solid #E2E8F0' : '1.5px dashed #CBD5E1',
            background: '#fff', cursor: 'pointer', position: 'relative', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {temAssinatura ? (
            <>
              <img src={value} alt={label} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              <span style={{
                position: 'absolute', top: 8, right: 8, background: 'rgba(15,23,42,0.75)', color: '#fff',
                borderRadius: 8, padding: '4px 9px', fontSize: 12, fontWeight: 400,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Maximize2 size={11} /> Refazer
              </span>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#0369A1' }}>
              <Maximize2 size={24} />
              <span style={{ fontSize: 14, fontWeight: 400 }}>Toque para assinar em tela cheia</span>
            </div>
          )}
        </button>
      ) : (
        photoPreview ? (
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
            <img src={photoPreview} alt={label} style={{ width: '100%', height: 150, objectFit: 'contain', background: '#fff' }} />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, height: 150 }}>
            <label style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 6, borderRadius: 12, cursor: 'pointer', minWidth: 0,
              border: '1.5px dashed #BAE6FD', background: '#E0F2FE',
            }}>
              <Camera size={28} color="#0369A1" />
              <span style={{ fontSize: 13, color: '#0369A1' }}>Tirar foto</span>
              <input type="file" accept="image/*" capture="environment"
                onChange={(e) => { if (e.target.files?.[0]) handlePhoto(e.target.files[0]) }}
                style={{ display: 'none' }} />
            </label>
            <label style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 6, borderRadius: 12, cursor: 'pointer', minWidth: 0,
              border: '1.5px dashed #CBD5E1', background: '#FFFFFF',
            }}>
              <ImageIcon size={28} color="#475569" />
              <span style={{ fontSize: 13, color: '#475569' }}>Galeria</span>
              <input type="file" accept="image/*"
                onChange={(e) => { if (e.target.files?.[0]) handlePhoto(e.target.files[0]) }}
                style={{ display: 'none' }} />
            </label>
          </div>
        )
      )}

      {/* ═══ Tela cheia de assinatura ═══ */}
      {fullscreen && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000, background: '#EEF2F6',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 'calc(12px + env(safe-area-inset-top, 0px)) 16px 12px', background: '#FEFEFE', borderBottom: '1px solid #E2E8F0', flexShrink: 0, gap: 8,
          }}>
            <button type="button" onClick={() => setFullscreen(false)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
              color: '#475569', fontSize: 15, fontWeight: 400, cursor: 'pointer', padding: 6,
            }}>
              <X size={20} /> Cancelar
            </button>
            <span style={{ fontSize: 15, fontWeight: 500, color: '#0F172A', textAlign: 'center', minWidth: 0 }}>{label}</span>
            <button type="button" onClick={limparCanvas} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
              color: '#DC2626', fontSize: 15, fontWeight: 400, cursor: 'pointer', padding: 6,
            }}>
              <RotateCcw size={18} /> Limpar
            </button>
          </div>

          {/* Area de assinatura */}
          <div style={{ flex: 1, position: 'relative', padding: 16 }}>
            <canvas
              ref={fsCanvasRef}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
              style={{
                width: '100%', height: '100%', borderRadius: 16,
                border: '1px solid #E2E8F0', background: '#fff',
                touchAction: 'none', cursor: 'crosshair', display: 'block',
              }}
            />
            {!hasDrawn && (
              <div style={{
                position: 'absolute', inset: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none', color: '#CBD5E1', flexDirection: 'column', gap: 10,
              }}>
                <Pen size={34} />
                <span style={{ fontSize: 16, fontWeight: 400, color: '#94A3B8' }}>Assine aqui</span>
                <span style={{ fontSize: 13, color: '#94A3B8' }}>Vire o celular para mais espaço</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 16px calc(16px + env(safe-area-inset-bottom, 0px))', background: '#FEFEFE', borderTop: '1px solid #E2E8F0', flexShrink: 0 }}>
            <button type="button" onClick={concluir} style={{
              width: '100%', minHeight: 50, padding: '0 14px', borderRadius: 12, border: 'none',
              background: hasDrawn ? '#0369A1' : '#94A3B8', color: '#fff',
              fontSize: 16, fontWeight: 500, cursor: 'pointer',
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
