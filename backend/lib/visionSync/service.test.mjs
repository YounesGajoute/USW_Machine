import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fixture } from './fixtures/helpers.mjs'
import { createVisionSyncService } from './service.mjs'
import { createVisionSyncStore } from './store.mjs'

const proposal = JSON.parse(readFileSync(new URL('./fixtures/slave-proposal.json', import.meta.url), 'utf8'))
function setup(t, options) {
  const f = fixture(options)
  t.after(() => f.db.close())
  f.registrationResponse = f.service.register(f.registration).response
  f.poll = requestId => f.service.state(f.stateRequest(f.registrationResponse, requestId))
  return f
}

test('matches supplied registration/state/ready shape, but never issues a grant', t => {
  const f = setup(t)
  assert.deepEqual(f.registrationResponse, proposal.registrationResponse)
  assert.deepEqual(f.poll(), proposal.stateResponse)
  assert.equal(f.service.status().state, 'pending')
  assert.equal(f.service.status().synchronized, false)
  assert.deepEqual(f.service.ack(proposal.readyReport), { ...proposal.grantResponse, grant: null })
  assert.equal(f.service.status().state, 'synchronized')
  assert.equal(f.service.status().phase, 'ready')
  assert.equal(f.service.status().productionAuthorized, false)
  assert.throws(() => f.service.ack(proposal.installedReport), { code: 'PRODUCTION_INHIBITED' })
  assert.deepEqual(f.service.capabilities().capabilities, ['sessions', 'state', 'ack'])
})
test('status is disconnected until the Slave registers', t => {
  const f = fixture()
  t.after(() => f.db.close())
  assert.deepEqual(f.service.status(), {
    state: 'disconnected', connected: false, synchronized: false,
    desiredMode: null, referenceId: null, recipeRevision: null,
    phase: null, productionAuthorized: false, issues: [],
  })
})
test('registration exact retries are idempotent; conflicting request IDs are rejected', t => {
  const f = setup(t)
  const again = f.service.register(f.registration)
  assert.equal(again.created, false)
  assert.deepEqual(again.response, f.registrationResponse)
  assert.throws(() => f.service.register({ ...f.registration, ledgerId: 'different' }), { code: 'REQUEST_CONFLICT' })
})
test('Slave restart retires sessions and old registration retries cannot restore them', t => {
  const f = setup(t)
  const next = f.service.register({ ...f.registration, requestId: 'restart', slaveBootId: 'boot-2' })
  assert.equal(next.response.sessionGeneration, '2')
  assert.throws(() => f.poll(), { code: 'SESSION_REPLACED' })
  assert.throws(() => f.service.register(f.registration), { code: 'SESSION_REPLACED' })
  assert.throws(() => f.service.register({ ...f.registration, requestId: 'old-new-id' }), { code: 'STALE_SLAVE_BOOT' })
})
test('no active reference after Master restart; persisted recipes are not selection authority', t => {
  const f = setup(t)
  const restarted = createVisionSyncService({ store: f.store, deviceId: 'slave-example', bootId: 'new-master',
    getSelection: () => ({ referenceId: null, selectionRevision: '0' }) })
  const registration = restarted.register(f.registration).response
  const state = restarted.state(f.stateRequest(registration))
  assert.equal(state.requiredByReference, false)
  assert.equal(state.desiredMode, 'disabled')
  assert.equal(state.binding.referenceId, null)
  assert.throws(() => restarted.state(f.stateRequest(f.registrationResponse)), { code: 'SESSION_REPLACED' })
})
test('snapshot stability, metadata update and A-B-A between polls', t => {
  const f = setup(t)
  const before = f.poll('poll1')
  assert.equal(f.poll('poll2').snapshotSequence, before.snapshotSequence)
  f.db.prepare('UPDATE product_references SET name = ? WHERE id = ?').run('Renamed', 'reference-A')
  const renamed = f.poll('poll3')
  assert.equal(renamed.binding.desiredRevision, before.binding.desiredRevision)
  assert.notEqual(renamed.snapshotSequence, before.snapshotSequence)
  f.select('reference-B'); f.select('reference-A')
  const after = f.poll('poll4')
  assert.notEqual(after.binding.selectionRevision, before.binding.selectionRevision)
  assert.notEqual(after.binding.desiredRevision, before.binding.desiredRevision)
  assert.throws(() => f.service.ack(f.report(before)), { code: 'STALE_BINDING' })
})
test('same-reference measurements revise persisted state; no-op updates do not', t => {
  const f = setup(t)
  const before = f.poll()
  const row = f.db.prepare('SELECT realtime_v2_config_json AS json FROM product_references WHERE id = ?').get('reference-A')
  f.db.prepare('UPDATE product_references SET realtime_v2_config_json = ? WHERE id = ?').run(row.json, 'reference-A')
  assert.equal(f.poll().binding.recipeRevision, before.binding.recipeRevision)
  const saved = JSON.parse(row.json)
  saved.config.welding_splice.length_tolerance_mm = 2
  f.db.prepare('UPDATE product_references SET realtime_v2_config_json = ? WHERE id = ?').run(JSON.stringify(saved), 'reference-A')
  const after = f.poll()
  assert.equal(after.binding.recipeRevision, '2')
  assert.notEqual(after.binding.recipeDigest, before.binding.recipeDigest)
  assert.throws(() => f.service.ack(f.report(before)), { code: 'STALE_BINDING' })
  createVisionSyncStore(f.db) // idempotent installation preserves revisions
  assert.equal(f.poll().binding.recipeRevision, '2')
})
test('linked tube edits invalidate saved recipe without inventing new defaults', t => {
  const f = setup(t)
  f.db.exec('UPDATE shrink_tubes SET length_mm = 60')
  const state = f.poll()
  assert.equal(state.desiredMode, 'hold')
  assert.equal(state.requiredByReference, true)
  assert.equal(state.binding, null)
  assert.deepEqual(state.issues, ['RECIPE_REVALIDATION_REQUIRED'])
})
test('deleted and deactivated selections hold until authoritative selection is cleared', t => {
  const f = setup(t)
  f.db.exec("UPDATE product_references SET is_active = 0 WHERE id = 'reference-A'")
  assert.deepEqual(f.poll().issues, ['LOADED_REFERENCE_INACTIVE'])
  f.db.exec("DELETE FROM product_references WHERE id = 'reference-A'")
  assert.deepEqual(f.poll().issues, ['LOADED_REFERENCE_NOT_FOUND'])
  assert.ok(f.db.prepare('SELECT * FROM vision_sync_reference_revisions WHERE reference_id = ?').get('reference-A'))
  f.select(null)
  const state = f.poll()
  assert.equal(state.desiredMode, 'disabled')
  const ack = f.report(state, { phase: 'disabled', enabled: false, locallyReady: false })
  assert.equal(f.service.ack(ack).grant, null)
})
test('initialization and policy holds remain unknown/non-executable, not not-required', t => {
  let stage = 'initializing'
  let policy = []
  const f = setup(t, { getServiceState: () => stage, getPolicyIssues: () => policy })
  assert.equal(f.poll().requiredByReference, null)
  assert.equal(f.poll().binding, null)
  stage = 'ready'
  assert.equal(f.poll().desiredMode, 'enabled')
  policy = ['MAINTENANCE_POLICY_REQUIRED']
  assert.equal(f.poll().desiredMode, 'hold')
  assert.equal(f.poll().requiredByReference, true)
})
test('reports are idempotent, ordered, and locally revisioned without authorization', t => {
  const f = setup(t)
  const report = f.report(f.poll())
  const first = f.service.ack(report)
  assert.deepEqual(f.service.ack(report), first)
  assert.throws(() => f.service.ack({ ...report, busy: true }), { code: 'REPORT_CONFLICT' })
  const busy = { ...report, requestId: 'busy', reportSequence: '2', active: true, busy: true }
  assert.equal(f.service.ack(busy).grant, null)
  assert.throws(() => f.service.ack(report), { code: 'REPORT_OUT_OF_ORDER' })
  assert.throws(() => f.service.ack({ ...busy, requestId: 'lower-local', reportSequence: '3', binding: { ...report.binding, localRevision: '0' } }), { code: 'STALE_LOCAL_REVISION' })
})
test('device and ledger mismatches reject; ledger discontinuity is sticky in database', t => {
  const f = setup(t)
  assert.throws(() => f.service.register({ ...f.registration, deviceId: 'other' }), { code: 'DEVICE_MISMATCH' })
  const report = f.report(f.poll(), { ledgerDiscontinuity: true })
  f.service.ack(report)
  assert.equal(f.store.observeLedger('slave-example', 'ledger-example', false), true)
  assert.equal(f.poll().desiredMode, 'hold')
  assert.deepEqual(f.poll().issues, ['LEDGER_DISCONTINUITY_REVIEW_REQUIRED'])
  assert.throws(() => f.service.ack({ ...report, ledgerId: 'unknown' }), { code: 'LEDGER_CHANGED' })
})
test('revision triggers roll back with a failed product transaction', t => {
  const f = setup(t)
  const before = f.poll()
  assert.throws(() => f.db.transaction(() => {
    f.db.exec("UPDATE product_references SET vision_inspection_enabled = 0 WHERE id = 'reference-A'")
    throw new Error('abort')
  })())
  assert.deepEqual(f.poll(), before)
})

