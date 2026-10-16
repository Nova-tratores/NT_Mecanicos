'use client'
import { useRef, useState } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { enviarAvatar } from '@/lib/tecnico-utils'
import { User, Mail, Phone, LogOut, Shield, Camera } from 'lucide-react'

export default function PerfilPage() {
  const { user, loading, logout, refresh } = useCurrentUser()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [avatarLocal, setAvatarLocal] = useState<string | null>(null)
  const [saindo, setSaindo] = useState(false)

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!user) return null

  const iniciais = (user.tecnico_nome || '?')
    .split(' ')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('')

  const handleFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Permite escolher a mesma foto de novo depois de um erro
    e.target.value = ''
    if (!file || !user || uploading) return

    // Mesmo fluxo da Home: comprime e envia pelo /api/avatar (antes subia o
    // arquivo original de vários MB para outro bucket e não atualizava o perfil do portal)
    setUploading(true)
    try {
      const novaUrl = await enviarAvatar(file, user.id)
      setAvatarLocal(novaUrl)
      if (refresh) refresh()
    } catch (err) {
      console.error('Erro ao enviar foto:', err)
      alert(err instanceof Error ? err.message : 'Não foi possível enviar a foto. Tente novamente.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      {/* Card principal */}
      <div style={{
        background: '#fff', borderRadius: 16, padding: 24,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center',
        marginBottom: 16,
      }}>
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 16 }}>
          {(avatarLocal || user.avatar_url) ? (
            <img
              src={avatarLocal || user.avatar_url || ''}
              alt="Foto"
              style={{
                width: 80, height: 80, borderRadius: '50%', objectFit: 'cover',
                border: '3px solid #E5E7EB',
              }}
            />
          ) : (
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: 'linear-gradient(135deg, #C41E2A, #E02D3A)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, fontWeight: 700,
            }}>
              {iniciais}
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label="Trocar foto de perfil"
            style={{
              position: 'absolute', bottom: -6, right: -6,
              width: 38, height: 38, borderRadius: '50%',
              background: '#1E3A5F', border: '2px solid #fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: uploading ? 'wait' : 'pointer',
            }}
          >
            {uploading
              ? <div className="spinner" style={{ width: 14, height: 14 }} />
              : <Camera size={14} color="#fff" />
            }
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFoto}
            style={{ display: 'none' }}
          />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1F2937', margin: '0 0 4px', overflowWrap: 'anywhere' }}>
          {user.tecnico_nome}
        </h1>
        <span style={{
          fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
          background: user.ativo ? '#F0FDF4' : '#FEF2F2',
          color: user.ativo ? '#16A34A' : '#DC2626',
        }}>
          {user.ativo ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      {/* Informações (somente leitura) */}
      <div style={{
        background: '#fff', borderRadius: 16, padding: 20,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16,
      }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F', margin: '0 0 16px' }}>
          Informações
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <User size={18} color="#6B7280" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Nome</div>
              <div style={{ fontSize: 14, color: '#1F2937', fontWeight: 500 }}>{user.tecnico_nome}</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Mail size={18} color="#6B7280" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>E-mail</div>
              <div style={{ fontSize: 14, color: '#1F2937', fontWeight: 500, overflowWrap: 'anywhere' }}>{user.tecnico_email || '—'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Phone size={18} color="#6B7280" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Telefone</div>
              <div style={{ fontSize: 14, color: '#1F2937', fontWeight: 500 }}>{user.telefone || '—'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Shield size={18} color="#6B7280" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Função</div>
              <div style={{ fontSize: 14, color: '#1F2937', fontWeight: 500 }}>
                {user.role === 'admin' ? 'Administrador' : 'Técnico de Campo'}
              </div>
            </div>
          </div>
        </div>

        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 10,
          background: '#F9FAFB', fontSize: 12, color: '#9CA3AF', textAlign: 'center',
        }}>
          Para alterar nome, e-mail ou função, entre em contato com o administrador.
        </div>
      </div>

      {/* Botão sair */}
      <button
        onClick={async () => {
          if (saindo) return
          if (!confirm('Sair da conta neste celular?')) return
          setSaindo(true)
          try { await logout() } catch { setSaindo(false) }
        }}
        disabled={saindo}
        style={{
          width: '100%', padding: '14px 0', borderRadius: 12,
          background: '#fff', color: '#DC2626', border: '1.5px solid #FCA5A5',
          fontSize: 14, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        <LogOut size={18} />
        {saindo ? 'Saindo...' : 'Sair da conta'}
      </button>
    </div>
  )
}
