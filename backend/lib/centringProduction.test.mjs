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

test('validateCentringGapAgainstStatus rejects gap at wrong posture', () => {
  const st = { u: S_MAX, l: S_MIN }
  assert.throws(
    () => validateCentringGapAgainstStatus(st, 10, 'upper', 'pre'),
    /unreachable|no valid|outside/i,
  )
})

test('assertCentringGapAchieved prefers STATUS h field', () => {
  assert.doesNotThrow(() =>
    assertCentringGapAchieved({ u: S_MIN, l: S_MAX, h: 20.2, moveEnd: 'ok' }, 20, 'pre'),
  )
})

test('assertCentringGapAchieved falls back to model from u/l', () => {
  const target = 25
  const hLo = heightFromSigned(S_MAX)
  const hUp = target - hLo
  const u = solveSignedFromHeight(hUp, S_MIN)
  assert.ok(u != null)
  assert.doesNotThrow(() => assertCentringGapAchieved({ u, l: S_MAX, moveEnd: 'ok' }, target, 'pre'))
})

test('assertCentringGapAchieved rejects large error', () => {
  assert.throws(
    () => assertCentringGapAchieved({ u: S_MAX, l: S_MAX, h: 1.2, moveEnd: 'ok' }, 25, 'pre'),
    /gap not achieved/i,
  )
})

test('assertCentringGapAchieved accepts moveEnd=limit when gap within tol', () => {
  assert.doesNotThrow(() =>
    assertCentringGapAchieved({ u: S_MIN, l: S_MAX, h: 20, moveEnd: 'limit' }, 20, 'pre'),
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
