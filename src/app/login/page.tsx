'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { limparDadosDoAparelho } from '@/lib/sessao'
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
            router.replace('/') // a área /admin saiu do app; useCurrentUser manda quem é só admin para o Portal
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
    setErro('')
    setLoading(true)

    try {
      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: senha,
      })

      if (loginError) {
        // sem sinal não é senha errada (José, 23/10/2026)
        const semRede = !navigator.onLine || loginError.name === 'AuthRetryableFetchError'
          || (loginError as { status?: number }).status === 0 || /fetch|network|rede/i.test(loginError.message || '')
        setErro(semRede ? 'Sem internet. Conecte e tente de novo.' : 'E-mail ou senha incorretos')
        setLoading(false)
        return
      }

      const uid = loginData?.session?.user?.id
      if (!uid) {
        setErro('Erro ao obter sessão')
        setLoading(false)
        return
      }

      // Outro técnico entrando neste celular: apaga o que ficou do anterior (José, 23/10/2026)
      try {
        const anterior = JSON.parse(localStorage.getItem('nt-mecanicos-profile') || 'null') as { id?: string } | null
        if (anterior?.id && anterior.id !== uid) await limparDadosDoAparelho()
      } catch { /* sem perfil guardado */ }

      // 1. Checar portal_permissoes
      const { data: perm } = await supabase
        .from('portal_permissoes')
        .select('is_admin, mecanico_role')
        .eq('user_id', uid)
        .single()

      if (perm) {
        // Admin do portal → admin do mecânicos
        if (perm.is_admin && !perm.mecanico_role) {
          window.location.replace(process.env.NEXT_PUBLIC_PORTAL_URL || 'https://portal.novatratores.com') // gestão é no Portal (José, 23/10/2026)
          return
        }
        // Tem papel no app mecânicos
        if (perm.mecanico_role) {
          router.push('/')
          return
        }
      }

      // 2. Fallback: checar mecanico_usuarios (legado)
      const { data: perfil } = await supabase
        .from('mecanico_usuarios')
        .select('role')
        .eq('id', uid)
        .single()

      if (perfil) {
        if (perfil.role === 'admin') { window.location.replace(process.env.NEXT_PUBLIC_PORTAL_URL || 'https://portal.novatratores.com'); return }
        router.push('/')
        return
      }

      // 3. Sem acesso em nenhuma tabela
      await supabase.auth.signOut()
      setErro('Sem acesso ao app. Solicite ao administrador do portal.')
    } catch {
      setErro(navigator.onLine ? 'Erro de conexão. Tente de novo.' : 'Sem internet. Conecte e tente de novo.')
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #1E3A5F 0%, #2D5A8E 100%)',
      padding: 24,
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: 32,
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
              required placeholder="seu@email.com" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Senha</label>
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
              required placeholder="Sua senha do portal" minLength={6} style={inputStyle} />
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
  border: '1.5px solid #E5E7EB', fontSize: 15, outline: 'none',
  boxSizing: 'border-box',
}

const btnStyle = (loading: boolean): React.CSSProperties => ({
  width: '100%', padding: '14px 0', borderRadius: 12,
  background: loading ? '#9CA3AF' : '#1E3A5F', color: '#fff',
  fontSize: 15, fontWeight: 700, border: 'none',
  cursor: loading ? 'default' : 'pointer',
})
