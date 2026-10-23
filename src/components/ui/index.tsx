'use client'
import { ReactNode, CSSProperties, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import Link from 'next/link'
import { LucideIcon, ChevronRight, X } from 'lucide-react'
import { colors, radius, spacing, text, getStatus } from '@/lib/ui'

/* Estilo POS NewPortal (22/10/2026): cartões brancos cantos 16, sem negrito (máx. 500), sem caixa alta,
 * botão principal azul do portal, campos brancos com borda clara e foco azul-claro. As props não mudaram. */

/** borda do campo com foco */
const FOCO = '#38BDF8'

/* ═══════════════════════════════════════════════════════════
 * PageHeader — título + ação opcional
 * ═══════════════════════════════════════════════════════════ */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ ...text.h1, fontSize: 21, lineHeight: 1.25 }}>{title}</h1>
        {subtitle && <div style={{ fontSize: 13.5, color: colors.textMuted, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
 * SectionLabel — rótulo acima de uma lista (sem caixa alta)
 * ═══════════════════════════════════════════════════════════ */
export function SectionLabel({
  children,
  icon: Icon,
  color,
  count,
}: {
  children: ReactNode
  icon?: LucideIcon
  color?: string
  count?: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: spacing.sm, padding: '0 2px' }}>
      {Icon && <Icon size={14} color={color || colors.textMuted} />}
      <span style={{ ...text.sectionLabel, color: color || colors.textMuted }}>
        {children}{count !== undefined ? ` (${count})` : ''}
      </span>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
 * Card — container base
 * ═══════════════════════════════════════════════════════════ */
interface CardProps {
  children: ReactNode
  href?: string
  onClick?: () => void
  padding?: number | string
  tone?: 'default' | 'danger' | 'warning' | 'success' | 'info'
  style?: CSSProperties
}

export function Card({ children, href, onClick, padding = '14px 16px', tone = 'default', style }: CardProps) {
  const toneMap = {
    default: { bg: colors.surface, border: colors.border },
    danger: { bg: colors.dangerBg, border: colors.dangerBorder },
    warning: { bg: colors.warningBg, border: colors.warningBorder },
    success: { bg: colors.successBg, border: colors.successBorder },
    info: { bg: colors.infoBg, border: colors.infoBorder },
  }
  const t = toneMap[tone]

  const baseStyle: CSSProperties = {
    background: t.bg,
    borderRadius: radius.xl,
    padding,
    border: `1px solid ${t.border}`,
    textDecoration: 'none',
    color: 'inherit',
    display: 'block',
    minWidth: 0,
    cursor: href || onClick ? 'pointer' : 'default',
    ...style,
  }

  if (href) {
    return <Link href={href} style={baseStyle}>{children}</Link>
  }
  if (onClick) {
    return <div onClick={onClick} style={baseStyle}>{children}</div>
  }
  return <div style={baseStyle}>{children}</div>
}

/* ═══════════════════════════════════════════════════════════
 * ListRow — linha clicável padrão com ícone, título, subtítulo
 * ═══════════════════════════════════════════════════════════ */
export function ListRow({
  href,
  onClick,
  icon: Icon,
  iconColor = colors.textMuted,
  iconBg = colors.accentBg,
  title,
  subtitle,
  meta,
  badge,
  trailing,
  tone = 'default',
}: {
  href?: string
  onClick?: () => void
  icon?: LucideIcon
  iconColor?: string
  iconBg?: string
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  badge?: ReactNode
  trailing?: ReactNode
  tone?: CardProps['tone']
}) {
  return (
    <Card href={href} onClick={onClick} tone={tone}>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
        {Icon && (
          <div style={{
            width: 40, height: 40, borderRadius: 11, flexShrink: 0,
            background: iconBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={19} color={iconColor} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {badge && <div style={{ marginBottom: 3 }}>{badge}</div>}
          <div style={{
            fontSize: 15, fontWeight: 500, color: colors.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {title}
          </div>
          {subtitle && (
            <div style={{
              fontSize: 13, color: colors.textMuted, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {subtitle}
            </div>
          )}
          {meta && (
            <div style={{ fontSize: 12, color: colors.textSubtle, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
              {meta}
            </div>
          )}
        </div>
        {trailing ?? (href || onClick ? <ChevronRight size={18} color="#94A3B8" style={{ flexShrink: 0 }} /> : null)}
      </div>
    </Card>
  )
}

/* ═══════════════════════════════════════════════════════════
 * Badge — pílula de status
 * ═══════════════════════════════════════════════════════════ */
export function Badge({
  children,
  status,
  bg,
  color,
  size = 'sm',
}: {
  children: ReactNode
  status?: string
  bg?: string
  color?: string
  size?: 'xs' | 'sm' | 'md'
}) {
  let finalBg = bg
  let finalColor = color
  if (status) {
    const s = getStatus(status)
    finalBg = s.bg
    finalColor = s.color
  }
  const sizeMap = {
    xs: { fontSize: 11, padding: '1px 7px' },
    sm: { fontSize: 12, padding: '2px 9px' },
    md: { fontSize: 13, padding: '3px 11px' },
  }
  return (
    <span style={{
      display: 'inline-block',
      fontWeight: 500,
      lineHeight: 1.45,
      borderRadius: radius.pill,
      background: finalBg || colors.accentBg,
      color: finalColor || colors.textMuted,
      whiteSpace: 'nowrap',
      ...sizeMap[size],
    }}>
      {children}
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════
 * StatCard — card de métrica (rótulo + número)
 * ═══════════════════════════════════════════════════════════ */
export function StatCard({
  value,
  label,
  tone = 'neutral',
  onClick,
}: {
  value: number | string
  label: string
  tone?: 'neutral' | 'warning' | 'danger' | 'success' | 'info'
  onClick?: () => void
}) {
  const toneMap = {
    neutral: { bg: colors.surface, color: colors.textSubtle, border: colors.border },
    warning: { bg: colors.warningBg, color: colors.warning, border: colors.warningBorder },
    danger: { bg: colors.dangerBg, color: colors.danger, border: colors.dangerBorder },
    success: { bg: colors.successBg, color: colors.success, border: colors.successBorder },
    info: { bg: colors.infoBg, color: colors.info, border: colors.infoBorder },
  }
  const isEmpty = typeof value === 'number' && value === 0
  const t = isEmpty ? toneMap.neutral : toneMap[tone]
  return (
    <div
      onClick={onClick}
      style={{
        background: t.bg,
        borderRadius: radius.lg,
        padding: '10px 12px',
        border: `1px solid ${t.border}`,
        cursor: onClick ? 'pointer' : 'default',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 12.5, color: colors.textMuted, lineHeight: 1.2 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 500, color: t.color, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
 * TabBar — pílulas segmentadas
 * ═══════════════════════════════════════════════════════════ */
interface TabOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
  badgeCount?: number
}

export function TabBar<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: TabOption<T>[]
}) {
  return (
    <div style={{
      display: 'flex',
      gap: 4,
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: radius.lg,
      padding: 4,
    }}>
      {options.map((opt) => {
        const isActive = value === opt.value
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '10px 4px',
              borderRadius: radius.md,
              fontSize: 13.5,
              fontWeight: isActive ? 500 : 400,
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s',
              background: isActive ? colors.primaryBg : 'transparent',
              color: isActive ? colors.primary : colors.textSubtle,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {Icon && <Icon size={15} />}
            {opt.label}
            {opt.badgeCount !== undefined && opt.badgeCount > 0 && (
              <span style={{
                position: 'absolute',
                top: 2,
                right: 6,
                background: colors.danger,
                color: colors.surface,
                fontSize: 10,
                fontWeight: 500,
                borderRadius: radius.pill,
                minWidth: 17,
                height: 17,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 4px',
              }}>
                {opt.badgeCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
 * EmptyState — estado vazio padrão
 * ═══════════════════════════════════════════════════════════ */
export function EmptyState({
  icon: Icon,
  title,
  subtitle,
  tone = 'neutral',
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
  tone?: 'neutral' | 'success'
}) {
  const toneMap = {
    neutral: { iconBg: colors.accentBg, iconColor: colors.textSubtle, titleColor: colors.textMuted },
    success: { iconBg: colors.successBg, iconColor: colors.success, titleColor: colors.success },
  }
  const t = toneMap[tone]
  return (
    <div style={{
      background: colors.surface,
      borderRadius: radius.xl,
      padding: '30px 20px',
      textAlign: 'center',
      border: `1px dashed ${colors.borderStrong}`,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 11, background: t.iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 12px',
      }}>
        <Icon size={21} color={t.iconColor} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: t.titleColor }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: colors.textSubtle, marginTop: 4, lineHeight: 1.4 }}>{subtitle}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
 * Button — botão padronizado (principal azul do portal; ghost = branco com borda)
 * ═══════════════════════════════════════════════════════════ */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'success' | 'accent' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: LucideIcon
  loading?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading,
  disabled,
  children,
  style,
  ...props
}: ButtonProps) {
  const variantMap = {
    primary: { bg: colors.primary, color: '#fff', border: colors.primary },
    success: { bg: colors.success, color: '#fff', border: colors.success },
    accent: { bg: colors.accent, color: '#fff', border: colors.accent },
    ghost: { bg: colors.surface, color: colors.text, border: colors.border },
    danger: { bg: colors.danger, color: '#fff', border: colors.danger },
  }
  const sizeMap = {
    sm: { padding: '7px 14px', fontSize: 13.5, iconSize: 15, minHeight: 38 },
    md: { padding: '10px 18px', fontSize: 15, iconSize: 17, minHeight: 46 },
    lg: { padding: '12px 20px', fontSize: 15.5, iconSize: 18, minHeight: 50 },
  }
  const v = variantMap[variant]
  const s = sizeMap[size]
  const isDisabled = disabled || loading

  return (
    <button
      {...props}
      disabled={isDisabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        background: isDisabled ? colors.accentBg : v.bg,
        color: isDisabled ? colors.textSubtle : v.color,
        border: `1px solid ${isDisabled ? colors.border : v.border}`,
        borderRadius: radius.md,
        padding: s.padding,
        minHeight: s.minHeight,
        fontSize: s.fontSize,
        fontWeight: 500,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        boxShadow: 'none',
        transition: 'all 0.15s',
        ...style,
      }}
    >
      {loading ? <div className="spinner" style={{ width: s.iconSize, height: s.iconSize }} /> : Icon && <Icon size={s.iconSize} />}
      {children}
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════
 * FormField — label + input/textarea
 * ═══════════════════════════════════════════════════════════ */
const fieldInputStyle: CSSProperties = {
  width: '100%',
  minHeight: 46,
  padding: '11px 14px',
  borderRadius: radius.md,
  border: `1px solid ${colors.border}`,
  fontSize: 15,
  outline: 'none',
  background: colors.surface,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  color: colors.text,
  transition: 'border-color 0.15s',
}

export function FormField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <label style={{
        fontSize: 13, fontWeight: 400, color: colors.textMuted,
        marginBottom: 6, display: 'block',
      }}>
        {label}{required && <span style={{ color: colors.danger }}> *</span>}
      </label>
      {children}
    </div>
  )
}

/** borda volta ao normal ao sair do campo (respeita uma borda passada em `style`) */
function bordaNormal(style?: CSSProperties) {
  return (style?.borderColor as string) || colors.border
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      onFocus={(e) => { e.currentTarget.style.borderColor = FOCO; props.onFocus?.(e) }}
      onBlur={(e) => { e.currentTarget.style.borderColor = bordaNormal(props.style); props.onBlur?.(e) }}
      style={{ ...fieldInputStyle, ...props.style }}
    />
  )
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      onFocus={(e) => { e.currentTarget.style.borderColor = FOCO; props.onFocus?.(e) }}
      onBlur={(e) => { e.currentTarget.style.borderColor = bordaNormal(props.style); props.onBlur?.(e) }}
      style={{ ...fieldInputStyle, resize: 'none', lineHeight: 1.5, ...props.style }}
    />
  )
}

/* ═══════════════════════════════════════════════════════════
 * BottomSheet — modal slide-up pra forms no mobile
 * ═══════════════════════════════════════════════════════════ */
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surface,
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          padding: '12px 18px 30px',
          maxHeight: '88vh',
          overflowY: 'auto',
          animation: 'slideUp 0.22s ease',
        }}
      >
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: colors.borderStrong,
          margin: '0 auto 16px',
        }} />
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: spacing.md, marginBottom: spacing.lg,
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={text.h2}>{title}</h2>
            {subtitle && <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="fechar" style={{
            width: 36, height: 36, borderRadius: 11, border: `1px solid ${colors.border}`,
            background: colors.surface, cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X size={17} color={colors.textMuted} />
          </button>
        </div>
        {children}
      </div>
      <style jsx global>{`
        @keyframes slideUp {
          from { transform: translateY(20%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
 * SearchInput — input com ícone de busca + botão clear
 * ═══════════════════════════════════════════════════════════ */
export function SearchInput({
  value,
  onChange,
  placeholder,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onSubmit?: () => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: colors.surface, borderRadius: radius.md,
      padding: '0 14px', minHeight: 46,
      border: `1px solid ${colors.border}`,
      transition: 'border-color 0.15s',
    }}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.textSubtle} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <circle cx={11} cy={11} r={8} /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) onSubmit() }}
        onFocus={(e) => { const p = e.currentTarget.parentElement; if (p) p.style.borderColor = FOCO }}
        onBlur={(e) => { const p = e.currentTarget.parentElement; if (p) p.style.borderColor = colors.border }}
        placeholder={placeholder}
        style={{
          flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 15,
          padding: '11px 0', background: 'transparent', color: colors.text,
        }}
      />
      {value.trim() && (
        <button
          type="button"
          aria-label="limpar"
          onClick={() => onChange('')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}
        >
          <X size={16} color={colors.textSubtle} />
        </button>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
 * PageSpinner — spinner centralizado
 * ═══════════════════════════════════════════════════════════ */
export function PageSpinner() {
  return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <div className="spinner" style={{ margin: '0 auto' }} />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
 * Section — label + conteúdo
 * ═══════════════════════════════════════════════════════════ */
export function Section({
  label,
  icon,
  color,
  count,
  children,
}: {
  label: string
  icon?: LucideIcon
  color?: string
  count?: number
  children: ReactNode
}) {
  return (
    <div>
      <SectionLabel icon={icon} color={color} count={count}>{label}</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}
