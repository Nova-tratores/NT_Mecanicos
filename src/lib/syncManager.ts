/**
 * Gerenciador de sync offline → online.
 * Processa a fila do IndexedDB quando volta a ter internet.
 */

import { supabase } from './supabase'
import { getQueue, removeFromQueue, updateQueueItem, type SyncItem } from './offlineCache'

// Promise do sync em andamento: quem chamar processQueue() durante um sync
// espera ESSE terminar (antes recebia 0 na hora — o OfflineSync então gerava
// o PDF antes de o relatório ter subido).
let syncingPromise: Promise<number> | null = null
let autoSyncStarted = false
const MAX_RETRIES = 10
const SYNC_TIMEOUT = 45000
const UPLOAD_TIMEOUT = 90000

// Erro de REDE (timeout, sem sinal, DNS…) nunca pode aposentar um item da
// fila — ela existe exatamente pra aguentar sinal ruim na roça. Só erro de
// DADO (RLS, coluna, constraint) vira falha permanente após MAX_RETRIES.
// (Caso real: OS-0670 — 10 timeouts seguidos mataram o relatório no aparelho.)
function isNetworkError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '').toLowerCase()
  return (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('dns') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('aborted') ||
    msg.includes('socket')
  )
}

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

function withTimeout<T>(p: PromiseLike<T>, ms = SYNC_TIMEOUT): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('sync timeout')), ms) }),
  ]).finally(() => clearTimeout(timer))
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
    // Com sinal fraco o upload podia ficar pendurado pra sempre — e como o
    // processQueue segura a flag `syncing`, a fila inteira travava até recarregar.
    const { error } = await withTimeout(supabase.storage.from('requisicoes').upload(path, blob, { upsert: true }), UPLOAD_TIMEOUT)
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
async function resolverFotosPendentes(data: Record<string, unknown>): Promise<{ data: Record<string, unknown>; pendente: boolean; subiu: boolean }> {
  const osId = String(data.Ordem_Servico || 'unknown')
  const resolved = { ...data }
  let pendente = false
  // A mesma foto aparece em mais de um campo (FotoExtra1 + FotosExtras[0],
  // FotoAlmoco + AlmocosFotos[0]) — sobe cada base64 uma vez só.
  const jaSubidas = new Map<string, string>()
  const upload = async (base64: string, campo: string): Promise<string | null> => {
    const ja = jaSubidas.get(base64)
    if (ja) return ja
    const url = await uploadBase64Foto(base64, campo, osId)
    if (url) jaSubidas.set(base64, url)
    return url
  }

  for (const campo of FOTO_FIELDS) {
    const valor = resolved[campo]
    if (typeof valor === 'string' && valor.startsWith('data:')) {
      const url = await upload(valor, campo)
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
        const url = await upload(foto, `FotoAlmoco_${obj.data || 'x'}`)
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
        const url = await upload(foto, `FotoExtra${i + 1}`)
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
      const url = await upload(valor, campo)
      if (url) {
        resolved[campo] = url
      } else {
        pendente = true
      }
    }
  }

  return { data: resolved, pendente, subiu: jaSubidas.size > 0 }
}

export function processQueue(): Promise<number> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return Promise.resolve(0)
  // Já tem sync rodando: devolve o mesmo resultado em vez de 0
  if (syncingPromise) return syncingPromise
  const p = runQueue().finally(() => { syncingPromise = null })
  syncingPromise = p
  return p
}

/** Insert de relatório que já existe no banco vira update — evita linha
 *  duplicada quando o insert original "deu timeout" mas chegou no servidor,
 *  ou quando a OS foi aberta offline sem o IdOs em cache. */
async function resolverInsertDuplicado(item: SyncItem, data: Record<string, unknown>): Promise<{ action: SyncItem['action']; match?: Record<string, unknown> }> {
  if (item.action !== 'insert' || item.table !== 'Ordem_Servico_Tecnicos' || !data.Ordem_Servico) {
    return { action: item.action, match: item.match }
  }
  const { data: existente, error } = await withTimeout(
    supabase.from('Ordem_Servico_Tecnicos').select('IdOs')
      .eq('Ordem_Servico', data.Ordem_Servico as string)
      .order('IdOs', { ascending: false }).limit(1),
  )
  if (error) throw new Error(error.message)
  const idOs = (existente as { IdOs: number }[] | null)?.[0]?.IdOs
  if (idOs) return { action: 'update', match: { IdOs: idOs } }
  return { action: 'insert' }
}

