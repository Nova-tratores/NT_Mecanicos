'use client'
// Aviso de sessão expirada (José, 23/10/2026): o app continua abrindo com o perfil guardado, mas sem login
// nada grava no banco. O que o técnico envia fica na fila do aparelho.
// 06/11/2026: NUNCA tira o técnico da tela (ele pode estar no meio de uma OS). Primeiro tenta renovar o login
// sozinho; se não der, pede a senha aqui mesmo, por cima da tela, e ao entrar sobe a fila e recarrega agenda/Liga.
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { EVENTO_SESSAO_EXPIRADA, avisarSessaoVoltou, temSessaoValida } from '@/lib/sessao'
import { sincronizarTudo } from '@/lib/syncManager'

function perfilGuardado(): { id?: string; tecnico_email?: string; tecnico_nome?: string } | null {
  try { return JSON.parse(localStorage.getItem('nt-mecanicos-profile') || 'null') } catch { return null }
}

const campo: React.CSSProperties = {
  width: '100%', minHeight: 46, borderRadius: 12, border: '1px solid #E2E8F0', padding: '0 12px',
  fontSize: 16, color: '#0F172A', background: '#FEFEFE', boxSizing: 'border-box',
}

export default function SessaoExpirada() {
  const [ver, setVer] = useState(false)
  const [entrando, setEntrando] = useState(false) // janelinha com e-mail e senha aberta
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    let conferindo = false
    const on = async () => {
      if (conferindo) return
      conferindo = true
      // às vezes é só o token vencido: renova sem incomodar ninguém
      const ok = navigator.onLine && await temSessaoValida()
      conferindo = false
      if (ok) { avisarSessaoVoltou(); void sincronizarTudo(); return }
      setVer(true)
    }
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, on)
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, on)
  }, [])

  const abrirLogin = () => {
    setEmail(perfilGuardado()?.tecnico_email || '')
    setSenha('')
    setErro('')
    setEntrando(true)
  }

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha })
      if (error) {
        const semRede = !navigator.onLine || error.name === 'AuthRetryableFetchError'
          || (error as { status?: number }).status === 0 || /fetch|network|rede/i.test(error.message || '')
        setErro(semRede ? 'Sem internet. Conecte e tente de novo.' : 'E-mail ou senha incorretos')
        return
      }
      // outra pessoa no celular de um técnico com trabalho guardado: não mistura (a fila é do dono do perfil)
      const dono = perfilGuardado()
      if (dono?.id && data.session?.user?.id !== dono.id) {
        await supabase.auth.signOut().catch(() => {})
        setErro(`Este celular está com ${dono.tecnico_nome || 'outro técnico'}. Entre com a conta dele.`)
        return
      }
      setEntrando(false)
      setVer(false)
      avisarSessaoVoltou()
      void sincronizarTudo()
    } catch {
      setErro(navigator.onLine ? 'Erro de conexão. Tente de novo.' : 'Sem internet. Conecte e tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  if (!ver || pathname === '/login') return null

  if (entrando) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9001, background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
        <form onSubmit={entrar} style={{
          width: '100%', maxWidth: 420, background: '#FEFEFE', borderRadius: 16, padding: 16, display: 'grid', gap: 10,
          boxShadow: '0 12px 32px -12px rgba(15,23,42,0.35)',
        }}>
          <div style={{ fontSize: 16, color: '#0F172A' }}>Entrar de novo</div>
          <div style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.5 }}>
            Você continua nesta tela. O que já preencheu fica como está.
          </div>
          <input type="email" autoComplete="username" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} style={campo} required />
          <input type="password" autoComplete="current-password" placeholder="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} style={campo} required autoFocus />
          {erro && <div style={{ fontSize: 13.5, color: '#DC2626' }}>{erro}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setEntrando(false)} disabled={enviando} style={{
              flex: 1, minHeight: 44, borderRadius: 12, border: '1px solid #E2E8F0', background: '#FEFEFE', color: '#0F172A', fontSize: 14.5, cursor: 'pointer',
            }}>Voltar</button>
            <button type="submit" disabled={enviando} style={{
              flex: 1, minHeight: 44, borderRadius: 12, border: 'none', background: '#1E3A5F', color: '#FEFEFE', fontSize: 14.5, cursor: 'pointer', opacity: enviando ? 0.7 : 1,
            }}>{enviando ? 'Entrando…' : 'Entrar'}</button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div role="alert" style={{
      position: 'fixed', left: 16, right: 16, zIndex: 9001,
      top: 'calc(72px + env(safe-area-inset-top, 0px))', maxWidth: 420, margin: '0 auto',
      background: '#FEFEFE', border: '1px solid #E2E8F0', borderRadius: 16,
      boxShadow: '0 12px 32px -12px rgba(15,23,42,0.35)', padding: 14, display: 'grid', gap: 10,
    }}>
      <div style={{ fontSize: 15, color: '#0F172A' }}>Sua sessão expirou</div>
      <div style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.5 }}>
        Pode continuar preenchendo: o que você enviar fica guardado no aparelho e sobe quando entrar de novo.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setVer(false)} style={{
          flex: 1, minHeight: 44, borderRadius: 12, border: '1px solid #E2E8F0', background: '#FEFEFE', color: '#0F172A', fontSize: 14.5, cursor: 'pointer',
        }}>Depois</button>
        <button type="button" onClick={abrirLogin} style={{
          flex: 1, minHeight: 44, borderRadius: 12, border: 'none', background: '#1E3A5F', color: '#FEFEFE', fontSize: 14.5, cursor: 'pointer',
        }}>Entrar de novo</button>
      </div>
    </div>
  )
}
