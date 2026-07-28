import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '(vazio)'
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  const hasAnonKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const hasVapidPublic = !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const hasVapidPrivate = !!process.env.VAPID_PRIVATE_KEY

  let dbTest = 'nao testado'
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    const supabase = createClient(url, key)
    const { data, error } = await supabase.from('push_subscriptions').select('id, tecnico_nome')
    if (error) dbTest = `erro: ${error.message}`
    else dbTest = `ok: ${(data || []).length} subscriptions`
  } catch (e: unknown) {
    dbTest = `exception: ${(e as Error).message}`
  }

  return Response.json({
    supabase_url: url.substring(0, 30) + '...',
    has_service_key: hasServiceKey,
    has_anon_key: hasAnonKey,
    has_vapid_public: hasVapidPublic,
    has_vapid_private: hasVapidPrivate,
    db_test: dbTest,
  })
}
