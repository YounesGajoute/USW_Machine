import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeMoveAxis,
  gapMmForCentringAxis,
  resolveGapMove,
} from './centring_reference.js'

test('normalizeMoveAxis accepts both/upper/lower', () => {
  assert.equal(normalizeMoveAxis('BOTH'), 'both')
  assert.equal(normalizeMoveAxis('upper'), 'upper')
  assert.throws(() => normalizeMoveAxis('mid'), /invalid axis/)
})

test('gapMmForCentringAxis keeps total H for single-axis MOVE*MM', () => {
  assert.equal(gapMmForCentringAxis(12, 'upper'), 12)
  assert.equal(gapMmForCentringAxis(12, 'lower'), 12)
  assert.equal(gapMmForCentringAxis(12, 'both'), 12)
})

test('resolveGapMove maps axis to MOVE*MM commands', () => {
  assert.deepEqual(resolveGapMove({ gapMm: 20, axis: 'both' }), {
    gapMm: 20,
    axis: 'both',
    moveCommand: 'MOVEBOTHMM',
  })
  assert.equal(resolveGapMove({ gapMm: 20, axis: 'upper' }).moveCommand, 'MOVE_UPPERMM')
  assert.equal(resolveGapMove({ gapMm: 20, axis: 'lower' }).moveCommand, 'MOVE_LOWERMM')
})
