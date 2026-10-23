/**
 * Helper para operações de escrita com fallback offline.
 * Se online, faz a operação direto no Supabase.
 * Se offline (ou se falhar por rede), enfileira no IndexedDB para sync depois.
 *
 * Reenvio sem duplicar (José, 23/10/2026): o timeout de 8 s mandava pra fila um insert que muitas vezes JÁ
 * tinha gravado — e a fila gravava de novo. Agora:
 *  - antes de enfileirar depois de um timeout, e antes de cada insert da fila, procura se a linha já existe
 *    (campos escalares curtos do payload); se existe, não insere de novo;
 *  - essa procura é SÓ no caminho da fila e com janela de tempo: conta apenas linha com created_at a partir
 *    do enfileiramento (createdAt do item) menos 2 min. Insert normal online não confere nada (antes uma
 *    notificação com texto igual a uma antiga, ou duas requisições iguais no dia, eram descartadas).
 *    Tabela sem created_at: não dá pra conferir, insere;
 *  - Ordem_Servico_Tecnicos é UM relatório por OS: grava por Ordem_Servico (update se existe, senão insert).
 */

import { supabase } from './supabase'
import { queueSync } from './offlineCache'
import { melhorRelatorio } from './diasRelatorio'

const WRITE_TIMEOUT = 8000
const CHECK_TIMEOUT = 6000
/** folga da janela do "já existe": linha criada até 2 min antes do enfileiramento ainda conta */
const JANELA_DEDUPE = 2 * 60_000

interface WriteOptions {
  table: string
  action: 'insert' | 'update' | 'upsert' | 'delete'
  data: Record<string, unknown>
  match?: Record<string, unknown>
}

type Resultado = { error: { message: string } | null; idOs?: number }

function withTimeout<T>(p: PromiseLike<T>, ms = WRITE_TIMEOUT): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ])
}

export function isNetworkError(err: unknown): boolean {
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

/** Update/delete que não mexeu em nenhuma linha (sessão expirada com RLS) é FALHA, não sucesso. */
export const SEM_LINHA = 'nenhuma linha foi alterada (sessão expirada? entre de novo no app)'

/* ═══ Campos usados para achar a linha já gravada ═══
   Só escalares curtos: texto até 200 letras (sem base64), número e sim/não. Arrays, objetos, nulos e textos
   longos (fotos, assinaturas, json) ficam de fora. */
function camposDeBusca(data: Record<string, unknown>): [string, string | number | boolean][] {
  const out: [string, string | number | boolean][] = []
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') {
      if (!v || v.length > 200 || v.startsWith('data:') || v.startsWith('blob:')) continue
      out.push([k, v])
    } else if (typeof v === 'number' && Number.isFinite(v)) out.push([k, v])
    else if (typeof v === 'boolean') out.push([k, v])
    if (out.length >= 20) break
  }
  return out
}

/**
 * A linha deste insert já está no banco, criada desde `desde` (ms) menos 2 min? true = sim, false = não,
 * null = não deu pra saber (tabela sem created_at, coluna json etc.). Erro de REDE sobe como exceção.
 */
export async function jaExisteNoBanco(table: string, data: Record<string, unknown>, desde: number, ms = CHECK_TIMEOUT): Promise<boolean | null> {
  const campos = camposDeBusca(data)
  if (campos.length === 0) return null
  let q = supabase.from(table).select('*', { count: 'exact', head: true })
  for (const [k, v] of campos) q = q.eq(k, v)
  q = q.gte('created_at', new Date(desde - JANELA_DEDUPE).toISOString())
  const res = await withTimeout(q, ms)
  if (res.error) {
    if (isNetworkError(res.error)) throw new Error(res.error.message || 'network')
    return null
  }
  return (res.count || 0) > 0
}

/**
 * Grava o relatório do técnico: UM por OS. Procura a linha da OS (a melhor, se já houver duplicadas);
 * existe → update nela; não existe → insert. Rascunho nunca rebaixa um relatório já enviado.
 */
