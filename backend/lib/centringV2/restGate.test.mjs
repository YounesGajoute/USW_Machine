import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heightFromSigned, S_MAX } from '../centringMaster/centring_height_model.js'
import { expectedReferencePoses, H_PRE, H_POST, TRAVEL, UNKNOWN, IN_MOTION, NOT_AVAILABLE } from './position.mjs'
import { centringRestState, centringRestBlockReason, REST_BLOCK } from './restGate.mjs'

const CAL = Object.freeze({ calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })
const REF = Object.freeze({ l_eff_mm: 50, h_pre_mm: 3, h_post_mm: 22, centring_axis: 'both' })
const BASE = Object.freeze({ busy: false, estop: false, cal: true, moveEnd: 'ok', uh: false, ut: false, lh: false, lt: false })

const POSES = expectedReferencePoses({ reference: REF, slaveCal: CAL })
const at = (pose) => ({
  ...BASE,
  u: pose.upper.angleDeg, pu: pose.upper.pulseUs, puMm: pose.upper.sideHeightMm,
  l: pose.lower.angleDeg, pl: pose.lower.pulseUs, plMm: pose.lower.sideHeightMm,
})
const AT_H_PRE = at(POSES.h_pre)
const AT_H_POST = at(POSES.h_post)
const AT_TRAVEL = {
  ...BASE,
  u: S_MAX, pu: CAL.tu, puMm: heightFromSigned(S_MAX), ut: true,
  l: S_MAX, pl: CAL.tl, plMm: heightFromSigned(S_MAX), lt: true,
}

const state = (status, extra = {}) => centringRestState({ status, reference: REF, slaveCal: CAL, ...extra })

test('ready when both centring axes are H_PRE, cal=1, E-stop clear, not busy', () => {
  const s = state(AT_H_PRE)
  assert.equal(s.ready, true)
  assert.equal(s.code, null)
  assert.deepEqual(s.positions, { upper: H_PRE, lower: H_PRE })
  assert.equal(centringRestBlockReason(s), null)
})

test('not ready when both axes are at TRAVEL (closed idle is not the rest position)', () => {
  const s = state(AT_TRAVEL)
  assert.equal(s.ready, false)
  assert.equal(s.code, REST_BLOCK.NOT_AT_H_PRE)
  assert.deepEqual(s.positions, { upper: TRAVEL, lower: TRAVEL })
  assert.match(centringRestBlockReason(s), /^Centring not at the reference closing height \(upper TRAVEL, lower TRAVEL\) — press Initialization first$/)
})

test('not ready at H_POST, or with one axis off its pose', () => {
  assert.deepEqual(state(AT_H_POST).positions, { upper: H_POST, lower: H_POST })
  assert.equal(state(AT_H_POST).ready, false)
  const offPulse = { ...AT_H_PRE, pl: AT_H_PRE.pl + 40 }
  const s = state(offPulse)
  assert.equal(s.ready, false)
  assert.deepEqual(s.positions, { upper: H_PRE, lower: UNKNOWN })
})

test('E-stop, cal=0 and busy each block, in that order, even at the H_PRE pose', () => {
  assert.equal(state({ ...AT_H_PRE, estop: true, cal: false }).code, REST_BLOCK.ESTOP_LATCHED)
  assert.equal(state({ ...AT_H_PRE, cal: false }).code, REST_BLOCK.NOT_CALIBRATED)
  const busy = state({ ...AT_H_PRE, busy: true })
  assert.equal(busy.code, REST_BLOCK.BUSY)
  assert.deepEqual(busy.positions, { upper: IN_MOTION, lower: IN_MOTION })
  assert.match(centringRestBlockReason(busy), /moving/)
})

test('no STATUS or link down → not ready, axes NOT_AVAILABLE', () => {
  const none = state(null)
  assert.equal(none.code, REST_BLOCK.STATUS_UNAVAILABLE)
  assert.deepEqual(none.positions, { upper: NOT_AVAILABLE, lower: NOT_AVAILABLE })
  assert.equal(state(AT_H_PRE, { linkAvailable: false }).code, REST_BLOCK.STATUS_UNAVAILABLE)
})

test('without saved calibration H_PRE cannot be named → not ready', () => {
  const s = state(AT_H_PRE, { slaveCal: null })
  assert.equal(s.ready, false)
  assert.deepEqual(s.positions, { upper: UNKNOWN, lower: UNKNOWN })
})

test('recipe without centring_axis → not ready, named', () => {
  const s = centringRestState({ status: AT_H_PRE, reference: { ...REF, centring_axis: null }, slaveCal: CAL })
  assert.equal(s.code, REST_BLOCK.CENTRING_AXIS_INVALID)
  assert.match(centringRestBlockReason(s), /centring_axis/)
})

test('single axis: the centring_axis jaw at H_PRE is ready, the unused jaw is not judged', () => {
  const REF_UP = { ...REF, centring_axis: 'upper' }
  let poses
  try {
    poses = expectedReferencePoses({ reference: REF_UP, slaveCal: CAL, partnerAngleDeg: S_MAX })
  } catch {
    poses = expectedReferencePoses({ reference: { ...REF_UP, h_post_mm: REF_UP.h_pre_mm }, slaveCal: CAL, partnerAngleDeg: S_MAX })
  }
  const st = {
    ...AT_TRAVEL,
    u: poses.h_pre.upper.angleDeg, pu: poses.h_pre.upper.pulseUs, puMm: poses.h_pre.upper.sideHeightMm, ut: false,
  }
  const s = centringRestState({ status: st, reference: REF_UP, slaveCal: CAL })
  assert.deepEqual(s.positions, { upper: H_PRE, lower: TRAVEL })
  assert.equal(s.ready, true)
  assert.equal(centringRestState({ status: AT_TRAVEL, reference: REF_UP, slaveCal: CAL }).ready, false)
})

test('every block reason names Centring (HMI offers the setup button on it)', () => {
  for (const status of [null, { ...AT_H_PRE, estop: true }, { ...AT_H_PRE, cal: false }, { ...AT_H_PRE, busy: true }, AT_TRAVEL]) {
    assert.match(centringRestBlockReason(state(status), 'press Recover first'), /Centring/)
  }
})
