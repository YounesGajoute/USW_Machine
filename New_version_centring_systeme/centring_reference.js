/**
 * Centring gap moves — explicit gapMm + axis (MOVEBOTHMM / MOVE_UPPERMM / MOVE_LOWERMM).
 * Production supplies gap from shrink-tube profile or orchestration logic; no RBK tables.
 */

const MOVE_COMMANDS = {
  both: 'MOVEBOTHMM',
  upper: 'MOVE_UPPERMM',
  lower: 'MOVE_LOWERMM',
}

export function normalizeMoveAxis(axis) {
  const a = String(axis || 'both').toLowerCase()
  if (a === 'both' || a === 'upper' || a === 'lower') return a
  throw new Error(`invalid axis "${axis}" (use both, upper, or lower)`)
}

/** Total shrink-tube gap → command gap: both axes share total; single axis moves half (per side). */
export function gapMmForCentringAxis(totalGapMm, axis = 'both') {
  const total = Number(totalGapMm)
  if (!Number.isFinite(total)) return total
  const ax = normalizeMoveAxis(axis)
  return ax === 'both' ? total : total / 2
}

/** Resolve gap mm and wire move command for a centring motion. */
export function resolveGapMove({ gapMm, axis = 'both' } = {}) {
  const h = Number(gapMm)
  if (!Number.isFinite(h) || h <= 0 || h > 200) {
    throw new Error('gapMm must be a finite number in (0, 200]')
  }
  const ax = normalizeMoveAxis(axis)
  return {
    gapMm: h,
    axis: ax,
    moveCommand: MOVE_COMMANDS[ax],
  }
}

function validateGapAgainstLimits(gapMm, hMin, hMax) {
  if (hMin != null && Number.isFinite(hMin) && gapMm < hMin) {
    throw new Error(`gap ${gapMm} mm below Nano hmin ${hMin} mm`)
  }
  if (hMax != null && Number.isFinite(hMax) && gapMm > hMax) {
    throw new Error(`gap ${gapMm} mm above Nano hmax ${hMax} mm`)
  }
}

async function getMasterModule() {
  return import('./centring_master.js')
}

/** Move centring to an explicit gap (requires both axes homed unless single-axis move). */
export async function applyGap({ gapMm, axis = 'both', speedDegS, connect = true } = {}) {
  const resolved = resolveGapMove({ gapMm, axis })
  const master = await getMasterModule()

  if (connect) {
    await master.connectWithRetry()
  }

  const st = await master.status()
  if (!st) throw new Error('applyGap: STATUS unavailable')
  if (st.estop) throw new Error('applyGap: e-stop latched')
  if (st.homeFail) throw new Error('applyGap: home failed')
  if (resolved.axis !== 'lower' && !st.homedUpper) {
    throw new Error('applyGap: upper not homed (HOME or HOME_UPPER first)')
  }
  if (resolved.axis !== 'upper' && !st.homedLower) {
    throw new Error('applyGap: lower not homed (HOME or HOME_LOWER first)')
  }

  validateGapAgainstLimits(resolved.gapMm, st.hMin, st.hMax)

  const masterCfg = await getMasterModule()
  const masterRange = masterCfg.getEffectiveHRangeMm()
  validateGapAgainstLimits(resolved.gapMm, masterRange.min, masterRange.max)

  const done = await master.moveTo(resolved.gapMm, speedDegS, resolved.axis)

  return { ...resolved, done }
}

/** Alias for applyGap — used when production loads a target opening height. */
export async function loadGap(opts) {
  return applyGap(opts)
}

/**
 * Shrink-tube centring gap (h_pre or h_post) at high servo speed.
 * Uses gapMoveSpeedDegS from centring config (default 90 deg/s) unless speedDegS is passed.
 * @param {'pre'|'post'} phase
 * @param {object} resolved — from resolveShrinkTubeCentring()
 */
export async function applyShrinkTubeGapPhase({
  phase,
  resolved,
  gapMm,
  axis,
  speedDegS,
  connect = true,
} = {}) {
  const p = String(phase || '').toLowerCase()
  if (p !== 'pre' && p !== 'post') {
    throw new Error('applyShrinkTubeGapPhase: phase must be "pre" or "post"')
  }
  if (!resolved && gapMm == null) {
    throw new Error('applyShrinkTubeGapPhase: resolved profile or gapMm required')
  }

  const master = await getMasterModule()
  const totalGapMm = gapMm ?? (p === 'pre' ? resolved.h_pre_mm : resolved.h_post_mm)
  const ax = axis ?? resolved?.centring_axis ?? 'both'
  const commandedGapMm = gapMmForCentringAxis(totalGapMm, ax)
  const spd = speedDegS ?? master.getGapMoveSpeedDegS()

  const result = await applyGap({ gapMm: commandedGapMm, axis: ax, speedDegS: spd, connect })
  return { ...result, phase: p, totalGapMm, commandedGapMm }
}
