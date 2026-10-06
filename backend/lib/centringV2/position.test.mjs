import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyAxisPosition,
  expectedReferencePoses,
  moveCommandForCentringAxis,
  validateMatchToleranceDeg,
  DEFAULT_MATCH_TOLERANCE_DEG,
  HOME,
  TRAVEL,
  H_PRE,
  H_POST,
  UNKNOWN,
  IN_MOTION,
  NOT_AVAILABLE,
  WIRING,
} from './position.mjs'

const CAL = Object.freeze({ calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })
const REF_BOTH = Object.freeze({ h_pre_mm: 3, h_post_mm: 22, centring_axis: 'both' })
const REF_UPPER = Object.freeze({ h_pre_mm: 40, h_post_mm: 50, centring_axis: 'upper' })
const BETWEEN = Object.freeze({ busy: 0, uh: 0, ut: 0, lh: 0, lt: 0 })

const POSES_BOTH = expectedReferencePoses({ reference: REF_BOTH, slaveCal: CAL })
const POSES_UPPER = expectedReferencePoses({ reference: REF_UPPER, slaveCal: CAL })

function lastMove(poses, command = 'MOVEBOTHMM') {
  return { command, ...poses }
}

function classify(overrides = {}) {
  return classifyAxisPosition({
    axis: 'upper',
    status: BETWEEN,
    lastCompletedMove: lastMove(POSES_BOTH.h_pre),
    reference: REF_BOTH,
    slaveCal: CAL,
    ...overrides,
  })
}

test('rule 1: busy=1 is in motion, whatever the switches say', () => {
  assert.equal(classify({ status: { ...BETWEEN, busy: 1 } }), IN_MOTION)
  assert.equal(classify({ status: { ...BETWEEN, busy: true, uh: 1 } }), IN_MOTION)
})

test('rule 2: no STATUS or link lost is not available, even when the last move matched h_pre', () => {
  assert.equal(classify({ status: null }), NOT_AVAILABLE)
  assert.equal(classify({ linkAvailable: false }), NOT_AVAILABLE)
})

test('rule 3: both switches of one axis is a wiring warning, not a position', () => {
  assert.equal(classify({ status: { ...BETWEEN, uh: 1, ut: 1 } }), WIRING)
  assert.equal(classify({ axis: 'lower', status: { ...BETWEEN, lh: true, lt: true } }), WIRING)
  // The other axis is unaffected.
  assert.equal(classify({ axis: 'lower', status: { ...BETWEEN, uh: 1, ut: 1 } }), H_PRE)
})

test('rule 4: HOME switch only is HOME, even when the last move matched h_pre', () => {
  assert.equal(classify({ status: { ...BETWEEN, uh: 1 } }), HOME)
  assert.equal(classify({ axis: 'lower', status: { ...BETWEEN, lh: '1' } }), HOME)
})

test('rule 5: TRAVEL switch only is TRAVEL, even when the last move matched h_post', () => {
  assert.equal(classify({ status: { ...BETWEEN, ut: 1 }, lastCompletedMove: lastMove(POSES_BOTH.h_post) }), TRAVEL)
  assert.equal(classify({ axis: 'lower', status: { ...BETWEEN, lt: true } }), TRAVEL)
})

test('rule 6: between the switches and the last move matches h_pre is H_PRE on both axes', () => {
  assert.equal(classify(), H_PRE)
  assert.equal(classify({ axis: 'lower' }), H_PRE)
})

test('rule 7: between the switches and the last move matches h_post is H_POST', () => {
  const lastCompletedMove = lastMove(POSES_BOTH.h_post)
  assert.equal(classify({ lastCompletedMove }), H_POST)
  assert.equal(classify({ axis: 'lower', lastCompletedMove }), H_POST)
})

test('rule 8: between the switches with no matching last move is UNKNOWN', () => {
  const off = { angleDeg: 0, sideHeightMm: 4.68, pulseUs: 1500 }
  assert.equal(classify({ lastCompletedMove: { upper: off, lower: off } }), UNKNOWN)
  assert.equal(classify({ lastCompletedMove: null }), UNKNOWN)
  assert.equal(classify({ reference: null }), UNKNOWN)
})

test('a last move within tolerance still matches', () => {
  const exp = POSES_BOTH.h_pre.upper
  const near = { angleDeg: exp.angleDeg + 0.4, sideHeightMm: exp.sideHeightMm + 0.01, pulseUs: exp.pulseUs - 4 }
  assert.equal(classify({ lastCompletedMove: { upper: near } }), H_PRE)
})

test('any one of pulse, angle or height outside tolerance is UNKNOWN', () => {
  const exp = POSES_BOTH.h_pre.upper
  const cases = {
    angle: { ...exp, angleDeg: exp.angleDeg + 0.6 },
    height: { ...exp, sideHeightMm: exp.sideHeightMm + 0.5 },
    pulse: { ...exp, pulseUs: exp.pulseUs + 20 },
    missingPulse: { angleDeg: exp.angleDeg, sideHeightMm: exp.sideHeightMm },
  }
  for (const [name, upper] of Object.entries(cases)) {
    assert.equal(classify({ lastCompletedMove: { upper } }), UNKNOWN, name)
  }
})

