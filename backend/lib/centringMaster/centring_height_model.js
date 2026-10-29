/**
 * Centring height model — mirrors Double_Actuator_Centring_Slave_Firmware.
 *
 * Authority: Double_Actuator_Centring_Slave_Firmware/HEIGHT_MODEL.md
 *
 * Angle coordinate system:
 *   S_HOME (−80°) — HOME switch: guides open, max height per side
 *   S_TRAVEL (+35°) — TRAVEL switch: guides closed, min height per side
 *
 *   h(s) = A + B·s + C·s²
 *   H    = h(u) + h(l) + mechOffsetMm
 */

export const CENTRING_A = 4.67687625
export const CENTRING_B = -0.176873
export const CENTRING_C = 0.00197035

export const S_MIN = -80.0
export const S_MAX = 35.0

/** @deprecated aliases — prefer S_MIN / S_MAX */
export const S_HOME = S_MIN
export const S_TRAVEL = S_MAX

/**
 * Soft-angle settle band after switch seeks (HOME / SEEK_TRAVEL).
 * Hardware TRAVEL/HOME switches remain authoritative; soft ° is derived from
 * pulse mapping and can sit ~1.5–3° off calibrated sTravel/sHome.
 * Matches e2e SEEK acceptance (±3°).
 */
export const ANGLE_IDLE_TOL_DEG = 3.0

/** Default runtime mechanical offset (mm). */
export const MECH_OFFSET_MM_DEFAULT = 0.0
/** @deprecated use MECH_OFFSET_MM_DEFAULT */
export const SMAX_MECH_OFFSET_MM = MECH_OFFSET_MM_DEFAULT

const MOVE_COMMANDS = new Set(['MOVEBOTHMM', 'MOVE_UPPERMM', 'MOVE_LOWERMM'])

function clampSigned(s) {
  return Math.max(S_MIN, Math.min(S_MAX, s))
}

/** Per-side model height (mm) from signed angle. */
export function heightFromSigned(s) {
  const x = clampSigned(Number(s))
  return CENTRING_A + CENTRING_B * x + CENTRING_C * x * x
}

export function totalHeightFromSigned(u, l, mechOffsetMm = 0) {
  return heightFromSigned(u) + heightFromSigned(l) + (Number(mechOffsetMm) || 0)
}

/** Side height at HOME (open) / TRAVEL (closed). */
export const H_SIDE_HOME = heightFromSigned(S_MIN)
export const H_SIDE_TRAVEL = heightFromSigned(S_MAX)
/** @deprecated open = HOME end */
export const H_SIDE_OPEN = H_SIDE_HOME
/** @deprecated closed = TRAVEL end */
export const H_SIDE_CLOSED = H_SIDE_TRAVEL

export const H_TOTAL_MAX = 2 * H_SIDE_HOME
export const H_TOTAL_MIN = 2 * H_SIDE_TRAVEL

/**
 * Model total H when one axis is at HOME (open) and the other at TRAVEL (closed).
 * Descriptive only — production park uses HOME_* on the active axis, not MOVE*MM
 * to this number. Tube closing/opening gaps are independent recipe heights.
 */
export const H_PRODUCTION_PARK_MM = H_SIDE_HOME + H_SIDE_TRAVEL

/** Firmware hmin/hmax band (total mm). Uniform offset shifts both limits. */
export function getModelHRangeMm(offsetMm = MECH_OFFSET_MM_DEFAULT) {
  const off = Number(offsetMm) || 0
  return {
    min: H_TOTAL_MIN + off,
    max: H_TOTAL_MAX + off,
  }
}

/**
 * Solve signed angle from per-side height (quadratic). Picks root closest to currentSigned.
 * @returns {number|null}
 */
