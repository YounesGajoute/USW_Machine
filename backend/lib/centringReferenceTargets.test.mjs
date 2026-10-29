import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCentringReferenceTargets } from './centringReferenceTargets.mjs'
import { initializeCentringReferenceHome } from './centringIdle.mjs'
import { slaveCalMatchesLive } from './centringMaster/centring_master.js'

const status = { busy: false, estop: false, cal: true, accepted: true, hMin: 0.4,
  hMax: 61.47, mechOff: 0, u: -80, l: -80, uh: true, ut: false, lh: true, lt: false, moveEnd: 'ok' }
const recipe = { centring_axis: 'both', L_eff_mm: 50, h_pre_mm: 2, h_post_mm: 10 }

test('two-mm reference becomes reachable with the requested 0.4-mm minimum', () => {
  assert.deepEqual(validateCentringReferenceTargets(status, recipe), { min: .4, max: 60 })
  assert.throws(() => validateCentringReferenceTargets({ ...status, hMin: 3.8, hMax: 64.87, mechOff: 2 }, recipe),
    { code: 'CENTRING_REFERENCE_RANGE' })
})

test('initialization rejects an unreachable reference before HOME or parking', async () => {
  let moves = 0
  await assert.rejects(initializeCentringReferenceHome('both', {
    referenceRecipe: recipe, setHold: () => {}, connect: async () => {}, ensureReady: async () => {},
    status: async () => ({ ...status, hMin: 3.8, hMax: 64.87, mechOff: 2 }),
    homeByAxis: async () => { moves++; }, seekTravelByAxis: async () => { moves++; },
  }), { code: 'CENTRING_REFERENCE_RANGE' })
  assert.equal(moves, 0)
})

test('single-axis targets use the planned inactive-TRAVEL posture', () => {
  for (const axis of ['upper', 'lower']) {
    assert.deepEqual(validateCentringReferenceTargets(status, recipe, axis), { min: .4, max: 30.935 })
    assert.throws(() => validateCentringReferenceTargets(status, { ...recipe, h_pre_mm: 40 }, axis), /reachable/)
  }
  assert.doesNotThrow(() => validateCentringReferenceTargets(status, { ...recipe, h_pre_mm: 40 }))
})

test('long-tube h_post and missing live calibration cannot bypass preflight', () => {
  assert.throws(() => validateCentringReferenceTargets(status, { ...recipe, L_eff_mm: 100, h_post_mm: .1 }), /h_post/)
  assert.doesNotThrow(() => validateCentringReferenceTargets(status, { ...recipe, h_post_mm: .1 }))
  for (const change of [{ cal: false }, { busy: true }, { hMin: undefined }, { hMax: NaN }, { accepted: false }])
    assert.throws(() => validateCentringReferenceTargets({ ...status, ...change }, recipe))
})

test('same PWM ends cannot conceal a changed millimetre model', () => {
  const cal = { calId: 'gap04-20261029', hu: 2118, tu: 1262, hl: 1545, tl: 789,
    A: 3.97687625, B: -.176873, C: .00197035, sHome: -80, sTravel: 35 }
  const live = { ...status, ...cal }
  assert.equal(slaveCalMatchesLive(cal, live), true)
  assert.equal(slaveCalMatchesLive(cal, { ...live, hMin: 1.8, hMax: 62.87 }), false)
  assert.equal(slaveCalMatchesLive(cal, { ...live, calId: 'old-model' }), false)
  assert.equal(slaveCalMatchesLive(cal, { ...live, hMin: undefined }), false)
})

import { heightFromSigned, getModelHRangeMm, gapMmToMoveTarget, S_MIN, S_MAX } from './centringMaster/centring_height_model.js'

test('operator-set TRAVEL contributions are 0.2 mm each with zero offset', () => {
  assert.ok(Math.abs(heightFromSigned(S_MAX) - 0.2) < 1e-9)
  const range = getModelHRangeMm(0)
  assert.ok(Math.abs(range.min - 0.4) < 1e-9)
  assert.ok(Math.abs(range.max - 61.4739125) < 1e-8)
  for (const moveCommand of ['MOVEBOTHMM', 'MOVE_UPPERMM', 'MOVE_LOWERMM']) {
    const target = gapMmToMoveTarget({ gapMm: 2, moveCommand,
      uNow: moveCommand === 'MOVE_LOWERMM' ? S_MAX : S_MIN,
      lNow: moveCommand === 'MOVE_UPPERMM' ? S_MAX : S_MIN,
      mechOffsetMm: 0 })
    assert.ok(Math.abs(target.expectedH - 2) < 0.01)
  }
})
