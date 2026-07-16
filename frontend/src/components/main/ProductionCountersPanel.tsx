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

function useCountPulse(value: number) {
  const prev = useRef(value)
  const [pulse, setPulse] = useState(false)

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

  return pulse
}

function MetricTile({
  label,
  value,
  accent,
  inactive,
}: {
  label: string
  value: number
  accent: CountAccent
  inactive?: boolean
}) {
  const { colors } = useTheme()
  const pulse = useCountPulse(value)

  const tone =
    accent === 'good'
      ? {
          value: colors.successDark,
          bg: `${colors.success}14`,
          bar: colors.success,
          label: colors.successDark,
        }
      : accent === 'ng'
        ? {
            value: colors.errorDark,
            bg: `${colors.error}12`,
            bar: colors.error,
            label: colors.errorDark,
          }
        : {
            value: colors.text,
            bg: colors.grey,
            bar: colors.primary,
            label: colors.textSecondary,
          }

  // Inactive (no reference loaded) keeps the same tile structure and contrast as
  // Session — only the title lock signals “not scoped”. Opacity wash + muted
  // greens made Good/NG/Total unreadable on Versigent cream.
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 0,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '6px',
        padding: '8px 8px 8px 10px',
        borderRadius: '8px',
        backgroundColor: tone.bg,
        border: `1px solid ${tone.bar}28`,
        overflow: 'hidden',
        transition: 'border-color 0.15s ease',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '3px',
          backgroundColor: tone.bar,
          opacity: inactive ? 0.45 : 1,
        }}
      />
      <span
        style={{
          fontSize: '14px',
          fontWeight: 800,
          color: tone.label,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          lineHeight: 1,
        }}
      >
        {label}
      </span>
      <span
        aria-live="polite"
        aria-atomic="true"
        className={pulse ? 'production-count-pulse' : undefined}
        style={{
          fontSize: '22px',
          fontWeight: 800,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.03em',
          color: tone.value,
          display: 'inline-block',
          transform: pulse ? 'scale(1.12)' : 'scale(1)',
          transformOrigin: 'left center',
          transition: 'transform 0.2s ease, color 0.15s ease',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function CounterBlock({
  title,
  counts,
  inactive,
  yieldPct,
  headerAction,
}: {
  title: string
  counts: ProductionCountBucket
  inactive?: boolean
  yieldPct?: number | null
  headerAction?: ReactNode
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
        gap: '8px',
        minWidth: 0,
        flex: '1 1 0',
        height: '100%',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          minWidth: 0,
          minHeight: '18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          {inactive ? (
            <Lock size={11} color={colors.textSecondary} aria-hidden style={{ flexShrink: 0 }} />
          ) : null}
          <span
            style={{
              fontSize: '15px',
              fontWeight: 800,
              color: active ? colors.primaryDark : colors.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}
          >
            {title}
          </span>
          {yieldPct != null && active ? (
            <span
              title={`${yieldPct}% yield`}
              style={{
                fontSize: '10px',
                fontWeight: 700,
                color: yieldPct >= 95 ? colors.successDark : colors.textSecondary,
                backgroundColor:
                  yieldPct >= 95 ? `${colors.success}18` : `${colors.border}66`,
                borderRadius: '999px',
                padding: '2px 7px',
                lineHeight: 1.2,
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {yieldPct}%
            </span>
          ) : null}
        </div>
        {headerAction}
      </div>

      <div
        style={{
          display: 'flex',
          gap: '6px',
          minWidth: 0,
          alignItems: 'stretch',
        }}
      >
        <MetricTile label="Good" value={counts.good} accent="good" inactive={inactive} />
        <MetricTile label="NG" value={counts.ng} accent="ng" inactive={inactive} />
        <MetricTile label="Total" value={total} accent="total" inactive={inactive} />
      </div>
    </section>
  )
}

function ResetSessionButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled?: boolean
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
        gap: '4px',
        padding: '3px 8px',
        minHeight: '22px',
        borderRadius: '6px',
        border: `1px solid ${
          disabled
            ? colors.border
            : isWarn
              ? colors.warning
              : hovered
                ? colors.primary
                : colors.border
        }`,
        backgroundColor: disabled
          ? 'transparent'
          : isWarn
            ? `${colors.warning}20`
            : hovered
              ? `${colors.primary}12`
              : colors.white,
        color: disabled
          ? colors.disabled
          : isWarn
            ? colors.text
            : hovered
              ? colors.primaryDark
              : colors.textSecondary,
        fontSize: '10px',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        flexShrink: 0,
        opacity: disabled ? 0.45 : 1,
        transition: 'border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease',
      }}
    >
      <RotateCcw size={11} aria-hidden />
      {confirming ? 'Confirm' : 'Reset'}
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
  const referenceYield = productionYieldPct(referenceCounts)
  const sessionYield = productionYieldPct(totalCounts)

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
          alignItems: 'stretch',
          gap: compact ? '12px' : '10px',
          boxSizing: 'border-box',
          padding: 0,
        }}
      >
        <CounterBlock
          title="Reference"
          counts={referenceCounts}
          inactive={!referenceActive}
          yieldPct={referenceActive ? referenceYield : null}
        />

        <div
          aria-hidden
          style={{
            width: '1px',
            alignSelf: 'stretch',
            margin: '4px 0',
            background: `linear-gradient(180deg, transparent 0%, ${colors.border} 18%, ${colors.border} 82%, transparent 100%)`,
            flexShrink: 0,
          }}
        />

        <CounterBlock
          title="Session"
          counts={totalCounts}
          yieldPct={sessionYield}
          headerAction={<ResetSessionButton onClick={onResetTotal} disabled={sessionEmpty} />}
        />
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
