import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixtures/helpers.mjs'
import { isVisionSyncCommissioning } from '../visionSyncMode.mjs'
import { initRealtimeInspectionClient, enableRealtimeInspection, disableRealtimeInspection,
  putRealtimeConfig, runRealtimeInspection, runRealtimeInspectionWithLighting } from '../realtimeInspectionClient.mjs'
import { syncRealtimeInspectionForReference, disableRealtimeInspectionForClearedReference,
  saveRealtimeInspectionForReference } from '../realtimeInspectionReference.mjs'

function commissioning(t) {
  const before = process.env.VISION_SYNC_MODE
  const fetch = globalThis.fetch
  process.env.VISION_SYNC_MODE = 'commissioning'
  const calls = []
  globalThis.fetch = async () => { calls.push('network'); throw new Error('No network is permitted in commissioning tests') }
  initRealtimeInspectionClient({ setLighting: async () => { calls.push('lighting') } })
  t.after(() => {
    if (before === undefined) delete process.env.VISION_SYNC_MODE
    else process.env.VISION_SYNC_MODE = before
    globalThis.fetch = fetch
  })
  return calls
}
test('commissioning blocks direct controls before network and lighting', async t => {
  const calls = commissioning(t)
  for (const control of [enableRealtimeInspection, disableRealtimeInspection, () => putRealtimeConfig({}), runRealtimeInspection, runRealtimeInspectionWithLighting]) {
    await assert.rejects(control, { code: 'SYNCHRONIZATION_REQUIRED', status: 428 })
  }
  assert.deepEqual(calls, [])
})
test('reference load and clear publish pull intent without pushing to Slave', async t => {
  const calls = commissioning(t)
  const f = fixture(); t.after(() => f.db.close())
  const result = await syncRealtimeInspectionForReference({ db: f.db, referenceId: 'reference-A', getLoadedReferenceId: () => 'reference-A' })
  assert.equal(result.state, 'awaiting_slave')
  assert.equal((await disableRealtimeInspectionForClearedReference()).state, 'disabled_requested')
  assert.deepEqual(calls, [])
})
test('Settings save persists Master recipe and reports saved-but-not-synchronized without Slave writes', async t => {
  const calls = commissioning(t)
  const f = fixture(); t.after(() => f.db.close())
  await assert.rejects(() => saveRealtimeInspectionForReference({ db: f.db, referenceId: 'reference-A',
    getLoadedReferenceId: () => 'reference-A', draft: { welding_splice: { expected_length_mm: 12, length_tolerance_mm: 0 } } }),
  { saved: true, code: 'PRODUCTION_INHIBITED' })
  const published = f.store.readDesired('reference-A')
  assert.equal(published.recipe.welding_splice.expected_length_mm, 12)
  assert.equal(published.recipe.welding_splice.length_tolerance_mm, 0)
  assert.equal(published.recipeRevision, '2')
  assert.deepEqual(calls, [])
})
test('production mode keeps unversioned inspection controls inhibited', async t => {
  const calls = commissioning(t)
  process.env.VISION_SYNC_MODE = 'production'
  assert.equal(isVisionSyncCommissioning(), false)
  await assert.rejects(runRealtimeInspection, { code: 'SYNCHRONIZATION_REQUIRED' })
  assert.deepEqual(calls, [])
})
