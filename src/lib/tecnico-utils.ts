const DIACRITICS = /[̀-ͯ]/g

const RE_PREFIXO_CARGO =
  /^(T[ÉE]CNICOS?(\s+EXTERNO)?|MEC[ÂA]NICOS?|MOTORISTAS?|VENDEDOR(ES)?|AUX(ILIARES)?|PECAS|PEÇAS)[:\s]+/i

export function normName(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS, '').toLowerCase().trim()
}

export function cleanName(str: string | null | undefined): string | null {
  if (!str) return null
  let s = String(str).toUpperCase().normalize('NFD').replace(DIACRITICS, '').trim()
  s = s.replace(RE_PREFIXO_CARGO, '')
  s = s.replace(/\b(DE|DA|DO|DOS|DAS|E|OU|SR|SRA)\b/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').trim().replace(/\s+/g, ' ')
  if (s.length < 3) return null
  if (s.includes('FINALIZEI') || s.includes('TRANSFERENCIA') || s.includes('VIA API')) return null
  return s
}

export function splitTecnicos(raw: string | null | undefined): string[] {
  if (!raw) return []
  const sem = String(raw).replace(RE_PREFIXO_CARGO, '')
  return sem.split(/[/&]|\sE\s|\/\//).map(p => p.trim()).filter(p => p.length > 2)
}

export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const palA = a.split(' ').filter(w => w.length >= 3)
  const palB = b.split(' ').filter(w => w.length >= 3)
  if (palA.length < 2 || palB.length < 2) return false
  return palA.every(w => palB.includes(w)) || palB.every(w => palA.includes(w))
}

export function nomesBatem(a: string, b: string): boolean {
  if (!a || !b) return false
  const pA = normName(a).replace(/[^a-z\s]/g, '').split(/\s+/).filter(p => p.length > 2)
  const pB = normName(b).replace(/[^a-z\s]/g, '').split(/\s+/).filter(p => p.length > 2)
  if (!pA.length || !pB.length || pA[0] !== pB[0]) return false
  if (pA.length === 1 || pB.length === 1) return true
  const s = new Set(pA.slice(1))
  return pB.slice(1).some(p => s.has(p))
}
