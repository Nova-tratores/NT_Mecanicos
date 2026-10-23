'use client'
import { useRef, useState } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase } from '@/lib/supabase'
import { User, Mail, Phone, LogOut, Shield, Camera } from 'lucide-react'
import { getQueueCount } from '@/lib/offlineCache'

export default function PerfilPage() {
  const { user, loading, logout, refresh } = useCurrentUser()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  // sair com envio ainda no celular: avisa antes (o trabalho fica guardado, mas só sobe quando ele entrar de novo) (José, 23/10/2026)
  const sair = async () => {
    const n = await getQueueCount().catch(() => 0)
    if (n > 0 && !window.confirm(`Ainda tem ${n} envio${n > 1 ? 's' : ''} guardado${n > 1 ? 's' : ''} no celular esperando internet. Se sair agora, ${n > 1 ? 'eles só sobem' : 'ele só sobe'} quando você entrar de novo. Sair mesmo assim?`)) return
    await logout()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!user) return null

  const iniciais = user.tecnico_nome
    .split(' ')
    .map((p) => p.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('')

  const handleFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return

    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `avatars/${user.id}.${ext}`

      const { error: upErr } = await supabase.storage
        .from('mecanico-files')
        .upload(path, file, { upsert: true })

      if (upErr) throw upErr

      const { data: urlData } = supabase.storage
        .from('mecanico-files')
        .getPublicUrl(path)

      const avatarUrl = urlData.publicUrl + '?t=' + Date.now()

      await supabase
        .from('mecanico_usuarios')
        .update({ avatar_url: avatarUrl })
        .eq('id', user.id)

      if (refresh) refresh()
    } catch (err) {
      console.error('Erro ao enviar foto:', err)
      alert('Erro ao enviar foto. Tente novamente.')
    } finally {
      setUploading(false)
    }
  }

  // Estilo POS NewPortal (22/10/2026): cartões brancos, ícones em quadradinho, sem degradê vermelho
  const linhas = [
    { rot: 'Nome', valor: user.tecnico_nome, Icone: User, cor: '#0369A1' },
    { rot: 'E-mail', valor: user.tecnico_email || '—', Icone: Mail, cor: '#2563EB' },
    { rot: 'Telefone', valor: user.telefone || '—', Icone: Phone, cor: '#16A34A' },
    { rot: 'Função', valor: user.role === 'admin' ? 'Administrador' : 'Técnico de Campo', Icone: Shield, cor: '#7C3AED' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Card principal */}
      <div style={{
        background: '#FEFEFE', borderRadius: 16, padding: '22px 16px',
        border: '1px solid #E2E8F0', textAlign: 'center',
      }}>
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 14 }}>
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt="Foto"
              style={{
                width: 84, height: 84, borderRadius: 22, objectFit: 'cover',
                border: '1px solid #E2E8F0',
              }}
            />
          ) : (
            <div style={{
              width: 84, height: 84, borderRadius: 22,
              background: 'color-mix(in srgb, #0369A1 10%, #FEFEFE)',
              border: '1px solid color-mix(in srgb, #0369A1 18%, transparent)',
              color: '#0369A1', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30, fontWeight: 500,
            }}>
              {iniciais}
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label="trocar foto"
            style={{
              position: 'absolute', bottom: -6, right: -6,
              width: 34, height: 34, borderRadius: 11,
              background: '#0369A1', border: '2px solid #FEFEFE',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: uploading ? 'wait' : 'pointer',
            }}
          >
            {uploading
              ? <div className="spinner" style={{ width: 14, height: 14 }} />
              : <Camera size={15} color="#fff" />
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
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#0F172A', margin: '0 0 6px', overflowWrap: 'anywhere' }}>
          {user.tecnico_nome}
        </h1>
        <span style={{
          fontSize: 12.5, fontWeight: 500, padding: '2px 11px', borderRadius: 999,
          background: user.ativo ? '#ECFDF5' : '#FEF2F2',
          color: user.ativo ? '#16A34A' : '#DC2626',
        }}>
          {user.ativo ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      {/* Informações (somente leitura) */}
      <div style={{
        background: '#FEFEFE', borderRadius: 16, padding: 14,
        border: '1px solid #E2E8F0',
      }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: '#0F172A', margin: '2px 2px 12px' }}>
          Informações
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {linhas.map(({ rot, valor, Icone, cor }) => (
            <div key={rot} style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                background: `color-mix(in srgb, ${cor} 9%, #FEFEFE)`,
                border: `1px solid color-mix(in srgb, ${cor} 16%, transparent)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icone size={18} color={cor} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: '#64748B' }}>{rot}</div>
                <div style={{ fontSize: 15, color: '#0F172A', overflowWrap: 'anywhere' }}>{valor}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: 14, padding: '10px 12px', borderRadius: 12,
          background: '#EEF2F6', fontSize: 13, color: '#475569', textAlign: 'center', lineHeight: 1.45,
        }}>
          Para alterar nome, e-mail ou função, entre em contato com o administrador.
        </div>
      </div>

      {/* Botão sair */}
      <button
        onClick={sair}
        style={{
          width: '100%', height: 46, borderRadius: 12,
          background: '#FEFEFE', color: '#DC2626', border: '1px solid #FECACA',
          fontSize: 15, fontWeight: 500, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        <LogOut size={18} />
        Sair da conta
      </button>
    </div>
  )
}
