import { serverEnv } from '@/lib/server-env'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({
    service_key_len: serverEnv('SUPABASE_SERVICE_ROLE_KEY').length,
    anon_key_len: serverEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY').length,
    vapid_pub_len: serverEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY').length,
    vapid_priv_len: serverEnv('VAPID_PRIVATE_KEY').length,
    url: serverEnv('NEXT_PUBLIC_SUPABASE_URL').substring(0, 30),
  })
}
