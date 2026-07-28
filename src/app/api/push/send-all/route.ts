import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/server-env'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    serverEnv('NEXT_PUBLIC_SUPABASE_URL'),
    serverEnv('SUPABASE_SERVICE_ROLE_KEY') || serverEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  )
}

function initVapid() {
  const publicKey = serverEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY')
  const privateKey = serverEnv('VAPID_PRIVATE_KEY')
  if (publicKey && privateKey) {
    webpush.setVapidDetails('mailto:suporte@novatratores.com.br', publicKey, privateKey)
  }
}

export async function POST(request: Request) {
  initVapid()
  const supabase = getSupabase()
  const { titulo, descricao, link } = await request.json()

  if (!titulo) {
    return Response.json({ error: 'Título obrigatório' }, { status: 400 })
  }

  const { data: subs, error: subsError } = await supabase
    .from('push_subscriptions')
    .select('*')

  if (subsError) {
    return Response.json({ error: subsError.message, hint: subsError.hint }, { status: 500 })
  }

  if (!subs || subs.length === 0) {
    return Response.json({ sent: 0, debug: 'nenhuma subscription encontrada' })
  }

  const payload = JSON.stringify({
    title: titulo,
    body: descricao || '',
    icon: '/capa_app.png',
    badge: '/capa_app.png',
    data: { url: link || '/' },
  })

  let sent = 0
  const expired: number[] = []
  const errors: string[] = []

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
      )
      sent++
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string }
      if (e.statusCode === 410 || e.statusCode === 404) {
        expired.push(sub.id)
      }
      errors.push(`${sub.tecnico_nome}: ${e.statusCode || ''} ${e.message || ''}`)
    }
  }

  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expired)
  }

  return Response.json({ sent, expired: expired.length, total_subs: subs.length, errors })
}
