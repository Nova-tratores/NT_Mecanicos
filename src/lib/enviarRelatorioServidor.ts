// Relatório vai para o SERVIDOR no Enviar (José, 12/11/2026: "não pode depender só do celular do técnico").
// Antes: login vencido ou sinal fraco → relatório ficava na fila do aparelho e o app dizia "guardada no celular";
// o portal não via nada (OS-0900 e OS-0893, 11/11). Agora o servidor (/api/relatorio/receber) recebe, guarda uma
// cópia e grava na OS com a chave dele; aceita login vencido (a assinatura do token prova quem é).
// O último token fica guardado à parte: quando a renovação falha, o supabase-js apaga a sessão e o servidor
// ficaria sem saber quem é o técnico.
import { supabase } from './supabase'
import { getQueue, removeFromQueue, offlineSet, type SyncItem } from './offlineCache'

const CHAVE_TOKEN = 'nt-ultimo-token'
let ouvindo = false

/** guarda o token de cada login/renovação (chamar uma vez; idempotente). Vai também para o IndexedDB ('sw-token'):
 *  o service worker não lê o localStorage e precisa dele para mandar a fila com o app fechado (José, 12/11/2026) */
export function guardarUltimoToken() {
  if (ouvindo || typeof window === 'undefined') return
  ouvindo = true
  const salvar = (t?: string | null) => {
    if (!t) return
    try { localStorage.setItem(CHAVE_TOKEN, t) } catch { /* sem espaço */ }
    void offlineSet('sw-token', t).catch(() => {})
  }
  supabase.auth.getSession().then(({ data }) => salvar(data.session?.access_token)).catch(() => {})
  supabase.auth.onAuthStateChange((_e, s) => salvar(s?.access_token))
}

async function tokenParaEnvio(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) return data.session.access_token
  } catch { /* usa o guardado */ }
  try { return localStorage.getItem(CHAVE_TOKEN) || '' } catch { return '' }
}

export type RespostaServidor = { ok: boolean; idOs?: number; erro?: string; alcancou: boolean }

/** manda o relatório para o servidor gravar. alcancou=false: não chegou lá (sem sinal, timeout, servidor fora). */
export async function enviarRelatorioAoServidor(payload: Record<string, unknown>, ms = 25_000): Promise<RespostaServidor> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: false, alcancou: false, erro: 'sem internet' }
  const token = await tokenParaEnvio()
  if (!token) return { ok: false, alcancou: false, erro: 'sem login guardado no aparelho' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch('/api/relatorio/receber', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ payload }),
      signal: ctrl.signal,
    })
    const j = await r.json().catch(() => ({})) as { ok?: boolean; idOs?: number; erro?: string; error?: string }
    if (!r.ok) return { ok: false, alcancou: r.status !== 502 && r.status !== 503 && r.status !== 504, erro: j.erro || j.error || `servidor ${r.status}` }
    return { ok: !!j.ok, idOs: j.idOs, erro: j.erro, alcancou: true }
  } catch (e) {
    return { ok: false, alcancou: false, erro: (e as Error)?.name === 'AbortError' ? 'o servidor demorou' : String((e as Error)?.message || e) }
  } finally { clearTimeout(t) }
}

/**
 * Pede ao celular para mandar a fila SOZINHO quando a internet voltar, mesmo com o app fechado (Background Sync —
 * Android/Chrome; no iPhone não existe e segue o envio ao abrir o app). O service worker (public/sw.js, evento
 * 'sync' com a tag 'enviar-relatorios') manda os relatórios parados para /api/relatorio/receber (José, 12/11/2026).
 */
export async function pedirEnvioEmSegundoPlano(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.ready
    const sync = (reg as unknown as { sync?: { register: (tag: string) => Promise<void> } }).sync
    if (sync) await sync.register('enviar-relatorios')
  } catch { /* sem suporte: fica o envio ao abrir o app */ }
}

/** há relatório final parado na fila? (para pedir o envio em segundo plano ao abrir o app) */
export async function temRelatorioNaFila(): Promise<boolean> {
  try { return (await getQueue()).some((i) => ehRelatorioFinal(i)) } catch { return false }
}

/** item da fila que é o relatório final (não só fotos, não rascunho) */
const ehRelatorioFinal = (i: SyncItem) =>
  i.table === 'Ordem_Servico_Tecnicos' && i.data?.Status === 'enviado' && typeof i.data?.Ordem_Servico === 'string'

/** item da fila que só sobe a fase/garantia da OS (o servidor já faz isso ao gravar o relatório) */
const ehFaseDaOS = (i: SyncItem, os: string) =>
  i.table === 'Ordem_Servico' && String(i.match?.Id_Ordem || '') === os
  && Object.keys(i.data || {}).every((k) => k === 'Status' || k === 'Tipo_Servico')

/**
 * Resgate da fila do celular pelo servidor: todo relatório final parado na fila (login vencido, sinal, erro) vai
 * para o servidor — não precisa de login válido. O que o servidor gravou sai da fila (com o item de fase da OS).
 * O PDF continua pendente no aparelho e sai quando der. Devolve quantos relatórios o servidor gravou.
 */
export async function resgatarFilaPeloServidor(): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0
  let fila: SyncItem[]
  try { fila = await getQueue() } catch { return 0 }
  // o mais novo de cada OS (duas edições na fila: vale a última)
  const porOS = new Map<string, SyncItem>()
  for (const i of fila) if (ehRelatorioFinal(i)) {
    const os = String(i.data.Ordem_Servico)
    const atual = porOS.get(os)
    if (!atual || (i.createdAt || 0) >= (atual.createdAt || 0)) porOS.set(os, i)
  }
  let gravados = 0
  for (const [os, item] of porOS) {
    const r = await enviarRelatorioAoServidor(item.data)
    if (!r.alcancou) break // sem sinal: tenta na próxima
    if (!r.ok) { console.warn('[relatorio] servidor não gravou', os, r.erro); continue }
    gravados++
    for (const i of fila) {
      if (!i.id) continue
      if ((ehRelatorioFinal(i) && i.data.Ordem_Servico === os) || ehFaseDaOS(i, os)) await removeFromQueue(i.id).catch(() => {})
    }
  }
  return gravados
}
