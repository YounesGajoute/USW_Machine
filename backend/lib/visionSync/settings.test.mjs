import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { fixture } from './fixtures/helpers.mjs'
import { createRealtimeInspectionRouter } from '../realtimeInspectionRoutes.mjs'
import { getRealtimeConfiguredReferenceId, initRealtimeInspectionClient } from '../realtimeInspectionClient.mjs'

async function setup(t, mode) {
  const previousMode = process.env.VISION_SYNC_MODE
  const fetchHttp = globalThis.fetch
  const outbound = []
  process.env.VISION_SYNC_MODE = mode
  globalThis.fetch = async () => { outbound.push('slave request'); throw new Error('No direct Slave request is allowed') }
  initRealtimeInspectionClient({ setLighting: async () => { outbound.push('lighting') } })
  const f = fixture()
  let server
  t.after(async () => {
    if (server) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    globalThis.fetch = fetchHttp
    if (previousMode === undefined) delete process.env.VISION_SYNC_MODE
    else process.env.VISION_SYNC_MODE = previousMode
    f.db.close()
  })
  const app = express()
  app.use(express.json())
  app.use('/api/realtime-v2', createRealtimeInspectionRouter({ db: f.db,
    getLoadedReferenceId: () => f.getSelection().referenceId,
    getLoadedReferenceSelection: f.getSelection,
    requireAuth: (_req, _res, next) => next(),
    captureZone: async () => { throw new Error('Capture must not be called') },
  }))
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const save = async body => {
    const res = await fetchHttp(`http://127.0.0.1:${server.address().port}/api/realtime-v2/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: res.status, data: await res.json() }
  }
  return { ...f, save, outbound }
}

// Matches the reported UI selection: weld position and heat-shrink presence only.
const input = {
  referenceId: 'reference-A',
  selectionRevision: '1',
  checks: {
    welding_splice: { enabled: true, length_check: false, width_check: false, position_check: true },
    heat_shrink_tube: { enabled: true, position_check: true, length_check: false, diameter_check: false },
  },
  config: { welding_splice: { position_tolerance_mm: 0.4 }, heat_shrink_tube: {},
    calibration: { valid: false, mm_per_px_x: 999 }, weld_zone: { x: 999 } },
}

for (const mode of ['off', 'commissioning']) {
  test(`Vision Settings uses versioned pull intent with mode=${mode}, never direct control`, async t => {
    const f = await setup(t, mode)
    const registration = f.service.register(f.registration).response
    const before = f.service.state(f.stateRequest(registration))
    const result = await f.save(input)
    assert.equal(result.status, 200)
    assert.equal(result.data.saved, true)
    assert.equal(result.data.synced, false)
    assert.equal(result.data.sync_state, mode === 'off' ? 'not_configured' : 'awaiting_slave')
    assert.equal(result.data.sync_error, undefined)
    assert.deepEqual(result.data.reference.vision_checks_config, input.checks)
    assert.equal(result.data.config.welding_splice.position_tolerance_mm, 0.4)
    assert.equal(result.data.config.calibration, undefined)
    const saved = JSON.parse(f.db.prepare('SELECT realtime_v2_config_json AS json FROM product_references WHERE id = ?').get('reference-A').json)
    assert.equal(saved.config.calibration, undefined)
    assert.equal(saved.config.weld_zone, undefined)
    const after = f.service.state(f.stateRequest(registration))
    assert.equal(after.desiredMode, 'enabled')
    assert.equal(after.binding.recipeRevision, '2')
    assert.equal(after.recipe.welding_splice.checks.position.enabled, true)
    assert.equal(after.recipe.welding_splice.expected_length_mm, null)
    assert.equal(after.recipe.heat_shrink_tube.checks.position.enabled, true)
    assert.equal(after.recipe.heat_shrink_tube.expected_diameter_mm, null)
    assert.throws(() => f.service.ack(f.report(before)), { code: 'STALE_BINDING' })
    const ack = f.service.ack(f.report(after))
    assert.equal(ack.grant, null)
    assert.equal(ack.installedGrantId, null)
    assert.equal(getRealtimeConfiguredReferenceId(), null)
    assert.deepEqual(f.outbound, [])
    assert.equal(process.env.VISION_SYNC_MODE, mode)
  })
}

test('Vision Settings still rejects invalid dimensions, empty checks and stale references atomically', async t => {
  const f = await setup(t, 'commissioning')
  const before = f.store.readDesired('reference-A')
  const invalid = structuredClone(input)
  invalid.config.welding_splice.position_tolerance_mm = -1
  assert.equal((await f.save(invalid)).status, 400)
  assert.equal((await f.save({ ...input, checks: {} })).status, 409)
  const { checks: ignored, ...missing } = input
  assert.equal((await f.save(missing)).status, 400)
  assert.equal((await f.save({ ...input, referenceId: 'old-reference' })).status, 409)
  assert.equal((await f.save({ ...input, selectionEpoch: 'stale-master-process' })).status, 409)
  f.select('reference-B')
  f.select('reference-A')
  const staleRevision = await f.save(input)
  assert.equal(staleRevision.status, 409)
  assert.equal(staleRevision.data.code, 'REFERENCE_CHANGED')
  assert.equal(staleRevision.data.currentReferenceId, 'reference-A')
  assert.deepEqual(f.store.readDesired('reference-A'), before)
  assert.deepEqual(f.outbound, [])
})

test('Vision Settings accepts an already-open legacy tab during a rolling HMI deployment', async t => {
  const f = await setup(t, 'commissioning')
  const { selectionRevision: ignoredRevision, ...legacyInput } = input
  const result = await f.save(legacyInput)
  assert.equal(result.status, 200)
  assert.equal(result.data.saved, true)
  assert.equal(typeof result.data.selectionEpoch, 'string')
  assert.equal(result.data.selectionRevision, '1')
})
