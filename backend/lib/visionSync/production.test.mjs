import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixtures/helpers.mjs'
import { createVisionSyncService } from './service.mjs'

function rig(t, getPolicyIssues = () => []) {
  const f = fixture()
  t.after(() => f.db.close())
  let clock = 1_000
  let counter = 0
  let verified = true
  const service = createVisionSyncService({ store: f.store, getSelection: f.getSelection,
    deviceId: 'slave-example', bootId: 'production-master', production: true,
    getPolicyIssues,
    now: () => clock, uuid: () => `production-${++counter}`,
    verifySlaveBoot: async request => verified && request.slaveBootId === 'slave-boot-example' &&
      request.ledgerId === 'ledger-example' })
  const session = service.register(f.registration).response
  const state = () => service.state(f.stateRequest(session, `state-${++counter}`))
  let sequence = 0
  const report = (overrides = {}) => f.report(state(), {
    requestId: `report-${++sequence}`, reportSequence: String(sequence), ...overrides,
  })
  return { f, service, state, report, session,
    advance: ms => { clock += ms }, rejectProof: () => { verified = false } }
}

test('production grant requires current boot proof and installed acknowledgement', async t => {
  const r = rig(t)
  assert.deepEqual(r.service.capabilities().capabilities, ['sessions', 'state', 'ack', 'versioned-runs'])
  const noProof = r.service.ack(r.report())
  assert.equal(noProof.grant, null)
  assert.equal(r.service.executionTicket(), null)
  await r.service.verifyBoot(r.f.registration)
  const first = r.service.ack(r.report())
  assert.equal(first.grant.purpose, 'production')
  assert.equal(r.service.executionTicket(), null)
  const installed = r.service.ack(r.report({ installedGrantId: first.grant.grantId }))
  assert.equal(installed.installedGrantId, first.grant.grantId)
  assert.equal(r.service.executionTicket().grantId, first.grant.grantId)
  assert.equal(r.service.status().productionAuthorized, true)
  r.advance(10_000)
  assert.equal(r.service.executionTicket(), null)
  assert.equal(r.service.status().productionAuthorized, false)
})

test('changed selection, busy report and stale installation revoke production authority', async t => {
  const r = rig(t)
  await r.service.verifyBoot(r.f.registration)
  const first = r.service.ack(r.report())
  assert.throws(() => r.service.ack(r.report({ installedGrantId: 'invented' })), { code: 'STALE_GRANT' })
  r.service.ack(r.report({ installedGrantId: first.grant.grantId }))
  assert.ok(r.service.executionTicket())
  const busy = r.service.ack(r.report({ busy: true, installedGrantId: first.grant.grantId }))
  assert.equal(busy.grant, null)
  assert.equal(busy.installedGrantId, null)
  assert.equal(r.service.executionTicket(), null)
  r.f.select('reference-B')
  assert.equal(r.service.executionTicket(), null)
})

test('failed Slave boot proof cannot authorize a run', async t => {
  const r = rig(t)
  r.rejectProof()
  await assert.rejects(() => r.service.verifyBoot(r.f.registration), { code: 'BOOT_PROOF_FAILED' })
  assert.equal(r.service.ack(r.report()).grant, null)
})

test('a current Master policy issue holds the recipe and issues no grant', async t => {
  const r = rig(t, () => ['MAINTENANCE_POLICY_REQUIRED'])
  await r.service.verifyBoot(r.f.registration)
  const state = r.state()
  assert.equal(state.desiredMode, 'hold')
  assert.deepEqual(state.issues, ['MAINTENANCE_POLICY_REQUIRED'])
  assert.equal(r.service.executionTicket(), null)
})

test('grant rotation requires a new installation before the old lease expires', async t => {
  const r = rig(t)
  await r.service.verifyBoot(r.f.registration)
  const first = r.service.ack(r.report()).grant
  r.service.ack(r.report({ installedGrantId: first.grantId }))
  assert.ok(r.service.executionTicket())
  r.advance(8_000)
  const rotated = r.service.ack(r.report({ installedGrantId: first.grantId }))
  assert.notEqual(rotated.grant.grantId, first.grantId)
  assert.equal(r.service.executionTicket(), null)
  r.service.ack(r.report({ installedGrantId: rotated.grant.grantId }))
  assert.equal(r.service.executionTicket().grantId, rotated.grant.grantId)
})
