import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertRealtimeConfigCurrent,
  captureRealtimeFrameWithLighting,
  captureRealtimeFrame,
  disableRealtimeInspection,
  fetchRealtimeImage,
  getRealtimeConfig,
  getRealtimeConfiguredReferenceId,
  initRealtimeInspectionClient,
  normalizeRealtimeImagePath,
  proxyRealtimeImageUrls,
  runRealtimeInspectionWithLighting,
  realtimeVerdict,
  waitForRealtimeDisabled,
  withRealtimeLighting,
  waitUntilRealtimeIdle,
  putRealtimeZones,
  setRealtimeConfiguredReferenceId,
} from './realtimeInspectionClient.mjs'
import { mapRealtimeInspectionConfig } from './realtimeInspectionConfig.mjs'
import { buildProductionSteps } from './productionSequence.mjs'

const oldFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = oldFetch })

test('reads actual slave inspection_tools and detects nested configuration changes', async () => {
  initRealtimeInspectionClient({ readSystemSettings: () => ({}) })
  const config = {
    calibration: { mm_per_px_x: 0.179043, mm_per_px_y: 0.181835, valid: true },
    weld_zone: { x: 450, y: 585, width: 507, height: 292 },
    inspection_tools: {
      welding_splice: { enabled: true, checks: { position: { enabled: true } } },
      heat_shrink_tube: { enabled: true, checks: { position: { enabled: true } } },
    },
  }
  globalThis.fetch = async () => Response.json(config)
  const normalized = await getRealtimeConfig()
  assert.deepEqual(normalized.welding_splice, config.inspection_tools.welding_splice)
  assert.deepEqual(normalized.heat_shrink_tube, config.inspection_tools.heat_shrink_tube)
  assert.deepEqual(normalized.weld_zone, config.weld_zone)
  assert.deepEqual(normalized.calibration, config.calibration)
  setRealtimeConfiguredReferenceId('REF-NESTED', normalized)
  await assertRealtimeConfigCurrent()
  config.inspection_tools.welding_splice.checks.position.enabled = false
  await assert.rejects(assertRealtimeConfigCurrent(), /configuration changed/)
  setRealtimeConfiguredReferenceId(null)
})

test('reference booleans map to the slave schema and preserve operator tolerances', () => {
  const mapped = mapRealtimeInspectionConfig({
    saved: { calibration: { mm_per_px_x: 0.1, mm_per_px_y: 0.2, valid: true }, welding_splice: {}, heat_shrink_tube: {} },
    draft: {
      welding_splice: { expected_length_mm: 8, length_tolerance_mm: 0.5, expected_width_mm: 2, width_tolerance_mm: 0.3, position_tolerance_mm: 0.5 },
      heat_shrink_tube: { length_tolerance_mm: 1, diameter_tolerance_mm: 0.4 },
    },
    checks: {
      welding_splice: { enabled: true, length_check: true, width_check: true, position_check: false },
      heat_shrink_tube: { enabled: true, length_check: true, diameter_check: true, position_check: true },
    },
    shrinkTube: { length_mm: 20, diameter_mm: 3 },
  })
  assert.deepEqual(mapped.calibration, { mm_per_px_x: 0.1, mm_per_px_y: 0.2, valid: true })
  assert.deepEqual(mapped.welding_splice.checks, { length: { enabled: true }, width: { enabled: true }, position: { enabled: false } })
  assert.deepEqual(mapped.heat_shrink_tube.checks, { position: { enabled: true }, length: { enabled: true }, diameter: { enabled: true } })
  assert.equal(mapped.heat_shrink_tube.expected_length_mm, 20)
  assert.equal(mapped.heat_shrink_tube.expected_diameter_mm, 3)
  assert.equal(mapped.heat_shrink_tube.length_tolerance_mm, 1)
  assert.throws(() => mapRealtimeInspectionConfig({ saved: { calibration: { mm_per_px_x: 0, mm_per_px_y: 0.1 } } }), /X calibration/)
  assert.throws(() => mapRealtimeInspectionConfig({ draft: { ...mapped, calibration: { ...mapped.calibration, valid: false } }, checks: {
    welding_splice: { enabled: true, length_check: true }, heat_shrink_tube: { enabled: false },
  } }), /must be validated/)
  assert.throws(() => mapRealtimeInspectionConfig({ draft: { ...mapped, welding_splice: { ...mapped.welding_splice, length_tolerance_mm: true } }, checks: {
    welding_splice: { enabled: true, length_check: true }, heat_shrink_tube: { enabled: false },
  } }), /length_tolerance_mm/)
})

