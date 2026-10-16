'use client'

/**
 * Inscrição de notificações push (lado do navegador).
 *
 * Regras:
 * - Só pede permissão quando o usuário toca em "Ativar" (pedir sozinho faz o
 *   Chrome bloquear de vez e o iPhone recusar).
 * - Se a inscrição existente foi criada com outra chave VAPID, ela é refeita —
 *   senão todo envio para esse celular falha sem aviso.
 * - No logout a inscrição é apagada, para o celular parar de receber avisos
 *   do usuário anterior.
 */

export const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim()

export type PushStatus = 'indisponivel' | 'precisa-instalar' | 'bloqueado' | 'pendente' | 'ativo'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

function mesmaChave(sub: PushSubscription): boolean {
  const atual = sub.options?.applicationServerKey
  if (!atual) return true // navegador não informa: assume que está certo
  const esperada = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  const a = new Uint8Array(atual)
  if (a.length !== esperada.length) return false
  return a.every((b, i) => b === esperada[i])
}

function ehIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function estaInstalado() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function pushStatusInicial(): PushStatus {
  if (typeof window === 'undefined') return 'indisponivel'
  if (ehIos() && !estaInstalado()) return 'precisa-instalar'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || !VAPID_PUBLIC_KEY) {
    return 'indisponivel'
  }
  if (Notification.permission === 'denied') return 'bloqueado'
  if (Notification.permission === 'default') return 'pendente'
  return 'ativo'
}

async function salvarNoServidor(tecnicoNome: string, sub: PushSubscription) {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tecnico_nome: tecnicoNome, subscription: sub.toJSON() }),
  })
  if (!res.ok) throw new Error('Falha ao registrar notificações no servidor')
}

/**
 * Garante que este celular está inscrito para o técnico informado.
 * Com `pedirPermissao: false` (padrão) nunca mostra o pedido do navegador —
 * só sincroniza se a permissão já foi dada.
 */
export async function garantirInscricaoPush(
  tecnicoNome: string,
  { pedirPermissao = false }: { pedirPermissao?: boolean } = {},
): Promise<PushStatus> {
  const inicial = pushStatusInicial()
  if (inicial === 'indisponivel' || inicial === 'precisa-instalar' || inicial === 'bloqueado') return inicial
  if (!tecnicoNome || tecnicoNome === 'Usuário') return inicial

  if (Notification.permission === 'default') {
    if (!pedirPermissao) return 'pendente'
    const perm = await Notification.requestPermission()
    if (perm === 'denied') return 'bloqueado'
    if (perm !== 'granted') return 'pendente'
  }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (sub && !mesmaChave(sub)) {
    await sub.unsubscribe().catch(() => {})
    sub = null
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }
  await salvarNoServidor(tecnicoNome, sub)
  return 'ativo'
}

/** Remove a inscrição deste celular (usar no logout). Nunca lança erro. */
export async function removerInscricaoPush(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  } catch { /* logout nunca pode travar por causa disso */ }
}
