/**
 * Gerenciador de sync offline → online.
 * Processa a fila do IndexedDB quando volta a ter internet.
 */

import { supabase } from './supabase'
import { getQueue, removeFromQueue, updateQueueItem, getPendingPdfs, removePendingPdf, type SyncItem } from './offlineCache'
import { executarEscrita, isNetworkError } from './offlineWrite'
import { gerarEAnexarRelatorio } from './gerarEAnexarRelatorio'

const MAX_RETRIES = 10
const SYNC_TIMEOUT = 45000

// Erro de REDE (timeout, sem sinal, DNS…) nunca pode aposentar um item da
// fila — ela existe exatamente pra aguentar sinal ruim na roça. Só erro de
// DADO (RLS, coluna, constraint) vira falha permanente após MAX_RETRIES.
// (Caso real: OS-0670 — 10 timeouts seguidos mataram o relatório no aparelho.)
// (isNetworkError vem de offlineWrite — a mesma regra nos dois lugares.)

const syncFailListeners: Array<(item: SyncItem, error: string) => void> = []
export function onSyncFail(cb: (item: SyncItem, error: string) => void) {
  syncFailListeners.push(cb)
  return () => { const i = syncFailListeners.indexOf(cb); if (i >= 0) syncFailListeners.splice(i, 1) }
}

async function logFailureToServer(item: SyncItem, errorMsg: string) {
  try {
    await supabase.from('sync_failures').insert({
      tabela: item.table,
      acao: item.action,
      payload: item.data,
      match_filter: item.match || null,
      erro: errorMsg,
      criado_em: new Date().toISOString(),
      os_id: item.data?.Ordem_Servico || item.data?.Id_Ordem || item.match?.Id_Ordem || null,
    })
  } catch { /* melhor não travar por causa do log */ }
}

// Campos que podem conter fotos em base64 pendentes de upload
const FOTO_FIELDS = [
  'FotoHorimetro', 'FotoChassis', 'FotoFrente', 'FotoDireita', 'FotoEsquerda',
  'FotoTraseira', 'FotoVolante', 'FotoFalha1', 'FotoFalha2', 'FotoFalha3', 'FotoFalha4',
  'FotoPecaNova1', 'FotoPecaNova2', 'FotoPecaInstalada1', 'FotoPecaInstalada2', 'FotoAlmoco',
  'FotoExtra1', 'FotoExtra2', 'FotoExtra3', 'FotoExtra4', 'FotoExtra5',
]

/* Fotos que não sobem (José, 23/10/2026): o item vira update SÓ dos campos de foto, cada rodada conta uma
   tentativa e, depois de MAX_TENTATIVAS_FOTO, vira falha visível (não trava o PDF nem o Status da OS). */
const MAX_TENTATIVAS_FOTO = 12
const CAMPOS_DE_FOTO = new Set([...FOTO_FIELDS, 'AlmocosFotos', 'FotosExtras', 'AssCliente', 'AssTecnico'])

/** só os campos de foto do payload (+ nº da OS, que diz qual relatório atualizar) */
function soCamposDeFoto(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { Ordem_Servico: data.Ordem_Servico }
  for (const [k, v] of Object.entries(data)) if (CAMPOS_DE_FOTO.has(k)) out[k] = v
  return out
}

/** item que já é só o reenvio das fotos de um relatório que subiu */
function ehSoFotos(item: SyncItem): boolean {
  if (item.table !== 'Ordem_Servico_Tecnicos' || item.action !== 'update') return false
  return Object.keys(item.data || {}).every((k) => k === 'Ordem_Servico' || CAMPOS_DE_FOTO.has(k))
}

/** Upload de uma foto base64 para Supabase Storage. Retorna URL ou null se falhou. */
async function uploadBase64Foto(base64: string, campo: string, osId: string): Promise<string | null> {
  try {
    const res = await fetch(base64)
    const blob = await res.blob()
    const path = `os-tecnicos/${osId}/${campo}_sync_${Date.now()}.jpg`
    const { error } = await supabase.storage.from('requisicoes').upload(path, blob, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from('requisicoes').getPublicUrl(path)
      return data.publicUrl
    }
    console.error(`[sync] Upload foto ${campo} falhou:`, error.message)
  } catch (err) {
    console.error(`[sync] Erro upload base64 ${campo}:`, err)
  }
  return null
}

/** Resolve fotos base64 pendentes no payload antes de sincronizar.
 *  Retorna { data, pendente } — pendente=true se alguma foto não subiu. */
