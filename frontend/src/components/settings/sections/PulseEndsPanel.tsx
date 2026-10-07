import { useEffect, useRef, useState } from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/Button'
import { ActionDock, CalibrationFrame } from '@/components/settings/sections/calibrationChrome'

export type PulseField = 'hu' | 'tu' | 'hl' | 'tl'

export type PulseEndsRow = {
  id: string
  axis: 'upper' | 'lower'
  position: 'home' | 'travel'
  switch: string
  field: PulseField
  jaw: string
}

type PulseLive = {
  pulseUs: number
  uh: boolean
  ut: boolean
  lh: boolean
  lt: boolean
}

type Props = {
  rows: PulseEndsRow[]
  host: Partial<Record<PulseField, number | null>>
  captured: Partial<Record<PulseField, number>>
  liveById: Partial<Record<string, PulseLive>>
  activeId: string | null
  busy: boolean
  confirmApply: boolean
  onSelect: (id: string) => void
  onJog: (row: PulseEndsRow, direction: 'open' | 'close') => void
  onSave: (row: PulseEndsRow) => void
  onRequestApply: () => void
  onApply: () => void
  onCancelApply: () => void
}

/** Same limits as backend/lib/centringHeightCalibration.mjs. The host still rejects an illegal apply. */
const PULSE_MIN_US = 544
const PULSE_MAX_US = 2400
const PULSE_MIN_SPAN_US = 80
const STEP_US = 4
const FIELDS = ['hu', 'tu', 'hl', 'tl'] as const

type Tone = 'info' | 'ready' | 'warning' | 'fault'
type SpanIssue = { fault: boolean; message: string }
type Pending =
  | { kind: 'jog'; jaw: string; toward: 'open' | 'close' }
  | { kind: 'save'; field: PulseField }
  | { kind: 'apply' }
type Guidance = { tone: Tone; eyebrow: string; message: string }
type SavedMap = Record<PulseField, number | null>

