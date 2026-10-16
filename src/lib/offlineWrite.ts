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

type WriteResult = { ok: boolean; queued: boolean; error?: string }

function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), WRITE_TIMEOUT) }),
  ]).finally(() => clearTimeout(timer))
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
    msg.includes('aborted') ||
    msg.includes('socket')
  )
}

/** Enfileira no IndexedDB. Se nem isso der (armazenamento cheio/bloqueado),
 *  devolve erro em vez de estourar exceção — quem chama mostra o alerta e o
 *  formulário continua na tela (antes o botão ficava travado em "Enviando..."). */
async function enfileirar(item: Omit<WriteOptions, 'match'> & { match?: Record<string, unknown> }): Promise<WriteResult> {
  try {
    await queueSync(item)
    return { ok: true, queued: true }
  } catch (err) {
    console.error('[offlineWrite] Falha ao enfileirar:', err)
    return {
      ok: false, queued: false,
      error: 'Sem conexão e não foi possível salvar no aparelho (armazenamento cheio?). Libere espaço e tente de novo.',
    }
  }
}

export async function offlineWrite(opts: WriteOptions): Promise<WriteResult> {
  const queueItem = { table: opts.table, action: opts.action, data: opts.data, match: opts.match }

  // Se offline, vai direto pra fila (queueSync agora aguarda a transação)
  if (!navigator.onLine) {
    return enfileirar(queueItem)
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
        return enfileirar(queueItem)
      }
      return { ok: false, queued: false, error: result.error.message }
    }

    return { ok: true, queued: false }
  } catch {
    // Erro de rede, enfileira
    return enfileirar(queueItem)
  }
}
