/**
 * Tokens de design — fonte única de verdade para cores, espaçamento, radius, sombras.
 * Importe a partir de qualquer componente para manter consistência visual.
 * 22/10/2026: "Estilo POS NewPortal" (docs/estilo-pos-newportal.md do Portal) — fundo cinza-azulado, cartões
 * brancos com cantos 16, texto escuro, sem negrito (máx. 500), azul do portal como cor principal e as cores
 * com significado fixo (roxo para fazer, azul execução, laranja peças, verde feita, vermelho atrasada).
 */

export const colors = {
  // Marca
  primary: '#0369A1',
  primaryDark: '#075985',
  primaryBg: '#E0F2FE',
  primaryBorder: '#BAE6FD',

  // Acento
  accent: '#0F172A',
  accentBg: '#F1F5F9',
  accentBorder: '#E2E8F0',

  // Status
  success: '#16A34A',
  successBg: '#ECFDF5',
  successBorder: '#A7F3D0',

  warning: '#D97706',
  warningBg: '#FFF7ED',
  warningBorder: '#FED7AA',

  danger: '#DC2626',
  dangerBg: '#FEF2F2',
  dangerBorder: '#FECACA',

  info: '#2563EB',
  infoBg: '#EFF6FF',
  infoBorder: '#BFDBFE',

  // Neutros
  text: '#0F172A',
  textMuted: '#475569',
  textSubtle: '#64748B',
  textGhost: '#CBD5E1',

  surface: '#FEFEFE',
  surfaceAlt: '#EEF2F6',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',

  // Situação da OS (mesma cor sempre — José, 22/10/2026)
  osFazer: '#7C3AED',
  osExecucao: '#2563EB',
  osPecas: '#D97706',
  osFeita: '#16A34A',
  osAtrasada: '#DC2626',
  osResservico: '#9F1239',
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 16,
  pill: 999,
} as const

export const shadow = {
  none: 'none',
  sm: '0 1px 3px rgba(0,0,0,0.06)',
  md: '0 2px 8px rgba(0,0,0,0.08)',
  lg: '0 4px 16px rgba(0,0,0,0.1)',
  primary: '0 6px 16px -8px rgba(3,105,161,0.6)',
  accent: '0 6px 16px -8px rgba(15,23,42,0.4)',
  success: '0 2px 8px rgba(5,150,105,0.25)',
} as const

export const text = {
  // Títulos
  h1: { fontSize: 24, fontWeight: 500, color: colors.text, margin: 0 },
  h2: { fontSize: 19, fontWeight: 500, color: colors.text, margin: 0 },
  h3: { fontSize: 16, fontWeight: 500, color: colors.text, margin: 0 },

  // Corpo
  body: { fontSize: 14, color: colors.text },
  bodyMuted: { fontSize: 14, color: colors.textMuted },
  small: { fontSize: 12, color: colors.textMuted },
  tiny: { fontSize: 11, color: colors.textSubtle },

  // Label de seção (sem caixa alta no estilo novo)
  sectionLabel: {
    fontSize: 13,
    fontWeight: 400,
    color: colors.textMuted,
    textTransform: 'none' as const,
    letterSpacing: 0,
  },
} as const

// Mapa de status de requisição → cor
export const statusStyle: Record<string, { label: string; bg: string; color: string; border: string }> = {
  pedido: { label: 'Pedido', bg: colors.warningBg, color: colors.warning, border: colors.warningBorder },
  completa: { label: 'Atualizada', bg: colors.successBg, color: colors.success, border: colors.successBorder },
  cancelada: { label: 'Cancelada', bg: colors.dangerBg, color: colors.danger, border: colors.dangerBorder },
  cancelar: { label: 'Cancelamento', bg: colors.dangerBg, color: colors.danger, border: colors.dangerBorder },
  aguardando: { label: 'Aguardando', bg: colors.infoBg, color: colors.info, border: colors.infoBorder },
  financeiro: { label: 'Financeiro', bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE' },
  pendente: { label: 'Pendente', bg: colors.warningBg, color: colors.warning, border: colors.warningBorder },
  preenchida: { label: 'Preenchida', bg: colors.accentBg, color: colors.accent, border: colors.accentBorder },
  enviada: { label: 'Enviada', bg: colors.successBg, color: colors.success, border: colors.successBorder },
  atrasada: { label: 'Atrasada', bg: colors.dangerBg, color: colors.danger, border: colors.dangerBorder },
}

export function getStatus(key: string) {
  return statusStyle[key] || { label: key, bg: colors.border, color: colors.textMuted, border: colors.borderStrong }
}