function asPulse(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function fmt(value: number | null | undefined): string {
  const pulse = asPulse(value)
  return pulse == null ? '—' : String(pulse)
}

function formatDelta(delta: number): string {
  return Number.isInteger(delta) ? String(delta) : delta.toFixed(1)
}

function savedMap(captured: Partial<Record<PulseField, number>>): SavedMap {
  return {
    hu: asPulse(captured.hu),
    tu: asPulse(captured.tu),
    hl: asPulse(captured.hl),
    tl: asPulse(captured.tl),
  }
}

function placeLabel(row: PulseEndsRow): 'Open' | 'Closed' {
  return row.position === 'home' ? 'Open' : 'Closed'
}

function rowsForAxis(rows: PulseEndsRow[], axis: 'upper' | 'lower'): PulseEndsRow[] {
  return rows
    .filter((row) => row.axis === axis)
    .sort((a, b) => Number(a.position === 'travel') - Number(b.position === 'travel'))
}

function liveForRows(rows: PulseEndsRow[], liveById: Partial<Record<string, PulseLive>>): PulseLive | undefined {
  for (const row of rows) {
    const live = liveById[row.id]
    if (live) return live
  }
  return undefined
}

function switchOn(row: PulseEndsRow, live: PulseLive | undefined): boolean {
  if (!live) return false
  if (row.axis === 'upper' && row.position === 'home') return live.uh
  if (row.axis === 'upper' && row.position === 'travel') return live.ut
  if (row.axis === 'lower' && row.position === 'home') return live.lh
  if (row.axis === 'lower' && row.position === 'travel') return live.lt
  return false
}

function pairIssue(
  jaw: string,
  open: number | null,
  closed: number | null,
  openField: PulseField,
  closedField: PulseField,
): SpanIssue | null {
  if (open == null || closed == null) return null
  if (open > closed && open - closed >= PULSE_MIN_SPAN_US) return null
  const delta = open - closed
  if (open <= closed) {
    return {
      fault: true,
      message: `${jaw} ${openField} − ${closedField} is reversed (${formatDelta(delta)} µs). ${openField} must be greater than ${closedField} by at least ${PULSE_MIN_SPAN_US} µs.`,
    }
  }
  return {
    fault: false,
    message: `${jaw} ${openField} − ${closedField} is ${formatDelta(delta)} µs. It must be at least ${PULSE_MIN_SPAN_US} µs.`,
  }
}

function collectIssues(saved: SavedMap): SpanIssue[] {
  const issues: SpanIssue[] = []
  for (const field of FIELDS) {
    const value = saved[field]
    if (value == null) continue
    if (value < PULSE_MIN_US || value > PULSE_MAX_US) {
      issues.push({
        fault: true,
        message: `${field} must be between ${PULSE_MIN_US} and ${PULSE_MAX_US} µs.`,
      })
    }
  }
  const upper = pairIssue('Upper', saved.hu, saved.tu, 'hu', 'tu')
  const lower = pairIssue('Lower', saved.hl, saved.tl, 'hl', 'tl')
  if (upper) issues.push(upper)
  if (lower) issues.push(lower)
  return issues
}

function guidance(input: {
  active: PulseEndsRow
  live: PulseLive | undefined
  switchIsOn: boolean
  saved: SavedMap
  issues: SpanIssue[]
  axisIssue: SpanIssue | null
  pending: Pending | null
  busy: boolean
  next: PulseEndsRow | null
}): Guidance {
  const { active, live, switchIsOn, saved, issues, axisIssue, pending, busy, next } = input
  if (busy && pending?.kind === 'jog') {
    return {
      tone: 'info',
      eyebrow: 'Moving',
      message: `${pending.jaw} jaw, toward ${pending.toward === 'open' ? 'open' : 'closed'}. One step is ${STEP_US} µs.`,
    }
  }
  if (busy && pending?.kind === 'save') {
    return {
      tone: 'info',
      eyebrow: `Saving ${pending.field}`,
      message: 'Checking the switch and the commanded pulse.',
    }
  }
  if (busy && pending?.kind === 'apply') {
    return {
      tone: 'info',
      eyebrow: 'Applying',
      message: 'Storing the four valus and sending. The jaws stay where they are.',
    }
  }

  const stored = saved[active.field]
  if (stored != null && (stored < PULSE_MIN_US || stored > PULSE_MAX_US)) {
    return {
      tone: 'fault',
      eyebrow: `${active.field} is out of range`,
      message: `${active.field} must be between ${PULSE_MIN_US} and ${PULSE_MAX_US} µs. Jog back into range and save it again.`,
    }
  }
  if (axisIssue) {
    return {
      tone: axisIssue.fault ? 'fault' : 'warning',
      eyebrow: 'Span is not valid',
      message: `${axisIssue.message} Jog that end and save it again.`,
    }
  }

  const allSaved = FIELDS.every((field) => saved[field] != null)
  if (allSaved && issues.length > 0) {
    const issue = issues[0]
    return {
      tone: issue.fault ? 'fault' : 'warning',
      eyebrow: 'Cannot apply yet',
      message: issue.message,
    }
  }
  if (allSaved) {
    return {
      tone: 'ready',
      eyebrow: 'Ready to apply',
      message: 'All four valus are saved this visit. Apply stores them. The jaws stay where they are.',
    }
  }

  const place = placeLabel(active)
  const pulse = live?.pulseUs
  const liveOut = pulse != null && (pulse < PULSE_MIN_US || pulse > PULSE_MAX_US)
  if (pulse == null) {
    return {
      tone: 'info',
      eyebrow: `${active.jaw} · ${place}`,
      message: `Press ${place} until ${active.switch} is on. Each press moves this jaw ${STEP_US} µs.`,
    }
  }
  if (liveOut && switchIsOn) {
    return {
      tone: 'fault',
      eyebrow: `${pulse} µs is out of range`,
      message: `Save stays off. ${active.field} must be between ${PULSE_MIN_US} and ${PULSE_MAX_US} µs. Jog back into range.`,
    }
  }
  if (!switchIsOn) {
    if (liveOut) {
      return {
        tone: 'fault',
        eyebrow: `${pulse} µs is out of range`,
        message: `${active.field} must be between ${PULSE_MIN_US} and ${PULSE_MAX_US} µs, and ${active.switch} must be on. Jog until both are true, then save.`,
      }
    }
    return {
      tone: 'info',
      eyebrow: `${active.switch} is off`,
      message: `Press ${place}. Save ${active.field} stays off until ${active.switch} is on. Commanded pulse is ${pulse} µs.`,
    }
  }
  if (stored == null) {
    return {
      tone: 'ready',
      eyebrow: `${active.switch} is on`,
      message: `Commanded pulse is ${pulse} µs. Press Save ${active.field}. Another step this way will not move while ${active.switch} stays on.`,
    }
  }
  if (stored !== pulse) {
    return {
      tone: 'ready',
      eyebrow: `${active.field} saved at ${stored} µs`,
      message: `The jaw is now at ${pulse} µs. Save again to replace ${active.field}, or select the next position.`,
    }
  }
  if (next) {
    return {
      tone: 'info',
      eyebrow: `${active.field} saved`,
      message: `Next is ${next.jaw} ${placeLabel(next).toLowerCase()} (${next.field}).`,
    }
  }
  return {
    tone: 'info',
    eyebrow: `${active.field} saved`,
    message: 'Save the remaining positions.',
  }
}

function spanLine(open: number | null, closed: number | null): { text: string; tone: Tone } {
  if (open == null || closed == null) return { text: 'Save both ends', tone: 'info' }
  const delta = open - closed
  if (delta <= 0) return { text: `Reversed · ${formatDelta(delta)} µs`, tone: 'fault' }
  if (delta < PULSE_MIN_SPAN_US) return { text: `${formatDelta(delta)} µs · need ${PULSE_MIN_SPAN_US}`, tone: 'warning' }
  return { text: `${formatDelta(delta)} µs`, tone: 'ready' }
}

function SwitchLamp({ on, name }: { on: boolean; name: string }) {
  const { colors } = useTheme()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 20 }}>
      <span
        aria-hidden
        style={{
          width: 12,
          height: 12,
          borderRadius: 99,
          flex: '0 0 auto',
          background: on ? colors.success : colors.border,
          boxShadow: on ? `0 0 0 3px ${colors.success}33` : 'none',
        }}
      />
      <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', color: on ? colors.successDark : colors.textSecondary }}>
        {name} {on ? 'ON' : 'OFF'}
      </span>
    </span>
  )
}

