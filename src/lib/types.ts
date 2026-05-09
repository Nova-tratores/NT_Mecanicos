export interface MecanicoProfile {
  id: string
  tecnico_nome: string
  tecnico_email: string
  telefone: string | null
  avatar_url: string | null
  ativo: boolean
  role: 'tecnico' | 'admin'
  nome_pos: string | null  // nome usado no POS (Tecnicos_Appsheet/req_usuarios)
  mecanico_role?: 'tecnico' | 'observador' | null  // papel no app (vem do portal_permissoes)
}

export interface AgendaItem {
  id: number
  tecnico_nome: string
  id_ordem: string | null
  data_agendada: string
  turno: 'manha' | 'tarde' | 'integral'
  hora_inicio: string | null
  hora_fim: string | null
  descricao: string | null
  endereco: string | null
  cliente: string | null
  status: 'agendado' | 'em_andamento' | 'concluido' | 'cancelado'
  created_at: string
}

export interface OrdemServico {
  Id_Ordem: string
  Status: string
  Data: string
  Os_Cliente: string
  Cnpj_Cliente: string
  Endereco_Cliente: string
  Os_Tecnico: string
  Os_Tecnico2: string
  Tipo_Servico: string
  Revisao: string
  Projeto: string
  Serv_Solicitado: string
  Qtd_HR: number
  Qtd_KM: number
  Valor_Total: number
  ID_PPV: string
  Previsao_Execucao: string
  Previsao_Faturamento: string
}

export interface Execucao {
  id: number
  id_ordem: string
  tecnico_nome: string
  data_execucao: string
  hora_chegada: string | null
  hora_saida: string | null
  horimetro_inicio: string | null
  horimetro_fim: string | null
  km_percorrido: number
  horas_trabalhadas: number
  servico_realizado: string | null
  observacoes: string | null
  modelo_equipamento: string | null
  chassis: string | null
  fotos: string[]
  assinatura_cliente: string | null
  status: 'rascunho' | 'enviado'
  created_at: string
}

export interface MecanicoRequisicao {
  id: number
  id_ordem: string | null
  tecnico_nome: string
  material_solicitado: string
  quantidade: string | null
  urgencia: 'normal' | 'urgente'
  motivo: string | null
  status: 'pendente' | 'aprovada' | 'recusada' | 'atualizada' | 'cancelada'
  atualizada_pelo_tecnico: boolean
  data_aprovacao: string | null
  cancelamento_solicitado: boolean
  cancelamento_justificativa: string | null
  cancelamento_status: 'pendente' | 'aprovado' | 'recusado' | null
  created_at: string
}

export interface OrdemServicoTecnico {
  IdOs: number
  NumOs: string | null
  Ordem_Servico: string
  TecResp1: string
  TemTec: boolean
  TecResp2: string | null
  Motivo: string | null
  TipoServico: string | null
  TipoRev: string | null
  Projeto: string | null
  DataInicio: string | null
  DataFinal: string | null
  InicioHora: string | null
  FinalHora: string | null
  InicioKm: string | null
  FinalKm: string | null
  AdicionarData2: boolean
  DataInicio2: string | null
  InicioHora2: string | null
  FinalHora2: string | null
  InicioKm2: string | null
  FinalKm2: string | null
  AdicionarData3: boolean
  DataInicio3: string | null
  InicioHora3: string | null
  FinaHora3: string | null
  InicioKm3: string | null
  FinalKm3: string | null
  TotalHora: string | null
  TotalKm: string | null
  Horimetro: string | null
  Marca: string | null
  Modelo: string | null
  Garantia: boolean
  FotoHorimetro: string | null
  FotoChassis: string | null
  FotoFrente: string | null
  FotoDireita: string | null
  FotoEsquerda: string | null
  FotoTraseira: string | null
  FotoVolante: string | null
  TratorLocal1: string | null
  TratorLocal2: string | null
  FotoFalha1: string | null
  FotoFalha2: string | null
  FotoFalha3: string | null
  FotoFalha4: string | null
  FotoPecaNova1: string | null
  FotoPecaNova2: string | null
  FotoPecaInstalada1: string | null
  FotoPecaInstalada2: string | null
  NumPlaca: string | null
  Data: string | null
  Status: 'rascunho' | 'enviado'
  NomResp: string | null
  AssCliente: string | null
  AssTecnico: string | null
  pdf_criado: boolean
}

export interface SolicitacaoAgendamento {
  id: number
  tecnico_nome: string
  cliente: string
  descricao: string | null
  data_sugerida: string
  turno: 'manha' | 'tarde' | 'integral'
  urgencia: 'normal' | 'urgente'
  status: 'pendente' | 'aprovada' | 'recusada'
  created_at: string
}

export interface MecanicoNotificacao {
  id: number
  tecnico_nome: string
  tipo: string
  titulo: string
  descricao: string | null
  link: string | null
  lida: boolean
  created_at: string
}

export type AlertaSeveridade = 'baixa' | 'media' | 'alta' | 'critica'
export type AlertaStatus = 'pendente' | 'ocorrencia' | 'ignorado'

export interface MecanicoAlerta {
  id: number
  tecnico_nome: string
  tipo: string
  severidade: AlertaSeveridade
  data_referencia: string
  descricao: string
  detalhes: Record<string, unknown> | null
  id_ordem: string | null
  status: AlertaStatus
  pontos: number
  admin_nome: string | null
  admin_comentario: string | null
  resolvido_em: string | null
  created_at: string
}

export interface MecanicoOcorrencia {
  id: number
  tecnico_nome: string
  tipo: string
  descricao: string
  pontos: number
  data_referencia: string
  id_ordem: string | null
  id_alerta: number | null
  admin_nome: string | null
  created_at: string
}
