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

export default function SignaturePad({ label, value, onSave, allowPhoto }: SignaturePadProps) {
  const fsCanvasRef = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [mode, setMode] = useState<'signature' | 'photo'>(value && !value.startsWith('data:image/png') ? 'photo' : 'signature')
  const [photoPreview, setPhotoPreview] = useState(value && !value.startsWith('data:image/png') ? value : '')

  const temAssinatura = !!value && value.startsWith('data:image/png')

  // Configura o canvas de tela cheia quando abre
  useEffect(() => {
    if (!fullscreen) return
    const canvas = fsCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * 2
    canvas.height = rect.height * 2
    ctx.scale(2, 2)
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    setHasDrawn(false)

    // Carrega assinatura existente para poder continuar/ajustar
    if (temAssinatura) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height)
        setHasDrawn(true)
      }
      img.src = value
    }
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
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    setHasDrawn(false)
  }

  const concluir = () => {
    const canvas = fsCanvasRef.current
    if (!canvas) { setFullscreen(false); return }
    onSave(hasDrawn ? canvas.toDataURL('image/png') : '')
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
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>{label}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {allowPhoto && (
            <div style={{ display: 'flex', gap: 4, background: '#F3F4F6', borderRadius: 8, padding: 2 }}>
              <button type="button" onClick={() => { limparTudo(); setMode('signature') }}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: mode === 'signature' ? '#fff' : 'transparent',
                  color: mode === 'signature' ? '#1F2937' : '#9CA3AF',
                  boxShadow: mode === 'signature' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                <Pen size={12} /> Assinar
              </button>
              <button type="button" onClick={() => { limparTudo(); setMode('photo') }}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: mode === 'photo' ? '#fff' : 'transparent',
                  color: mode === 'photo' ? '#1F2937' : '#9CA3AF',
                  boxShadow: mode === 'photo' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                <Camera size={12} /> Foto
              </button>
            </div>
          )}
          {(mode === 'photo' ? !!photoPreview : temAssinatura) && (
            <button
              type="button"
              onClick={limparTudo}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
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
            <img src={photoPreview} alt={label} style={{ width: '100%', height: 150, objectFit: 'contain', background: '#fff' }} />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, height: 150 }}>
            <label style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 6, borderRadius: 12, cursor: 'pointer',
              border: '2px dashed #D1D5DB', background: '#FAFAFA',
            }}>
              <Camera size={28} color="#9CA3AF" />
              <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Tirar foto</span>
              <input type="file" accept="image/*" capture="environment"
                onChange={(e) => { if (e.target.files?.[0]) handlePhoto(e.target.files[0]) }}
                style={{ display: 'none' }} />
            </label>
            <label style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 6, borderRadius: 12, cursor: 'pointer',
              border: '2px dashed #D1D5DB', background: '#FAFAFA',
            }}>
              <ImageIcon size={28} color="#9CA3AF" />
              <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Galeria</span>
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
          position: 'fixed', inset: 0, zIndex: 10000, background: '#F5F6F8',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', background: '#fff', borderBottom: '1px solid #F3F4F6', flexShrink: 0,
          }}>
            <button type="button" onClick={() => setFullscreen(false)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
              color: '#6B7280', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 4,
            }}>
              <X size={20} /> Cancelar
            </button>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#1F2937' }}>{label}</span>
            <button type="button" onClick={limparCanvas} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
              color: '#EF4444', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 4,
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
                border: '2px solid #E5E7EB', background: '#fff',
                touchAction: 'none', cursor: 'crosshair', display: 'block',
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
          <div style={{ padding: '12px 16px 24px', background: '#fff', borderTop: '1px solid #F3F4F6', flexShrink: 0 }}>
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
