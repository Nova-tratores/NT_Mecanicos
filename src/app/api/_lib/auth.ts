import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

// Pasta privada (_lib): não vira rota. Helpers de autenticação para Route Handlers.
//
// O cliente envia o JWT da sessão Supabase em `Authorization: Bearer <token>`
// (ver authHeaders() em src/lib/supabase.ts). Aqui validamos o token no Supabase
// Auth (getUser faz a checagem no servidor, não só decodifica) e devolvemos um
// cliente que age COMO o usuário (RLS aplicada com o papel dele).

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export interface AuthOk {
  user: User
  client: SupabaseClient
}

function bearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1].trim() : null
}

/** Retorna o usuário autenticado ou uma resposta 401 pronta para devolver. */
export async function requireUser(req: NextRequest): Promise<AuthOk | NextResponse> {
  const token = bearer(req)
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const client = createClient(URL_SB, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data?.user) return NextResponse.json({ error: 'Sessão inválida ou expirada' }, { status: 401 })
  return { user: data.user, client }
}

/**
 * Exige usuário admin — mesma regra do hook useAdmin:
 * portal_permissoes.is_admin = true, ou (legado) mecanico_usuarios.role = 'admin'.
 */
export async function requireAdmin(req: NextRequest): Promise<AuthOk | NextResponse> {
  const auth = await requireUser(req)
  if (auth instanceof NextResponse) return auth

  const { data: perm } = await auth.client
    .from('portal_permissoes')
    .select('is_admin')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (perm?.is_admin) return auth

  const { data: legado } = await auth.client
    .from('mecanico_usuarios')
    .select('id')
    .eq('id', auth.user.id)
    .eq('role', 'admin')
    .maybeSingle()
  if (legado) return auth

  return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
}
