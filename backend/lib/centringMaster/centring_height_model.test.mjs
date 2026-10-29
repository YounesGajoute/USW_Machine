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

test('mech offset from matching home/closed measurements', () => {
  const base = MODEL_H_RANGE_MM
  const off = computeMechOffsetFromMeasurements({
    measuredHomeMm: base.max - 1.5,
    measuredClosedMm: base.min - 1.5,
  })
  assert.ok(Math.abs(off - (-1.5)) < 0.05)
})
