'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Image from 'next/image'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const router = useRouter()

  // Auto-redirect se já tem sessão ativa
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // Tem sessão, verifica perfil cacheado
        try {
          const cached = localStorage.getItem('nt-mecanicos-profile')
          if (cached) {
            const profile = JSON.parse(cached)
            router.replace(profile.role === 'admin' ? '/admin' : '/')
            return
          }
        } catch { /* */ }
        // Sem cache, redireciona pra home e deixa useCurrentUser resolver
        router.replace('/')
      } else {
        setCheckingSession(false)
      }
    }).catch(() => {
      setCheckingSession(false)
    })
  }, [router])

  if (checkingSession) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1E3A5F 0%, #2D5A8E 100%)' }}>
        <div className="spinner" style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
      </div>
    )
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setErro('')
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setErro('Sem conexão com a internet. Conecte-se para entrar.')
      return
    }
    setLoading(true)

    try {
      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: senha,
      })

      if (loginError) {
        // Falha de rede não é senha errada — não confundir o técnico
        const erroRede = loginError.name === 'AuthRetryableFetchError' || !loginError.status || loginError.status >= 500
        setErro(erroRede
          ? 'Não foi possível conectar. Verifique o sinal e tente novamente.'
          : 'E-mail ou senha incorretos')
        setLoading(false)
        return
      }

      const uid = loginData?.session?.user?.id
      if (!uid) {
        setErro('Erro ao obter sessão')
        setLoading(false)
        return
      }

      // 1. Checar portal_permissoes
      // maybeSingle: "sem linha" não é erro; erro real (rede) não pode virar "sem acesso" + signOut
      const { data: perm, error: permErr } = await supabase
        .from('portal_permissoes')
        .select('is_admin, mecanico_role')
        .eq('user_id', uid)
        .maybeSingle()
      if (permErr) throw permErr

      if (perm) {
        // Admin do portal → admin do mecânicos
        if (perm.is_admin) {
          router.push('/admin')
          return
        }
        // Tem papel no app mecânicos
        if (perm.mecanico_role) {
          router.push('/')
          return
        }
      }

      // 2. Fallback: checar mecanico_usuarios (legado)
      const { data: perfil, error: perfilErr } = await supabase
        .from('mecanico_usuarios')
        .select('role')
        .eq('id', uid)
        .maybeSingle()
      if (perfilErr) throw perfilErr

      if (perfil) {
        router.push(perfil.role === 'admin' ? '/admin' : '/')
        return
      }

      // 3. Sem acesso em nenhuma tabela
      await supabase.auth.signOut()
      setErro('Sem acesso ao app. Solicite ao administrador do portal.')
    } catch {
      setErro('Não foi possível conectar. Verifique o sinal e tente novamente.')
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #1E3A5F 0%, #2D5A8E 100%)',
      padding: 'calc(24px + env(safe-area-inset-top, 0px)) 16px calc(24px + env(safe-area-inset-bottom, 0px))',
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: '32px 24px',
        width: '100%', maxWidth: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Image src="/Logo_Nova.png" alt="Nova Tratores" width={140} height={60} style={{ margin: '0 auto 12px', objectFit: 'contain' }} />
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E3A5F', margin: 0 }}>NT Mecânicos</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
            Entre com sua conta do portal
          </p>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              required placeholder="seu@email.com" style={inputStyle}
              autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Senha</label>
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
              required placeholder="Sua senha do portal" minLength={6} style={inputStyle}
              autoComplete="current-password" />
          </div>
          {erro && <Erro texto={erro} />}
          <button type="submit" disabled={loading} style={btnStyle(loading)}>
            {loading ? 'Aguarde...' : 'Entrar'}
          </button>
          <p style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: 12 }}>
            Use as mesmas credenciais do Portal Nova Tratores
          </p>
        </form>
      </div>
    </div>
  )
}

function Erro({ texto }: { texto: string }) {
  return (
    <div style={{
      background: '#FEF2F2', color: '#DC2626', padding: '10px 14px',
      borderRadius: 10, fontSize: 13, marginBottom: 16, textAlign: 'center',
    }}>
      {texto}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', borderRadius: 12,
  border: '1.5px solid #E5E7EB', fontSize: 16, outline: 'none',
  boxSizing: 'border-box',
}

const btnStyle = (loading: boolean): React.CSSProperties => ({
  width: '100%', padding: '14px 0', borderRadius: 12,
  background: loading ? '#9CA3AF' : '#1E3A5F', color: '#fff',
  fontSize: 16, fontWeight: 700, border: 'none',
  cursor: loading ? 'default' : 'pointer',
})
