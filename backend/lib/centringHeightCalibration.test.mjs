import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertOpeningFalls,
  assertPulseInRange,
  curveFromEndpoints,
  curveSummary,
  fitQuadratic,
  heightAtAngle,
  interiorOpeningMm,
  INTERIOR_POSES,
  midPoseOpeningMm,
  poseSampleAngle,
  pulseEndStep,
  validatePulseEnds,
  DEFAULT_CURVE,
} from './centringHeightCalibration.mjs'
import { solveSignedFromHeight } from './centringMaster/centring_height_model.js'
import {
  buildCurve,
  driveCurvePose,
  __resetHeightCalibrationDepsForTest,
  __setHeightCalibrationDepsForTest,
} from './centringHeightCalibrationService.mjs'

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

test('mid pose commands the halfway-angle opening, not the average of the end heights', () => {
  const saved = curveSummary(DEFAULT_CURVE)
  const atHalfwayAngle = midPoseOpeningMm(DEFAULT_CURVE, 0)
  const heightAverage = saved.hHomeMm + saved.hTravelMm
  assert.ok(Math.abs(atHalfwayAngle - 2 * heightAtAngle(-22.5, DEFAULT_CURVE)) < 1e-9)
  assert.ok(Math.abs(atHalfwayAngle - heightAverage) > 10)
})

test('the gauge screen mid point is rejected at -22.5° and accepted at the height-average pose angle', () => {
  const saved = curveSummary(DEFAULT_CURVE)
  const commandedPerJaw = (saved.hHomeMm + saved.hTravelMm) / 2
  const poseAngle = solveSignedFromHeight(commandedPerJaw, saved.sHome, DEFAULT_CURVE)
  assert.ok(poseAngle != null)
  assert.ok(Math.abs(poseAngle - (-22.5)) > 10)

  const mislabeled = fitQuadratic([
    { angleDeg: -80, hMm: 22.5 },
    { angleDeg: -22.5, hMm: 17.5 },
    { angleDeg: 35, hMm: 0.5 },
  ])
  assert.ok(mislabeled.C < 0)
  assert.throws(
    () => assertOpeningFalls({ ...mislabeled, sHome: -80, sTravel: 35 }, { fromSamples: true }),
    /do not fall steadily/,
  )
  const summary = curveSummary({
    ...fitQuadratic([
      { angleDeg: -80, hMm: 22.5 },
      { angleDeg: poseAngle, hMm: 17.5 },
      { angleDeg: 35, hMm: 0.5 },
    ]),
    sHome: -80,
    sTravel: 35,
  })
  assert.ok(summary.C < 0)
  assert.ok(summary.hHomeMm > summary.hTravelMm)
  assertOpeningFalls(summary)
})

test('four middle openings sit at different heights', () => {
  const totals = INTERIOR_POSES.map((pose) => interiorOpeningMm(DEFAULT_CURVE, pose.fraction, 0))
  assert.equal(totals.length, 4)
  for (let i = 1; i < totals.length; i += 1) {
    assert.ok(totals[i] < totals[i - 1] - 5)
  }
})

test('six gauge samples recover the quadratic and a partial middle set is refused', () => {
  const samples = [
    { pose: 'home', angleDeg: -80, hMm: heightAtAngle(-80, DEFAULT_CURVE) },
    { pose: 'travel', angleDeg: 35, hMm: heightAtAngle(35, DEFAULT_CURVE) },
    ...INTERIOR_POSES.map((pose) => {
      const angleDeg = -80 + pose.fraction * 115
      return { pose: pose.id, angleDeg, hMm: heightAtAngle(angleDeg, DEFAULT_CURVE) }
    }),
  ]
  const summary = buildCurve({ sHome: -80, sTravel: 35, samples })
  assert.ok(Math.abs(summary.A - DEFAULT_CURVE.A) < 1e-6)
  assert.ok(Math.abs(summary.B - DEFAULT_CURVE.B) < 1e-6)
  assert.ok(Math.abs(summary.C - DEFAULT_CURVE.C) < 1e-8)
  assert.ok(summary.maxResidualMm < 1e-6)
  assert.throws(
    () => buildCurve({
      sHome: -80,
      sTravel: 35,
      C: DEFAULT_CURVE.C,
      samples: samples.filter((sample) => sample.pose !== 'm4'),
    }),
    /four middle/,
  )
})

