/**
 * Cache persistente com IndexedDB + Fila de sync offline.
 * Dados ficam salvos mesmo sem internet e sobem quando reconectar.
 */

const DB_NAME = 'nt-mecanicos-offline'
const DB_VERSION = 1
const STORE_CACHE = 'cache'
const STORE_QUEUE = 'syncQueue'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
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
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_CACHE, 'readonly')
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
    const db = await openDB()
    const tx = db.transaction(STORE_CACHE, 'readwrite')
    const store = tx.objectStore(STORE_CACHE)
    store.put({ key, data, timestamp: Date.now() })
    await awaitTx(tx)
  } catch (err) {
    console.error('[offline] Erro ao salvar cache:', err)
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
}

export async function queueSync(item: Omit<SyncItem, 'id' | 'createdAt' | 'retries'>): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE_QUEUE, 'readwrite')
  const store = tx.objectStore(STORE_QUEUE)
  store.add({ ...item, createdAt: Date.now(), retries: 0 })
  await awaitTx(tx)
}

export async function getQueue(): Promise<SyncItem[]> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_QUEUE, 'readonly')
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
    const db = await openDB()
    const tx = db.transaction(STORE_QUEUE, 'readwrite')
    const store = tx.objectStore(STORE_QUEUE)
    store.delete(id)
    await awaitTx(tx)
  } catch (err) {
    console.error('[offline] Erro ao remover da fila:', err)
  }
}

export async function updateQueueItem(id: number, updates: Partial<SyncItem>): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_QUEUE, 'readwrite')
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
