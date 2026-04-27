export const TURNOS = {
  manha: { label: 'Manhã', horario: '07:00 - 12:00' },
  tarde: { label: 'Tarde', horario: '13:00 - 17:30' },
  integral: { label: 'Integral', horario: '07:00 - 17:30' },
} as const

export const STATUS_AGENDA = {
  agendado: { label: 'Agendado', color: '#3B82F6', bg: '#EFF6FF' },
  em_andamento: { label: 'Em Andamento', color: '#F59E0B', bg: '#FEF3C7' },
  concluido: { label: 'Concluído', color: '#10B981', bg: '#D1FAE5' },
  cancelado: { label: 'Cancelado', color: '#EF4444', bg: '#FEE2E2' },
} as const

export const STATUS_REQUISICAO = {
  pendente: { label: 'Pendente', color: '#F59E0B', bg: '#FEF3C7' },
  aprovada: { label: 'Aprovada', color: '#3B82F6', bg: '#EFF6FF' },
  recusada: { label: 'Recusada', color: '#EF4444', bg: '#FEE2E2' },
  atualizada: { label: 'Atualizada', color: '#10B981', bg: '#D1FAE5' },
  cancelada: { label: 'Cancelada', color: '#6B7280', bg: '#F3F4F6' },
} as const

export const FASES_OS = [
  'Orçamento',
  'Orçamento enviado para o cliente e aguardando',
  'Execução',
  'Execução Procurando peças',
  'Execução aguardando peças (em transporte)',
  'Executada aguardando comercial',
  'Aguardando outros',
  'Aguardando ordem Técnico',
  'Relatório Concluído',
  'Concluída',
  'Cancelada',
]
