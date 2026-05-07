/**
 * Gerenciador de sync offline → online.
 * Processa a fila do IndexedDB quando volta a ter internet.
 */

import { supabase } from './supabase'
import { getQueue, removeFromQueue, updateQueueItem, type SyncItem } from './offlineCache'

let syncing = false
const MAX_RETRIES = 5

// Campos que podem conter fotos em base64 pendentes de upload
const FOTO_FIELDS = [
  'FotoHorimetro', 'FotoChassis', 'FotoFrente', 'FotoDireita', 'FotoEsquerda',
  'FotoTraseira', 'FotoVolante', 'FotoFalha1', 'FotoFalha2', 'FotoFalha3', 'FotoFalha4',
  'FotoPecaNova1', 'FotoPecaNova2', 'FotoPecaInstalada1', 'FotoPecaInstalada2', 'FotoAlmoco',
]

/** Upload de uma foto base64 para Supabase Storage */
async function uploadBase64Foto(base64: string, table: string, campo: string, osId: string): Promise<string> {
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
  return ''
}

/** Resolve fotos base64 pendentes no payload antes de sincronizar */
async function resolverFotosPendentes(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const osId = String(data.Ordem_Servico || 'unknown')
  const resolved = { ...data }
  for (const campo of FOTO_FIELDS) {
    const valor = resolved[campo]
    if (typeof valor === 'string' && valor.startsWith('data:')) {
      const url = await uploadBase64Foto(valor, 'Ordem_Servico_Tecnicos', campo, osId)
      resolved[campo] = url // URL do Supabase ou '' se falhou
    }
  }
  return resolved
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
      try {
        // Resolver fotos base64 antes de gravar
        const data = item.table === 'Ordem_Servico_Tecnicos'
          ? await resolverFotosPendentes(item.data)
          : item.data

        let result

        if (item.action === 'insert') {
          result = await supabase.from(item.table).insert(data)
        } else if (item.action === 'update' && item.match) {
          let query = supabase.from(item.table).update(data)
          for (const [k, v] of Object.entries(item.match)) {
            query = query.eq(k, v)
          }
          result = await query
        } else if (item.action === 'upsert') {
          result = await supabase.from(item.table).upsert(data)
        }

        if (result?.error) {
          const retries = (item.retries || 0) + 1
          if (retries >= MAX_RETRIES) {
            console.error(`[sync] Item ${item.id} falhou ${MAX_RETRIES}x, removendo da fila:`, result.error)
            if (item.id) await removeFromQueue(item.id)
          } else {
            console.warn(`[sync] Item ${item.id} falhou (tentativa ${retries}/${MAX_RETRIES}):`, result.error.message)
            if (item.id) await updateQueueItem(item.id, { retries })
          }
          continue
        }

        if (item.id) await removeFromQueue(item.id)
        processed++
        console.log(`[sync] Item ${item.id} sincronizado (${item.table}/${item.action})`)
      } catch (err) {
        console.error(`[sync] Erro no item ${item.id}:`, err)
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
