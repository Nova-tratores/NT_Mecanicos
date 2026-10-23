// Marca, modelo e chassi que já vêm da OS (José, 22/10/2026): o técnico só confere e troca se estiver diferente.
// Fontes: o Projeto da OS ("MAHINDRA 7095 MDI09520PT0006593", "6075E CAB MDI07513PS0006206", "JIVO 2025 - MBN1KGBXFNGL00082")
// e o cabeçalho da solicitação ("Modelo: …\nChassis: …\nHorimetro: …").

const MARCAS = ['MAHINDRA', 'VALTRA', 'MASSEY FERGUSON', 'MASSEY', 'JOHN DEERE', 'NEW HOLLAND', 'CASE', 'KUBOTA', 'YANMAR', 'AGRALE',
  'LS', 'TRAMONTINI', 'BUFFALO', 'KUHN', 'JACTO', 'STARA', 'BALDAN', 'TATU', 'MARCHESAN', 'NADIOLLE', 'VENTURA', 'JAN', 'IKEDA',
  'PICCIN', 'MIAC', 'LAVRALE', 'SOLIS', 'FENDT', 'CLAAS', 'SEMEATO', 'TRITON', 'MONTANA', 'KAMAQ', 'KO MAQUINAS']
  .map((m) => m.toUpperCase())

/** modelos e prefixos de chassi que são Mahindra (a maioria das OS vem sem a marca escrita) */
const EH_MAHINDRA = (modelo: string, chassi: string) =>
  /^(MDI|MBN|MBP|MZR|MDM)/.test(chassi) || /^(JIVO|YUVO|ARJUN|NOVO|\d{3,4}[A-Z]?\b)/.test(modelo)

/** chassi = palavra comprida com letra E número (código de peça curto não entra) */
const ehChassi = (w: string) => w.length >= 8 && /[A-Z]/.test(w) && /\d/.test(w)

export interface EquipamentoOS { marca: string; modelo: string; chassi: string; horimetro: string }

export function equipamentoDaOS(projeto: unknown, servSolicitado?: unknown): EquipamentoOS {
  const p = String(projeto ?? '').toUpperCase().replace(/\s+-\s+|\s-$|^-\s/g, ' ').replace(/\s+/g, ' ').trim()
  const palavras = p.split(' ').filter(Boolean)
  let chassi = ''
  for (let i = palavras.length - 1; i >= 0; i--) if (ehChassi(palavras[i])) { chassi = palavras.splice(i, 1)[0]; break }
  // implemento costuma ter só número de série ("NADIOLLE KD172 370069")
  if (!chassi && palavras.length > 1 && /^\d{5,}$/.test(palavras[palavras.length - 1])) chassi = palavras.pop()!
  let marca = ''
  const resto = palavras.join(' ')
  const m = MARCAS.find((x) => resto === x || resto.startsWith(x + ' '))
  let modelo = resto
  if (m) { marca = m; modelo = resto.slice(m.length).trim() }

  // cabeçalho da solicitação completa o que faltou (chassi e horímetro)
  const s = String(servSolicitado ?? '')
  const linha = (rot: RegExp) => (s.split('\n').find((l) => rot.test(l)) || '').replace(rot, '').trim()
  if (!chassi) { const c = linha(/^\s*chassis?\s*:\s*/i).toUpperCase().split(/\s+/).filter(ehChassi).pop(); if (c) chassi = c }
  if (!modelo) modelo = linha(/^\s*modelo\s*:\s*/i).replace(/\s*-\s*$/, '').toUpperCase()
  const horimetro = linha(/^\s*hor[ií]metro\s*:\s*/i)

  if (!marca && (modelo || chassi) && EH_MAHINDRA(modelo, chassi)) marca = 'MAHINDRA'
  const bonito = (x: string) => x.charAt(0) + x.slice(1).toLowerCase()
  return { marca: marca ? marca.split(' ').map(bonito).join(' ') : '', modelo, chassi, horimetro }
}
