import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { initMachineOperationAccess } from './machineOperationAccess.mjs'
import { createRealtimeInspectionRouter } from './realtimeInspectionRoutes.mjs'

async function fixture({ requireLogin = false } = {}) {
  const calls = []
  initMachineOperationAccess({ readSystemSettings: () => ({ require_login: requireLogin }), getUserById: id => id === 'operator' ? { is_active: 1 } : null })
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { if (req.headers['x-test-user']) req.session = { userId: req.headers['x-test-user'] }; next() })
  app.use('/api/realtime-v2', createRealtimeInspectionRouter({
    requireAuth: (_req, _res, next) => next(),
    getLoadedReferenceId: () => 'REF',
    captureZone: async context => { calls.push(context); return { capture_id: 'NEW', image_url: '/api/captures/NEW/image', archive_status: 'COMPLETE' } },
  }))
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)) })
  return { base: `http://127.0.0.1:${server.address().port}/api/realtime-v2`, calls, close: () => new Promise(resolve => server.close(resolve)) }
}

test('Config Area capture requires machine-operation login before any motion', async () => {
  const f = await fixture({ requireLogin: true })
  try {
    const response = await fetch(`${f.base}/capture/zone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 403)
    assert.deepEqual(f.calls, [])
  } finally { await f.close() }
})

test('authorized Config Area route forwards loaded reference, background, and focus ownership', async () => {
  const f = await fixture({ requireLogin: true })
  try {
    const context = { referenceId: 'REF', backgroundCaptureId: 'EMPTY', focusToken: 'focus-12345678' }
    const response = await fetch(`${f.base}/capture/zone`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': 'operator' }, body: JSON.stringify(context),
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).capture_id, 'NEW')
    assert.deepEqual(f.calls, [{ expectedReferenceId: 'REF', expectedBackgroundCaptureId: 'EMPTY', focusToken: 'focus-12345678' }])
  } finally { await f.close() }
})

test('zone saving rejects a changed loaded reference before contacting the slave', async () => {
  const f = await fixture()
  try {
    const response = await fetch(`${f.base}/zones`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ referenceId: 'OLD' }) })
    assert.equal(response.status, 409)
    assert.match((await response.json()).error, /changed/)
  } finally { await f.close() }
})
