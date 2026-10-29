import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requirePassingRealtimeInspection } from './productionSequence.mjs'

const feedback = outcome => ({
  runId: 'run-1', ledgerId: 'ledger-1',
  result: {
    outcome,
    capture_id: 'capture-1',
    welding_splice: { checks: [{ name: 'position', result: outcome === 'PASS' ? 'OK' : 'NG', reason: 'outside tolerance' }] },
    heat_shrink_tube: { checks: [] },
  },
})

test('camera FAIL records exact feedback and prevents the next mechanical step', async () => {
  const phases = []
  const state = {}
  let tailMoved = false
  const steps = [
    () => requirePassingRealtimeInspection(feedback('FAIL'), phases, state),
    () => { tailMoved = true },
  ]
  await assert.rejects(async () => {
    for (const step of steps) await step()
  }, /Real-time inspection FAIL: position: outside tolerance/)
  assert.equal(tailMoved, false)
  assert.equal(phases[0].result, 'FAIL')
  assert.equal(phases[0].inspection.runId, 'run-1')
  assert.equal(phases[0].inspection.result.capture_id, 'capture-1')
})

test('camera PASS allows the next mechanical step; unknown outcomes stop', async () => {
  const phases = []
  const state = {}
  let tailMoved = false
  for (const step of [
    () => requirePassingRealtimeInspection(feedback('PASS'), phases, state),
    () => { tailMoved = true },
  ]) await step()
  assert.equal(tailMoved, true)
  assert.equal(state.inspectionOutcome, 'PASS')
  assert.equal(phases[0].result, 'PASS')

  const unknown = { result: { outcome: 'UNKNOWN' } }
  assert.throws(() => requirePassingRealtimeInspection(unknown, phases, state), /Real-time inspection UNKNOWN/)
  assert.equal(phases.at(-1).result, 'UNKNOWN')
})
