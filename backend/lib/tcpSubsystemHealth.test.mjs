import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { probeVisionHealth, runTcpHealthPoll, getCachedCentringStatus, setCachedCentringStatus } from './tcpSubsystemHealth.mjs'
import { setSetupActive } from './machineSetupHealth.mjs'
import { initRealtimeInspectionClient } from './realtimeInspectionClient.mjs'

const originalFetch = globalThis.fetch
const originalEngine = process.env.PRODUCTION_VISION_ENGINE
const originalNow = Date.now
afterEach(() => {
  Date.now = originalNow
  setCachedCentringStatus(null)
  globalThis.fetch = originalFetch
  if (originalEngine === undefined) delete process.env.PRODUCTION_VISION_ENGINE
  else process.env.PRODUCTION_VISION_ENGINE = originalEngine
  initRealtimeInspectionClient({ readSystemSettings: () => ({}) })
})

test('an old idle STATUS expires instead of keeping Start enabled indefinitely', () => {
  let now = 100000
  Date.now = () => now
  const status = { cal: true, busy: false, estop: false, h: 3 }
  setCachedCentringStatus(status)
  assert.deepEqual(getCachedCentringStatus(), status)
  now += Math.max(15000, (Number(process.env.COMM_HEALTH_INTERVAL_MS) || 5000) * 3) + 1
  assert.equal(getCachedCentringStatus(), null)
  setCachedCentringStatus(status)
  assert.deepEqual(getCachedCentringStatus(), status)
  setCachedCentringStatus(null)
  assert.equal(getCachedCentringStatus(), null)
})

test('V2 production health probes the configured inspection app, not the legacy Vision Pi', async () => {
  delete process.env.PRODUCTION_VISION_ENGINE
  initRealtimeInspectionClient({ readSystemSettings: () => ({ realtime_inspection_url: 'http://slave.test:3174/api' }) })
  globalThis.fetch = async url => {
    assert.equal(String(url), 'http://slave.test:3174/api/app/identity')
    return Response.json({ app: 'realtime-inspection-app', lighting_owner: 'master' })
  }
  assert.deepEqual(await probeVisionHealth(), { ok: true })

  globalThis.fetch = async () => Response.json({ app: 'wrong-service' })
  assert.deepEqual(await probeVisionHealth(), { ok: false, error: 'Unexpected inspection service identity' })
})

test('legacy production health keeps the legacy Vision Pi probe', async () => {
  process.env.PRODUCTION_VISION_ENGINE = 'legacy'
  globalThis.fetch = async url => {
    assert.equal(new URL(url).pathname, '/api/remote/info')
    return new Response(null, { status: 401 })
  }
  assert.deepEqual(await probeVisionHealth(), { ok: true })
})

test('runTcpHealthPoll skips pick-place and centring while setup in progress', async () => {
  setSetupActive(true)
  try {
    const edges = await runTcpHealthPoll()
    assert.ok(Array.isArray(edges))
    assert.equal(edges.some((e) => e.key === 'pickPlace'), false)
    assert.equal(edges.some((e) => e.key === 'centring'), false)
  } finally {
    setSetupActive(false)
  }
})

test('overlapping health polls share one in-flight probe and release it after completion', async () => {
  setSetupActive(true)
  let calls = 0
  let release
  globalThis.fetch = async () => {
    calls++
    await new Promise(resolve => { release = resolve })
    return Response.json({ app: 'realtime-inspection-app' })
  }
  try {
    const first = runTcpHealthPoll()
    const second = runTcpHealthPoll()
    assert.equal(first, second)
    assert.equal(calls, 1)
    release()
    await Promise.all([first, second])
    const next = runTcpHealthPoll()
    assert.equal(calls, 2)
    release()
    await next
  } finally {
    setSetupActive(false)
  }
})