async function resolverFotosPendentes(data: Record<string, unknown>): Promise<{ data: Record<string, unknown>; pendente: boolean }> {
  const osId = String(data.Ordem_Servico || 'unknown')
  const resolved = { ...data }
  let pendente = false

  for (const campo of FOTO_FIELDS) {
    const valor = resolved[campo]
    if (typeof valor === 'string' && valor.startsWith('data:')) {
      const url = await uploadBase64Foto(valor, campo, osId)
      if (url) {
        resolved[campo] = url
      } else {
        pendente = true
      }
    }
  }

  // AlmocosFotos: array de {data, valor?, foto} — cada foto pode ser base64
  const almocos = resolved.AlmocosFotos
  if (Array.isArray(almocos)) {
    const resolvedAlmocos = []
    for (const item of almocos) {
      const obj = (item || {}) as Record<string, unknown>
      const foto = obj.foto
      if (typeof foto === 'string' && foto.startsWith('data:')) {
        const url = await uploadBase64Foto(foto, `FotoAlmoco_${obj.data || 'x'}`, osId)
        if (url) {
          resolvedAlmocos.push({ ...obj, foto: url })
        } else {
          resolvedAlmocos.push(obj)
          pendente = true
        }
      } else {
        resolvedAlmocos.push(obj)
      }
    }
    resolved.AlmocosFotos = resolvedAlmocos
    // Manter FotoAlmoco (legacy) em sincronia com o primeiro item
    if (resolvedAlmocos.length > 0) {
      const primeiraFoto = (resolvedAlmocos[0] as Record<string, unknown>).foto
      if (typeof primeiraFoto === 'string' && !primeiraFoto.startsWith('data:')) {
        resolved.FotoAlmoco = primeiraFoto
      }
    }
  }

  // FotosExtras: array de URLs/base64
  const extras = resolved.FotosExtras
  if (Array.isArray(extras)) {
    const resolvedExtras = []
    for (let i = 0; i < extras.length; i++) {
      const foto = extras[i] as string
      if (typeof foto === 'string' && foto.startsWith('data:')) {
        const url = await uploadBase64Foto(foto, `FotoExtra${i + 1}`, osId)
        if (url) {
          resolvedExtras.push(url)
        } else {
          resolvedExtras.push(foto)
          pendente = true
        }
      } else {
        resolvedExtras.push(foto)
      }
    }
    resolved.FotosExtras = resolvedExtras
    // Manter colunas legacy Extra1-5
    for (let i = 0; i < 5; i++) {
      const v = resolvedExtras[i]
      if (typeof v === 'string' && !v.startsWith('data:')) {
        resolved[`FotoExtra${i + 1}`] = v
      }
    }
  }

  // Assinaturas também podem ser base64
  for (const campo of ['AssCliente', 'AssTecnico']) {
    const valor = resolved[campo]
    if (typeof valor === 'string' && valor.startsWith('data:')) {
      const url = await uploadBase64Foto(valor, campo, osId)
      if (url) {
        resolved[campo] = url
      } else {
        pendente = true
      }
    }
  }

  return { data: resolved, pendente }
}

/** chave da OS do item (para ligar relatório e Status da mesma OS) */
function osDoItem(item: SyncItem): string | null {
  const d = item.data || {}, m = item.match || {}
  if (item.table === 'Ordem_Servico_Tecnicos') return d.Ordem_Servico ? String(d.Ordem_Servico) : (m.Ordem_Servico ? String(m.Ordem_Servico) : null)
  if (item.table === 'Ordem_Servico') return m.Id_Ordem ? String(m.Id_Ordem) : null
  return null
}

// Um fluxo só (José, 23/10/2026): o 'online' disparava dois processQueue (este arquivo e o OfflineSync) e os PDFs
// rodavam antes da fila subir. Agora quem chama aguarda a MESMA rodada em andamento.
let rodada: Promise<number> | null = null

export function processQueue(): Promise<number> {
  if (rodada) return rodada
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve(0)
  rodada = processarFila().finally(() => { rodada = null })
  return rodada
}

