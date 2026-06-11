import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Lock, RotateCcw } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import {
  productionCountIsEmpty,
  productionCountTotal,
  productionYieldPct,
  type ProductionCountBucket,
} from '@/types/productionCounts.types'

export interface ProductionCountersPanelProps {
  referenceCounts: ProductionCountBucket
  totalCounts: ProductionCountBucket
  referenceActive?: boolean
  onResetTotal: () => void
  /** Tighter layout for a narrower InfoCard column. */
  compact?: boolean
}

type CountAccent = 'good' | 'ng' | 'total'

const COUNT_PULSE_MS = 420
const RESET_CONFIRM_MS = 4000

function AnimatedCount({
  value,
  accent,
  inactive,
  size = 'md',
  compact = false,
}: {
  value: number
  accent: CountAccent
  inactive?: boolean
  size?: 'md' | 'lg'
  compact?: boolean
}) {
  const { colors } = useTheme()
  const prev = useRef(value)
  const [pulse, setPulse] = useState(false)

  const tile =
    accent === 'good'
      ? { value: colors.successDark }
      : accent === 'ng'
        ? { value: colors.errorDark }
        : { value: colors.text }

  useEffect(() => {
    if (value === prev.current) return
    if (value > prev.current) {
      setPulse(true)
      const t = window.setTimeout(() => setPulse(false), COUNT_PULSE_MS)
      prev.current = value
      return () => window.clearTimeout(t)
    }
    prev.current = value
  }, [value])

  const fontSize = compact
    ? size === 'lg'
      ? accent === 'total'
        ? '17px'
        : '15px'
      : accent === 'total'
        ? '15px'
        : '14px'
    : size === 'lg'
      ? accent === 'total'
        ? '22px'
        : '20px'
      : accent === 'total'
        ? '18px'
        : '16px'

  return (
    <span
      aria-live="polite"
      aria-atomic="true"
      className={pulse ? 'production-count-pulse' : undefined}
      style={{
        fontSize,
        fontWeight: 800,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        color: inactive ? colors.textSecondary : tile.value,
        display: 'inline-block',
        transform: pulse ? 'scale(1.14)' : 'scale(1)',
        transition: 'transform 0.2s ease, color 0.15s ease',
      }}
    >
      {value}
    </span>
  )
}

function CountCell({
  label,
  value,
  accent,
  inactive,
  emphasize,
  compact = false,
}: {
  label: string
  value: number
  accent: CountAccent
  inactive?: boolean
  emphasize?: boolean
  compact?: boolean
}) {
  const { colors } = useTheme()

  const tile =
    accent === 'good'
      ? { bg: colors.successBg, border: colors.success, value: colors.successDark }
      : accent === 'ng'
        ? { bg: colors.errorBg, border: colors.error, value: colors.errorDark }
        : { bg: colors.grey, border: colors.border, value: colors.text }

  const active = !inactive

  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '3px',
        padding: compact ? '4px 2px' : emphasize ? '6px 4px' : '5px 3px',
        borderRadius: compact ? '6px' : '8px',
        backgroundColor: active ? tile.bg : colors.white,
        border: active
          ? `1.5px solid ${tile.border}${accent === 'total' ? '' : '66'}`
          : `1px dashed ${colors.border}`,
        minHeight: compact ? (emphasize ? '42px' : '38px') : emphasize ? '52px' : '48px',
        boxShadow: active && emphasize ? `inset 0 1px 0 ${colors.white}99` : undefined,
      }}
    >
      <span
        style={{
          fontSize: '8px',
          fontWeight: 700,
          color: active ? colors.textSecondary : colors.disabled,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
        }}
      >
        {label}
      </span>
      <AnimatedCount
        value={value}
        accent={accent}
        inactive={inactive}
        size={emphasize ? 'lg' : 'md'}
        compact={compact}
      />
    </div>
  )
}

function YieldBadge({
  counts,
  inactive,
  compact,
}: {
  counts: ProductionCountBucket
  inactive?: boolean
  compact?: boolean
}) {
  if (compact) return null
  const { colors } = useTheme()
  const yieldPct = productionYieldPct(counts)

  if (inactive || yieldPct == null) return null

  const tone =
    yieldPct >= 95 ? colors.successDark : yieldPct >= 80 ? colors.primaryDark : colors.errorDark

  return (
    <span
      style={{
        fontSize: '9px',
        fontWeight: 700,
        color: tone,
        padding: '2px 6px',
        borderRadius: '999px',
        backgroundColor: `${tone}12`,
        border: `1px solid ${tone}33`,
        whiteSpace: 'nowrap',
      }}
    >
      Yield {yieldPct}%
    </span>
  )
}

