import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertPulseInRange,
  curveFromEndpoints,
  curveSummary,
  fitQuadratic,
  heightAtAngle,
  pulseEndStep,
  validatePulseEnds,
  DEFAULT_CURVE,
} from './centringHeightCalibration.mjs'

test('default curve matches the Version 1 HOME and TRAVEL heights', () => {
  const summary = curveSummary(DEFAULT_CURVE)
  assert.ok(Math.abs(summary.hHomeMm - 31.437) < 0.01)
  assert.ok(Math.abs(summary.hTravelMm - 0.9) < 0.01)
  assert.ok(summary.hHomeMm > summary.hTravelMm)
})

test('fitQuadratic recovers a known curve from three samples', () => {
  const curve = { A: 4, B: -0.2, C: 0.002 }
  const samples = [-80, -20, 35].map((angleDeg) => ({
    angleDeg,
    hMm: heightAtAngle(angleDeg, curve),
  }))
  const fitted = fitQuadratic(samples)
  assert.ok(Math.abs(fitted.A - 4) < 1e-6)
  assert.ok(Math.abs(fitted.B + 0.2) < 1e-6)
  assert.ok(Math.abs(fitted.C - 0.002) < 1e-8)
})

test('curveFromEndpoints keeps C and hits the measured ends', () => {
  const next = curveFromEndpoints(30, 1, -80, 35, DEFAULT_CURVE.C)
  assert.ok(Math.abs(heightAtAngle(-80, next) - 30) < 1e-6)
  assert.ok(Math.abs(heightAtAngle(35, next) - 1) < 1e-6)
  assert.equal(next.C, DEFAULT_CURVE.C)
})

test('validatePulseEnds rejects a reversed upper span', () => {
  assert.throws(
    () => validatePulseEnds({ hu: 1100, tu: 1950, hl: 1501, tl: 731 }),
    /hu > tu/,
  )
})

test('validatePulseEnds accepts a legal pair', () => {
  const ends = validatePulseEnds({ hu: 1950, tu: 1100, hl: 1501, tl: 731 })
  assert.equal(ends.hu, 1950)
  assert.equal(ends.tl, 731)
})

test('pulseEndStep names one jaw and one switch', () => {
  const upperHome = pulseEndStep('upper', 'home')
  assert.equal(upperHome.command, 'CALDRV OPEN U')
  assert.equal(upperHome.field, 'hu')
  const lowerTravel = pulseEndStep('lower', 'travel')
  assert.equal(lowerTravel.command, 'CALDRV CLOSE L')
  assert.equal(lowerTravel.field, 'tl')
  assert.throws(() => pulseEndStep('both', 'home'), /upper or lower/)
})

test('assertPulseInRange rejects a pulse below 544 µs', () => {
  assert.throws(() => assertPulseInRange('tu', 400), /544/)
  assert.equal(assertPulseInRange('hu', 1950.4), 1950)
})