test('reference names are bounded even on hold; invalid metadata never reaches the wire', t => {
  const f = setup(t)
  const before = f.poll()
  const update = f.db.prepare('UPDATE product_references SET name = ? WHERE id = ?')
  for (const name of ['a'.repeat(300), '😀'.repeat(150)]) {
    update.run(name, 'reference-A')
    const state = f.poll()
    assert.equal(state.referenceName, name)
    assert.equal(state.desiredMode, 'enabled')
    assert.equal(state.binding.desiredRevision, before.binding.desiredRevision)
  }
  for (const name of ['a'.repeat(301), '😀'.repeat(151), null]) {
    update.run(name, 'reference-A')
    const state = f.poll()
    assert.equal(state.referenceName, null)
    assert.equal(state.binding, null)
    assert.equal(state.desiredMode, 'hold')
    assert.deepEqual(state.issues, ['INVALID_REFERENCE_NAME'])
  }
  update.run('Repaired', 'reference-A')
  assert.equal(f.poll().desiredMode, 'enabled')
  assert.notEqual(f.poll().binding.desiredRevision, before.binding.desiredRevision)
})

test('required references with no effective checks hold; explicit nonvision still disables', t => {
  const f = setup(t)
  const row = f.db.prepare('SELECT vision_checks_json FROM product_references WHERE id = ?').get('reference-A')
  const original = JSON.parse(row.vision_checks_json)
  for (const checks of [
    { ...original, welding_splice: { ...original.welding_splice, enabled: false } },
    { ...original, welding_splice: { ...original.welding_splice, length_check: false } },
    {},
  ]) {
    f.db.prepare('UPDATE product_references SET vision_checks_json = ? WHERE id = ?').run(JSON.stringify(checks), 'reference-A')
    const state = f.poll()
    assert.equal(state.desiredMode, 'hold')
    assert.equal(state.requiredByReference, true)
    assert.equal(state.binding, null)
    assert.equal(state.recipe, null)
    assert.deepEqual(state.issues, ['NO_ENABLED_VISION_CHECKS'])
  }
  f.db.exec("UPDATE product_references SET vision_inspection_enabled = 0 WHERE id = 'reference-A'")
  const disabled = f.poll()
  assert.equal(disabled.desiredMode, 'disabled')
  assert.equal(disabled.requiredByReference, false)
  assert.equal(disabled.binding.referenceId, 'reference-A')
  assert.notEqual(disabled.binding.recipeRevision, null)
})
