/**
 * Dias do relatório do técnico. O preencher deixa lançar até 10 dias e grava TODOS em `DiasExecucao`
 * (json); as colunas DataInicio/2/3 só guardam os 3 primeiros. Ler sempre por aqui — antes a tela da OS
 * enviada e o PDF liam só as colunas e os dias 4 a 10 sumiam (22/10/2026).
 */
import { supabase } from './supabase'
import { offlineGet, offlineSet } from './offlineCache'
import { cacheGet, cacheSet } from './cache'

export interface DiaRelatorio { data: string; horaInicio: string; horaFim: string; kmTotal: string; virouNoite?: boolean }

export function diasDoRegistro(r: Record<string, unknown> | null | undefined): DiaRelatorio[] {
  if (!r) return []
  const s = (k: string) => (r[k] as string) || ''
  let json = r.DiasExecucao as unknown
  if (typeof json === 'string') { try { json = JSON.parse(json) } catch { json = null } }
  if (Array.isArray(json) && json.length) {
    return (json as Record<string, unknown>[]).map((d) => ({
      data: String(d.data || ''), horaInicio: String(d.horaInicio || ''), horaFim: String(d.horaFim || ''), kmTotal: String(d.kmTotal ?? ''),
      ...(d.virouNoite ? { virouNoite: true } : {}),
    }))
  }
  const dias: DiaRelatorio[] = []
  if (r.DataInicio) dias.push({ data: s('DataInicio'), horaInicio: s('InicioHora'), horaFim: s('FinalHora'), kmTotal: s('InicioKm') || s('TotalKm') })
  if (r.AdicionarData2 && r.DataInicio2) dias.push({ data: s('DataInicio2'), horaInicio: s('InicioHora2'), horaFim: s('FinalHora2'), kmTotal: s('InicioKm2') })
  if (r.AdicionarData3 && r.DataInicio3) dias.push({ data: s('DataInicio3'), horaInicio: s('InicioHora3'), horaFim: s('FinaHora3'), kmTotal: s('InicioKm3') })
  return dias
}

/* ═══ Um relatório por OS (José, 23/10/2026) ═══
   A fila offline chegou a gravar 2+ linhas da mesma OS em Ordem_Servico_Tecnicos; .maybeSingle() quebrava
   com 2 linhas e a tela abria vazia. Ler sempre a MELHOR linha: enviado > rascunho, depois a mais nova. */
export function melhorRelatorio<T extends Record<string, unknown>>(rows: T[] | null | undefined): T | null {
  if (!rows || rows.length === 0) return null
  const peso = (r: T) => (r.Status === 'enviado' ? 1 : 0)
  return [...rows].sort((a, b) =>
    peso(b) - peso(a)
    || (Number(b.IdOs) || 0) - (Number(a.IdOs) || 0)
    || String(b.Data || '').localeCompare(String(a.Data || '')),
  )[0]
}

/** busca o relatório da OS (a melhor linha). `ms` = tempo máximo; estourou = erro (a tela usa o cache). */
export async function buscarRelatorioDaOS(
  osId: string, colunas = '*', ms = 8000,
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  try {
    const consulta = supabase.from('Ordem_Servico_Tecnicos').select(colunas).eq('Ordem_Servico', osId).limit(20)
    const res = await Promise.race([
      consulta,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ])
    if (res.error) return { data: null, error: res.error.message }
    return { data: melhorRelatorio((res.data || []) as unknown as Record<string, unknown>[]), error: null }
  } catch (e) {
    return { data: null, error: String((e as { message?: string })?.message || e) }
  }
}

/* ═══ Horas do dia ═══ */
/** minutos entre início e fim. Fim antes do início = virou a meia-noite (soma 24h) e `virou` = true. */
export function minutosDoDia(inicio?: string, fim?: string): { min: number; virou: boolean } {
  if (!inicio || !fim) return { min: 0, virou: false }
  const [hi, mi] = inicio.split(':').map(Number)
  const [hf, mf] = fim.split(':').map(Number)
  if ([hi, mi, hf, mf].some((n) => Number.isNaN(n))) return { min: 0, virou: false }
  let diff = (hf * 60 + mf) - (hi * 60 + mi)
  const virou = diff < 0
  if (virou) diff += 24 * 60
  return { min: diff, virou }
}

/** total em minutos de vários dias ({inicio, fim}) */
export function totalMinutos(dias: { inicio?: string; fim?: string }[]): number {
  return dias.reduce((s, d) => s + minutosDoDia(d.inicio, d.fim).min, 0)
}

/** "3h30m" (texto da tela e do relatório) */
export function horasTexto(min: number): string {
  if (min <= 0) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}h${m > 0 ? `${m}m` : ''}`
}

/** 3.5 (horas decimais — a garantia faz Number() e "3h30m" virava 0; José, 23/10/2026) */
export function horasDecimais(min: number): number {
  return Math.round((min / 60) * 100) / 100
}

/* ═══ Cache local depois do envio (José, 23/10/2026) ═══
   Enviado sem internet, o cache continuava com o rascunho antigo: a OS reabria como rascunho e "Salvar horários"
   regravava 'rascunho' por cima. Depois do envio (na hora ou na fila) o cache que as telas leem é atualizado. */
export async function atualizarCacheRelatorio(
  osId: string,
  registro: Record<string, unknown>,
  opts: { nome?: string; statusOS?: string | null } = {},
): Promise<void> {
  try {
    // relatório (prefetch:os-tec) — mescla por cima do que já estava
    const tecAntigo = (await offlineGet<Record<string, unknown>>(`prefetch:os-tec:${osId}`)) || {}
    const novo: Record<string, unknown> = { ...tecAntigo, ...registro }
    // enviado nunca volta a rascunho no cache
    if (tecAntigo.Status === 'enviado' && registro.Status === 'rascunho') novo.Status = 'enviado'
    await offlineSet(`prefetch:os-tec:${osId}`, novo)

    // OS (prefetch:os) — Status novo
    if (opts.statusOS) {
      const os = await offlineGet<Record<string, unknown>>(`prefetch:os:${osId}`)
      if (os) await offlineSet(`prefetch:os:${osId}`, { ...os, Status: opts.statusOS })
    }

    // lista de OS (os:v2:<nome>) — memória e IndexedDB
    if (opts.nome) {
      const chave = `os:v2:${opts.nome}`
      type Lista = { ordens?: Record<string, unknown>[]; preenchidas?: Iterable<string>; enviadas?: Iterable<string>; enviadasCount?: number; [k: string]: unknown }
      const base = cacheGet<Lista>(chave) || (await offlineGet<Lista>(chave))
      if (base) {
        const preenchidas = new Set<string>(base.preenchidas ? Array.from(base.preenchidas) : [])
        const enviadas = new Set<string>(base.enviadas ? Array.from(base.enviadas) : [])
        preenchidas.add(osId)
        const contar = novo.Status === 'enviado' && !enviadas.has(osId)
        if (novo.Status === 'enviado') enviadas.add(osId)
        const ordens = (base.ordens || []).map((o) => (String(o.Id_Ordem) === osId && opts.statusOS ? { ...o, Status: opts.statusOS } : o))
        cacheSet(chave, { ...base, ordens, preenchidas, enviadas, enviadasCount: (base.enviadasCount || 0) + (contar ? 1 : 0) })
      }
    }
  } catch (e) {
    console.warn('[cache] não atualizou o relatório local:', e)
  }
}
