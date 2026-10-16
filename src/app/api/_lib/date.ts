// Datas no fuso de Brasília. O servidor (Railway) roda em UTC, então
// `new Date().toISOString().slice(0, 10)` vira o dia seguinte após 21h e
// `getMonth()/getHours()` ficam 3h adiantados.

const TZ = 'America/Sao_Paulo'

/** YYYY-MM-DD no fuso de Brasília. */
export function hojeBR(d: Date = new Date()): string {
  // en-CA formata como YYYY-MM-DD
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

/** YYYY-MM no fuso de Brasília. */
export function mesBR(d: Date = new Date()): string {
  return hojeBR(d).slice(0, 7)
}

/** Hora (0-23) no fuso de Brasília. */
export function horaBR(d: Date = new Date()): number {
  const h = Number(d.toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }))
  return h === 24 ? 0 : h
}
