import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/server-env'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    serverEnv('NEXT_PUBLIC_SUPABASE_URL'),
    serverEnv('SUPABASE_SERVICE_ROLE_KEY') || serverEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  )
}

export async function POST(request: Request) {
  const supabase = getSupabase()
  const { tecnico_nome, subscription } = await request.json()

  if (!tecnico_nome || !subscription?.endpoint) {
    return Response.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const { endpoint, keys } = subscription

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        tecnico_nome,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      { onConflict: 'endpoint' },
    )

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
