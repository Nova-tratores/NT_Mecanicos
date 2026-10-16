import { getSupabaseServer } from '@/lib/push-server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = getSupabaseServer()
  const { tecnico_nome, subscription } = await request.json().catch(() => ({}))
  const nome = typeof tecnico_nome === 'string' ? tecnico_nome.trim() : ''

  if (!nome || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return Response.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const { endpoint, keys } = subscription

  // Um celular (endpoint) pertence a um técnico só: se outro usuário entrar
  // neste celular, a inscrição passa a ser dele.
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        tecnico_nome: nome,
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

/** Remove a inscrição deste celular (logout). */
export async function DELETE(request: Request) {
  const supabase = getSupabaseServer()
  const { endpoint } = await request.json().catch(() => ({}))

  if (!endpoint || typeof endpoint !== 'string') {
    return Response.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ ok: true })
}
