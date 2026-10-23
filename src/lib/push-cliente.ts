// Inscrição de push num lugar só (José, 23/10/2026): antes eram 3 cópias (ServiceWorkerRegister,
// PushPermissionBanner, NotificacaoObrigatoria) e uma delas pedia permissão sem toque (iOS ignora, Chrome bloqueia).
// Regra: pedir permissão SÓ dentro de um toque (pedirPermissaoEInscrever); fora disso, só inscreve se já 'granted'.
// O nome do técnico vem do token no servidor (/api/push/subscribe) — o corpo leva só a inscrição.

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  || 'BMKJOMgDI2my4D-ZyeEYa4eUaAhXVh9wR0CvMqAnkivEojf4ychFmeH0nu_pWP4seKFTJUqSz35OEaguFU5Tcd0'

function chaveVapid(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** o aparelho/navegador tem push? (iOS < 16.4, Safari sem instalar e navegador do WhatsApp não têm) */
export function pushSuportado(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
}

export function permissaoPush(): NotificationPermission | 'sem-suporte' {
  return pushSuportado() ? Notification.permission : 'sem-suporte'
}

/** espera o service worker ficar pronto, com limite (sem SW registrado o .ready nunca resolve) */
async function swPronto(ms = 8000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ])
}

/**
 * Inscreve este aparelho no push e grava no servidor. Não pede permissão: só age se já estiver 'granted'.
 * Devolve true se ficou inscrito e gravado.
 */
export async function inscreverPush(nome?: string): Promise<boolean> {
  if (!pushSuportado() || Notification.permission !== 'granted') return false
  try {
    const reg = await swPronto()
    if (!reg) return false
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveVapid(VAPID) })
    if (typeof navigator !== 'undefined' && !navigator.onLine) return true // grava no servidor quando voltar
    const r = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tecnico_nome: nome || undefined, subscription: sub.toJSON() }),
    })
    return r.ok
  } catch (err) {
    console.warn('[push] inscrição falhou:', err)
    return false
  }
}

/** Pede a permissão (chamar SÓ dentro de um toque) e inscreve. */
export async function pedirPermissaoEInscrever(nome?: string): Promise<NotificationPermission | 'sem-suporte'> {
  if (!pushSuportado()) return 'sem-suporte'
  const p = await Notification.requestPermission()
  if (p === 'granted') await inscreverPush(nome)
  return p
}

/** Sair do app: cancela a inscrição deste aparelho (o próximo técnico não recebe push do anterior). */
export async function cancelarPush(): Promise<void> {
  if (!pushSuportado()) return
  try {
    const reg = await swPronto(3000)
    const sub = await reg?.pushManager.getSubscription()
    if (sub) await sub.unsubscribe()
  } catch { /* sem SW: nada a cancelar */ }
}
