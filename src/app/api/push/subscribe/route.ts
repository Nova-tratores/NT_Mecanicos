import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const env = globalThis.process?.env ?? {}

function getSupabase() {
  const url = env['NEXT_PUBLIC_SUPABASE_URL'] || ''
  const key = env['SUPABASE_SERVICE_ROLE_KEY'] || env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || ''
  return createClient(url, key)
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
