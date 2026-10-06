import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getModelHRangeMm,
  heightFromSigned,
  solveSignedFromHeight,
  gapMmToMoveTarget,
  S_MIN,
  S_MAX,
  H_PRODUCTION_PARK_MM,
} from './centring_height_model.js'
import {
  computeMechOffsetFromMeasurements,
  MODEL_H_RANGE_MM,
} from './centring_calibration.js'

test('model band matches slave quadratic endpoints', () => {
  const r = getModelHRangeMm(0)
  assert.ok(Math.abs(r.max - 2 * heightFromSigned(S_MIN)) < 1e-6)
  assert.ok(Math.abs(r.min - 2 * heightFromSigned(S_MAX)) < 1e-6)
  assert.deepEqual(MODEL_H_RANGE_MM, r)
})

test('solveSignedFromHeight round-trips near HOME and TRAVEL', () => {
  const hHome = heightFromSigned(S_MIN)
  const hTravel = heightFromSigned(S_MAX)
  assert.ok(Math.abs(solveSignedFromHeight(hHome, 0) - S_MIN) < 0.05)
  assert.ok(Math.abs(solveSignedFromHeight(hTravel, 0) - S_MAX) < 0.05)
})

test('MOVEBOTHMM mid-band target is accepted', () => {
  const mid = (MODEL_H_RANGE_MM.min + MODEL_H_RANGE_MM.max) / 2
  const t = gapMmToMoveTarget({
    gapMm: mid,
    moveCommand: 'MOVEBOTHMM',
    uNow: S_MIN,
    lNow: S_MIN,
  })
  assert.ok(Math.abs(t.expectedH - mid) < 0.05)
})

test('production park model height is one open + one closed side (descriptive)', () => {
  assert.ok(Math.abs(H_PRODUCTION_PARK_MM - (heightFromSigned(S_MIN) + heightFromSigned(S_MAX))) < 1e-6)
})

const CUSTOM_CURVE = Object.freeze({ A: 5.2, B: -0.19, C: 0.0021, sHome: -80, sTravel: 35 })

test('omitted curve is the default curve', () => {
  assert.equal(heightFromSigned(-20), heightFromSigned(-20, undefined))
  assert.deepEqual(getModelHRangeMm(0.5), getModelHRangeMm(0.5, undefined))
})

test('custom curve changes height, band, and the solved angle', () => {
  const c = CUSTOM_CURVE
  assert.ok(Math.abs(heightFromSigned(-20, c) - (c.A + c.B * -20 + c.C * 400)) < 1e-9)
  const r = getModelHRangeMm(0, c)
  assert.ok(Math.abs(r.max - 2 * heightFromSigned(c.sHome, c)) < 1e-9)
  assert.ok(Math.abs(r.min - 2 * heightFromSigned(c.sTravel, c)) < 1e-9)
  const s = solveSignedFromHeight(10, 0, c)
  assert.ok(Math.abs(heightFromSigned(s, c) - 10) < 1e-6)
  assert.ok(Math.abs(s - solveSignedFromHeight(10, 0)) > 0.5)
})

test('gapMmToMoveTarget follows a custom curve', () => {
  const t = gapMmToMoveTarget({ gapMm: 20, moveCommand: 'MOVEBOTHMM', uNow: S_MIN, lNow: S_MIN, curve: CUSTOM_CURVE })
  assert.ok(Math.abs(heightFromSigned(t.deg, CUSTOM_CURVE) - 10) < 1e-6)
  assert.ok(Math.abs(t.expectedH - 20) < 1e-6)
  assert.throws(() => gapMmToMoveTarget({ gapMm: 20, moveCommand: 'MOVEBOTHMM', uNow: 0, lNow: 0, curve: { A: 1 } }), /height curve/)
})

test('mech offset from matching home/closed measurements', () => {
  const base = MODEL_H_RANGE_MM
  const off = computeMechOffsetFromMeasurements({
    measuredHomeMm: base.max - 1.5,
    measuredClosedMm: base.min - 1.5,
  })
  assert.ok(Math.abs(off - (-1.5)) < 0.05)
})