test('uses /config for saved settings and serializes lighting through capture and run', async () => {
  const calls = []
  initRealtimeInspectionClient({
    readSystemSettings: () => ({}),
    setLighting: async on => { calls.push(`light:${on}`) },
  })
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname
    calls.push(path)
    if (path === '/api/config') return Response.json({ calibration: { mm_per_px_x: 0.1, mm_per_px_y: 0.1 } })
    if (path.endsWith('/snapshot')) return Response.json({ status: { active: false }, result: null })
    if (path === '/api/camera/capture') {
      assert.equal(JSON.parse(init.body).async, true)
      return Response.json({ capture_id: 'C1', image_url: '/api/captures/C1/image' })
    }
    if (path === '/api/captures/C1/status') return Response.json({ capture_id: 'C1', archive_status: 'COMPLETE' })
    if (path.endsWith('/run')) return Response.json({ result: { verdict: 'PASS' } })
    throw new Error(`unexpected ${path} ${init?.method}`)
  }
  await getRealtimeConfig()
  await Promise.all([captureRealtimeFrameWithLighting('zone-reference'), runRealtimeInspectionWithLighting()])
  assert.deepEqual(calls, [
    '/api/config', 'light:true', '/api/camera/capture', '/api/captures/C1/status', '/api/realtime/inspection/snapshot', 'light:false',
    'light:true', '/api/realtime/inspection/snapshot', '/api/realtime/inspection/run', '/api/realtime/inspection/snapshot', 'light:false',
  ])
})

test('lighting is released on failure and cannot be switched off by another V2 user early', async () => {
  const calls = []
  initRealtimeInspectionClient({ readSystemSettings: () => ({}), setLighting: async on => { calls.push(on) } })
  let release
  const first = withRealtimeLighting(() => new Promise(resolve => { release = resolve }))
  const second = withRealtimeLighting(() => { calls.push('second'); throw new Error('capture failed') })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [true])
  await new Promise(resolve => setTimeout(resolve, 850))
  release()
  await first
  await assert.rejects(second, /capture failed/)
  assert.deepEqual(calls, [true, false, true, 'second', false])
})

test('uncertain slave state stops waiting after its reconciliation deadline', async () => {
  globalThis.fetch = async () => { throw new Error('slave offline') }
  await assert.rejects(waitUntilRealtimeIdle({ timeoutMs: 10, intervalMs: 1 }), error => error.code === 'INSPECTION_STATE_UNKNOWN')
})

test('asynchronous capture rejects failed storage before a frame can be used', async () => {
  globalThis.fetch = async url => new URL(url).pathname === '/api/camera/capture'
    ? Response.json({ capture_id: 'failed-frame' })
    : Response.json({ archive_status: 'FAILED', archive_error: 'disk full' })
  await assert.rejects(captureRealtimeFrame('zone-reference'), /disk full/)
})

test('only registered slave image paths are fetched through the master', async () => {
  assert.equal(normalizeRealtimeImagePath('http://evil.example/file'), null)
  assert.equal(normalizeRealtimeImagePath('/api/../admin'), null)
  const proxied = proxyRealtimeImageUrls({ image_urls: { product: '/api/realtime/inspection/results/1/product.png', welding_splice: null } })
  assert.match(proxied.image_urls.product, /^\/api\/realtime-v2\/images\/[\w-]+$/)
  assert.equal(proxied.image_urls.welding_splice, null)
  globalThis.fetch = async url => {
    assert.equal(new URL(url).pathname, '/api/realtime/inspection/results/1/product.png')
    return new Response('pixels', { headers: { 'Content-Type': 'image/png' } })
  }
  const token = proxied.image_urls.product.split('/').at(-1)
  assert.equal((await fetchRealtimeImage(token)).headers.get('content-type'), 'image/png')
  await assert.rejects(fetchRealtimeImage('unregistered'), /Invalid inspection image path/)
})

