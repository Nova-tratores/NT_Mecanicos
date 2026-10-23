// Token do login em todo fetch para /api do próprio app (José, 23/10/2026): as rotas do servidor agora exigem
// "Authorization: Bearer <access token>" (lib/apiAuth.ts). Embrulha o window.fetch uma vez só; não mexe em
// pedido para outro site (portal, mapas) nem em quem já mandou o próprio Authorization.
import { supabase } from '@/lib/supabase'

let instalado = false

function ehApiDoApp(input: RequestInfo | URL): boolean {
  try {
    const bruto = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const u = new URL(bruto, window.location.href)
    return u.origin === window.location.origin && u.pathname.startsWith('/api/')
  } catch { return false }
}

export function instalarAuthFetch() {
  if (instalado || typeof window === 'undefined') return
  instalado = true
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!ehApiDoApp(input)) return original(input, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (!headers.has('authorization')) {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (token) headers.set('Authorization', `Bearer ${token}`)
      } catch { /* sem sessão: segue sem token (a rota responde 401) */ }
    }
    return original(input, { ...init, headers })
  }
}
