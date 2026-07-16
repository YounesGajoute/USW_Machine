/**
 * Centring gap moves — Double_Actuator_Centring_Slave_Firmware contract.
 *
 * Authority:
 *   Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/MASTER_CONTROL.md
 * Wire:
 *   MOVE*MM <h_mm> [deg/s] → STATUS (busy=1) → completion STATUS busy=0
 *   Master verifies moveEnd=ok|none and |h − target| ≤ 1.0 mm
 *   MOVE requires cal=1 (SETCAL); honour reason= on rejects
 */

import { gapMmToMoveTarget } from './centring_height_model.js'

const MOVE_COMMANDS = {
  both: 'MOVEBOTHMM',
  upper: 'MOVE_UPPERMM',
  lower: 'MOVE_LOWERMM',
}

const MOVE_TOL_MM = Number(process.env.CENTRING_MOVE_TOL_MM || 1.0)
const SPEED_MIN = 0.01
const SPEED_MAX = 120

export function normalizeMoveAxis(axis) {
  const a = String(axis || 'both').toLowerCase()
  if (a === 'both' || a === 'upper' || a === 'lower') return a
  throw new Error(`invalid axis "${axis}" (use both, upper, or lower)`)
}

/**
 * Total shrink-tube gap → MOVE*MM target height.
 * Slave expects total H for MOVEBOTHMM / MOVE_UPPERMM / MOVE_LOWERMM alike.
 */
export function gapMmForCentringAxis(totalGapMm, axis = 'both') {
  const total = Number(totalGapMm)
  if (!Number.isFinite(total)) return total
  normalizeMoveAxis(axis)
  return total
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

function validateGapAgainstLimits(gapMm, hMin, hMax, label = 'gap') {
  if (hMin != null && Number.isFinite(hMin) && gapMm < hMin - 1e-4) {
    throw new Error(`${label} ${gapMm} mm below hmin ${hMin} mm`)
  }
  if (hMax != null && Number.isFinite(hMax) && gapMm > hMax + 1e-4) {
    throw new Error(`${label} ${gapMm} mm above hmax ${hMax} mm`)
  }
}

function clampSpeedDegS(speedDegS, fallback) {
  const n = Number(speedDegS ?? fallback)
  if (!Number.isFinite(n) || n < SPEED_MIN || n > SPEED_MAX) {
    throw new Error(`speedDegS must be ${SPEED_MIN}–${SPEED_MAX}`)
  }
  return n
}

function statusFromMoveResult(done) {
  if (done?.status && typeof done.status === 'object') return done.status
  if (done && Number.isFinite(done.h)) return done
  return null
}

function assertMoveAccepted(st, moveCommand) {
  if (!st) throw new Error(`applyGap: STATUS unavailable after ${moveCommand}`)
  if (st.accepted === false) {
    const reason = st.reason ?? '?'
    const hint = reason === 'nocal'
      ? ' — SETCAL required'
      : reason === 'estop'
        ? ' — CLEARESTOP then HOME'
        : reason === 'range'
          ? ' — height outside hmin/hmax'
          : st.busy
            ? ' — wait for busy=0 then retry'
            : ''
    throw new Error(
      `applyGap: ${moveCommand} rejected (accepted=0) reason=${reason} cal=${st.cal ? 1 : 0} `
      + `estop=${st.estop ? 1 : 0} busy=${st.busy ? 1 : 0}${hint}`,
    )
  }
  if (st.busy) {
    throw new Error(`applyGap: ${moveCommand} completion missing busy=0`)
  }
  const mend = st.moveEnd != null ? String(st.moveEnd).toLowerCase() : 'none'
  if (mend === 'home_fail') {
    throw new Error(`applyGap: unexpected home_fail after ${moveCommand}`)
  }
  if (mend !== 'ok' && mend !== 'none') {
    throw new Error(`applyGap: ${moveCommand} ended early: moveEnd=${mend}`)
  }
}

function assertHeightTol(st, targetMm, moveCommand) {
  const h = Number(st?.h)
  if (!Number.isFinite(h)) {
    throw new Error(`applyGap: ${moveCommand} completion STATUS missing h (cal=${st?.cal ? 1 : 0})`)
  }
  if (Math.abs(h - targetMm) > MOVE_TOL_MM) {
    throw new Error(
      `applyGap: height out of tol after ${moveCommand}: h=${h} target=${targetMm} (tol ${MOVE_TOL_MM} mm)`,
    )
  }
}

async function getMasterModule() {
  return import('./centring_master.js')
}

/**
 * Ensure STATUS allows MOVE* — cal=1, !estop, !busy (ensureReady + SETCAL).
 * @returns {Promise<object>} live STATUS
 */
async function ensureMoveReady(master, _axis) {
  void _axis
  let st = await master.ensureReady()
  if (!st) throw new Error('applyGap: STATUS unavailable after ensureReady')

  if (st.busy) {
    st = await master.waitIdle()
    if (!st) throw new Error('applyGap: STATUS unavailable after waitIdle')
    if (st.busy) throw new Error('applyGap: still busy after waitIdle')
  }

  if (!st.cal) {
    throw new Error('applyGap: cal=0 after ensureReady — SETCAL required')
  }
  if (st.estop) {
    throw new Error('applyGap: estop=1 after ensureReady — CLEARESTOP then HOME')
  }

  return st
}

/**
 * Move centring to an explicit total height H (mm).
 */
export async function applyGap({ gapMm, axis = 'both', speedDegS, connect = true } = {}) {
  const resolved = resolveGapMove({ gapMm, axis })
  const master = await getMasterModule()

  if (connect) {
    await master.connectWithRetry()
  }

  let st = await ensureMoveReady(master, resolved.axis)

  validateGapAgainstLimits(resolved.gapMm, st.hMin, st.hMax, 'gap')
  const masterRange = master.getEffectiveHRangeMm()
  validateGapAgainstLimits(resolved.gapMm, masterRange.min, masterRange.max, 'gap')

  const cfg = master.getCentringConfig()
  gapMmToMoveTarget({
    gapMm: resolved.gapMm,
    moveCommand: resolved.moveCommand,
    uNow: st.u,
    lNow: st.l,
    mechOffsetMm: cfg.mechOffsetMm ?? st.mechOff ?? 0,
  })

  const spd = clampSpeedDegS(speedDegS, cfg.movementSpeedDegS ?? 45)
  const done = await master.moveTo(resolved.gapMm, spd, resolved.axis)
  st = statusFromMoveResult(done) ?? (await master.status())

  assertMoveAccepted(st, resolved.moveCommand)
  assertHeightTol(st, resolved.gapMm, resolved.moveCommand)

  return {
    ...resolved,
    speedDegS: spd,
    done,
    status: st,
    h: st.h,
    tolMm: MOVE_TOL_MM,
  }
}

/** Alias for applyGap — used when production loads a target opening height. */
export async function loadGap(opts) {
  return applyGap(opts)
}

/**
 * Shrink-tube centring gap (h_pre or h_post) at gap-move servo speed.
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
