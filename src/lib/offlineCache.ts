/**
 * Cache persistente com IndexedDB + Fila de sync offline.
 * Dados ficam salvos mesmo sem internet e sobem quando reconectar.
 */

const DB_NAME = 'nt-mecanicos-offline'
const DB_VERSION = 1
const STORE_CACHE = 'cache'
const STORE_QUEUE = 'syncQueue'

// Uma conexão só, reaproveitada. Antes cada leitura/escrita abria uma conexão
// nova que nunca era fechada (o prefetch faz centenas de offlineSet) — vazava
// memória no celular e podia bloquear upgrades de versão do banco.
let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // Outra aba/SW pediu upgrade, ou o navegador fechou a conexão:
      // descarta a referência para a próxima chamada reabrir.
      db.onversionchange = () => { db.close(); dbPromise = null }
      db.onclose = () => { dbPromise = null }
      resolve(db)
    }
    req.onerror = () => { dbPromise = null; reject(req.error) }
  })
  dbPromise = p
  return p
}

/** Abre uma transação; se a conexão em cache morreu, reabre uma vez. */
async function openTx(store: string, mode: IDBTransactionMode): Promise<IDBTransaction> {
  const db = await openDB()
  try {
    return db.transaction(store, mode)
  } catch {
    dbPromise = null
    const db2 = await openDB()
    return db2.transaction(store, mode)
  }
}

/** Aguarda a transação completar de verdade */
function awaitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'))
  })
}

// ═══ Cache persistente ═══

export async function offlineGet<T>(key: string): Promise<T | null> {
  try {
    const tx = await openTx(STORE_CACHE, 'readonly')
    return await new Promise((resolve) => {
      const store = tx.objectStore(STORE_CACHE)
      const req = store.get(key)
      req.onsuccess = () => resolve(req.result ? req.result.data : null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function offlineSet<T>(key: string, data: T): Promise<void> {
  try {
    const tx = await openTx(STORE_CACHE, 'readwrite')
    const store = tx.objectStore(STORE_CACHE)
    store.put({ key, data, timestamp: Date.now() })
    await awaitTx(tx)
  } catch (err) {
    console.error('[offline] Erro ao salvar cache:', err)
  }
}

export async function offlineDelete(key: string): Promise<void> {
  try {
    const tx = await openTx(STORE_CACHE, 'readwrite')
    tx.objectStore(STORE_CACHE).delete(key)
    await awaitTx(tx)
  } catch (err) {
    console.error('[offline] Erro ao apagar cache:', err)
  }
}

// ═══ Fila de sync offline ═══

export interface SyncItem {
  id?: number
  table: string
  action: 'insert' | 'update' | 'upsert' | 'delete'
  data: Record<string, unknown>
  match?: Record<string, unknown> // para updates/deletes: { id: 123 }
  createdAt: number
  retries?: number
  failed?: boolean
  failedAt?: number
  lastError?: string
}

export async function queueSync(item: Omit<SyncItem, 'id' | 'createdAt' | 'retries'>): Promise<void> {
  const tx = await openTx(STORE_QUEUE, 'readwrite')
  const store = tx.objectStore(STORE_QUEUE)
  store.add({ ...item, createdAt: Date.now(), retries: 0 })
  await awaitTx(tx)
}

export async function getQueue(): Promise<SyncItem[]> {
  try {
    const tx = await openTx(STORE_QUEUE, 'readonly')
    return await new Promise((resolve) => {
      const store = tx.objectStore(STORE_QUEUE)
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => resolve([])
    })
  } catch {
    return []
  }
}

export async function removeFromQueue(id: number): Promise<void> {
  try {
    const tx = await openTx(STORE_QUEUE, 'readwrite')
    const store = tx.objectStore(STORE_QUEUE)
    store.delete(id)
    await awaitTx(tx)
  } catch (err) {
    console.error('[offline] Erro ao remover da fila:', err)
  }
}

export async function updateQueueItem(id: number, updates: Partial<SyncItem>): Promise<void> {
  try {
    const tx = await openTx(STORE_QUEUE, 'readwrite')
    const store = tx.objectStore(STORE_QUEUE)
    const req = store.get(id)
    req.onsuccess = () => {
      if (req.result) {
        store.put({ ...req.result, ...updates })
      }
    }
    await awaitTx(tx)
  } catch (err) {
    console.error('[offline] Erro ao atualizar item na fila:', err)
  }
}

export async function getQueueCount(): Promise<number> {
  const items = await getQueue()
  return items.length
}

export async function getFailedItems(): Promise<SyncItem[]> {
  const items = await getQueue()
  return items.filter(i => i.failed)
}

export async function retryFailedItem(id: number): Promise<void> {
  await updateQueueItem(id, { failed: false, retries: 0, lastError: undefined, failedAt: undefined })
}

// ═══ OS enviadas offline aguardando geração do PDF (anexar no portal) ═══

const PENDING_PDF_KEY = 'pending-pdfs'

export async function addPendingPdf(osId: string): Promise<void> {
  const list = (await offlineGet<string[]>(PENDING_PDF_KEY)) || []
  if (!list.includes(osId)) {
    list.push(osId)
    await offlineSet(PENDING_PDF_KEY, list)
  }
}

export async function getPendingPdfs(): Promise<string[]> {
  return (await offlineGet<string[]>(PENDING_PDF_KEY)) || []
}

export async function removePendingPdf(osId: string): Promise<void> {
  const list = (await offlineGet<string[]>(PENDING_PDF_KEY)) || []
  await offlineSet(PENDING_PDF_KEY, list.filter((x) => x !== osId))
}
