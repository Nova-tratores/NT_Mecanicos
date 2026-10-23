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

// A compressão fica com quem recebe o arquivo (o preencher já comprime; para os demais use lib/imagem).
// Zera o input depois de escolher: dá para tirar/escolher a mesma foto de novo depois de remover (23/10/2026).
// Estilo POS NewPortal (22/10/2026): rótulo 13px sem negrito, quadros com borda fina, azul do portal no "Tirar foto".
export default function FotoUpload({ label, value, onChange, onRemove, obrigatorio }: FotoUploadProps) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 400, color: '#475569', marginBottom: 6, overflowWrap: 'anywhere' }}>
        {label} {obrigatorio && <span style={{ color: '#DC2626' }}>*</span>}
      </div>
      {value ? (
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid #E2E8F0', background: '#EEF2F6' }}>
          <img src={value} alt={label} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remover foto"
            style={{
              position: 'absolute', top: 6, right: 6,
              width: 30, height: 30, borderRadius: '50%',
              background: 'rgba(15,23,42,0.7)', border: 'none',
              color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <div style={{
          display: 'flex', gap: 8, height: 104,
        }}>
          <label style={{
            flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 5, borderRadius: 12, cursor: 'pointer',
            border: '1.5px dashed #BAE6FD', background: '#E0F2FE',
          }}>
            <Camera size={22} color="#0369A1" />
            <span style={{ fontSize: 12.5, color: '#0369A1', textAlign: 'center' }}>Tirar foto</span>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onChange(f) }}
              style={{ display: 'none' }}
            />
          </label>
          <label style={{
            flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 5, borderRadius: 12, cursor: 'pointer',
            border: '1.5px dashed #CBD5E1', background: '#FFFFFF',
          }}>
            <ImageIcon size={22} color="#475569" />
            <span style={{ fontSize: 12.5, color: '#475569', textAlign: 'center' }}>Galeria</span>
            <input
              ref={galeriaRef}
              type="file"
              accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onChange(f) }}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      )}
    </div>
  )
}
