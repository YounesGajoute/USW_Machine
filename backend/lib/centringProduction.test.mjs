import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateCentringGapAgainstStatus,
  assertCentringGapAchieved,
  readCentringStatusAfterMove,
  __setCentringProductionTestDeps,
  __clearCentringProductionTestDeps,
} from './centringProduction.mjs'
import {
  S_MIN,
  S_MAX,
  heightFromSigned,
  solveSignedFromHeight,
} from './centringMaster/centring_height_model.js'

test('validateCentringGapAgainstStatus accepts mid gap at upper production posture', () => {
  const st = { u: S_MIN, l: S_MAX }
  assert.doesNotThrow(() => validateCentringGapAgainstStatus(st, 20, 'upper', 'pre'))
})

test('validateCentringGapAgainstStatus delegates per-axis reachability to the Nano', () => {
  const st = { u: S_MAX, l: S_MIN }
  assert.doesNotThrow(
    () => validateCentringGapAgainstStatus(st, 10, 'upper', 'pre'),
  )
})

test('assertCentringGapAchieved prefers STATUS h field', () => {
  assert.doesNotThrow(() =>
    assertCentringGapAchieved({ u: S_MIN, l: S_MAX, h: 20.2, moveEnd: 'ok' }, 20, 'pre'),
  )
})

test('reported 2 mm cannot override a lower jaw still reporting HOME', () => {
  assert.throws(() => assertCentringGapAchieved({
    cal: true, busy: false, estop: false, accepted: true, moveEnd: 'ok',
    u: 33.35, l: 35, h: 1.93, uh: false, ut: false, lh: true, lt: false,
  }, 2, 'pre'), { code: 'CENTRING_FEEDBACK_MISMATCH' })
})

test('gap completion rejects unsafe state and invalid targets even at the reported height', () => {
  const st = { cal: true, busy: false, estop: false, accepted: true, h: 2, moveEnd: 'ok' }
  for (const bad of [{ busy: true }, { estop: true }, { accepted: false }, { cal: false }]) {
    assert.throws(() => assertCentringGapAchieved({ ...st, ...bad }, 2, 'pre'), /not ready/)
  }
  assert.throws(() => assertCentringGapAchieved(st, NaN, 'pre'), /invalid target/)
})

test('assertCentringGapAchieved requires Nano height even when angles imply the target', () => {
  const target = 25
  const hLo = heightFromSigned(S_MAX)
  const hUp = target - hLo
  const u = solveSignedFromHeight(hUp, S_MIN)
  assert.ok(u != null)
  for (const h of [undefined, null, '', NaN, Infinity]) {
    assert.throws(() => assertCentringGapAchieved({ h, u, l: S_MAX, moveEnd: 'ok' }, target, 'pre'),
      /missing finite Nano height/)
  }
})

test('production delegates geometry within fixed policy and rejects above 60 mm', () => {
  assert.doesNotThrow(() => validateCentringGapAgainstStatus({}, 0, 'both', 'pre'))
  assert.doesNotThrow(() => validateCentringGapAgainstStatus({}, 1, 'both', 'pre'))
  assert.throws(() => validateCentringGapAgainstStatus({}, 80, 'both', 'pre'), /fixed command limits/)
  assert.doesNotThrow(() => validateCentringGapAgainstStatus({}, 1, 'lower', 'pre'))
  assert.throws(() => validateCentringGapAgainstStatus({}, 2, 'invalid', 'pre'), /invalid axis/)
})

test('gap completion permits zero only with valid Nano completion and height', () => {
  const st = { cal: true, busy: false, estop: false, accepted: true, h: 0, moveEnd: 'ok' }
  assert.doesNotThrow(() => assertCentringGapAchieved(st, 0, 'pre'))
  assert.throws(() => assertCentringGapAchieved({ ...st, h: 80 }, 80, 'pre'), /invalid target/)
  assert.throws(() => assertCentringGapAchieved({ ...st, accepted: false }, 0, 'pre'), /not ready/)
})

test('assertCentringGapAchieved rejects large error', () => {
  assert.throws(
    () => assertCentringGapAchieved({ u: S_MAX, l: S_MAX, h: 1.2, moveEnd: 'ok' }, 25, 'pre'),
    /gap not achieved/i,
  )
})

test('assertCentringGapAchieved rejects moveEnd=limit even when gap within tol', () => {
  assert.throws(() =>
    assertCentringGapAchieved({ u: S_MIN, l: S_MAX, h: 20, moveEnd: 'limit' }, 20, 'pre'),
    /moveEnd=limit/,
  )
})

test('assertCentringGapAchieved rejects moveEnd=home_fail', () => {
  assert.throws(
    () => assertCentringGapAchieved({ u: S_MIN, l: S_MAX, h: 20, moveEnd: 'home_fail' }, 20, 'pre'),
    /home_fail/i,
  )
})

test('readCentringStatusAfterMove reuses known idle STATUS (no extra TCP)', async () => {
  let waitCalls = 0
  let statusCalls = 0
  __setCentringProductionTestDeps({
    waitIdle: async () => {
      waitCalls += 1
      return { u: S_MIN, l: S_MAX, h: 20, busy: false, moveEnd: 'ok' }
    },
    centringStatus: async () => {
      statusCalls += 1
      return { u: S_MIN, l: S_MAX, h: 20, busy: false, moveEnd: 'ok' }
    },
  })
  try {
    const known = { u: S_MIN, l: S_MAX, h: 20.1, busy: false, moveEnd: 'ok' }
    const st = await readCentringStatusAfterMove('pre', 20, known)
    assert.equal(st, known)
    assert.equal(waitCalls, 0)
    assert.equal(statusCalls, 0)
  } finally {
    __clearCentringProductionTestDeps()
  }
})
