#!/usr/bin/env node
/**
 * Calibration module + uniform offset band tests.
 */
import {
  MODEL_H_RANGE_MM,
  computeMechOffsetFromMeasurements,
  deriveMechOffsetFromHRange,
  effectiveHRangeFromOffset,
  getCalibrationInfo,
} from '../master/centring_calibration.js'
import { getModelHRangeMm } from '../master/centring_height_model.js'

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

check('MODEL_H_RANGE matches getModelHRangeMm(0)', MODEL_H_RANGE_MM.min === getModelHRangeMm(0).min)
check('model min ~0', Math.abs(MODEL_H_RANGE_MM.min) < 0.1)
check('model max ~67.6', Math.abs(MODEL_H_RANGE_MM.max - 67.6) < 0.15)

for (const off of [-2, -1, 0, 1.5, 3]) {
  const band = effectiveHRangeFromOffset(off)
  check(`offset ${off} shifts min`, Math.abs(band.min - (MODEL_H_RANGE_MM.min + off)) < 0.01)
  check(`offset ${off} shifts max`, Math.abs(band.max - (MODEL_H_RANGE_MM.max + off)) < 0.01)
  check(`offset ${off} span preserved`, Math.abs((band.max - band.min) - (MODEL_H_RANGE_MM.max - MODEL_H_RANGE_MM.min)) < 0.01)
}

const offEx = computeMechOffsetFromMeasurements({ measuredHomeMm: -2, measuredClosedMm: 65.6 })
check('example calibration -2 mm', Math.abs(offEx + 2) < 0.01, String(offEx))

const offZero = computeMechOffsetFromMeasurements({ measuredHomeMm: MODEL_H_RANGE_MM.min, measuredClosedMm: MODEL_H_RANGE_MM.max })
check('nominal measurements → 0 offset', Math.abs(offZero) < 0.05, String(offZero))

try {
  computeMechOffsetFromMeasurements({ measuredHomeMm: -2, measuredClosedMm: 60.0 })
  check('non-uniform measurements throw', false)
} catch {
  check('non-uniform measurements throw', true)
}

try {
  deriveMechOffsetFromHRange({ min: 0, max: 66.0 })
  check('non-uniform hRange throw', false)
} catch {
  check('non-uniform hRange throw', true)
}

const derived = deriveMechOffsetFromHRange({ min: -2, max: 65.6 })
check('derive from hRange -2', Math.abs(derived + 2) < 0.01)

const info = getCalibrationInfo(-2)
check('getCalibrationInfo effective min', Math.abs(info.effectiveHRangeMm.min + 2) < 0.1)
check('getCalibrationInfo effective max', Math.abs(info.effectiveHRangeMm.max - 65.6) < 0.1)

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
