import type { CSSProperties, ReactNode } from 'react'
import { useTheme } from '@/contexts/ThemeContext'

export function CalibrationFrame({ children, busy, fill, dense }: { children: ReactNode; busy?: boolean; fill?: boolean; dense?: boolean }) {
  const { colors } = useTheme()
  return (
    <section
      aria-busy={busy || undefined}
      style={{
        flex: fill ? 1 : undefined,
        minHeight: fill ? 0 : undefined,
        width: '100%',
        border: `1px solid ${colors.border}`,
        borderRadius: 14,
        background: colors.white,
        boxShadow: colors.shadowCard,
        padding: dense ? 10 : fill ? 20 : 18,
        display: 'flex',
        flexDirection: 'column',
        gap: dense ? 6 : fill ? 16 : 18,
        opacity: busy ? 0.72 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {children}
    </section>
  )
}

export function Metric({
  label,
  value,
  unit,
  accent,
}: {
  label: string
  value: string
  unit?: string
  accent?: string
}) {
  const { colors } = useTheme()
  return (
    <div
      style={{
        minWidth: 0,
        background: colors.grey,
        borderRadius: 10,
        padding: '10px 12px',
        borderTop: accent ? `3px solid ${accent}` : `3px solid transparent`,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.08em', fontWeight: 700, color: colors.textSecondary }}>{label}</div>
      <div style={{ marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 22, color: colors.text, lineHeight: 1.1 }}>
          {value}
        </span>
        {unit ? <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary }}>{unit}</span> : null}
      </div>
    </div>
  )
}

export function ActionDock({ children, columns }: { children: ReactNode; columns?: number }) {
  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: columns ? `repeat(${columns}, minmax(0, 1fr))` : 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 10,
  }
  return <div style={style}>{children}</div>
}

export function CalibrationTabs({
  page,
  onChange,
}: {
  page: 'ends' | 'curve' | 'record' | 'manual'
  onChange: (page: 'ends' | 'curve' | 'record' | 'manual') => void
}) {
  const { colors } = useTheme()
  const items: Array<{ id: 'ends' | 'curve' | 'record' | 'manual'; label: string }> = [
    { id: 'ends', label: 'Pulse ends' },
    { id: 'curve', label: 'Quadratic curve' },
    { id: 'record', label: 'Stored relation' },
    { id: 'manual', label: 'Manual move' },
  ]
  return (
    <div
      role="tablist"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 4,
        padding: 4,
        borderRadius: 12,
        background: colors.grey,
      }}
    >
      {items.map((item) => {
        const active = page === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            style={{
              minHeight: 44,
              border: 'none',
              borderRadius: 9,
              background: active ? colors.white : 'transparent',
              color: active ? colors.text : colors.textSecondary,
              fontWeight: 700,
              fontSize: 14,
              boxShadow: active ? colors.shadowCard : 'none',
              cursor: 'pointer',
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export function CalibrationAlert({ message }: { message: string }) {
  const { colors } = useTheme()
  return (
    <div
      role="alert"
      style={{
        borderRadius: 10,
        borderLeft: `4px solid ${colors.error}`,
        background: colors.grey,
        color: colors.error,
        fontWeight: 600,
        padding: '10px 12px',
      }}
    >
      {message}
    </div>
  )
}
