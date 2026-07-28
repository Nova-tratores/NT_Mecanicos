import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const env = globalThis.process?.env ?? {}

export async function GET() {
  const url = env['NEXT_PUBLIC_SUPABASE_URL'] || '(vazio)'
  const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'] || ''
  const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || ''
  const vapidPub = env['NEXT_PUBLIC_VAPID_PUBLIC_KEY'] || ''
  const vapidPriv = env['VAPID_PRIVATE_KEY'] || ''

  let dbTest = 'nao testado'
  const keyUsed = serviceKey ? 'service_role' : anonKey ? 'anon' : 'nenhuma'
  const key = serviceKey || anonKey
  if (key) {
    try {
      const supabase = createClient(url, key)
      const { data, error } = await supabase.from('push_subscriptions').select('id, tecnico_nome')
      if (error) dbTest = `erro: ${error.message}`
      else dbTest = `ok: ${(data || []).length} subscriptions`
    } catch (e: unknown) {
      dbTest = `exception: ${(e as Error).message}`
    }
  }

  return Response.json({
    supabase_url_prefix: url.substring(0, 30),
    service_key_length: serviceKey.length,
    anon_key_length: anonKey.length,
    vapid_public_length: vapidPub.length,
    vapid_private_length: vapidPriv.length,
    key_used: keyUsed,
    db_test: dbTest,
  })
}