test('curveFromEndpoints accepts a negative C when the opening still falls', () => {
  const next = curveFromEndpoints(22.5, 0.5, -80, 35, -0.0002)
  assert.equal(next.C, -0.0002)
  assert.ok(Math.abs(heightAtAngle(-80, next) - 22.5) < 1e-6)
  assert.ok(Math.abs(heightAtAngle(35, next) - 0.5) < 1e-6)
  assertOpeningFalls(next)
})

test('curveFromEndpoints rejects a negative C that rises near HOME', () => {
  assert.throws(
    () => curveFromEndpoints(22.5, 0.5, -80, 35, -0.01),
    /does not fall steadily/,
  )
})

test('poseSampleAngle uses the live mid angle and the switch labels at the ends', () => {
  const home = poseSampleAngle('home', DEFAULT_CURVE, { uh: 1, lh: 1, u: -77, l: -78 })
  assert.equal(home.angleDeg, -80)
  assert.throws(
    () => poseSampleAngle('travel', DEFAULT_CURVE, { ut: 1, lt: 0, u: 35, l: 35 }),
    /close-end switches/,
  )
  const mid = poseSampleAngle('m2', DEFAULT_CURVE, { u: -43.9, l: -43.5 })
  assert.ok(Math.abs(mid.angleDeg - (-43.7)) < 0.05)
  assert.equal(mid.offCommand, true)
  assert.throws(
    () => poseSampleAngle('m2', DEFAULT_CURVE, { u: -30, l: -40 }),
    /not at the same angle/,
  )
})

test('drive m2 sends that fraction opening and stores the reported soft angle', async () => {
  const moves = []
  __setHeightCalibrationDepsForTest({
    master: {
      connectWithRetry: async () => {},
      getCentringConfig: () => ({ slaveCal: null, mechOffsetMm: 0 }),
      calDrive: async () => { throw new Error('a middle pose must not crawl to a switch') },
      moveBoth: async (h) => { moves.push(h) },
      status: async () => ({ u: -34.1, l: -33.9, uh: 0, ut: 0, lh: 0, lt: 0 }),
    },
  })
  try {
    const result = await driveCurvePose('m2')
    assert.ok(Math.abs(moves[0] - interiorOpeningMm(DEFAULT_CURVE, 0.4, 0)) < 1e-9)
    assert.ok(Math.abs(result.angleDeg - (-34)) < 0.05)
    assert.equal(result.offCommand, false)
  } finally {
    __resetHeightCalibrationDepsForTest()
  }
})

test('drive HOME records sHome only when both open switches are pressed', async () => {
  const moves = []
  __setHeightCalibrationDepsForTest({
    master: {
      connectWithRetry: async () => {},
      getCentringConfig: () => ({ slaveCal: null, mechOffsetMm: 0 }),
      calDrive: async () => {},
      moveBoth: async (h) => { moves.push(h) },
      status: async () => ({ u: -78, l: -79, uh: 1, ut: 0, lh: 1, lt: 0 }),
    },
  })
  try {
    const result = await driveCurvePose('home')
    assert.equal(result.angleDeg, DEFAULT_CURVE.sHome)
    assert.equal(moves.length, 0)
  } finally {
    __resetHeightCalibrationDepsForTest()
  }
})

test('assertPulseInRange rejects a pulse below 544 µs', () => {
  assert.throws(() => assertPulseInRange('tu', 400), /544/)
  assert.equal(assertPulseInRange('hu', 1950.4), 1950)
})