async function runQueue(): Promise<number> {
  let processed = 0

  const items = await getQueue()
  if (items.length === 0) return 0

  console.log(`[sync] Processando ${items.length} item(s) pendente(s)...`)

  for (const item of items) {
    if (item.failed) continue
    // Sinal caiu no meio: para aqui. Seguir adiante só acumula timeouts de
    // 45s por item e pode gravar itens fora de ordem (ex.: status da OS sem
    // o relatório). O resto sobe no próximo sync.
    if (!navigator.onLine) break
    let redeCaiu = false
    try {
      // Resolver fotos base64 antes de gravar
      let data = item.data
      let fotoPendente = false
      if (item.table === 'Ordem_Servico_Tecnicos') {
        const r = await resolverFotosPendentes(item.data)
        // Guarda as URLs já subidas na fila: se a gravação abaixo falhar por
        // rede, a próxima tentativa não re-envia as mesmas fotos (sinal fraco)
        if (r.subiu && item.id) {
          await updateQueueItem(item.id, { data: r.data })
        }
        data = r.data
        fotoPendente = r.pendente
      }

      const { action, match } = await resolverInsertDuplicado(item, data)

      let result

      if (action === 'insert') {
        result = await withTimeout(supabase.from(item.table).insert(data))
      } else if (action === 'update' && match) {
        let query = supabase.from(item.table).update(data)
        for (const [k, v] of Object.entries(match)) {
          query = query.eq(k, v)
        }
        result = await withTimeout(query)
      } else if (action === 'upsert') {
        result = await withTimeout(supabase.from(item.table).upsert(data))
      } else if (action === 'delete' && match) {
        let query = supabase.from(item.table).delete()
        for (const [k, v] of Object.entries(match)) {
          query = query.eq(k, v)
        }
        result = await withTimeout(query)
      }

      if (result?.error) {
        const retries = (item.retries || 0) + 1
        const errMsg = result.error.message || String(result.error)
        if (isNetworkError(result.error)) {
          // Rede ruim: registra a tentativa mas NUNCA marca como falha
          console.warn(`[sync] Item ${item.id} falhou por rede (tentativa ${retries}), fica na fila:`, errMsg)
          if (item.id) await updateQueueItem(item.id, { retries, lastError: errMsg })
          redeCaiu = true
        } else if (retries >= MAX_RETRIES) {
          console.error(`[sync] Item ${item.id} falhou ${MAX_RETRIES}x, marcando como falha permanente:`, result.error)
          if (item.id) await updateQueueItem(item.id, { retries, failed: true, failedAt: Date.now(), lastError: errMsg })
          await logFailureToServer(item, errMsg)
          syncFailListeners.forEach(cb => cb(item, errMsg))
        } else {
          console.warn(`[sync] Item ${item.id} falhou (tentativa ${retries}/${MAX_RETRIES}):`, errMsg)
          if (item.id) await updateQueueItem(item.id, { retries, lastError: errMsg })
        }
        if (redeCaiu) break
        continue
      }

      if (fotoPendente && item.id) {
        // Dados gravados no banco mas algumas fotos ficaram como base64.
        // Atualiza o item na fila com os dados parcialmente resolvidos
        // para tentar subir as fotos restantes no próximo sync.
        // (match por Ordem_Servico: antes usava { IdOs: Ordem_Servico } —
        // código da OS no campo numérico — e as fotos nunca subiam.)
        await updateQueueItem(item.id, {
          data, action: 'update',
          match: match && action === 'update' ? match : { Ordem_Servico: data.Ordem_Servico },
        })
        console.warn(`[sync] Item ${item.id} gravado, mas ${item.table} tem fotos pendentes — tentará de novo`)
      } else {
        if (item.id) await removeFromQueue(item.id)
        console.log(`[sync] Item ${item.id} sincronizado (${item.table}/${action})`)
      }
      processed++
    } catch (err) {
      console.error(`[sync] Erro no item ${item.id}:`, err)
      const retries = (item.retries || 0) + 1
      const errMsg = String((err as { message?: string })?.message || err)
      if (isNetworkError(err)) redeCaiu = true
      if (item.id) {
        if (redeCaiu) {
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
      if (redeCaiu) break
    }
  }

  if (processed > 0) {
    console.log(`[sync] ${processed} item(s) sincronizado(s) com sucesso`)
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

/** Registra listeners para sync automático quando volta online */
export function startAutoSync() {
  if (typeof window === 'undefined') return
  // Registra os listeners uma vez só (o componente pode montar de novo —
  // StrictMode, troca de layout — e cada montagem duplicava os listeners)
  if (autoSyncStarted) return
  autoSyncStarted = true

  const sync = () => { processQueue().catch(err => console.error('[sync] Erro no sync:', err)) }

  // Sync quando volta online
  window.addEventListener('online', () => {
    console.log('[sync] Conexão restaurada, sincronizando...')
    sync()
  })

  // Sync quando o app volta ao foco
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      sync()
    }
  })

  // Sync inicial se tiver internet (antes, devolve pra fila o que morreu por rede)
  if (navigator.onLine) {
    ressuscitarFalhasDeRede().then(sync, sync)
  }
}
