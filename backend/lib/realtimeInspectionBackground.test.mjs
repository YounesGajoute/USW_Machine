import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { initRealtimeInspectionClient } from './realtimeInspectionClient.mjs'
import { createRealtimeInspectionRouter } from './realtimeInspectionRoutes.mjs'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

async function fixture({ retainNewReference = true, active = false } = {}) {
  let activeCaptureId = 'OLD'
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url)
    if (parsed.hostname === '127.0.0.1') return originalFetch(url, init)
    const path = parsed.pathname
    calls.push(`${init.method ?? 'GET'} ${path}`)
    if (path === '/api/realtime/inspection/snapshot') return Response.json({ status: { active, disable_pending: false } })
    if (path === '/api/camera/capture') return Response.json({ capture_id: 'NEW' })
    if (path === '/api/captures/NEW/status') return Response.json({ capture_id: 'NEW', archive_status: 'COMPLETE', image_url: '/api/captures/NEW/image' })
    if (path === '/api/realtime/inspection/reference/from-capture/NEW') {
      if (retainNewReference) activeCaptureId = 'NEW'
      return Response.json({ capture_id: 'NEW' })
    }
    if (path === '/api/realtime/inspection/reference') return Response.json({ capture_id: activeCaptureId })
    throw new Error(`Unexpected slave request: ${path}`)
  }
  initRealtimeInspectionClient({ readSystemSettings: () => ({}), setLighting: async () => {} })
  const app = express()
  app.use(express.json())
  app.use('/api/realtime-v2', createRealtimeInspectionRouter({ requireAuth: (_req, _res, next) => next() }))
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/realtime-v2`
  return { base, calls, get activeCaptureId() { return activeCaptureId }, close: () => new Promise(resolve => server.close(resolve)) }
}

test('background capture stays unsaved until Save, then slave readback confirms it', async () => {
  const f = await fixture()
  try {
    const captureResponse = await originalFetch(`${f.base}/capture/background`, { method: 'POST' })
    assert.equal(captureResponse.status, 200)
    const capture = await captureResponse.json()
    assert.equal(capture.archive_status, 'COMPLETE')
    assert.equal(capture.capture_id, 'NEW')
    assert.equal(f.activeCaptureId, 'OLD')
    assert.equal(f.calls.some(call => call.includes('/reference/from-capture/')), false)

    const saveResponse = await originalFetch(`${f.base}/reference/from-current-frame`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capture_id: 'NEW', confirm_empty_fixture: true }),
    })
    assert.equal(saveResponse.status, 200)
    assert.equal((await saveResponse.json()).capture_id, 'NEW')
    assert.equal(f.activeCaptureId, 'NEW')
    assert.ok(f.calls.includes('GET /api/realtime/inspection/reference'))
  } finally { await f.close() }
})

test('save reports an unconfirmed slave reference instead of success', async () => {
  const f = await fixture({ retainNewReference: false })
  try {
    const response = await originalFetch(`${f.base}/reference/from-current-frame`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capture_id: 'NEW', confirm_empty_fixture: true }),
    })
    assert.equal(response.status, 409)
    const body = await response.json()
    assert.equal(body.saved, true)
    assert.match(body.error, /did not confirm/)
    assert.equal(f.activeCaptureId, 'OLD')
  } finally { await f.close() }
})

test('busy inspection refuses background capture before camera I/O', async () => {
  const f = await fixture({ active: true })
  try {
    const response = await originalFetch(`${f.base}/capture/background`, { method: 'POST' })
    assert.equal(response.status, 409)
    assert.equal(f.calls.some(call => call.includes('/camera/capture')), false)
  } finally { await f.close() }
})
