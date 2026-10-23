/**
 * Número digitado no jeito brasileiro: "12,5" → 12.5 · "1.250" → 1250 · "1.250,5" → 1250.5 · "12.5" → 12.5.
 * `parseFloat` puro dava 12 para "12,5" e 1,25 para "1.250" (KM e quantidade errados — 22/10/2026).
 */
export function numeroBR(v: unknown): number {
  let s = String(v ?? '').trim().replace(/\s/g, '')
  if (!s) return NaN
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  return parseFloat(s)
}
