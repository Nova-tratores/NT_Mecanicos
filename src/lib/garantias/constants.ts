import type { GarantiaStatus } from './types'

export const VALOR_HORA = 193.0
export const VALOR_KM = 2.8
export const BUCKET_GARANTIAS = 'garantias'

export const STATUS_LABEL: Record<GarantiaStatus, string> = {
  aberta: 'Solicitada',
  em_analise: 'Em análise',
  bo_tecnico: 'Aguardando você (B.O.)',
  enviada: 'Em análise da fábrica',
  info_pendente: 'Fábrica solicitou informação',
  aprovada: 'Aprovada',
  rejeitada: 'Recusada',
}

export const STATUS_COR: Record<GarantiaStatus, string> = {
  aberta: '#0EA5E9',
  em_analise: '#6366F1',
  bo_tecnico: '#F59E0B',
  enviada: '#8B5CF6',
  info_pendente: '#F97316',
  aprovada: '#10B981',
  rejeitada: '#EF4444',
}

export const STATUS_BG: Record<GarantiaStatus, string> = {
  aberta: '#E0F2FE',
  em_analise: '#EEF2FF',
  bo_tecnico: '#FEF3C7',
  enviada: '#F5F3FF',
  info_pendente: '#FFEDD5',
  aprovada: '#ECFDF5',
  rejeitada: '#FEF2F2',
}

export const STATUS_FINALIZADOS: GarantiaStatus[] = ['aprovada', 'rejeitada']

// Status em que o técnico ainda tem ação a fazer (aparece com destaque)
export const STATUS_AGUARDANDO_TECNICO: GarantiaStatus[] = ['bo_tecnico', 'info_pendente']
