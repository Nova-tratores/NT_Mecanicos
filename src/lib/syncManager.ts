/**
 * Gerenciador de sync offline → online.
 * Processa a fila do IndexedDB quando volta a ter internet.
 */

import { supabase } from './supabase'
import { getQueue, removeFromQueue, updateQueueItem, type SyncItem } from './offlineCache'

let syncing = false
const MAX_RETRIES = 10
const SYNC_TIMEOUT = 45000

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

function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('sync timeout')), SYNC_TIMEOUT)),
  ])
}

// Campos que podem conter fotos em base64 pendentes de upload
const FOTO_FIELDS = [
  'FotoHorimetro', 'FotoChassis', 'FotoFrente', 'FotoDireita', 'FotoEsquerda',
  'FotoTraseira', 'FotoVolante', 'FotoFalha1', 'FotoFalha2', 'FotoFalha3', 'FotoFalha4',
  'FotoPecaNova1', 'FotoPecaNova2', 'FotoPecaInstalada1', 'FotoPecaInstalada2', 'FotoAlmoco',
  'FotoExtra1', 'FotoExtra2', 'FotoExtra3', 'FotoExtra4', 'FotoExtra5',
]

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

export async function processQueue(): Promise<number> {
  if (syncing) return 0
  if (!navigator.onLine) return 0

  syncing = true
  let processed = 0

  try {
    const items = await getQueue()
    if (items.length === 0) return 0

    console.log(`[sync] Processando ${items.length} item(s) pendente(s)...`)

    for (const item of items) {
      if (item.failed) continue
      try {
        // Resolver fotos base64 antes de gravar
        let data = item.data
        let fotoPendente = false
        if (item.table === 'Ordem_Servico_Tecnicos') {
          const r = await resolverFotosPendentes(item.data)
          data = r.data
          fotoPendente = r.pendente
        }

        let result

        if (item.action === 'insert') {
          result = await withTimeout(supabase.from(item.table).insert(data))
        } else if (item.action === 'update' && item.match) {
          let query = supabase.from(item.table).update(data)
          for (const [k, v] of Object.entries(item.match)) {
            query = query.eq(k, v)
          }
          result = await withTimeout(query)
        } else if (item.action === 'upsert') {
          result = await withTimeout(supabase.from(item.table).upsert(data))
        } else if (item.action === 'delete' && item.match) {
          let query = supabase.from(item.table).delete()
          for (const [k, v] of Object.entries(item.match)) {
            query = query.eq(k, v)
          }
          result = await withTimeout(query)
        }

        if (result?.error) {
          const retries = (item.retries || 0) + 1
          const errMsg = result.error.message || String(result.error)
          if (retries >= MAX_RETRIES) {
            console.error(`[sync] Item ${item.id} falhou ${MAX_RETRIES}x, marcando como falha permanente:`, result.error)
            if (item.id) await updateQueueItem(item.id, { retries, failed: true, failedAt: Date.now(), lastError: errMsg })
            await logFailureToServer(item, errMsg)
            syncFailListeners.forEach(cb => cb(item, errMsg))
          } else {
            console.warn(`[sync] Item ${item.id} falhou (tentativa ${retries}/${MAX_RETRIES}):`, errMsg)
            if (item.id) await updateQueueItem(item.id, { retries })
          }
          continue
        }

        if (fotoPendente && item.id) {
          // Dados gravados no banco mas algumas fotos ficaram como base64.
          // Atualiza o item na fila com os dados parcialmente resolvidos
          // para tentar subir as fotos restantes no próximo sync.
          await updateQueueItem(item.id, { data, action: 'update', match: item.match || { IdOs: data.Ordem_Servico } })
          console.warn(`[sync] Item ${item.id} gravado, mas ${item.table} tem fotos pendentes — tentará de novo`)
        } else {
          if (item.id) await removeFromQueue(item.id)
          console.log(`[sync] Item ${item.id} sincronizado (${item.table}/${item.action})`)
        }
        processed++
      } catch (err) {
        console.error(`[sync] Erro no item ${item.id}:`, err)
        const retries = (item.retries || 0) + 1
        const errMsg = String((err as { message?: string })?.message || err)
        if (item.id) {
          if (retries >= MAX_RETRIES) {
            await updateQueueItem(item.id, { retries, failed: true, failedAt: Date.now(), lastError: errMsg })
            await logFailureToServer(item, errMsg)
            syncFailListeners.forEach(cb => cb(item, errMsg))
          } else {
            await updateQueueItem(item.id, { retries })
          }
        }
      }
    }

    if (processed > 0) {
      console.log(`[sync] ${processed} item(s) sincronizado(s) com sucesso`)
    }
  } finally {
    syncing = false
  }

  return processed
}

/** Registra listeners para sync automático quando volta online */
export function startAutoSync() {
  if (typeof window === 'undefined') return

  // Sync quando volta online
  window.addEventListener('online', () => {
    console.log('[sync] Conexão restaurada, sincronizando...')
    processQueue()
  })

  // Sync quando o app volta ao foco
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      processQueue()
    }
  })

  // Sync inicial se tiver internet
  if (navigator.onLine) {
    processQueue()
  }
}