test('the command name alone is not a match, and is not required for a match', () => {
  assert.equal(classify({ lastCompletedMove: { command: 'MOVEBOTHMM', targetH: 3 } }), UNKNOWN)
  const off = { angleDeg: 0, sideHeightMm: 4.68, pulseUs: 1500 }
  assert.equal(classify({ lastCompletedMove: { command: 'MOVEBOTHMM', upper: off } }), UNKNOWN)
  assert.equal(classify({ lastCompletedMove: { command: 'HOME', ...POSES_BOTH.h_pre } }), H_PRE)
  assert.equal(classify({ lastCompletedMove: { ...POSES_BOTH.h_pre } }), H_PRE)
})

test('an axis not in centring_axis is never H_PRE or H_POST', () => {
  const lastCompletedMove = { command: 'MOVE_UPPERMM', upper: POSES_UPPER.h_pre.upper, lower: POSES_UPPER.h_pre.upper }
  assert.equal(classify({ reference: REF_UPPER, lastCompletedMove }), H_PRE)
  assert.equal(classify({ axis: 'lower', reference: REF_UPPER, lastCompletedMove }), UNKNOWN)
})

test('single-axis h_post is matched from the h_pre pose', () => {
  const lastCompletedMove = { command: 'MOVE_UPPERMM', upper: POSES_UPPER.h_post.upper }
  assert.equal(classify({ reference: REF_UPPER, lastCompletedMove }), H_POST)
})

test('without a valid saved calibration an axis between the switches is UNKNOWN (V2-REQ-013)', () => {
  assert.equal(classify({ slaveCal: null }), UNKNOWN)
  assert.equal(classify({ slaveCal: { ...CAL, hu: 900, tu: 2200 } }), UNKNOWN)
  assert.equal(classify({ slaveCal: null, status: { ...BETWEEN, uh: 1 } }), HOME)
  assert.equal(classify({ slaveCal: null, status: { ...BETWEEN, ut: 1 } }), TRAVEL)
})

test('an unreachable reference height gives UNKNOWN, not an exception', () => {
  assert.equal(classify({ reference: { ...REF_BOTH, h_pre_mm: 80 } }), UNKNOWN)
})

test('match tolerance defaults to 0.5° and accepts only 0.1°–2.0°', () => {
  assert.deepEqual(validateMatchToleranceDeg(undefined), { ok: true, toleranceDeg: DEFAULT_MATCH_TOLERANCE_DEG })
  assert.equal(validateMatchToleranceDeg(0.1).ok, true)
  assert.equal(validateMatchToleranceDeg(2.0).ok, true)
  for (const t of [0.09, 2.01, 0, -0.5, NaN, 'x']) {
    assert.equal(validateMatchToleranceDeg(t).code, 'TOLERANCE_OUT_OF_RANGE', `tol ${t}`)
  }
  assert.throws(() => classify({ toleranceDeg: 3 }), /tolerance/)
})

test('a wider tolerance accepts a last move that 0.5° rejects', () => {
  const exp = POSES_BOTH.h_pre.upper
  const upper = { angleDeg: exp.angleDeg + 1.0, sideHeightMm: exp.sideHeightMm, pulseUs: exp.pulseUs }
  assert.equal(classify({ lastCompletedMove: { upper } }), UNKNOWN)
  assert.equal(classify({ lastCompletedMove: { upper }, toleranceDeg: 1.5 }), H_PRE)
})

test('moveCommandForCentringAxis maps upper / lower / both', () => {
  assert.equal(moveCommandForCentringAxis('both'), 'MOVEBOTHMM')
  assert.equal(moveCommandForCentringAxis('upper'), 'MOVE_UPPERMM')
  assert.equal(moveCommandForCentringAxis('LOWER'), 'MOVE_LOWERMM')
  assert.throws(() => moveCommandForCentringAxis('left'))
})

test('invalid axis argument throws', () => {
  assert.throws(() => classify({ axis: 'middle' }), /axis/)
})

test('a pressed HOME switch is HOME even when the pulse is at the TRAVEL end', () => {
  const slaveCal = {
    calId: 'meas-v1', hu: 2160, tu: 1200, hl: 1584, tl: 720,
    A: 4.67687625, B: -0.176873, C: 0.00197035, sHome: -80, sTravel: 35,
  }
  const reference = { h_pre_mm: 2, h_post_mm: 20, centring_axis: 'both' }
  const status = { busy: 0, uh: 1, ut: 0, lh: 1, lt: 0, pu: 2118, pl: 733, u: -74.97, l: 33.27 }
  const lastCompletedMove = {
    command: 'HOME',
    upper: { pulseUs: 2118, angleDeg: -74.97, sideHeightMm: 29.19 },
    lower: { pulseUs: 733, angleDeg: 33.27, sideHeightMm: 1 },
  }
  assert.equal(classifyAxisPosition({
    axis: 'upper', status, lastCompletedMove, reference, slaveCal,
  }), HOME)
  assert.equal(classifyAxisPosition({
    axis: 'lower', status, lastCompletedMove, reference, slaveCal,
  }), HOME)
})
