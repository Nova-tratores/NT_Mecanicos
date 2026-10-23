// Resserviço (José, 22/10/2026): o portal cria uma OS nova, cópia da original, quando o técnico precisa voltar
// para refazer o serviço. Ela vem com `resservico_de` (nº da OS original) e a descrição começa com
// "RESSERVIÇO da OS-xxxx — <motivo>" e "O que precisa refazer: <texto>".
export interface InfoResservico { de: string; motivo: string; refazer: string }

export function infoResservico(os: { resservico_de?: string | null; Serv_Solicitado?: string | null }): InfoResservico | null {
  if (!os.resservico_de) return null
  const linhas = String(os.Serv_Solicitado || '').split('\n')
  const motivo = (linhas[0] || '').split(' — ').slice(1).join(' — ').trim()
  const refazer = (linhas.find((l) => /^O que precisa refazer:/i.test(l)) || '').replace(/^O que precisa refazer:\s*/i, '').trim()
  return { de: os.resservico_de, motivo, refazer }
}
