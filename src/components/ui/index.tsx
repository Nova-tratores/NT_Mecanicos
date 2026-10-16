'use client'
import { ReactNode, CSSProperties, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import Link from 'next/link'
import { LucideIcon, ChevronRight, X } from 'lucide-react'
import { colors, radius, shadow, spacing, text, getStatus } from '@/lib/ui'

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
        <h1 style={text.h1}>{title}</h1>
        {subtitle && <div style={{ ...text.small, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
 * SectionLabel — rótulo uppercase acima de uma lista
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
      {Icon && <Icon size={13} color={color || colors.textSubtle} />}
      <span style={{ ...text.sectionLabel, color: color || colors.textSubtle }}>
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
  iconBg = colors.border,
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
            width: 42, height: 42, borderRadius: radius.md, flexShrink: 0,
            background: iconBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={20} color={iconColor} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {badge && <div style={{ marginBottom: 3 }}>{badge}</div>}
          <div style={{
            fontSize: 14, fontWeight: 600, color: colors.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {title}
          </div>
          {subtitle && (
            <div style={{
              fontSize: 12, color: colors.textSubtle, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {subtitle}
            </div>
          )}
          {meta && (
            <div style={{ fontSize: 11, color: colors.textSubtle, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
              {meta}
            </div>
          )}
        </div>
        {trailing ?? (href || onClick ? <ChevronRight size={18} color={colors.textGhost} style={{ flexShrink: 0 }} /> : null)}
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
    xs: { fontSize: 9, padding: '2px 6px' },
    sm: { fontSize: 10, padding: '2px 7px' },
    md: { fontSize: 11, padding: '3px 9px' },
  }
  return (
    <span style={{
      display: 'inline-block',
      fontWeight: 700,
      borderRadius: radius.sm,
      background: finalBg || colors.border,
      color: finalColor || colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      ...sizeMap[size],
    }}>
      {children}
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════
 * StatCard — card de métrica (número grande + label)
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
    neutral: { bg: colors.surfaceAlt, color: colors.textGhost, border: colors.border },
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
        padding: '14px 12px',
        textAlign: 'center',
        border: `1px solid ${t.border}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 800, color: t.color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textSubtle, marginTop: 4 }}>{label}</div>
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
      background: colors.border,
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
              padding: '11px 0',
              borderRadius: radius.md,
              fontSize: 13,
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s',
              background: isActive ? colors.surface : 'transparent',
              color: isActive ? colors.text : colors.textSubtle,
              boxShadow: isActive ? shadow.sm : 'none',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {Icon && <Icon size={14} />}
            {opt.label}
            {opt.badgeCount !== undefined && opt.badgeCount > 0 && (
              <span style={{
                position: 'absolute',
                top: 3,
                right: 8,
                background: colors.danger,
                color: colors.surface,
                fontSize: 9,
                fontWeight: 800,
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
    neutral: { iconBg: colors.surfaceAlt, iconColor: colors.textGhost, titleColor: colors.textSubtle },
    success: { iconBg: colors.successBg, iconColor: colors.success, titleColor: colors.success },
  }
  const t = toneMap[tone]
  return (
    <div style={{
      background: colors.surface,
      borderRadius: radius.xl,
      padding: '40px 20px',
      textAlign: 'center',
      border: `1px solid ${colors.border}`,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: radius.lg, background: t.iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 12px',
      }}>
        <Icon size={24} color={t.iconColor} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: t.titleColor }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: colors.textGhost, marginTop: 4 }}>{subtitle}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
 * Button — botão primário padronizado
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
    primary: { bg: colors.primary, color: '#fff', shadow: shadow.primary },
    success: { bg: colors.success, color: '#fff', shadow: shadow.success },
    accent: { bg: colors.accent, color: '#fff', shadow: shadow.accent },
    ghost: { bg: colors.border, color: colors.textMuted, shadow: 'none' },
    danger: { bg: colors.danger, color: '#fff', shadow: '0 2px 8px rgba(220,38,38,0.2)' },
  }
  const sizeMap = {
    sm: { padding: '8px 14px', fontSize: 13, iconSize: 14, radius: radius.md },
    md: { padding: '11px 18px', fontSize: 14, iconSize: 16, radius: radius.md },
    lg: { padding: '14px 20px', fontSize: 15, iconSize: 18, radius: radius.lg },
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
        gap: 6,
        background: isDisabled ? colors.textGhost : v.bg,
        color: v.color,
        border: 'none',
        borderRadius: s.radius,
        padding: s.padding,
        fontSize: s.fontSize,
        fontWeight: 700,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        boxShadow: isDisabled ? 'none' : v.shadow,
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
  padding: '13px 14px',
  borderRadius: radius.md,
  border: `1.5px solid ${colors.borderStrong}`,
  // >= 16px: abaixo disso o iOS dá zoom automático ao focar o campo
  fontSize: 16,
  outline: 'none',
  background: colors.surfaceAlt,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  color: colors.text,
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
        fontSize: 13, fontWeight: 700, color: colors.text,
        marginBottom: 6, display: 'block',
      }}>
        {label}{required && <span style={{ color: colors.primary }}> *</span>}
      </label>
      {children}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...fieldInputStyle, ...props.style }} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} style={{ ...fieldInputStyle, resize: 'none', lineHeight: 1.5, ...props.style }} />
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
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surface,
          borderRadius: '24px 24px 0 0',
          width: '100%',
          maxWidth: 480,
          padding: '14px 20px calc(32px + env(safe-area-inset-bottom, 0px))',
          maxHeight: '88vh',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          animation: 'slideUp 0.22s ease',
        }}
      >
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: colors.borderStrong,
          margin: '0 auto 18px',
        }} />
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: spacing.md, marginBottom: spacing.xl,
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={text.h2}>{title}</h2>
            {subtitle && <div style={{ ...text.small, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{
            width: 40, height: 40, borderRadius: radius.md, border: 'none',
            background: colors.border, cursor: 'pointer', flexShrink: 0,
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
      background: colors.surface, borderRadius: radius.lg,
      padding: '0 14px',
      border: `1.5px solid ${colors.borderStrong}`,
    }}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.textSubtle} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={11} cy={11} r={8} /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) onSubmit() }}
        placeholder={placeholder}
        style={{
          flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16,
          padding: '13px 0', background: 'transparent', color: colors.text,
        }}
      />
      {value.trim() && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpar busca"
          style={{ background: 'none', border: 'none', cursor: 'pointer', width: 36, height: 36, marginRight: -8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
    <div role="status" aria-label="Carregando" style={{ textAlign: 'center', padding: 40 }}>
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
