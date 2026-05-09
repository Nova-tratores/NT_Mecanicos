import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

function initVapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (publicKey && privateKey) {
    webpush.setVapidDetails('mailto:suporte@novatratores.com.br', publicKey, privateKey)
  }
}

export async function POST(request: Request) {
  initVapid()
  const { tecnico_nome, titulo, descricao, link } = await request.json()

  if (!tecnico_nome || !titulo) {
    return Response.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  // Buscar todas as subscriptions desse técnico
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('tecnico_nome', tecnico_nome)

  if (!subs || subs.length === 0) {
    return Response.json({ sent: 0 })
  }

  const payload = JSON.stringify({
    title: titulo,
    body: descricao || '',
    icon: '/Logo_Nova.png',
    badge: '/Logo_Nova.png',
    data: { url: link || '/' },
  })

  let sent = 0
  const expired: number[] = []

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
      const statusCode = (err as { statusCode?: number }).statusCode
      // 410 Gone ou 404 = subscription expirada
      if (statusCode === 410 || statusCode === 404) {
        expired.push(sub.id)
      }
    }
  }

  // Limpar subscriptions expiradas
  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expired)
  }

  return Response.json({ sent, expired: expired.length })
}