test('disable reconciliation waits until both active and enabled are false', async () => {
  let count = 0
  globalThis.fetch = async (url, init) => {
    if (new URL(url).pathname.endsWith('/disable')) {
      assert.equal(init.method, 'POST')
      return Response.json({ disable_pending: true }, { status: 202 })
    }
    return Response.json({ status: ++count === 1
      ? { active: true, enabled: true, disable_pending: true }
      : { active: false, enabled: false } })
  }
  assert.equal((await disableRealtimeInspection()).disable_pending, true)
  const result = await waitForRealtimeDisabled({ timeoutMs: 500, intervalMs: 1 })
  assert.equal(result.status.enabled, false)
  assert.equal(count, 2)
})

test('slave 409 errors propagate to the master with their message', async () => {
  globalThis.fetch = async () => Response.json({ error: 'disable pending' }, { status: 409 })
  await assert.rejects(putRealtimeZones({}), error => error.status === 409 && error.message === 'disable pending')
})

test('production verdict reads the V2 slave outcome field', () => {
  assert.equal(realtimeVerdict({ result: { outcome: 'PASS' } }), 'PASS')
  assert.equal(realtimeVerdict({ result: { outcome: 'FAIL' } }), 'FAIL')
  assert.equal(realtimeVerdict({ outcome: 'PASS' }), 'PASS')
})

test('V2 production has one inspection after lever and pick/place clamp close', () => {
  const context = {
    timing: {}, skipVision: false, skipCentring: true, skipPickTail: true,
    init: { referenceId: 'REF' },
    visionChecks: {
      welding_splice: { enabled: true, length_check: true },
      heat_shrink_tube: { enabled: true, position_check: true },
    },
  }
  const state = { centring: null, moveToPick: null, moveToBackoff: null }
  const steps = buildProductionSteps({}, context, [], state)
  const names = steps.map(step => step.name)
  assert.equal(names.filter(name => name.startsWith('vision_')).length, 1)
  assert.equal(names.indexOf('vision_realtime_v2'), names.indexOf('pp_clamp_close') + 1)
  assert.equal(names.indexOf('vision_realtime_v2'), names.indexOf('open_clamps') - 1)

  const skipped = buildProductionSteps({}, { ...context, skipVision: true }, [], state)
  assert.equal(skipped.some(step => step.name.startsWith('vision_')), false)
})

test('changing reference checks or linked product dimensions invalidates saved V2 binding', () => {
  let fingerprint = 'checks=A;length=20;diameter=3'
  initRealtimeInspectionClient({ readSystemSettings: () => ({}), setLighting: async () => {}, readReferenceFingerprint: () => fingerprint })
  setRealtimeConfiguredReferenceId('REF-A')
  assert.equal(getRealtimeConfiguredReferenceId(), 'REF-A')
  fingerprint = 'checks=A;length=21;diameter=3'
  assert.equal(getRealtimeConfiguredReferenceId(), null)
  setRealtimeConfiguredReferenceId(null)
})

test('master refuses a slave configuration changed after saving', async () => {
  const config = {
    calibration: { mm_per_px_x: 0.1, mm_per_px_y: 0.2, valid: true },
    welding_splice: { enabled: true, checks: { length: { enabled: true } }, expected_length_mm: 8, length_tolerance_mm: 0.5 },
    heat_shrink_tube: { enabled: false, checks: {} },
  }
  initRealtimeInspectionClient({ readSystemSettings: () => ({}), setLighting: async () => {}, readReferenceFingerprint: () => 'stable' })
  setRealtimeConfiguredReferenceId('REF-A', config)
  globalThis.fetch = async () => Response.json(config)
  await assertRealtimeConfigCurrent()
  globalThis.fetch = async () => Response.json({ ...config, welding_splice: { ...config.welding_splice, expected_length_mm: 9 } })
  await assert.rejects(assertRealtimeConfigCurrent(), error => error.status === 409)
  setRealtimeConfiguredReferenceId(null)
})
