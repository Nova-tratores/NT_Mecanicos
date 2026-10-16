'use client'
import { Camera, Image as ImageIcon, X } from 'lucide-react'
import { useRef } from 'react'

interface FotoUploadProps {
  label: string
  value: string
  onChange: (file: File) => void
  onRemove: () => void
  obrigatorio?: boolean
}

export default function FotoUpload({ label, value, onChange, onRemove, obrigatorio }: FotoUploadProps) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Limpa o input para que escolher o mesmo arquivo de novo (após remover) dispare onChange
    e.target.value = ''
    if (file) onChange(file)
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label} {obrigatorio && <span style={{ color: '#C41E2A' }}>*</span>}
      </div>
      {value ? (
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
          <img src={value} alt={label} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 12, display: 'block' }} />
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remover foto ${label}`}
            style={{
              position: 'absolute', top: 2, right: 2,
              width: 40, height: 40, borderRadius: '50%',
              background: 'transparent', border: 'none',
              color: '#fff', cursor: 'pointer', padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span style={{
              width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <X size={14} />
            </span>
          </button>
        </div>
      ) : (
        <div style={{
          display: 'flex', gap: 8, height: 100,
        }}>
          <label style={{
            flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 4, borderRadius: 12, cursor: 'pointer',
            border: '2px dashed #D1D5DB', background: '#FAFAFA',
          }}>
            <Camera size={22} color="#9CA3AF" />
            <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>Tirar foto</span>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleChange}
              style={{ display: 'none' }}
            />
          </label>
          <label style={{
            flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 4, borderRadius: 12, cursor: 'pointer',
            border: '2px dashed #D1D5DB', background: '#FAFAFA',
          }}>
            <ImageIcon size={22} color="#9CA3AF" />
            <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>Galeria</span>
            <input
              ref={galeriaRef}
              type="file"
              accept="image/*"
              onChange={handleChange}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      )}
    </div>
  )
}
