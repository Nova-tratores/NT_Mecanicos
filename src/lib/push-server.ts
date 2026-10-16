import webpush from 'web-push'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/server-env'

/**
 * Envio de notificações push (lado do servidor), usado por /api/push/send,
 * /api/push/send-all e pelo webhook de OS nova.
 */

export interface PushPayload {
  titulo: string
  descricao?: string
  link?: string
  /** Notificações com a mesma tag substituem a anterior (evita aviso duplicado) */
  tag?: string
}

export interface PushResultado {
  sent: number
  expired: number
  total_subs: number
  errors: string[]
  debug?: string
}

interface SubRow {
  id: number
  tecnico_nome: string
  endpoint: string
  p256dh: string
  auth: string
}

export function getSupabaseServer(): SupabaseClient {
  return createClient(
    serverEnv('NEXT_PUBLIC_SUPABASE_URL'),
    serverEnv('SUPABASE_SERVICE_ROLE_KEY') || serverEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  )
}

let vapidPronto = false
function initVapid(): boolean {
  if (vapidPronto) return true
  const publicKey = serverEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY').trim()
  const privateKey = serverEnv('VAPID_PRIVATE_KEY').trim()
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails('mailto:suporte@novatratores.com.br', publicKey, privateKey)
  vapidPronto = true
  return true
}

export async function getAdminNames(supabase: SupabaseClient): Promise<string[]> {
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

/** Busca as inscrições pelo nome (sem diferenciar maiúsculas), um nome por vez. */
async function buscarInscricoes(supabase: SupabaseClient, nomes: string[]): Promise<SubRow[]> {
  const unicos = [...new Set(nomes.map(n => n?.trim()).filter(Boolean))]
  const resultados = await Promise.all(unicos.map(async (nome) => {
    // Escapa curingas do ILIKE para casar o nome exato
    const padrao = nome.replace(/[\\%_]/g, (c) => `\\${c}`)
    const { data, error } = await supabase.from('push_subscriptions').select('*').ilike('tecnico_nome', padrao)
    if (error) throw new Error(error.message)
    return (data || []) as SubRow[]
  }))
  const porId = new Map<number, SubRow>()
  resultados.flat().forEach(s => porId.set(s.id, s))
  return [...porId.values()]
}

async function enviar(supabase: SupabaseClient, subs: SubRow[], payload: PushPayload): Promise<PushResultado> {
  if (!initVapid()) {
    return { sent: 0, expired: 0, total_subs: subs.length, errors: ['VAPID não configurado no servidor'] }
  }

  const corpo = JSON.stringify({
    title: payload.titulo,
    body: payload.descricao || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag,
    data: { url: payload.link || '/' },
  })

  const expired: number[] = []
  const errors: string[] = []
  let sent = 0

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        corpo,
        // urgency high: o Android entrega mesmo com o celular em economia de bateria
        { TTL: 60 * 60 * 24, urgency: 'high' },
      )
      sent++
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string }
      // 404/410: inscrição não existe mais. 403: criada com outra chave VAPID —
      // o app refaz a inscrição na próxima vez que abrir.
      if (e.statusCode === 410 || e.statusCode === 404 || e.statusCode === 403) expired.push(sub.id)
      errors.push(`${sub.tecnico_nome}: ${e.statusCode || ''} ${e.message || ''}`.trim())
    }
  }))

  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expired)
  }

  return { sent, expired: expired.length, total_subs: subs.length, errors }
}

/** Envia para os técnicos informados (e, opcionalmente, para os admins). */
export async function enviarPushPara(
  nomes: string[],
  payload: PushPayload,
  { incluirAdmins = false }: { incluirAdmins?: boolean } = {},
): Promise<PushResultado> {
  const supabase = getSupabaseServer()
  const alvo = [...nomes]
  if (incluirAdmins) alvo.push(...await getAdminNames(supabase))

  const subs = await buscarInscricoes(supabase, alvo)
  if (subs.length === 0) {
    return { sent: 0, expired: 0, total_subs: 0, errors: [], debug: `nenhuma inscrição para: ${alvo.join(', ')}` }
  }
  return enviar(supabase, subs, payload)
}

/** Envia para todos os celulares inscritos. */
export async function enviarPushParaTodos(payload: PushPayload): Promise<PushResultado> {
  const supabase = getSupabaseServer()
  const { data, error } = await supabase.from('push_subscriptions').select('*')
  if (error) throw new Error(error.message)
  const subs = (data || []) as SubRow[]
  if (subs.length === 0) return { sent: 0, expired: 0, total_subs: 0, errors: [], debug: 'nenhuma inscrição encontrada' }
  return enviar(supabase, subs, payload)
}
