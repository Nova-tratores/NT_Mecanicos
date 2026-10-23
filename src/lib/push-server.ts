// Envio de push para técnicos (servidor). Usado pelo vigia de OS (lib/vigia-os-push.ts).
// A inscrição guarda o nome do técnico como o app tem (nome_pos ou tecnico_nome) e a OS usa outro jeito de
// escrever ("DANILO DE SOUZA" × "Danilo de Souza", "José Oliveira" × "JOSE ANTONIO DE OLIVEIRA"): casa por `mesmoNome`.
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/server-env'

export const sem = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
export function mesmoNome(a: unknown, b: unknown) {
  const x = sem(a).split(/\s+/).filter((w) => w.length > 2), y = sem(b).split(/\s+/).filter((w) => w.length > 2)
  if (!x.length || !y.length) return false
  return x[0] === y[0] && (x[x.length - 1] === y[y.length - 1] || x.every((w) => y.includes(w)) || y.every((w) => x.includes(w)))
}

export function supabaseServidor() {
  return createClient(serverEnv('NEXT_PUBLIC_SUPABASE_URL'), serverEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
}

let vapidOk: boolean | null = null
function vapid(): boolean {
  if (vapidOk != null) return vapidOk
  const pub = serverEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY'), priv = serverEnv('VAPID_PRIVATE_KEY')
  vapidOk = !!(pub && priv)
  if (vapidOk) webpush.setVapidDetails('mailto:suporte@novatratores.com.br', pub, priv)
  return vapidOk
}

export interface Inscricao { id: number; tecnico_nome: string; endpoint: string; p256dh: string; auth: string }

export async function inscricoes(): Promise<Inscricao[]> {
  const { data } = await supabaseServidor().from('push_subscriptions').select('id, tecnico_nome, endpoint, p256dh, auth')
  return (data || []) as Inscricao[]
}

/** nomes dos inscritos sem repetir ("DANILO DE SOUZA" e "Danilo de Souza" contam uma vez) — senão o mesmo celular
 *  recebia 2 pushes (José, 23/10/2026) */
export function nomesInscritos(subs: Inscricao[]): string[] {
  const vistos = new Map<string, string>()
  for (const s of subs) { const k = sem(s.tecnico_nome); if (k && !vistos.has(k)) vistos.set(k, s.tecnico_nome) }
  return [...vistos.values()]
}

type Msg = { titulo: string; corpo: string; url?: string; baixar?: boolean }

/** manda para todas as inscrições do técnico; apaga as vencidas. Devolve quantos celulares receberam. */
export async function pushParaTecnico(nome: string, msg: Msg, lista?: Inscricao[]): Promise<number> {
  if (!vapid()) return 0
  return enviarPush((lista || await inscricoes()).filter((s) => mesmoNome(s.tecnico_nome, nome) || sem(s.tecnico_nome) === sem(nome)), msg)
}

/** manda para estas inscrições — um celular (endpoint) recebe uma vez só; apaga as vencidas */
export async function enviarPush(lista: Inscricao[], msg: Msg): Promise<number> {
  if (!vapid()) return 0
  const subs = [...new Map(lista.map((s) => [s.endpoint, s])).values()]
  const payload = JSON.stringify({ title: msg.titulo, body: msg.corpo, icon: '/capa_app.png', badge: '/capa_app.png', data: { url: msg.url || '/os', baixar: msg.baixar !== false } })
  let ok = 0
  const vencidas: number[] = []
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 12 * 3600 }); ok++ }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) vencidas.push(s.id) }
  }
  if (vencidas.length) await supabaseServidor().from('push_subscriptions').delete().in('id', vencidas)
  return ok
}
