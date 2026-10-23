// Regras pequenas das Requisições (José, 23/10/2026): valor com vírgula, data sem fuso, nome exato
// e o envio do comprovante que ficou guardado no celular quando faltou sinal.
import { supabase } from '@/lib/supabase'
import { offlineGet, offlineSet } from '@/lib/offlineCache'
import { base64ParaBlob, extensaoDe } from '@/lib/imagem'
import { notificarPortalReq } from '@/lib/notificarPortal'

/** "150,00", "1.485,00", "1485.00", "R$ 9,9" → número; inválido → NaN */
export function lerValor(v: unknown): number {
  if (typeof v === 'number') return v
  let s = String(v ?? '').replace(/[R$\s]/g, '').trim()
  if (!s) return NaN
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.') // vírgula é o decimal
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '') // 1.485 = mil
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

/** número → "150,00" (sem R$) */
export const moeda = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** máscara do campo de valor: só dígitos, sempre 2 casas ("15000" → "150,00") */
export function mascaraValor(digitado: string): string {
  const d = digitado.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11)
  if (!d) return ''
  return moeda(Number(d) / 100)
}

/** 'AAAA-MM-DD' (ou ISO) → dd/mm/aaaa sem voltar um dia pelo fuso */
export function dataBR(d: string | null | undefined): string {
  if (!d) return ''
  const s = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d
  const dt = new Date(s)
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('pt-BR')
}

/** sem acento, sem caixa, espaços únicos */
export const semAcento = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

/** nome exato (ignora caixa/acento): "João" não pega o "João Pedro" */
export function nomeIgual(a: unknown, ...nomes: unknown[]): boolean {
  const x = semAcento(a)
  return !!x && nomes.some((n) => !!semAcento(n) && semAcento(n) === x)
}

/** sinal de que o erro foi de rede (sem internet / caiu no meio) */
export function erroDeRede(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const m = String((err as { message?: string })?.message || err || '').toLowerCase()
  return /fetch|network|load failed|timeout|aborted|internet|conex/.test(m)
}

/* ─── Atualização guardada no celular (sem sinal) ─── */

export interface AtualizacaoPendente {
  reqId: number
  titulo: string
  valor: string        // "150,00"
  fornecedor: string
  comprovante: string | null // data URL (base64) do comprovante já comprimido
  tecnico: string
  criadoEm: number
}

const CHAVE_PEND = 'req-atualizacoes-pendentes'

export async function listarPendentes(): Promise<AtualizacaoPendente[]> {
  return (await offlineGet<AtualizacaoPendente[]>(CHAVE_PEND)) || []
}

/** guarda (uma por requisição — a mais nova vale) */
export async function guardarPendente(p: AtualizacaoPendente) {
  const lista = (await listarPendentes()).filter((x) => x.reqId !== p.reqId)
  lista.push(p)
  await offlineSet(CHAVE_PEND, lista)
}

/** tira só a que foi enviada (pelo criadoEm): uma mais nova da mesma requisição, guardada durante o envio,
 *  continua na fila (José, 23/10/2026) */
async function tirarPendente(p: AtualizacaoPendente) {
  const lista = (await listarPendentes()).filter((x) => !(x.reqId === p.reqId && x.criadoEm === p.criadoEm))
  await offlineSet(CHAVE_PEND, lista)
}

/** A atualização já chegou na Requisicao? (o envio pode ter gravado e a resposta se perdido no sinal ruim;
 *  reenviar subia o comprovante de novo e duplicava Supa-AtualizarReq e o aviso) (José, 23/10/2026)
 *  Lança erro se não conseguir conferir — aí não reenvia agora. */
async function jaGravada(p: AtualizacaoPendente): Promise<boolean> {
  const { data, error } = await supabase.from('Requisicao')
    .select('recibo_fornecedor, valor_despeza, fornecedor').eq('id', p.reqId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return false
  if (p.comprovante) return !!data.recibo_fornecedor
  const v = lerValor(p.valor)
  const mesmoValor = Number.isFinite(v) && Math.abs(lerValor(data.valor_despeza) - v) < 0.005
  return mesmoValor && semAcento(data.fornecedor) === semAcento(p.fornecedor)
}

/** Sobe o comprovante e grava a atualização. Lança erro com mensagem em português. */
export async function enviarAtualizacao(p: { reqId: number; titulo: string; valor: string; fornecedor: string; comprovante: Blob | null; nomeArquivo?: string; tecnico: string }) {
  let fotoUrl: string | null = null
  if (p.comprovante) {
    const path = `comprovantes/${p.reqId}_${Date.now()}.${extensaoDe(p.comprovante, p.nomeArquivo)}`
    const { error: upErr } = await supabase.storage.from('requisicoes').upload(path, p.comprovante, {
      upsert: true, contentType: p.comprovante.type || 'image/jpeg',
    })
    if (upErr) throw new Error(`Não subiu o comprovante: ${upErr.message}`)
    fotoUrl = supabase.storage.from('requisicoes').getPublicUrl(path).data.publicUrl
  }
  const valorNum = lerValor(p.valor)
  const valorBanco = Number.isFinite(valorNum) ? valorNum.toFixed(2) : p.valor

  // Sem comprovante continua "pedido" (o técnico ainda precisa anexar) — só grava valor e fornecedor.
  const dados: Record<string, unknown> = { fornecedor: p.fornecedor.toUpperCase(), valor_despeza: valorBanco }
  if (fotoUrl) { dados.recibo_fornecedor = fotoUrl; dados.status = 'completa' }
  const { error: upd } = await supabase.from('Requisicao').update(dados).eq('id', p.reqId)
  if (upd) throw new Error(`Não gravou a requisição: ${upd.message}`)

  const { error: ins } = await supabase.from('Supa-AtualizarReq').insert({
    ReqREF: String(p.reqId), ReqValor: valorBanco, ReqFotoNota: fotoUrl,
  })
  if (ins) console.warn('[req] Supa-AtualizarReq não gravou:', ins.message) // a Requisicao já está certa

  notificarPortalReq(
    'Requisição Atualizada',
    `${p.tecnico} atualizou a requisição #${p.reqId} — ${p.titulo} (R$ ${moeda(valorNum || 0)})${fotoUrl ? '' : ' — sem comprovante'}`,
  )
  return { fotoUrl }
}

let enviandoPendentes = false
/** Manda o que ficou guardado sem sinal. Devolve quantas foram. */
export async function enviarPendentes(): Promise<number> {
  if (enviandoPendentes || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0
  enviandoPendentes = true
  let n = 0
  try {
    for (const p of await listarPendentes()) {
      try {
        if (await jaGravada(p)) { await tirarPendente(p); n++; continue }
        const blob = p.comprovante ? await base64ParaBlob(p.comprovante) : null
        await enviarAtualizacao({ reqId: p.reqId, titulo: p.titulo, valor: p.valor, fornecedor: p.fornecedor, comprovante: blob, tecnico: p.tecnico })
        await tirarPendente(p)
        n++
      } catch (e) {
        console.warn(`[req] Atualização #${p.reqId} ainda não foi:`, e)
        if (erroDeRede(e)) break
      }
    }
  } finally {
    enviandoPendentes = false
  }
  return n
}
