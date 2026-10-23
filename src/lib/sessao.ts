// Sair do app e sessão expirada (José, 23/10/2026).
// Celular compartilhado: ao sair, apaga do aparelho o que é do técnico (OS baixadas, feed, Liga, inscrição de push)
// para o próximo não ver os dados do anterior. A FILA de envios pendentes fica (é trabalho feito que ainda não subiu).
// Sessão expirada com o perfil guardado: o app continua abrindo, mas avisa "entre de novo" (gravar no banco falharia).
import { cancelarPush } from './push-cliente'
import { offlineKeys, offlineDelete } from './offlineCache'

export const EVENTO_SESSAO_EXPIRADA = 'nt-sessao-expirada'
let saindo = false

/** quem chamou o signOut fomos nós (não mostrar "sessão expirou") */
export function marcarSaindo() { saindo = true }
export function estaSaindo() { return saindo }

export function avisarSessaoExpirada() {
  if (saindo || typeof window === 'undefined') return
  window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA))
}

/** chaves do localStorage que são do técnico (o resto — preferências do aparelho — fica) */
const PREFIXOS_LS = ['nt-mecanicos-profile', 'nt-home-feed:', 'nt-liga-xp', 'nt-prefetch-timestamp', 'nt-vitrine-catalogo', 'nt-sem-notificacao:']

/** apaga no servidor a inscrição de push deste aparelho (DELETE /api/push/subscribe), antes de desinscrever (José, 23/10/2026) */
async function apagarInscricaoNoServidor(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    await fetch('/api/push/subscribe', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }),
    })
  } catch { /* sem rede: o servidor apaga quando o push voltar 410 */ }
}

export async function limparDadosDoAparelho(): Promise<void> {
  await apagarInscricaoNoServidor()
  await cancelarPush().catch(() => {})

  try {
    const apagar: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && PREFIXOS_LS.some((p) => k.startsWith(p))) apagar.push(k)
    }
    apagar.forEach((k) => localStorage.removeItem(k))
  } catch { /* sem localStorage */ }

  // IndexedDB: só o store 'cache' (OS, clientes, feed, sw-config); a 'syncQueue' fica.
  // Rascunhos de relatório (nt-form:*) e PDFs pendentes também ficam: é trabalho que ainda não subiu (José, 23/10/2026)
  for (const k of await offlineKeys()) {
    if (k.startsWith('nt-form:') || k === 'pending-pdfs') continue
    await offlineDelete(k)
  }

  // páginas de OS guardadas pelo service worker (HTML/RSC de /os/...)
  try {
    if ('caches' in window) {
      for (const nome of await caches.keys()) {
        if (!nome.startsWith('nt-pages')) continue
        const c = await caches.open(nome)
        for (const req of await c.keys()) {
          if (new URL(req.url, location.origin).pathname.startsWith('/os/')) await c.delete(req)
        }
      }
    }
  } catch { /* sem Cache API */ }
}