function GuidanceBanner({ tone, eyebrow, message }: Guidance) {
  const { colors } = useTheme()
  const accent = tone === 'fault' ? colors.error : tone === 'warning' ? colors.warning : tone === 'ready' ? colors.success : colors.primary
  return (
    <div
      id="pulse-ends-status"
      role="status"
      aria-live="polite"
      style={{
        borderRadius: 10,
        borderLeft: `4px solid ${accent}`,
        background: colors.grey,
        padding: '12px 14px',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.06em', color: accent }}>{eyebrow}</div>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 600, lineHeight: 1.35, color: colors.text }}>{message}</div>
    </div>
  )
}

function PositionCard({
  row,
  live,
  saved,
  hostPulse,
  selected,
  next,
  onSelect,
}: {
  row: PulseEndsRow
  live: PulseLive | undefined
  saved: number | null
  hostPulse: number | null
  selected: boolean
  next: boolean
  onSelect: (id: string) => void
}) {
  const { colors } = useTheme()
  const on = switchOn(row, live)
  const badge = next ? 'Next' : ''
  return (
    <button
      type="button"
      className="pulse-ends-hit"
      aria-pressed={selected}
      aria-label={`${placeLabel(row)}, ${row.switch} ${on ? 'on' : 'off'}, ${row.field}, ${saved == null ? 'not saved' : `saved ${saved} microseconds`}`}
      onClick={() => onSelect(row.id)}
      style={{
        textAlign: 'left',
        border: 'none',
        borderRadius: 10,
        background: saved != null ? colors.successBg : colors.white,
        boxShadow: selected ? `0 0 0 2px ${colors.primary}, 0 0 0 6px ${colors.primary}33` : colors.shadowCard,
        padding: '10px 12px',
        cursor: 'pointer',
        minHeight: 0,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        color: colors.text,
        fontFamily: 'inherit',
        touchAction: 'manipulation',
        userSelect: 'none',
      }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>{placeLabel(row)} · {row.field}</span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: selected ? colors.primary : colors.textSecondary }}>
          {badge}
        </span>
      </span>
      <SwitchLamp on={on} name={row.switch} />
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontVariantNumeric: 'tabular-nums', fontSize: 26, fontWeight: 800, lineHeight: 1, color: saved != null ? colors.successDark : colors.text }}>
        <span>{saved == null ? '—' : saved}</span>
        {saved != null ? <span style={{ fontSize: 11, fontWeight: 700, color: colors.textSecondary }}>µs</span> : null}
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, color: colors.textSecondary }}>
        Machine {fmt(hostPulse)}{hostPulse == null ? '' : ' µs'}
      </span>
    </button>
  )
}

