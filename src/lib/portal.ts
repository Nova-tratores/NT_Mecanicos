// Chamadas do app às rotas do portal (mesmo Supabase): vão com o token do técnico logado.
import { supabase } from '@/lib/supabase'

export const PORTAL = (process.env.NEXT_PUBLIC_PORTAL_URL || (process.env.NODE_ENV === 'production' ? 'https://portal.novatratores.com' : 'http://localhost:3000')).replace(/\/$/, '')

export async function portalFetch(caminho: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sem login — entre de novo no app.')
  return fetch(`${PORTAL}${caminho}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` }, cache: 'no-store' })
}

/** JSON da resposta; erro do portal vira exceção com a mensagem dele */
export async function portalJson<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const r = await portalFetch(caminho, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j as { error?: string }).error || `Erro ${r.status}`)
  return j as T
}
