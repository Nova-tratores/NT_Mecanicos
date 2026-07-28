import webpush from 'web-push'
import { supabase } from '@/lib/supabase'

function initVapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (publicKey && privateKey) {
    webpush.setVapidDetails('mailto:suporte@novatratores.com.br', publicKey, privateKey)
  }
}

async function getAdminNames(): Promise<string[]> {
  const { data: admins } = await supabase
    .from('portal_permissoes')
    .select('user_id')
    .eq('is_admin', true)
  if (!admins?.length) return []
  const { data: profiles } = await supabase
    .from('financeiro_usu')
    .select('nome')
    .in('id', admins.map(a => a.user_id))
  return (profiles || []).map(p => p.nome).filter(Boolean)
}

export async function POST(request: Request) {
  initVapid()
  const { tecnico_nome, titulo, descricao, link } = await request.json()

  if (!tecnico_nome || !titulo) {
    return Response.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const nomesAlvo = new Set<string>([tecnico_nome])

  // Admins sempre recebem todas as notificações
  const adminNames = await getAdminNames()
  adminNames.forEach(n => nomesAlvo.add(n))

  const { data: subs, error: subsError } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('tecnico_nome', [...nomesAlvo])

  if (subsError) {
    return Response.json({ error: subsError.message, hint: subsError.hint }, { status: 500 })
  }

  if (!subs || subs.length === 0) {
    return Response.json({ sent: 0, debug: `nenhuma sub para: ${[...nomesAlvo].join(', ')}` })
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