function JawStation({
  axis,
  rows,
  live,
  saved,
  host,
  activeId,
  nextId,
  onSelect,
}: {
  axis: 'upper' | 'lower'
  rows: PulseEndsRow[]
  live: PulseLive | undefined
  saved: SavedMap
  host: Partial<Record<PulseField, number | null>>
  activeId: string
  nextId: string | null
  onSelect: (id: string) => void
}) {
  const { colors } = useTheme()
  const selected = rows.some((row) => row.id === activeId)
  const openField: PulseField = axis === 'upper' ? 'hu' : 'hl'
  const closedField: PulseField = axis === 'upper' ? 'tu' : 'tl'
  const span = spanLine(saved[openField], saved[closedField])
  const spanColor = span.tone === 'fault' ? colors.error : span.tone === 'warning' ? colors.warning : span.tone === 'ready' ? colors.success : colors.textSecondary
  return (
    <section
      aria-label={axis === 'upper' ? 'Upper jaw' : 'Lower jaw'}
      style={{
        borderRadius: 12,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
        background: selected ? `${colors.primary}14` : colors.grey,
        boxShadow: selected ? `inset 0 0 0 2px ${colors.primary}` : `inset 0 0 0 1px ${colors.border}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontWeight: 800, letterSpacing: '0.08em', color: colors.text, fontSize: 12 }}>
          {axis === 'upper' ? 'UPPER' : 'LOWER'}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }} aria-label={live ? `Commanded pulse ${live.pulseUs} microseconds` : 'Commanded pulse not read'}>
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.textSecondary }}>Pulse</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 28, fontWeight: 800, color: colors.text, lineHeight: 1 }}>
            {live ? live.pulseUs : '—'}
          </span>
          {live ? <span style={{ fontSize: 11, fontWeight: 700, color: colors.textSecondary }}>µs</span> : null}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {rows.map((row) => (
          <PositionCard
            key={row.id}
            row={row}
            live={live}
            saved={saved[row.field]}
            hostPulse={asPulse(host[row.field])}
            selected={row.id === activeId}
            next={row.id === nextId}
            onSelect={onSelect}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', color: colors.textSecondary }}>
          {openField} − {closedField}
        </span>
        <span style={{ fontSize: 14, fontWeight: 800, color: spanColor, textAlign: 'right' }}>{span.text}</span>
      </div>
    </section>
  )
}

function JogButton({
  direction,
  emphasized,
  moving,
  disabled,
  jaw,
  onPress,
}: {
  direction: 'open' | 'close'
  emphasized: boolean
  moving: boolean
  disabled: boolean
  jaw: string
  onPress: () => void
}) {
  const label = direction === 'open' ? 'Open' : 'Closed'
  const target = direction === 'open' ? 'HOME' : 'TRAVEL'
  const Icon = direction === 'open' ? ChevronsRight : ChevronsLeft
  return (
    <Button
      className="pulse-ends-hit"
      size="lg"
      fullWidth
      icon={moving ? undefined : Icon}
      variant={emphasized ? 'primary' : 'secondary'}
      disabled={disabled}
      title={`Move the ${jaw} jaw toward ${direction}, ${STEP_US} microseconds`}
      style={{ minHeight: 88, padding: '12px 16px' }}
      onClick={onPress}
    >
      {moving ? 'Moving…' : (
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
          <span style={{ fontSize: 22, fontWeight: 800 }}>{label}</span>
          <span style={{ fontSize: 14, fontWeight: 700, opacity: 0.9 }}>{target} · {STEP_US} µs</span>
        </span>
      )}
    </Button>
  )
}

export function PulseEndsPanel({
  rows,
  host,
  captured,
  liveById,
  activeId,
  busy,
  confirmApply,
  onSelect,
  onJog,
  onSave,
  onRequestApply,
  onApply,
  onCancelApply,
}: Props) {
  const { colors } = useTheme()
  const [pending, setPending] = useState<Pending | null>(null)
  const saved = savedMap(captured)
  const capturedKey = FIELDS.map((field) => saved[field] ?? '').join('|')
  const confirmSnapshot = useRef(capturedKey)
  const active = rows.find((row) => row.id === activeId) ?? rows[0] ?? null

  useEffect(() => {
    if (!busy) setPending(null)
  }, [busy])

  useEffect(() => {
    if (!confirmApply) {
      confirmSnapshot.current = capturedKey
      return
    }
    if (confirmSnapshot.current !== capturedKey) {
      confirmSnapshot.current = capturedKey
      onCancelApply()
    }
  }, [confirmApply, capturedKey, onCancelApply])

  const upperRows = rowsForAxis(rows, 'upper')
  const lowerRows = rowsForAxis(rows, 'lower')
  const upperLive = liveForRows(upperRows, liveById)
  const lowerLive = liveForRows(lowerRows, liveById)
  const activeLive = active?.axis === 'lower' ? lowerLive : upperLive
  const switchIsOn = active ? switchOn(active, activeLive) : false
  const livePulse = activeLive?.pulseUs
  const liveOut = livePulse != null && (livePulse < PULSE_MIN_US || livePulse > PULSE_MAX_US)
  const canSave = Boolean(active) && switchIsOn && !liveOut && !busy
  const issues = collectIssues(saved)
  const savedCount = FIELDS.filter((field) => saved[field] != null).length
  const ready = savedCount === FIELDS.length
  const applyBlocked = !ready || issues.length > 0
  const axisIssue = !active
    ? null
    : active.axis === 'upper'
      ? pairIssue('Upper', saved.hu, saved.tu, 'hu', 'tu')
      : pairIssue('Lower', saved.hl, saved.tl, 'hl', 'tl')
  const nextField = FIELDS.find((field) => saved[field] == null) ?? null
  const nextRow = nextField ? rows.find((row) => row.field === nextField && row.id !== active?.id) ?? null : null
  const step = active
    ? guidance({
      active,
      live: activeLive,
      switchIsOn,
      saved,
      issues,
      axisIssue,
      pending: busy ? pending : null,
      busy,
      next: nextRow,
    })
    : null
  const applyIssue = ready ? issues[0] : undefined

  const jog = (direction: 'open' | 'close') => {
    if (!active || busy) return
    setPending({ kind: 'jog', jaw: active.jaw, toward: direction })
    onJog(active, direction)
  }

  return (
    <CalibrationFrame busy={busy} fill>
      <style>{`.pulse-ends-hit:focus-visible{outline:3px solid ${colors.primary};outline-offset:2px;}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: colors.textSecondary }}>
          {PULSE_MIN_US}–{PULSE_MAX_US} µs · open − closed ≥ {PULSE_MIN_SPAN_US} µs · {STEP_US} µs / press
        </span>
        <span style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 800, color: colors.text }}>{savedCount} of 4 saved</span>
      </div>
      <div role="group" aria-label={`${savedCount} of 4 saved this visit`} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {FIELDS.map((field) => {
          const done = saved[field] != null
          const current = active?.field === field
          return (
            <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ flex: '0 0 auto', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: done ? colors.successDark : current ? colors.primary : colors.textSecondary }}>
                {field.toUpperCase()}
              </span>
              <span style={{ flex: 1, height: 4, borderRadius: 99, background: done ? colors.success : current ? colors.primary : colors.border }} />
            </div>
          )
        })}
      </div>

      {!active || !step ? (
        <p style={{ margin: 0, fontWeight: 600, color: colors.text }}>No pulse positions are available.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(380px, 0.95fr)', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <JawStation axis="upper" rows={upperRows} live={upperLive} saved={saved} host={host} activeId={active.id} nextId={nextRow?.id ?? null} onSelect={onSelect} />
            <JawStation axis="lower" rows={lowerRows} live={lowerLive} saved={saved} host={host} activeId={active.id} nextId={nextRow?.id ?? null} onSelect={onSelect} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: colors.text, lineHeight: 1.1 }}>
                {active.jaw} · {placeLabel(active)}
              </div>
              <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700, color: colors.textSecondary }}>
                Jog moves {active.switch} · {active.field}
              </div>
            </div>

            <GuidanceBanner {...step} />

            <ActionDock columns={2}>
              <JogButton
                direction="close"
                emphasized={active.position === 'travel'}
                moving={busy && pending?.kind === 'jog' && pending.toward === 'close'}
                disabled={busy}
                jaw={active.jaw}
                onPress={() => jog('close')}
              />
              <JogButton
                direction="open"
                emphasized={active.position === 'home'}
                moving={busy && pending?.kind === 'jog' && pending.toward === 'open'}
                disabled={busy}
                jaw={active.jaw}
                onPress={() => jog('open')}
              />
            </ActionDock>

            <Button
              className="pulse-ends-hit"
              size="lg"
              fullWidth
              variant="success"
              disabled={!canSave}
              title={canSave ? `Save ${active.field}` : `${active.switch} must be on and the pulse must be inside ${PULSE_MIN_US} to ${PULSE_MAX_US} microseconds`}
              style={{ minHeight: 72, padding: '12px 16px', fontSize: 20 }}
              onClick={() => {
                if (!canSave) return
                setPending({ kind: 'save', field: active.field })
                onSave(active)
              }}
            >
              {busy && pending?.kind === 'save' ? 'Saving…' : (
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                  <span>Save {active.field}</span>
                  {canSave && livePulse != null ? (
                    <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.9 }}>{livePulse} µs</span>
                  ) : null}
                </span>
              )}
            </Button>

            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: colors.textSecondary }}>On the machine</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
              {FIELDS.map((field) => {
                const visit = saved[field]
                const machine = asPulse(host[field])
                const accent = visit == null ? colors.border : machine != null && visit === machine ? colors.success : colors.primary
                return (
                  <div key={field} style={{ minWidth: 0, background: colors.grey, borderRadius: 10, padding: '10px 10px', borderTop: `3px solid ${accent}` }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', color: colors.textSecondary }}>{field.toUpperCase()}</div>
                    <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: 22, color: colors.text, lineHeight: 1.15 }}>{fmt(machine)}</div>
                  </div>
                )
              })}
            </div>

            {ready || confirmApply ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {confirmApply ? (
                <div
                  role="region"
                  aria-label="Confirm apply"
                  style={{
                    borderRadius: 10,
                    border: `1px solid ${colors.warning}`,
                    background: colors.severityMediumBg,
                    padding: '6px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 13, color: colors.text }}>Apply these pulses? SETCAL does not move the jaws.</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4 }}>
                    {FIELDS.map((field) => (
                      <div key={field} style={{ minWidth: 0, fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: colors.textSecondary }}>{field.toUpperCase()}</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: colors.text }}>{fmt(saved[field])}</div>
                      </div>
                    ))}
                  </div>
                  <ActionDock columns={2}>
                    <Button
                      className="pulse-ends-hit"
                      size="lg"
                      fullWidth
                      disabled={busy || Boolean(applyIssue)}
                      style={{ minHeight: 44, padding: '6px 8px' }}
                      onClick={() => {
                        setPending({ kind: 'apply' })
                        onApply()
                      }}
                    >
                      {busy && pending?.kind === 'apply' ? 'Applying…' : 'Apply'}
                    </Button>
                    <Button className="pulse-ends-hit" variant="ghost" size="lg" fullWidth disabled={busy} style={{ minHeight: 44, padding: '6px 8px' }} onClick={onCancelApply}>
                      Cancel
                    </Button>
                  </ActionDock>
                </div>
              ) : (
                <>
                  <Button
                    className="pulse-ends-hit"
                    size="lg"
                    fullWidth
                    disabled={busy || applyBlocked}
                    style={{ minHeight: 44, padding: '6px 10px' }}
                    onClick={() => {
                      if (busy || applyBlocked) return
                      onRequestApply()
                    }}
                  >
                    {busy && pending?.kind === 'apply' ? 'Applying…' : 'Apply four pulses'}
                  </Button>
                </>
              )}
            </div>
            ) : null}
          </div>
        </div>
      )}
    </CalibrationFrame>
  )
}
