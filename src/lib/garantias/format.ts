/**
 * Converte string de data do banco em Date.
 * `new Date('YYYY-MM-DD')` é interpretado como UTC e, no Brasil (-03:00),
 * cai no dia anterior — por isso datas "só dia" são montadas no fuso local.
 */
export function parseDataLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

export function fmtData(iso: string | null | undefined): string {
  const d = parseDataLocal(iso)
  if (!d) return '—'
  return d.toLocaleDateString('pt-BR')
}

export function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function fmtMoeda(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function tempoDecorrido(iso: string | null | undefined): string {
  const d = parseDataLocal(iso)
  if (!d) return '—'
  const ms = Date.now() - d.getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  const dias = Math.floor(h / 24)
  return `há ${dias}d`
}

export function diasEntre(aIso: string | null | undefined, bIso?: string | null): number | null {
  const a = parseDataLocal(aIso)
  if (!a) return null
  const b = bIso ? parseDataLocal(bIso) : new Date()
  if (!b) return null
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000))
}
