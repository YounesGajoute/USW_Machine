import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { fixture } from './fixtures/helpers.mjs'
import { createVisionSyncRouter } from './router.mjs'

async function server(t) {
  const f = fixture()
  let token = 'fixture-only-secret'
  let tokenHash
  let authMode = 'bearer'
  let allowedRemoteAddresses
  let configured = true
  const app = express()
  app.use('/api/vision-sync', createVisionSyncRouter({ service: f.service,
    getToken: () => token,
    getTokenHash: () => tokenHash,
    getAuthMode: () => authMode,
    getAllowedRemoteAddresses: () => allowedRemoteAddresses,
    isConfigured: () => configured,
  }))
  const http = createServer(app)
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  t.after(async () => {
    http.closeAllConnections()
    await new Promise(resolve => http.close(resolve))
    f.db.close()
  })
  const base = `http://127.0.0.1:${http.address().port}/api/vision-sync`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  async function request(path, { body, raw, ...options } = {}) {
    const response = await fetch(base + path, { headers, ...options,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
    return { status: response.status, data: await response.json(), headers: response.headers }
  }
  return { ...f, request, headers,
    setToken: value => { token = value },
    setTokenHash: value => { tokenHash = value },
    setAuthMode: value => { authMode = value },
    setAllowedRemoteAddresses: value => { allowedRemoteAddresses = value },
    setConfigured: value => { configured = value },
  }
}

test('HTTP exact fixture sequence: auth, registration, query state and nongrant acknowledgement', async t => {
  const f = await server(t)
  const capability = await f.request('/capabilities', { headers: { ...f.headers,
    'X-Vision-Device-Id': 'slave-example', 'X-Vision-Slave-Boot-Id': 'slave-boot-example' } })
  assert.equal(capability.status, 200)
  assert.equal(capability.headers.get('cache-control'), 'no-store')
  assert.deepEqual(capability.data.capabilities, ['sessions', 'state', 'ack'])
  const registered = await f.request('/sessions', { method: 'POST', body: f.registration })
  assert.equal(registered.status, 201)
  const duplicate = await f.request('/sessions', { method: 'POST', body: f.registration })
  assert.equal(duplicate.status, 200)
  assert.deepEqual(duplicate.data, registered.data)
  const query = new URLSearchParams(f.stateRequest(registered.data)).toString()
  const state = await f.request(`/state?${query}`)
  assert.equal(state.status, 200)
  assert.equal(state.data.desiredMode, 'enabled')
  const ack = await f.request('/ack', { method: 'POST', body: f.report(state.data) })
  assert.equal(ack.status, 200)
  assert.equal(ack.data.accepted, true)
  assert.equal(ack.data.grant, null)
  assert.equal(ack.data.installedGrantId, null)
})
test('HTTP auth fails closed and does not reflect credentials', async t => {
  const f = await server(t)
  const denied = await f.request('/sessions', { method: 'POST', headers: {}, body: f.registration })
  assert.equal(denied.status, 401)
  const wrong = await f.request('/sessions', { method: 'POST', headers: { ...f.headers, Authorization: 'Bearer do-not-echo' }, body: f.registration })
  assert.equal(wrong.status, 401)
  assert.equal(JSON.stringify(wrong.data).includes('do-not-echo'), false)
  f.setToken(undefined)
  assert.equal((await f.request('/capabilities')).status, 503)
  f.setToken('fixture-only-secret'); f.setConfigured(false)
  assert.equal((await f.request('/capabilities')).data.error.code, 'SYNC_NOT_CONFIGURED')
})
test('HTTP auth accepts a Slave-held token by configured SHA-256 fingerprint', async t => {
  const f = await server(t)
  f.setToken(undefined)
  f.setTokenHash(createHash('sha256').update('fixture-only-secret').digest('hex'))
  const response = await f.request('/capabilities', { headers: { ...f.headers,
    'X-Vision-Device-Id': 'slave-example', 'X-Vision-Slave-Boot-Id': 'slave-boot-example' } })
  assert.equal(response.status, 200)
  f.setTokenHash('not-a-sha256-fingerprint')
  assert.equal((await f.request('/capabilities')).data.error.code, 'AUTH_NOT_CONFIGURED')
})
test('HTTP auth rejects inconsistent raw token and fingerprint configuration', async t => {
  const f = await server(t)
  f.setTokenHash(createHash('sha256').update('different-secret').digest('hex'))
  assert.equal((await f.request('/capabilities')).data.error.code, 'AUTH_NOT_CONFIGURED')
})
test('HTTP tokenless mode accepts only configured device network addresses', async t => {
  const f = await server(t)
  f.setAuthMode('none')
  f.setAllowedRemoteAddresses('127.0.0.1')
  const response = await f.request('/capabilities', { headers: {
    'X-Vision-Device-Id': 'slave-example', 'X-Vision-Slave-Boot-Id': 'slave-boot-example',
  } })
  assert.equal(response.status, 200)
  f.setAllowedRemoteAddresses('192.168.10.2')
  assert.equal((await f.request('/capabilities', { headers: {} })).status, 401)
  f.setAllowedRemoteAddresses('')
  assert.equal((await f.request('/capabilities')).data.error.code, 'AUTH_NOT_CONFIGURED')
  f.setAuthMode('unsupported')
  assert.equal((await f.request('/capabilities')).data.error.code, 'AUTH_NOT_CONFIGURED')
})
test('HTTP wrong device, conflicting headers, unknown fields and version mismatch', async t => {
  const f = await server(t)
  assert.equal((await f.request('/sessions', { method: 'POST', body: { ...f.registration, deviceId: 'wrong' } })).status, 403)
  assert.equal((await f.request('/sessions', { method: 'POST', headers: { ...f.headers, 'X-Vision-Slave-Boot-Id': 'wrong' }, body: f.registration })).status, 403)
  assert.equal((await f.request('/sessions', { method: 'POST', body: { ...f.registration, surprise: true } })).status, 422)
  assert.equal((await f.request('/sessions', { method: 'POST', body: { ...f.registration, protocolVersion: 2 } })).status, 426)
})
test('HTTP duplicate keys, malformed JSON, oversized bodies and unknown routes', async t => {
  const f = await server(t)
  assert.equal((await f.request('/sessions', { method: 'POST', raw: '{' })).status, 422)
  assert.equal((await f.request('/sessions', { method: 'POST', raw: 'null' })).status, 422)
  const raw = JSON.stringify(f.registration).replace('"protocolVersion":1', '"protocolVersion":1,"protocolVersion":1')
  assert.equal((await f.request('/sessions', { method: 'POST', raw })).status, 422)
  assert.equal((await f.request('/sessions', { method: 'POST', raw: JSON.stringify({ padding: 'x'.repeat(70_000) }) })).status, 413)
  assert.equal((await f.request('/runs')).status, 404)
})
test('HTTP stale session, stale binding and installed fixture grant are rejected', async t => {
  const f = await server(t)
  const registration = (await f.request('/sessions', { method: 'POST', body: f.registration })).data
  const query = new URLSearchParams(f.stateRequest(registration)).toString()
  const state = (await f.request(`/state?${query}`)).data
  const installed = await f.request('/ack', { method: 'POST', body: f.report(state, { installedGrantId: 'fixture-grant' }) })
  assert.equal(installed.data.error.code, 'PRODUCTION_INHIBITED')
  f.select('reference-B')
  const stale = await f.request('/ack', { method: 'POST', body: f.report(state) })
  assert.equal(stale.data.error.code, 'STALE_BINDING')
  await f.request('/sessions', { method: 'POST', body: { ...f.registration, requestId: 'new-boot', slaveBootId: 'boot-2' } })
  assert.equal((await f.request(`/state?${query}`)).data.error.code, 'SESSION_REPLACED')
})

test('HTTP diagnostic budget rejects oversize issues without consuming the report sequence', async t => {
  const f = await server(t)
  const registration = (await f.request('/sessions', { method: 'POST', body: f.registration })).data
  const query = new URLSearchParams(f.stateRequest(registration)).toString()
  const state = (await f.request(`/state?${query}`)).data
  const issues = [...Array(15).fill('a'.repeat(1024)), 'a'.repeat(975)]
  const report = f.report(state, { issues })
  const oversized = { ...report, issues: [...issues.slice(0, -1), issues.at(-1) + 'a'] }
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) < 64 * 1024)
  const rejected = await f.request('/ack', { method: 'POST', body: oversized })
  assert.equal(rejected.status, 422)
  assert.equal(rejected.data.error.code, 'VALIDATION_ERROR')
  const accepted = await f.request('/ack', { method: 'POST', body: report })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.data.grant, null)
  assert.deepEqual((await f.request('/ack', { method: 'POST', body: report })).data, accepted.data)
})
