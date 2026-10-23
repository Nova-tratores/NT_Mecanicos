// Busca de peças do catálogo — regras puras (José, 23/10/2026: verificação do catálogo).
// Antes: código só era procurado se o nome não achasse nada com 2+ palavras ("006001547B91" dava zero) e "oleo"
// não achava "óleo" — caía num OU de palavras soltas e o "de" trazia qualquer peça.

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'para', 'com', 'em', 'no', 'na'])

/** minúsculas e sem acento */
export const semAcento = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** palavras que contam na busca (sem acento, sem "de/do/da…") */
export function palavrasBusca(texto: string): string[] {
  return semAcento(texto).replace(/[%,()*]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t))
}

/** código como o técnico escreve: tira o "RP-" do PPV, espaços e símbolos de busca */
export const codigoBusca = (texto: string) => String(texto || '').trim().replace(/^rp-/i, '').replace(/[%,()*\s]/g, '')

/** padrão do banco que aceita acento: vogal e "c" viram "_" (um caractere qualquer); o filtro fino é em `combina` */
export const padraoSemAcento = (t: string) => t.replace(/[aeiouc]/g, '_')

export interface PecaBusca { code?: unknown; name?: unknown }

/** a peça bate com a busca? (código contém o digitado OU o nome tem todas as palavras, sem ligar para acento) */
export function combina(p: PecaBusca, palavras: string[], codigo: string): boolean {
  const c = semAcento(p.code), n = semAcento(p.name), cod = semAcento(codigo)
  if (cod.length >= 3 && c.includes(cod)) return true
  return palavras.length > 0 && palavras.every((t) => n.includes(t))
}

/** ordem: código exato, código que começa, nome que começa com a 1ª palavra, nome mais curto */
export function ordenar<T extends PecaBusca>(lista: T[], palavras: string[], codigo: string): T[] {
  const cod = semAcento(codigo)
  const nota = (p: T) => {
    const c = semAcento(p.code), n = semAcento(p.name)
    if (cod && c === cod) return 0
    if (cod && c.startsWith(cod)) return 1
    if (palavras[0] && n.startsWith(palavras[0])) return 2
    return 3
  }
  return [...lista].sort((a, b) => nota(a) - nota(b) || String(a.name || '').length - String(b.name || '').length)
}
