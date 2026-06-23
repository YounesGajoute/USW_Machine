import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_VISION_CHECKS_CONFIG,
  normalizeVisionChecksConfig,
  mergeVisionChecksConfigPatch,
  withWeldingSpliceParentEnabled,
  withHeatShrinkTubeParentEnabled,
  getEnabledWeldingSpliceToolNames,
  getEnabledHeatShrinkToolNames,
  isAnyVisionCheckEnabled,
  parseVisionChecksJson,
} from './visionChecksConfigStore.mjs'
import { evaluateVisionToolResults } from './productionVisionInspection.mjs'

test('normalizeVisionChecksConfig fills defaults', () => {
  const cfg = normalizeVisionChecksConfig(null)
  assert.deepEqual(cfg, DEFAULT_VISION_CHECKS_CONFIG)
})

test('withWeldingSpliceParentEnabled turns on length_check by default', () => {
  const cfg = withWeldingSpliceParentEnabled(DEFAULT_VISION_CHECKS_CONFIG, true)
  assert.equal(cfg.welding_splice.enabled, true)
  assert.equal(cfg.welding_splice.length_check, true)
  assert.equal(cfg.welding_splice.diameter_check, false)
})

test('withHeatShrinkTubeParentEnabled turns on position_check by default', () => {
  const cfg = withHeatShrinkTubeParentEnabled(DEFAULT_VISION_CHECKS_CONFIG, true)
  assert.equal(cfg.heat_shrink_tube.enabled, true)
  assert.equal(cfg.heat_shrink_tube.position_check, true)
})

test('mergeVisionChecksConfigPatch deep-merges groups', () => {
  const merged = mergeVisionChecksConfigPatch(DEFAULT_VISION_CHECKS_CONFIG, {
    welding_splice: { enabled: true, diameter_check: true },
  })
  assert.equal(merged.welding_splice.enabled, true)
  assert.equal(merged.welding_splice.diameter_check, true)
  assert.equal(merged.heat_shrink_tube.enabled, false)
})

test('getEnabledWeldingSpliceToolNames respects toggles', () => {
  const cfg = normalizeVisionChecksConfig({
    welding_splice: {
      enabled: true,
      length_check: true,
      diameter_check: false,
      position_check: true,
    },
  })
  const names = getEnabledWeldingSpliceToolNames(cfg)
  assert.deepEqual(names, [
    'Welding Splice Length Check',
    'Welding Splice Position Check',
  ])
})

test('getEnabledHeatShrinkToolNames respects toggles', () => {
  const cfg = normalizeVisionChecksConfig({
    heat_shrink_tube: {
      enabled: true,
      length_check: true,
      diameter_check: true,
      position_check: false,
    },
  })
  const names = getEnabledHeatShrinkToolNames(cfg)
  assert.deepEqual(names, [
    'Heat-Shrink Tube Length Check',
    'Heat-Shrink Tube Diameter Check',
  ])
})

test('isAnyVisionCheckEnabled', () => {
  assert.equal(isAnyVisionCheckEnabled(DEFAULT_VISION_CHECKS_CONFIG), false)
  assert.equal(
    isAnyVisionCheckEnabled(
      mergeVisionChecksConfigPatch(DEFAULT_VISION_CHECKS_CONFIG, {
        heat_shrink_tube: { enabled: true },
      }),
    ),
    true,
  )
})

test('evaluateVisionToolResults passes when all enabled tools are OK', () => {
  const out = evaluateVisionToolResults(
    ['Welding Splice Length Check'],
    [{ name: 'Welding Splice Length Check', status: 'OK' }],
  )
  assert.equal(out.pass, true)
  assert.equal(out.result, 'PASS')
})

test('evaluateVisionToolResults fails on missing tool', () => {
  const out = evaluateVisionToolResults(['Welding Splice Length Check'], [])
  assert.equal(out.pass, false)
  assert.match(out.reason, /Missing tool results/)
})

test('parseVisionChecksJson returns normalized config', () => {
  const cfg = parseVisionChecksJson(
    JSON.stringify({
      welding_splice: { enabled: true, length_check: true, diameter_check: false, position_check: false },
      heat_shrink_tube: { enabled: false, length_check: false, diameter_check: false, position_check: false },
    }),
  )
  assert.equal(cfg?.welding_splice.enabled, true)
  assert.equal(cfg?.welding_splice.length_check, true)
})

test('evaluateVisionToolResults fails on NG tool', () => {
  const out = evaluateVisionToolResults(
    ['Welding Splice Length Check'],
    [{ name: 'Welding Splice Length Check', status: 'NG' }],
  )
  assert.equal(out.pass, false)
  assert.match(out.reason, /Failed checks/)
})
