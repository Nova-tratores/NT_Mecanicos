import { supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  const { tecnico_nome, subscription } = await request.json()

  if (!tecnico_nome || !subscription?.endpoint) {
    return Response.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const { endpoint, keys } = subscription

  // Upsert — se o endpoint já existe, atualiza
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
