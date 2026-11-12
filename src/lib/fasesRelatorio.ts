/* Fases ANTES do relatório: só nelas o envio sobe a OS para 'Relatório Concluído' (José, 23/10/2026).
   Lógica invertida: a lista do "depois" não casava com o banco ("Enviar Omie", "Cobrando Cliente") e reeditar
   voltava a OS de fase. Fase desconhecida fica como está.
   Status distintos em Ordem_Servico (REST, 23/10/2026): Aguardando ordem Técnico (21), Cancelada (182),
   Cobrando Cliente (2), Concluída (609), Enviar Omie (15), Execução (2), Execução aguardando peças
   (em transporte) (2), Orçamento enviado para o cliente e aguardando (3), Preenchido Garantia (21),
   Relatório Concluído (2). Ordem das fases: lib/constants FASES_OS.
   Arquivo comum (12/11/2026): a tela do técnico e o servidor (/api/relatorio/receber) usam a mesma regra. */
export const normFase = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

export const FASES_ANTES_DO_RELATORIO = new Set([
  '', 'Orçamento', 'Orçamento enviado para o cliente e aguardando', 'Execução', 'Execução Procurando peças',
  'Execução aguardando peças (em transporte)', 'Aguardando outros', 'Aguardando ordem Técnico', 'Preenchido Paliativo',
  // fases do POS que faltavam (OS-0853 estava em Orçamento Aprovado — José, 05/11/2026)
  'Orçamento Aprovado', 'Execução (Realizando Diagnóstico)',
].map(normFase))

export const antesDoRelatorio = (status: unknown) => FASES_ANTES_DO_RELATORIO.has(normFase(String(status ?? '')))
