import test from 'node:test'
import assert from 'node:assert/strict'
import { getCommandGapRangeMm, validateCommandGapMm } from './centring_command_limits.js'
import { getCalibrationInfo } from './centring_calibration.js'
import { resolveGapMove } from './centring_reference.js'
import { getEffectiveHRangeMm, mapFirmwareStatus } from './centring_master.js'
import { normalizeCentringConfig, mergeCentringConfigPatch } from '../centringConfigStore.mjs'

test('fixed command range is independent of offset and legacy saved limits', () => {
  for (const offset of [-1.8, 0, 2, -50, 50]) {
    const cfg = normalizeCentringConfig({ mechOffsetMm: offset, hRangeMm: { min: -99, max: 999 } })
    assert.deepEqual(cfg.hRangeMm, { min: 0, max: 60 })
    assert.equal(cfg.mechOffsetMm, offset)
    assert.deepEqual(getEffectiveHRangeMm(cfg), { min: 0, max: 60 })
    const info = getCalibrationInfo(offset)
    assert.deepEqual(info.commandRangeMm, { min: 0, max: 60 })
    assert.deepEqual(info.effectiveHRangeMm, { min: 0, max: 60 })
    assert.ok(Math.abs(info.modelHRangeWithOffsetMm.min - (0.4 + offset)) < 1e-6)
  }
  const range = getCommandGapRangeMm()
  range.min = 9
  assert.equal(getCommandGapRangeMm().min, 0)
})

test('settings patches cannot shift the fixed band or discard offset/calibration', () => {
  const slaveCal = { calId: 'meas-v1', hu: 2102, tu: 1266, hl: 1538, tl: 742 }
  const cfg = mergeCentringConfigPatch({ mechOffsetMm: 2, slaveCal }, { hRangeMm: { min: 4, max: 90 } })
  assert.deepEqual(cfg.hRangeMm, { min: 0, max: 60 })
  assert.equal(cfg.mechOffsetMm, 2)
  assert.deepEqual(cfg.slaveCal, slaveCal)
})

test('inclusive command boundaries, no clamping or coercion of missing values', () => {
  for (const h of [0, 0.001, 2, 59.999, 60, '0.000', '60.000']) {
    assert.equal(validateCommandGapMm(h), Number(h))
    for (const axis of ['both', 'upper', 'lower']) {
      assert.equal(resolveGapMove({ gapMm: h, axis }).gapMm, Number(h))
    }
  }
  for (const h of [-0.001, 60.001, NaN, Infinity, -Infinity, null, undefined, '', ' ', true, []]) {
    assert.throws(() => validateCommandGapMm(h), /fixed command limits/)
    assert.throws(() => resolveGapMove({ gapMm: h }), /fixed command limits/)
  }
})

test('status separates fixed policy from Nano reach; old firmware is not misrepresented', () => {
  const base = 'cal=1 h=5.8 hmin=3.8 hmax=64.87 mechOff=2'
  const legacy = mapFirmwareStatus(base)
  assert.deepEqual(legacy.commandRangeMm, { min: 0, max: 60 })
  assert.deepEqual(legacy.reachableRangeMm, { min: 3.8, max: 64.87 })
  assert.equal(legacy.firmwareCommandRangeMm, null)
  assert.equal(legacy.hMin, 3.8)
  assert.equal(legacy.hMax, 64.87)
  const current = mapFirmwareStatus(base + ' cmdMin=0 cmdMax=60')
  assert.deepEqual(current.firmwareCommandRangeMm, { min: 0, max: 60 })
  assert.equal(mapFirmwareStatus('cal=0 hmin=1 hmax=2').reachableRangeMm, null)
})
