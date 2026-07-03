/**
 * Helper para operações de escrita com fallback offline.
 * Se online, faz a operação direto no Supabase.
 * Se offline (ou se falhar por rede), enfileira no IndexedDB para sync depois.
 */

import { supabase } from './supabase'
import { queueSync } from './offlineCache'

const WRITE_TIMEOUT = 8000

interface WriteOptions {
  table: string
  action: 'insert' | 'update' | 'upsert' | 'delete'
  data: Record<string, unknown>
  match?: Record<string, unknown>
}

function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), WRITE_TIMEOUT)),
  ])
}

function isNetworkError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '').toLowerCase()
  return (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('dns') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('aborted')
  )
}

export async function offlineWrite(opts: WriteOptions): Promise<{ ok: boolean; queued: boolean; error?: string }> {
  const queueItem = { table: opts.table, action: opts.action, data: opts.data, match: opts.match }

  // Se offline, vai direto pra fila (queueSync agora aguarda a transação)
  if (!navigator.onLine) {
    await queueSync(queueItem)
    return { ok: true, queued: true }
  }

  // Tenta online
  try {
    let result

    if (opts.action === 'insert') {
      result = await withTimeout(supabase.from(opts.table).insert(opts.data))
    } else if (opts.action === 'update' && opts.match) {
      let query = supabase.from(opts.table).update(opts.data)
      for (const [k, v] of Object.entries(opts.match)) {
        query = query.eq(k, v as string | number)
      }
      result = await withTimeout(query)
    } else if (opts.action === 'upsert') {
      result = await withTimeout(supabase.from(opts.table).upsert(opts.data))
    } else if (opts.action === 'delete' && opts.match) {
      let query = supabase.from(opts.table).delete()
      for (const [k, v] of Object.entries(opts.match)) {
        query = query.eq(k, v as string | number)
      }
      result = await withTimeout(query)
    }

    if (result?.error) {
      // Se é erro de rede, enfileira
      if (isNetworkError(result.error)) {
        await queueSync(queueItem)
        return { ok: true, queued: true }
      }
      return { ok: false, queued: false, error: result.error.message }
    }

    return { ok: true, queued: false }
  } catch (err) {
    // Erro de rede, enfileira
    await queueSync(queueItem)
    return { ok: true, queued: true }
  }
}