export function solveSignedFromHeight(hPerSide, currentSigned) {
  const h = Number(hPerSide)
  if (!Number.isFinite(h)) return null
  const disc = CENTRING_B * CENTRING_B - 4 * CENTRING_C * (CENTRING_A - h)
  if (disc < -1e-4) return null
  const sq = Math.sqrt(Math.max(0, disc))
  const r1 = (-CENTRING_B + sq) / (2 * CENTRING_C)
  const r2 = (-CENTRING_B - sq) / (2 * CENTRING_C)
  const v1 = r1 >= S_MIN - 1e-3 && r1 <= S_MAX + 1e-3
  const v2 = r2 >= S_MIN - 1e-3 && r2 <= S_MAX + 1e-3
  if (!v1 && !v2) return null
  const cur = Number.isFinite(currentSigned) ? currentSigned : (S_MIN + S_MAX) / 2
  let pick
  if (v1 && v2) pick = Math.abs(r1 - cur) <= Math.abs(r2 - cur) ? r1 : r2
  else pick = v1 ? r1 : r2
  return clampSigned(pick)
}

/** True when both axes are at TRAVEL (closed idle). */
export function isCentringClosedIdle(u, l, tolDeg = ANGLE_IDLE_TOL_DEG) {
  const tol = Number.isFinite(tolDeg) ? tolDeg : ANGLE_IDLE_TOL_DEG
  return Math.abs(Number(u) - S_MAX) <= tol && Math.abs(Number(l) - S_MAX) <= tol
}

/** True when both axes are at HOME (fully open). */
export function isCentringOpenIdle(u, l, tolDeg = ANGLE_IDLE_TOL_DEG) {
  const tol = Number.isFinite(tolDeg) ? tolDeg : ANGLE_IDLE_TOL_DEG
  return Math.abs(Number(u) - S_MIN) <= tol && Math.abs(Number(l) - S_MIN) <= tol
}

/**
 * Convert total opening gap (mm) to signed degree target for a MOVE command.
 * @returns {{ deg: number, expectedH: number, moveCommand: string }}
 */
export function gapMmToMoveTarget({ gapMm, moveCommand, uNow, lNow, mechOffsetMm = MECH_OFFSET_MM_DEFAULT }) {
  const cmd = String(moveCommand || '').toUpperCase()
  if (!MOVE_COMMANDS.has(cmd)) {
    throw new Error(`gapMmToMoveTarget: unknown moveCommand ${moveCommand}`)
  }
  if (!Number.isFinite(gapMm)) {
    throw new Error(`gapMmToMoveTarget: gapMm must be a finite number`)
  }
  if (!Number.isFinite(uNow) || !Number.isFinite(lNow)) {
    throw new Error('gapMmToMoveTarget: uNow and lNow must be finite')
  }

  const off = Number(mechOffsetMm) || 0
  const modelGap = gapMm - off
  if (!Number.isFinite(modelGap)) {
    throw new Error(`gapMmToMoveTarget: physical gap ${gapMm} mm unreachable with offset ${mechOffsetMm}`)
  }

  const range = getModelHRangeMm(off)
  if (gapMm < range.min - 1e-3 || gapMm > range.max + 1e-3) {
    throw new Error(
      `gapMmToMoveTarget: gap ${gapMm} mm outside model band [${range.min.toFixed(2)}, ${range.max.toFixed(2)}] mm`,
    )
  }

  let deg
  let expectedH

  if (cmd === 'MOVEBOTHMM') {
    const hPerSide = modelGap * 0.5
    const currentSigned = (uNow + lNow) * 0.5
    deg = solveSignedFromHeight(hPerSide, currentSigned)
    if (deg == null) {
      throw new Error(`no valid signed angle for symmetric gap ${gapMm} mm`)
    }
    expectedH = 2 * heightFromSigned(deg) + off
  } else if (cmd === 'MOVE_UPPERMM') {
    const hLower = heightFromSigned(lNow)
    const hUpperTarget = modelGap - hLower
    deg = solveSignedFromHeight(hUpperTarget, uNow)
    if (deg == null) {
      throw new Error(`no valid upper angle for gap ${gapMm} mm (lower fixed at h=${hLower.toFixed(2)})`)
    }
    expectedH = heightFromSigned(deg) + hLower + off
  } else {
    const hUpper = heightFromSigned(uNow)
    const hLowerTarget = modelGap - hUpper
    deg = solveSignedFromHeight(hLowerTarget, lNow)
    if (deg == null) {
      throw new Error(`no valid lower angle for gap ${gapMm} mm (upper fixed at h=${hUpper.toFixed(2)})`)
    }
    expectedH = hUpper + heightFromSigned(deg) + off
  }

  deg = clampSigned(deg)
  return { deg, expectedH, moveCommand: cmd }
}
