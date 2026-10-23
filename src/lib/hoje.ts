/**
 * Dia de HOJE no horário de Brasília (YYYY-MM-DD).
 * `new Date().toISOString()` é UTC: depois das 21h ele já dá o dia seguinte — era o que gravava a data errada
 * no relatório enviado à noite (22/10/2026).
 */
export function hojeBR(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}
