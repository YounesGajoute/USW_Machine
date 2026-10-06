import { test } from 'node:test'
import assert from 'node:assert/strict'
import { H_PRODUCTION_PARK_MM } from '../centringMaster/centring_height_model.js'
import { validateCentringV2Recipe } from './recipeGate.mjs'

const CAL = Object.freeze({ calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })
const BOTH = Object.freeze({ l_eff_mm: 50, h_pre_mm: 3, h_post_mm: 22, centring_axis: 'both' })

test('typical both-axis recipe passes with and without saved calibration', () => {
  assert.deepEqual(validateCentringV2Recipe(BOTH, { slaveCal: CAL }), { ok: true, class: 'A', centringAxes: ['upper', 'lower'] })
  assert.equal(validateCentringV2Recipe({ ...BOTH, l_eff_mm: 66.5 }).class, 'B')
})

test('missing or non-finite h_pre_mm / h_post_mm is rejected', () => {
  assert.equal(validateCentringV2Recipe({ ...BOTH, h_pre_mm: undefined }).code, 'H_PRE_MISSING')
  assert.equal(validateCentringV2Recipe({ ...BOTH, h_pre_mm: null }).code, 'H_PRE_MISSING')
  assert.equal(validateCentringV2Recipe({ ...BOTH, h_post_mm: NaN }).code, 'H_POST_MISSING')
  assert.equal(validateCentringV2Recipe({ ...BOTH, h_post_mm: '' }).code, 'H_POST_MISSING')
})

test('L_eff outside 40–100 or missing rejects the recipe', () => {
  assert.equal(validateCentringV2Recipe({ ...BOTH, l_eff_mm: 39.9 }).code, 'LEFF_OUT_OF_RANGE')
  assert.equal(validateCentringV2Recipe({ ...BOTH, l_eff_mm: undefined }).code, 'LEFF_MISSING')
})

test('invalid centring_axis is rejected', () => {
  assert.equal(validateCentringV2Recipe({ ...BOTH, centring_axis: 'left' }).code, 'CENTRING_AXIS_INVALID')
})

test('h_pre and h_post too close for the tolerance are rejected (V2-REQ-015)', () => {
  const r = validateCentringV2Recipe({ ...BOTH, h_pre_mm: 22, h_post_mm: 22.1 }, { slaveCal: CAL })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'H_PRE_H_POST_TOO_CLOSE')
  assert.ok(r.details.some((d) => d.startsWith('upper angle')))
  assert.ok(r.details.some((d) => d.startsWith('lower pulse')))
})

test('the same separation passes with a tighter tolerance and fails with a wider one', () => {
  // 0.4 mm total ≈ 0.7° per side near 11 mm per side: > 2 × 0.1°, < 2 × 2.0°.
  const recipe = { ...BOTH, h_pre_mm: 22, h_post_mm: 22.4 }
  assert.equal(validateCentringV2Recipe(recipe, { slaveCal: CAL, toleranceDeg: 0.1 }).ok, true)
  assert.equal(validateCentringV2Recipe(recipe, { slaveCal: CAL, toleranceDeg: 2.0 }).code, 'H_PRE_H_POST_TOO_CLOSE')
})

test('tolerance outside 0.1–2.0 is rejected', () => {
  for (const toleranceDeg of [0.05, 2.01, -1, NaN]) {
    assert.equal(validateCentringV2Recipe(BOTH, { toleranceDeg }).code, 'TOLERANCE_OUT_OF_RANGE', `tol ${toleranceDeg}`)
  }
  assert.equal(validateCentringV2Recipe(BOTH, { toleranceDeg: 0.1 }).ok, true)
  assert.equal(validateCentringV2Recipe(BOTH, { toleranceDeg: 2.0 }).ok, true)
})

test('single-axis h_pre below the opening with the other axis at HOME is rejected (V2-REQ-043)', () => {
  const upper = { l_eff_mm: 60, h_pre_mm: 20, h_post_mm: 50, centring_axis: 'upper' }
  const r = validateCentringV2Recipe(upper)
  assert.equal(r.code, 'H_PRE_BELOW_SINGLE_AXIS_MIN')

  const atMin = { ...upper, h_pre_mm: H_PRODUCTION_PARK_MM + 0.5 }
  assert.equal(validateCentringV2Recipe(atMin, { slaveCal: CAL }).ok, true)

  // mechOff shifts the minimum: the same recipe fails with +1 mm offset.
  assert.equal(
    validateCentringV2Recipe(atMin, { slaveCal: CAL, mechOffsetMm: 1 }).code,
    'H_PRE_BELOW_SINGLE_AXIS_MIN',
  )
})

test('the single-axis minimum does not apply to both-axis recipes', () => {
  assert.equal(validateCentringV2Recipe({ ...BOTH, centring_axis: 'both', h_pre_mm: 3 }).ok, true)
  assert.equal(validateCentringV2Recipe({ ...BOTH, centring_axis: 'lower', h_pre_mm: 3 }).code, 'H_PRE_BELOW_SINGLE_AXIS_MIN')
})

test('a height outside the model band is rejected, not thrown', () => {
  assert.equal(validateCentringV2Recipe({ ...BOTH, h_post_mm: 80 }).code, 'HEIGHT_UNREACHABLE')
})