async function processarFila(): Promise<number> {
  let processed = 0

  try {
    const items = await getQueue()
    if (items.length === 0) return 0

    // sem sessão válida o banco recusa tudo (0 linhas) e cada volta do app gastava uma tentativa até virar
    // "falha": sem login, a fila só espera (José, 23/10/2026)
    const { data: sess } = await supabase.auth.getSession()
    if (!sess.session || (sess.session.expires_at && sess.session.expires_at * 1000 < Date.now() - 60_000)) {
      console.warn('[sync] sem sessão válida: a fila espera o técnico entrar de novo')
      return 0
    }

    console.log(`[sync] Processando ${items.length} item(s) pendente(s)...`)

    // OS cujo relatório NÃO subiu nesta rodada: o update de Status 'Relatório Concluído' dela fica esperando
    // (antes a OS ia pra fase seguinte no portal sem relatório nenhum).
    const relatorioTravado = new Set<string>()

    for (const item of items) {
      const osItem = osDoItem(item)
      if (item.failed) {
        if (item.table === 'Ordem_Servico_Tecnicos' && osItem && !ehSoFotos(item)) relatorioTravado.add(osItem)
        continue
      }
      if (item.table === 'Ordem_Servico' && osItem && relatorioTravado.has(osItem)) {
        console.warn(`[sync] Item ${item.id}: Status da ${osItem} espera o relatório subir`)
        continue
      }
      try {
        // Resolver fotos base64 antes de gravar
        let data = item.data
        let fotoPendente = false
        if (item.table === 'Ordem_Servico_Tecnicos') {
          const r = await resolverFotosPendentes(item.data)
          data = r.data
          fotoPendente = r.pendente
        }

        // enfileiradoEm: o insert da fila confere se a linha já subiu desde o enfileiramento (sem duplicar)
        const result = await executarEscrita({ table: item.table, action: item.action, data, match: item.match, enfileiradoEm: item.createdAt }, SYNC_TIMEOUT)

        if (result.error) {
          if (item.table === 'Ordem_Servico_Tecnicos' && osItem && !ehSoFotos(item)) relatorioTravado.add(osItem)
          const retries = (item.retries || 0) + 1
          const errMsg = result.error.message || String(result.error)
          if (isNetworkError(result.error)) {
            // Rede ruim: registra a tentativa mas NUNCA marca como falha
            console.warn(`[sync] Item ${item.id} falhou por rede (tentativa ${retries}), fica na fila:`, errMsg)
            if (item.id) await updateQueueItem(item.id, { retries, lastError: errMsg })
          } else if (retries >= MAX_RETRIES) {
            console.error(`[sync] Item ${item.id} falhou ${MAX_RETRIES}x, marcando como falha permanente:`, result.error)
            if (item.id) await updateQueueItem(item.id, { retries, failed: true, failedAt: Date.now(), lastError: errMsg })
            await logFailureToServer(item, errMsg)
            syncFailListeners.forEach(cb => cb(item, errMsg))
          } else {
            console.warn(`[sync] Item ${item.id} falhou (tentativa ${retries}/${MAX_RETRIES}):`, errMsg)
            if (item.id) await updateQueueItem(item.id, { retries, lastError: errMsg })
          }
          continue
        }

        if (fotoPendente && item.id) {
          // Dados gravados no banco mas algumas fotos ficaram como base64. O item vira update SÓ das fotos da
          // MESMA OS (por Ordem_Servico), contando tentativas; esgotou = falha visível e libera o PDF.
          const tentativas = ehSoFotos(item) ? (item.retries || 0) + 1 : 1
          const errMsg = `fotos do relatório não subiram (tentativa ${tentativas}/${MAX_TENTATIVAS_FOTO})`
          const fotos = soCamposDeFoto(data)
          if (tentativas >= MAX_TENTATIVAS_FOTO) {
            const falhou = { ...item, data: fotos, action: 'update' as const, match: { Ordem_Servico: data.Ordem_Servico } }
            await updateQueueItem(item.id, { data: fotos, action: 'update', match: { Ordem_Servico: data.Ordem_Servico }, retries: tentativas, failed: true, failedAt: Date.now(), lastError: errMsg })
            await logFailureToServer(falhou, errMsg)
            syncFailListeners.forEach(cb => cb(falhou, errMsg))
            console.error(`[sync] Item ${item.id}: ${errMsg} — desistiu`)
          } else {
            await updateQueueItem(item.id, { data: fotos, action: 'update', match: { Ordem_Servico: data.Ordem_Servico }, retries: tentativas, lastError: errMsg })
            console.warn(`[sync] Item ${item.id} gravado, mas ${errMsg} — tentará de novo`)
          }
        } else {
          if (item.id) await removeFromQueue(item.id)
          console.log(`[sync] Item ${item.id} sincronizado (${item.table}/${item.action})`)
        }
        processed++
      } catch (err) {
        console.error(`[sync] Erro no item ${item.id}:`, err)
        if (item.table === 'Ordem_Servico_Tecnicos' && osItem && !ehSoFotos(item)) relatorioTravado.add(osItem)
        const retries = (item.retries || 0) + 1
        const errMsg = String((err as { message?: string })?.message || err)
        if (item.id) {
          if (isNetworkError(err)) {
            // Rede ruim (timeout do withTimeout cai aqui): fica na fila pra sempre
            await updateQueueItem(item.id, { retries, lastError: errMsg })
          } else if (retries >= MAX_RETRIES) {
            await updateQueueItem(item.id, { retries, failed: true, failedAt: Date.now(), lastError: errMsg })
            await logFailureToServer(item, errMsg)
            syncFailListeners.forEach(cb => cb(item, errMsg))
          } else {
            await updateQueueItem(item.id, { retries, lastError: errMsg })
          }
        }
      }
    }

    if (processed > 0) {
      console.log(`[sync] ${processed} item(s) sincronizado(s) com sucesso`)
    }
  } finally {
    /* nada a liberar: a rodada é limpa em processQueue */
  }

  return processed
}