function CountGroup({
  title,
  counts,
  inactive,
  showDivider,
  emphasize,
  footer,
  hint,
  compact = false,
}: {
  title: string
  counts: ProductionCountBucket
  inactive?: boolean
  showDivider?: boolean
  emphasize?: boolean
  footer?: ReactNode
  hint?: string
  compact?: boolean
}) {
  const { colors } = useTheme()
  const total = productionCountTotal(counts)
  const active = !inactive

  return (
    <section
      aria-label={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? '3px' : '5px',
        padding: showDivider ? (compact ? '0 0 0 6px' : '0 0 0 10px') : compact ? '0 3px 0 0' : '0 5px 0 0',
        boxSizing: 'border-box',
        minWidth: 0,
        flex: showDivider ? '1.08 1 0' : '1 1 0',
        borderLeft: showDivider ? `1px solid ${colors.border}` : undefined,
        height: '100%',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
          {inactive ? (
            <Lock
              size={11}
              color={colors.textSecondary}
              aria-hidden
              style={{ flexShrink: 0 }}
            />
          ) : null}
          <span
            style={{
              fontSize: compact ? '8px' : '9px',
              fontWeight: 800,
              color: active ? colors.primaryDark : colors.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </span>
          <YieldBadge counts={counts} inactive={inactive} compact={compact} />
        </div>
        {hint ? (
          <span
            style={{
              fontSize: '8px',
              color: colors.textSecondary,
              lineHeight: 1.2,
              paddingLeft: inactive ? '16px' : 0,
            }}
          >
            {hint}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: compact ? '3px' : '5px', flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <CountCell label="Good" value={counts.good} accent="good" inactive={inactive} emphasize={emphasize} compact={compact} />
        <CountCell label="NG" value={counts.ng} accent="ng" inactive={inactive} emphasize={emphasize} compact={compact} />
        <CountCell label="Total" value={total} accent="total" inactive={inactive} emphasize={emphasize} compact={compact} />
      </div>

      {footer}
    </section>
  )
}

function ResetSessionButton({
  onClick,
  disabled,
  compact = false,
}: {
  onClick: () => void
  disabled?: boolean
  compact?: boolean
}) {
  const { colors } = useTheme()
  const [hovered, setHovered] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const t = window.setTimeout(() => setConfirming(false), RESET_CONFIRM_MS)
    return () => window.clearTimeout(t)
  }, [confirming])

  const handleClick = () => {
    if (disabled) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    onClick()
  }

  const isWarn = confirming && !disabled
  const label = confirming ? 'Confirm' : compact ? 'Reset' : 'Reset session'

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={confirming ? 'Confirm session reset' : 'Reset session totals'}
      title={
        disabled
          ? 'No session counts to reset'
          : confirming
            ? 'Tap again to clear session totals'
            : 'Clear session good, NG, and total counts'
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '5px',
        padding: compact ? '4px 6px' : '5px 8px',
        minHeight: compact ? '26px' : '32px',
        borderRadius: compact ? '6px' : '7px',
        border: `1.5px solid ${
          disabled
            ? colors.border
            : isWarn
              ? colors.warning
              : hovered
                ? colors.primary
                : colors.border
        }`,
        backgroundColor: disabled
          ? colors.grey
          : isWarn
            ? `${colors.warning}18`
            : hovered
              ? `${colors.primary}10`
              : colors.white,
        color: disabled ? colors.disabled : isWarn ? colors.text : hovered ? colors.primaryDark : colors.textSecondary,
        fontSize: compact ? '9px' : '10px',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: '100%',
        marginTop: '3px',
        opacity: disabled ? 0.7 : 1,
        transition: 'border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease',
      }}
    >
      <RotateCcw size={11} aria-hidden />
      {label}
    </button>
  )
}

export function ProductionCountersPanel({
  referenceCounts,
  totalCounts,
  referenceActive = true,
  onResetTotal,
  compact = false,
}: ProductionCountersPanelProps) {
  const { colors } = useTheme()
  const sessionEmpty = productionCountIsEmpty(totalCounts)

  return (
    <>
      <div
        aria-label="Production counters"
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          boxSizing: 'border-box',
          padding: '2px 0',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            gap: 0,
            borderRadius: '8px',
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.grey,
            padding: compact ? '5px 4px' : '6px 5px',
            boxSizing: 'border-box',
          }}
        >
          <CountGroup
            title="This reference"
            counts={referenceCounts}
            inactive={!referenceActive}
            hint={referenceActive ? undefined : compact ? 'Scan reference first' : 'Scan a reference to track per-part counts'}
            compact={compact}
          />
          <CountGroup
            title="Session total"
            counts={totalCounts}
            showDivider
            emphasize
            compact={compact}
            footer={
              <ResetSessionButton onClick={onResetTotal} disabled={sessionEmpty} compact={compact} />
            }
          />
        </div>
      </div>
      <style>{`
        @keyframes production-count-flash {
          0% { filter: brightness(1); }
          40% { filter: brightness(1.35); }
          100% { filter: brightness(1); }
        }
        .production-count-pulse {
          animation: production-count-flash ${COUNT_PULSE_MS}ms ease-out;
        }
      `}</style>
    </>
  )
}
