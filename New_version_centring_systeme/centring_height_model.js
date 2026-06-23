/**
 * Fixed etch-module gap model — mirrors firmware.
 *
 * Angle coordinate system (assigned after homing):
 *   S_HOME  (0°)  — HOME switch hit (UH/LH), guides closed, 0 mm per side
 *   S_TRAVEL (90°) — TRAVEL switch hit (UT/LT), guides open, 33.8 mm per side
 *
 * Total band: both at HOME 0 mm … both at TRAVEL 67.6 mm.
 */

export const H_SIDE_HOME = 0.0
export const H_SIDE_TRAVEL = 33.8
export const H_TOTAL_MAX = 67.6
export const S_HOME = 0.0
export const S_TRAVEL = 90.0

/** @deprecated use H_SIDE_HOME */
export const H_SIDE_OPEN = H_SIDE_HOME
/** @deprecated use H_SIDE_TRAVEL */
export const H_SIDE_CLOSED = H_SIDE_TRAVEL

/** @deprecated use S_HOME */
export const S_MIN = S_HOME
/** @deprecated use S_TRAVEL */
export const S_MAX = S_TRAVEL

/** Default runtime mechanical offset (mm). Uniform shift via SETMECHOFF / master config. */
export const MECH_OFFSET_MM_DEFAULT = 0.0
/** @deprecated use MECH_OFFSET_MM_DEFAULT */
export const SMAX_MECH_OFFSET_MM = MECH_OFFSET_MM_DEFAULT

const MOVE_COMMANDS = new Set(['MOVEBOTHMM', 'MOVE_UPPERMM', 'MOVE_LOWERMM'])

export function heightFromSigned(s) {
  const clamped = Math.max(S_HOME, Math.min(S_TRAVEL, s))
  const span = S_TRAVEL - S_HOME
  if (Math.abs(span) < 1e-6) return H_SIDE_HOME
  const t = (clamped - S_HOME) / span
  return H_SIDE_HOME + t * (H_SIDE_TRAVEL - H_SIDE_HOME)
}

export function totalHeightFromSigned(u, l) {
  return heightFromSigned(u) + heightFromSigned(l)
}

/** Firmware hmin/hmax band (total mm). Uniform offset shifts both limits. */
export function getModelHRangeMm(offsetMm = MECH_OFFSET_MM_DEFAULT) {
  const off = Number(offsetMm) || 0
  return {
    min: 2 * H_SIDE_HOME + off,
    max: 2 * H_SIDE_TRAVEL + off,
  }
}

export function solveSignedFromHeight(hPerSide, currentSigned) {
  void currentSigned
  const h = Number(hPerSide)
  if (!Number.isFinite(h) || h < -1e-4 || h > H_SIDE_TRAVEL + 1e-3) return null
  const hp = h < 0 ? 0 : (h > H_SIDE_TRAVEL ? H_SIDE_TRAVEL : h)
  const span = S_TRAVEL - S_HOME
  if (Math.abs(span) < 1e-6) return S_HOME
  const t = H_SIDE_TRAVEL > 1e-6 ? hp / H_SIDE_TRAVEL : 0
  return S_HOME + t * span
}

function clampSigned(deg) {
  return Math.max(S_HOME, Math.min(S_TRAVEL, deg))
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
  if (!Number.isFinite(gapMm) || gapMm < 0) {
    throw new Error(`gapMmToMoveTarget: gapMm must be a non-negative finite number`)
  }
  if (!Number.isFinite(uNow) || !Number.isFinite(lNow)) {
    throw new Error('gapMmToMoveTarget: uNow and lNow must be finite')
  }

  const modelGap = gapMm - (Number(mechOffsetMm) || 0)
  if (!Number.isFinite(modelGap) || modelGap < 0) {
    throw new Error(`gapMmToMoveTarget: physical gap ${gapMm} mm unreachable with offset ${mechOffsetMm}`)
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
    expectedH = 2 * heightFromSigned(deg) + (Number(mechOffsetMm) || 0)
  } else if (cmd === 'MOVE_UPPERMM') {
    const hLower = heightFromSigned(lNow)
    const hUpperTarget = modelGap - hLower
    if (hUpperTarget < 0) {
      throw new Error(`gap ${gapMm} mm unreachable with lower at h=${hLower.toFixed(2)} mm`)
    }
    deg = solveSignedFromHeight(hUpperTarget, uNow)
    if (deg == null) {
      throw new Error(`no valid upper angle for gap ${gapMm} mm (lower fixed)`)
    }
    expectedH = heightFromSigned(deg) + hLower + (Number(mechOffsetMm) || 0)
  } else {
    const hUpper = heightFromSigned(uNow)
    const hLowerTarget = modelGap - hUpper
    if (hLowerTarget < 0) {
      throw new Error(`gap ${gapMm} mm unreachable with upper at h=${hUpper.toFixed(2)} mm`)
    }
    deg = solveSignedFromHeight(hLowerTarget, lNow)
    if (deg == null) {
      throw new Error(`no valid lower angle for gap ${gapMm} mm (upper fixed)`)
    }
    expectedH = hUpper + heightFromSigned(deg) + (Number(mechOffsetMm) || 0)
  }

  deg = clampSigned(deg)
  return { deg, expectedH, moveCommand: cmd }
}