/** Ressuscita itens que versões antigas marcaram como falha permanente por
 *  ERRO DE REDE (10 timeouts seguidos matavam o item). Com a regra nova,
 *  rede nunca aposenta — então devolve esses pra fila ativa. */
export async function ressuscitarFalhasDeRede(): Promise<number> {
  const items = await getQueue()
  let n = 0
  for (const item of items) {
    if (item.failed && (!item.lastError || isNetworkError(item.lastError))) {
      if (item.id) {
        await updateQueueItem(item.id, { failed: false, retries: 0, failedAt: undefined })
        n++
      }
    }
  }
  if (n > 0) console.log(`[sync] ${n} item(s) marcados como falha por rede voltaram pra fila`)
  return n
}

/* ═══ PDFs das OS enviadas sem internet ═══
   Só depois que a fila daquela OS subiu (senão o PDF sairia do banco ainda antigo). */
export async function processarPdfsPendentes(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  const list = await getPendingPdfs()
  if (list.length === 0) return
  const fila = await getQueue()
  // foto que desistiu (falha) não segura o PDF para sempre
  const comFila = new Set(fila.filter((i) => i.table === 'Ordem_Servico_Tecnicos' && !(i.failed && ehSoFotos(i))).map((i) => String(i.data?.Ordem_Servico || i.match?.Ordem_Servico || '')))
  for (const osId of list) {
    if (comFila.has(osId)) continue // relatório ainda na fila: fica para a próxima rodada
    try {
      const ok = await gerarEAnexarRelatorio(osId, { forcar: true })
      if (ok) await removePendingPdf(osId)
    } catch { /* tenta de novo na próxima reconexão */ }
  }
}

/* ═══ Um fluxo só: sobe a fila e DEPOIS os PDFs (José, 23/10/2026) ═══ */
export type EstadoSync = { rodando: boolean; enviados: number }
const estadoListeners: Array<(e: EstadoSync) => void> = []
export function onSyncEstado(cb: (e: EstadoSync) => void) {
  estadoListeners.push(cb)
  return () => { const i = estadoListeners.indexOf(cb); if (i >= 0) estadoListeners.splice(i, 1) }
}
let tudo: Promise<number> | null = null
export function sincronizarTudo(): Promise<number> {
  if (tudo) return tudo
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve(0)
  tudo = (async () => {
    estadoListeners.forEach((cb) => cb({ rodando: true, enviados: 0 }))
    let n = 0
    try {
      n = await processQueue()
      // atualizações de requisição guardadas no celular (comprovante sem sinal) sobem junto (José, 23/10/2026)
      try { const { enviarPendentes } = await import('@/app/(tecnico)/requisicoes/_util'); n += await enviarPendentes() } catch { /* tenta no próximo sync */ }
      await processarPdfsPendentes()
    } finally {
      estadoListeners.forEach((cb) => cb({ rodando: false, enviados: n }))
    }
    return n
  })().finally(() => { tudo = null })
  return tudo
}

/** Registra listeners para sync automático quando volta online */
let autoIniciado = false
export function startAutoSync() {
  if (typeof window === 'undefined' || autoIniciado) return
  autoIniciado = true

  // Sync quando volta online
  window.addEventListener('online', () => {
    console.log('[sync] Conexão restaurada, sincronizando...')
    void sincronizarTudo()
  })

  // Sync quando o app volta ao foco
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void sincronizarTudo()
    }
  })

  // Sync inicial se tiver internet (antes, devolve pra fila o que morreu por rede)
  if (navigator.onLine) {
    ressuscitarFalhasDeRede().then(() => sincronizarTudo())
  }
}
