export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({
    process_env: {
      service_key_len: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').length,
      anon_key_len: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').length,
      vapid_pub_len: (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').length,
      vapid_priv_len: (process.env.VAPID_PRIVATE_KEY || '').length,
      url_len: (process.env.NEXT_PUBLIC_SUPABASE_URL || '').length,
    },
    serverEnv: {
      service_key_len: (await import('@/lib/server-env')).serverEnv('SUPABASE_SERVICE_ROLE_KEY').length,
      vapid_priv_len: (await import('@/lib/server-env')).serverEnv('VAPID_PRIVATE_KEY').length,
    },
  })
}
