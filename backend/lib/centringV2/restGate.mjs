/**
 * Centring rest gate: is the centring at the loaded reference's closing height?
 *
 * One rule for both machine setup ("already ready") and the production Start
 * gate: every centring_axis of the loaded reference is H_PRE
 * (classifyAxisPosition on the STATUS pulses, angles and heights), cal=1,
 * E-stop clear, not busy. Closed idle (both TRAVEL) is not ready, and no
 * marker of an earlier move is consulted: the STATUS alone decides.
 *
 * Pure: the caller supplies STATUS, reference and calibration.
 */
import { S_MAX } from '../centringMaster/centring_height_model.js'
import {
  H_PRE,
  NOT_AVAILABLE,
  centringAxesOf,
  classifyAxisPosition,
  expectedReferencePoses,
  normalizeSlaveCal,
} from './position.mjs'
import { lastMoveFromStatus } from './initialize.mjs'

export const REST_BLOCK = Object.freeze({
  STATUS_UNAVAILABLE: 'STATUS_UNAVAILABLE',
  ESTOP_LATCHED: 'ESTOP_LATCHED',
  NOT_CALIBRATED: 'NOT_CALIBRATED',
  BUSY: 'BUSY',
  CENTRING_AXIS_INVALID: 'CENTRING_AXIS_INVALID',
  NOT_AT_H_PRE: 'NOT_AT_H_PRE',
})

const AXES = Object.freeze(['upper', 'lower'])

function flag(v) {
  return v === true || v === 1 || v === '1'
}

/**
 * Reference the classifier can judge. When h_post is outside the height model
 * in this layout (e.g. one jaw with the other parked at TRAVEL), no jaw can be
 * at H_POST, so only h_pre is judged — the same rule as the class A cycle.
 */
function judgedReference(reference, poseArgs) {
  if (!centringAxesOf(reference?.centring_axis)) return reference
  try {
    expectedReferencePoses({ reference, ...poseArgs })
    return reference
  } catch {
    return { ...reference, h_post_mm: reference.h_pre_mm }
  }
}

/**
 * Position of both axes against the reference (axes outside centring_axis are
 * still named, for the operator lines).
 */
function classifyBoth({ status, reference: loaded, slaveCal, mechOffsetMm, toleranceDeg, linkAvailable }) {
  const axes = centringAxesOf(loaded?.centring_axis)
  const partnerAngleDeg = axes?.length === 1
    ? (normalizeSlaveCal(slaveCal)?.sTravel ?? S_MAX)
    : undefined
  const reference = judgedReference(loaded, {
    slaveCal,
    mechOffsetMm,
    ...(partnerAngleDeg != null ? { partnerAngleDeg } : {}),
  })
  const lastCompletedMove = lastMoveFromStatus(status, null)
  const positions = {}
  for (const axis of AXES) {
    positions[axis] = classifyAxisPosition({
      axis,
      status,
      linkAvailable,
      lastCompletedMove,
      reference,
      slaveCal,
      toleranceDeg,
      mechOffsetMm,
      ...(partnerAngleDeg != null ? { partnerAngleDeg } : {}),
    })
  }
  return positions
}

/**
 * @param {object} p
 * @param {object|null} p.status — latest STATUS
 * @param {object|null} p.reference — loaded recipe (`centring_axis`, `h_pre_mm`, `h_post_mm`)
 * @param {object|null} [p.slaveCal] — saved pulse–angle relation
 * @param {number} [p.mechOffsetMm=0]
 * @param {number} [p.toleranceDeg] — position match tolerance, default 0.5°
 * @param {boolean} [p.linkAvailable=true] — false while the centring link is down
 * @returns {{ ready: boolean, code: string|null, axes: string[]|null,
 *   positions: { upper: string, lower: string } }}
 */
export function centringRestState({
  status,
  reference,
  slaveCal = null,
  mechOffsetMm = 0,
  toleranceDeg,
  linkAvailable = true,
}) {
  const axes = centringAxesOf(reference?.centring_axis)
  const link = linkAvailable && status != null
  const positions = classifyBoth({ status, reference, slaveCal, mechOffsetMm, toleranceDeg, linkAvailable: link })
  const result = (code) => ({ ready: code == null, code, axes, positions })

  if (!link) return result(REST_BLOCK.STATUS_UNAVAILABLE)
  if (flag(status.estop)) return result(REST_BLOCK.ESTOP_LATCHED)
  if (!flag(status.cal)) return result(REST_BLOCK.NOT_CALIBRATED)
  if (flag(status.busy)) return result(REST_BLOCK.BUSY)
  if (!axes) return result(REST_BLOCK.CENTRING_AXIS_INVALID)
  if (!axes.every((axis) => positions[axis] === H_PRE)) return result(REST_BLOCK.NOT_AT_H_PRE)
  return result(null)
}

function describe(state) {
  const axes = state.axes ?? AXES
  return axes.map((axis) => `${axis} ${state.positions[axis] ?? NOT_AVAILABLE}`).join(', ')
}

/**
 * Operator block reason for a rest state that is not ready (null when ready).
 * Every reason names "Centring" so the HMI offers the setup button.
 * @param {ReturnType<typeof centringRestState>} state
 * @param {string} [setupCta='press Initialization first']
 */
export function centringRestBlockReason(state, setupCta = 'press Initialization first') {
  switch (state?.code ?? null) {
    case null:
      return null
    case REST_BLOCK.STATUS_UNAVAILABLE:
      return `Centring STATUS unavailable — wait for the next status, then ${setupCta}`
    case REST_BLOCK.ESTOP_LATCHED:
      return `Centring E-stop latched — release the button, clear the E-stop, then ${setupCta}`
    case REST_BLOCK.NOT_CALIBRATED:
      return `Centring not calibrated (cal=0) — ${setupCta}`
    case REST_BLOCK.BUSY:
      return `Centring is moving (${describe(state)}) — wait for the move to end`
    case REST_BLOCK.CENTRING_AXIS_INVALID:
      return 'Centring recipe has no centring_axis — re-save the shrink tube'
    default:
      return `Centring not at the reference closing height (${describe(state)}) — ${setupCta}`
  }
}
