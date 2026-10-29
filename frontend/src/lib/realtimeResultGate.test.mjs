import test from 'node:test'
import assert from 'node:assert/strict'
import { isNewProductionInspection } from './realtimeResultGate.mjs'

test('loading a reference never displays the prior inspection capture', () => {
  assert.equal(isNewProductionInspection({ captureId: 'old', baselineKnown: true, baselineCaptureId: 'old', runStartedAtMs: 1_000 }), false)
  assert.equal(isNewProductionInspection({ captureId: 'new', baselineKnown: true, baselineCaptureId: 'old', runStartedAtMs: 1_000 }), true)
  assert.equal(isNewProductionInspection({ captureId: null, baselineKnown: true, baselineCaptureId: null, runStartedAtMs: 1_000 }), false)
})

test('a late baseline response cannot promote a stale capture after Start', () => {
  const runStartedAtMs = Date.parse('2026-10-27T13:20:00Z')
  assert.equal(isNewProductionInspection({ captureId: 'old', baselineKnown: false, lastResultUtc: '2026-10-27T13:10:00Z', runStartedAtMs }), false)
  assert.equal(isNewProductionInspection({ captureId: 'new', baselineKnown: false, lastResultUtc: '2026-10-27T13:20:03Z', runStartedAtMs }), true)
  assert.equal(isNewProductionInspection({ captureId: 'unknown', baselineKnown: false, runStartedAtMs }), false)
})
