'use client'
import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAdmin } from '@/hooks/useAdmin'
import { colors, shadow } from '@/lib/ui'
import {
  UserCircle, Mail, Phone, Shield, LogOut, Camera, Check, Loader2, Key,
} from 'lucide-react'

export default function PerfilPage() {
  const { admin, loading, logout } = useAdmin()
  const [uploading, setUploading] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Troca de senha
  const [showSenha, setShowSenha] = useState(false)
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmSenha, setConfirmSenha] = useState('')
  const [salvandoSenha, setSalvandoSenha] = useState(false)

  const foto = avatarUrl || admin?.avatar_url
  const initials = (admin?.tecnico_nome || 'A').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const trocarFoto = async (file: File) => {
    if (!admin) return
    setUploading(true)
    setMsg(null)

    const ext = file.name.split('.').pop() || 'jpg'
    const path = `avatars/${admin.id}/${Date.now()}.${ext}`

    const { error: upErr } = await supabase.storage.from('anexos').upload(path, file, { upsert: true })
    if (upErr) {
      setMsg({ tipo: 'err', texto: 'Erro no upload: ' + upErr.message })
      setUploading(false)
      return
    }

    const { data: urlData } = supabase.storage.from('anexos').getPublicUrl(path)
    const publicUrl = urlData.publicUrl

    const { error: dbErr } = await supabase
      .from('financeiro_usu')
      .update({ avatar_url: publicUrl })
      .eq('id', admin.id)

    if (dbErr) {
      setMsg({ tipo: 'err', texto: 'Erro ao salvar: ' + dbErr.message })
    } else {
      setAvatarUrl(publicUrl)
      setMsg({ tipo: 'ok', texto: 'Foto atualizada!' })
    }
    setUploading(false)
  }

  const trocarSenha = async () => {
    if (novaSenha.length < 6) { setMsg({ tipo: 'err', texto: 'Senha deve ter no mínimo 6 caracteres' }); return }
    if (novaSenha !== confirmSenha) { setMsg({ tipo: 'err', texto: 'As senhas não conferem' }); return }
    setSalvandoSenha(true)
    setMsg(null)
    const { error } = await supabase.auth.updateUser({ password: novaSenha })
    if (error) {
      setMsg({ tipo: 'err', texto: 'Erro: ' + error.message })
    } else {
      setMsg({ tipo: 'ok', texto: 'Senha alterada com sucesso!' })
      setNovaSenha('')
      setConfirmSenha('')
      setShowSenha(false)
    }
    setSalvandoSenha(false)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!admin) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <UserCircle size={22} color="#64748B" />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>Perfil</div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>Suas informações</div>
        </div>
      </div>

      {/* Feedback */}
      {msg && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, fontSize: 13, textAlign: 'center', fontWeight: 600,
          background: msg.tipo === 'ok' ? colors.successBg : colors.dangerBg,
          color: msg.tipo === 'ok' ? colors.success : colors.danger,
          border: `1px solid ${msg.tipo === 'ok' ? colors.successBorder : colors.dangerBorder}`,
        }}>
          {msg.texto}
        </div>
      )}

      {/* Avatar + Nome */}
      <div style={{
        background: colors.surface, borderRadius: 18, padding: '28px 20px', boxShadow: shadow.sm,
        border: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
      }}>
        <div style={{ position: 'relative' }}>
          <div style={{
            width: 96, height: 96, borderRadius: '50%', overflow: 'hidden',
            background: '#1E3A5F', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '3px solid #fff', boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
          }}>
            {foto ? (
              <img src={foto} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ color: '#fff', fontSize: 36, fontWeight: 800 }}>{initials}</span>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
            const f = e.target.files?.[0]
            if (f) trocarFoto(f)
            if (fileRef.current) fileRef.current.value = ''
          }} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{
            position: 'absolute', bottom: 0, right: 0, width: 32, height: 32, borderRadius: '50%',
            background: '#1E3A5F', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: shadow.sm,
          }}>
            {uploading ? <Loader2 size={14} color="#fff" className="spinner" /> : <Camera size={14} color="#fff" />}
          </button>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>{admin.tecnico_nome}</div>
          {admin.nome_pos && admin.nome_pos !== admin.tecnico_nome && (
            <div style={{ fontSize: 12, color: colors.textSubtle, marginTop: 2 }}>POS: {admin.nome_pos}</div>
          )}
        </div>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 20,
          background: '#EFF6FF', border: '1px solid #BFDBFE',
        }}>
          <Shield size={13} color="#2563EB" />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#2563EB' }}>Administrador</span>
        </div>
      </div>

      {/* Info cards */}
      <div style={{
        background: colors.surface, borderRadius: 16, overflow: 'hidden', boxShadow: shadow.sm,
        border: `1px solid ${colors.border}`,
      }}>
        <InfoRow icon={<Mail size={16} color="#6366F1" />} label="E-mail" value={admin.tecnico_email} />
        {admin.telefone && <InfoRow icon={<Phone size={16} color="#10B981" />} label="Telefone" value={admin.telefone} />}
        <InfoRow icon={<Shield size={16} color="#F59E0B" />} label="Papel" value={admin.role === 'admin' ? 'Administrador' : 'Técnico'} />
        <InfoRow icon={<UserCircle size={16} color="#8B5CF6" />} label="ID" value={admin.id.slice(0, 8) + '...'} last />
      </div>

      {/* Trocar senha */}
      <div style={{
        background: colors.surface, borderRadius: 16, overflow: 'hidden', boxShadow: shadow.sm,
        border: `1px solid ${colors.border}`,
      }}>
        <button onClick={() => setShowSenha(!showSenha)} style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px',
          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Key size={16} color="#D97706" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>Alterar senha</div>
            <div style={{ fontSize: 11, color: colors.textSubtle }}>Trocar a senha de acesso</div>
          </div>
        </button>

        {showSenha && (
          <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)}
              placeholder="Nova senha (mín. 6 caracteres)"
              style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.borderStrong}`, fontSize: 14, boxSizing: 'border-box', background: '#FAFAFA' }} />
            <input type="password" value={confirmSenha} onChange={e => setConfirmSenha(e.target.value)}
              placeholder="Confirmar nova senha"
              style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${colors.borderStrong}`, fontSize: 14, boxSizing: 'border-box', background: '#FAFAFA' }} />
            <button onClick={trocarSenha} disabled={salvandoSenha || novaSenha.length < 6} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12, borderRadius: 10,
              background: novaSenha.length < 6 || salvandoSenha ? '#94a3b8' : '#1E3A5F',
              color: '#fff', border: 'none', fontSize: 14, fontWeight: 700,
            }}>
              <Check size={14} /> {salvandoSenha ? 'Salvando...' : 'Salvar nova senha'}
            </button>
          </div>
        )}
      </div>

      {/* Logout */}
      <button onClick={logout} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16,
        borderRadius: 16, background: colors.surface, border: `1px solid ${colors.dangerBorder}`,
        fontSize: 15, fontWeight: 700, color: colors.danger, cursor: 'pointer', boxShadow: shadow.sm,
      }}>
        <LogOut size={18} /> Sair da conta
      </button>

      <div style={{ textAlign: 'center', fontSize: 10, color: colors.textSubtle, padding: '10px 0 20px' }}>
        NT Mecânicos · Nova Tratores
      </div>
    </div>
  )
}

function InfoRow({ icon, label, value, last }: { icon: React.ReactNode; label: string; value: string; last?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
      borderBottom: last ? 'none' : `1px solid ${colors.border}`,
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: colors.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: colors.textSubtle, marginBottom: 1 }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      </div>
    </div>
  )
}
