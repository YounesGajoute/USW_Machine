import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import express from 'express'
import { fixture } from './fixtures/helpers.mjs'
import { createVisionSyncService } from './service.mjs'
import { createVisionSyncRouter } from './router.mjs'

test('authenticated HTTP registration proves Slave boot before a grant can be installed', async t => {
  const f = fixture()
  t.after(() => f.db.close())
  let ids = 0
  let proofs = 0
  const service = createVisionSyncService({ store: f.store, getSelection: f.getSelection,
    deviceId: 'slave-example', production: true, bootId: 'master-http-boot',
    uuid: () => `id-${++ids}`, verifySlaveBoot: async request => {
      proofs++
      return request.slaveBootId === f.registration.slaveBootId && request.ledgerId === f.registration.ledgerId
    } })
  const app = express()
  const token = 'private-production-token-at-least-32-characters'
  app.use('/api/vision-sync', createVisionSyncRouter({ service, production: true,
    getAuthMode: () => 'bearer',
    getTokenHash: () => createHash('sha256').update(token).digest('hex') }))
  const server = await new Promise(resolve => {
    const opened = app.listen(0, '127.0.0.1', () => resolve(opened))
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/api/vision-sync`
  const call = async (path, body, suppliedToken = token) => {
    const response = await fetch(base + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(suppliedToken ? { Authorization: `Bearer ${suppliedToken}` } : {}) },
      body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  assert.equal((await call('/sessions', f.registration, null)).status, 401)
  const registered = await call('/sessions', f.registration)
  assert.equal(registered.status, 201)
  assert.equal(proofs, 1)
  const state = service.state(f.stateRequest(registered.body))
  const ready = await call('/ack', f.report(state))
  assert.equal(ready.status, 200)
  assert.equal(ready.body.grant.purpose, 'production')
  assert.equal(service.executionTicket(), null)
  const installed = await call('/ack', f.report(state, { requestId: 'installed-report', reportSequence: '2',
    installedGrantId: ready.body.grant.grantId }))
  assert.equal(installed.status, 200)
  assert.equal(installed.body.installedGrantId, ready.body.grant.grantId)
  assert.equal(service.executionTicket().grantId, ready.body.grant.grantId)
})

test('production HTTP refuses address-only authentication', async t => {
  const f = fixture()
  t.after(() => f.db.close())
  const service = createVisionSyncService({ store: f.store, getSelection: f.getSelection,
    deviceId: 'slave-example', production: true })
  const app = express()
  app.use('/api/vision-sync', createVisionSyncRouter({ service, production: true,
    getAuthMode: () => 'none', getAllowedRemoteAddresses: () => '127.0.0.1' }))
  const server = await new Promise(resolve => {
    const opened = app.listen(0, '127.0.0.1', () => resolve(opened))
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/vision-sync/capabilities`, {
    headers: { 'X-Vision-Device-Id': 'slave-example', 'X-Vision-Slave-Boot-Id': 'boot-1' },
  })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'AUTH_NOT_CONFIGURED')
})

test('production HTTP refuses a weak configured bearer credential', async t => {
  const f = fixture()
  t.after(() => f.db.close())
  const service = createVisionSyncService({ store: f.store, getSelection: f.getSelection,
    deviceId: 'slave-example', production: true })
  const app = express()
  app.use('/api/vision-sync', createVisionSyncRouter({ service, production: true,
    getAuthMode: () => 'bearer', getToken: () => 'short' }))
  const server = await new Promise(resolve => {
    const opened = app.listen(0, '127.0.0.1', () => resolve(opened))
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/vision-sync/capabilities`, {
    headers: { Authorization: 'Bearer short', 'X-Vision-Device-Id': 'slave-example',
      'X-Vision-Slave-Boot-Id': 'boot-1' },
  })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'AUTH_NOT_CONFIGURED')
})