export async function gravarRelatorioTecnico(
  data: Record<string, unknown>,
  ms = WRITE_TIMEOUT,
  idOs?: number | null,
): Promise<Resultado> {
  const T = 'Ordem_Servico_Tecnicos'
  const osId = data.Ordem_Servico ? String(data.Ordem_Servico) : ''
  let alvo: Record<string, unknown> | null = null
  if (osId) {
    const busca = await withTimeout(supabase.from(T).select('IdOs, Status, Data').eq('Ordem_Servico', osId).limit(20), ms)
    if (busca.error) return { error: { message: busca.error.message } }
    alvo = melhorRelatorio((busca.data || []) as unknown as Record<string, unknown>[])
  } else if (idOs) {
    alvo = { IdOs: idOs }
  }

  if (alvo?.IdOs) {
    const upd = { ...data }
    if (alvo.Status === 'enviado' && data.Status === 'rascunho') {
      delete upd.Status; delete upd.pdf_criado; delete upd.Data
    }
    const r = await withTimeout(supabase.from(T).update(upd).eq('IdOs', alvo.IdOs as number).select('IdOs'), ms)
    if (r.error) return { error: { message: r.error.message } }
    if (!r.data || r.data.length === 0) return { error: { message: SEM_LINHA } }
    return { error: null, idOs: Number(alvo.IdOs) }
  }

  const r = await withTimeout(supabase.from(T).insert(data).select('IdOs'), ms)
  if (r.error) return { error: { message: r.error.message } }
  const novo = (r.data || [])[0] as { IdOs?: number } | undefined
  return { error: null, idOs: novo?.IdOs }
}

/**
 * Executa UMA escrita no Supabase (usada aqui e na fila). Update/delete com 0 linhas = erro.
 * `enfileiradoEm` (só a fila passa): insert confere antes se a linha já subiu desde o enfileiramento.
 */
export async function executarEscrita(
  item: { table: string; action: WriteOptions['action']; data: Record<string, unknown>; match?: Record<string, unknown>; enfileiradoEm?: number },
  ms = WRITE_TIMEOUT,
): Promise<Resultado> {
  const { table, action, data, match, enfileiradoEm } = item

  // Relatório do técnico: insert vira "grava por OS"; update por IdOs também vai pela OS quando tem o nº
  if (table === 'Ordem_Servico_Tecnicos' && (action === 'insert' || action === 'upsert' || (action === 'update' && data.Ordem_Servico))) {
    return gravarRelatorioTecnico(data, ms, (match?.IdOs as number | undefined) ?? null)
  }

  if (action === 'insert') {
    // só no reenvio da fila: se a linha já está lá (gravou mas a resposta não chegou), não insere de novo
    if (enfileiradoEm) {
      const existe = await jaExisteNoBanco(table, data, enfileiradoEm, ms)
      if (existe) return { error: null }
    }
    const r = await withTimeout(supabase.from(table).insert(data), ms)
    return { error: r.error ? { message: r.error.message } : null }
  }
  if (action === 'upsert') {
    const r = await withTimeout(supabase.from(table).upsert(data), ms)
    return { error: r.error ? { message: r.error.message } : null }
  }
  if ((action === 'update' || action === 'delete') && match && Object.keys(match).length) {
    const cols = Object.keys(match).join(',')
    let q = action === 'update' ? supabase.from(table).update(data) : supabase.from(table).delete()
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v as string | number)
    const r = await withTimeout(q.select(cols), ms)
    if (r.error) return { error: { message: r.error.message } }
    // delete sem linha pode ser "já apagado" (reenvio) — só update conta como falha
    if (action === 'update' && (!r.data || r.data.length === 0)) return { error: { message: SEM_LINHA } }
    return { error: null }
  }
  return { error: { message: `escrita inválida (${action} sem filtro)` } }
}

export async function offlineWrite(opts: WriteOptions): Promise<{ ok: boolean; queued: boolean; error?: string; idOs?: number }> {
  const queueItem = { table: opts.table, action: opts.action, data: opts.data, match: opts.match }

  // Se offline, vai direto pra fila (queueSync agora aguarda a transação)
  if (!navigator.onLine) {
    await queueSync(queueItem)
    return { ok: true, queued: true }
  }

  // Tenta online (o "já gravou?" depois de timeout olha só a partir daqui)
  const inicio = Date.now()
  try {
    const result = await executarEscrita(queueItem)
    if (result.error) {
      // Se é erro de rede, enfileira
      if (isNetworkError(result.error)) {
        const r = await enfileirarSemDuplicar(queueItem, inicio)
        return { ok: true, queued: r }
      }
      return { ok: false, queued: false, error: result.error.message }
    }
    return { ok: true, queued: false, idOs: result.idOs }
  } catch {
    // Erro de rede / timeout: pode ter gravado mesmo assim — confere antes de enfileirar
    const r = await enfileirarSemDuplicar(queueItem, inicio)
    return { ok: true, queued: r }
  }
}

/** Depois de um timeout: se o insert já gravou, não põe na fila. Devolve true se enfileirou. */
async function enfileirarSemDuplicar(item: WriteOptions, inicio: number): Promise<boolean> {
  if (item.action === 'insert' && item.table !== 'Ordem_Servico_Tecnicos') {
    try {
      if (await jaExisteNoBanco(item.table, item.data, inicio, 5000)) return false
    } catch { /* sem rede para conferir: a fila confere de novo antes de inserir */ }
  }
  await queueSync(item)
  return true
}
