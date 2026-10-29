import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initRealtimeInspectionClient, getRealtimeConfiguredReferenceId, setRealtimeConfiguredReferenceId } from './realtimeInspectionClient.mjs'
import { getRealtimeConfigForReference, getVisionSettingsForReference, saveRealtimeInspectionForReference, syncRealtimeInspectionForReference } from './realtimeInspectionReference.mjs'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  setRealtimeConfiguredReferenceId(null)
})

function fixture() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE shrink_tubes (id TEXT PRIMARY KEY, length_mm REAL, diameter_mm REAL);
    CREATE TABLE product_references (
      id TEXT PRIMARY KEY, name TEXT, vision_inspection_enabled INTEGER, vision_checks_json TEXT,
      shrink_tube_id TEXT, realtime_v2_config_json TEXT NOT NULL DEFAULT '', updated_at TEXT
    );
  `)
  db.prepare('INSERT INTO shrink_tubes VALUES (?, ?, ?)').run('ST-816221', 50, 10)
  const checks = JSON.stringify({
    welding_splice: { enabled: true, length_check: true, width_check: true, position_check: true },
    heat_shrink_tube: { enabled: true, length_check: true, diameter_check: true, position_check: true },
  })
  db.prepare('INSERT INTO product_references VALUES (?, ?, ?, ?, ?, ?, ?)').run('REF-165069', 'Product 165069', 1, checks, 'ST-816221', '', '')
  db.prepare('INSERT INTO product_references VALUES (?, ?, ?, ?, ?, ?, ?)').run('REF-OFF', 'Product off', 0, checks, 'ST-816221', '', '')
  let loaded = 'REF-165069'
  let enabled = true
  let config = { calibration: { mm_per_px_x: 0.1, mm_per_px_y: 0.2, valid: true }, inspection_tools: {
    welding_splice: { enabled: true, checks: { position: { enabled: true } } },
    heat_shrink_tube: { enabled: true, checks: { position: { enabled: true } } },
  } }
  const calls = []
  let mutateReadback = false
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname
    calls.push(`${init.method ?? 'GET'} ${path}`)
    if (path === '/api/config') {
      const response = structuredClone(config)
      if (mutateReadback && response.welding_splice) response.welding_splice.length_tolerance_mm = 999
      return Response.json(response)
    }
    if (path.endsWith('/snapshot')) {
      const group = (name, names) => names.filter(key => config[name]?.enabled && config[name]?.checks?.[key]?.enabled)
      return Response.json({ status: { active: false, enabled, can_run: enabled, disable_pending: false,
        enabled_checks: {
          welding_splice: group('welding_splice', ['length', 'width', 'position']),
          heat_shrink_tube: group('heat_shrink_tube', ['position', 'length', 'diameter']),
        },
      } })
    }
    if (path.endsWith('/disable')) { enabled = false; return Response.json({ enabled: false }) }
    if (path.endsWith('/enable')) { enabled = true; return Response.json({ enabled: true }) }
    if (path.endsWith('/config') && init.method === 'PUT') {
      config = JSON.parse(init.body)
      return Response.json(config)
    }
    throw new Error(`Unexpected ${path}`)
  }
  initRealtimeInspectionClient({ readSystemSettings: () => ({}), readReferenceFingerprint: () => 'stable' })
  return { db, calls, get loaded() { return loaded }, set loaded(value) { loaded = value },
    get enabled() { return enabled }, get config() { return config },
    set calibration(value) { config.calibration = value },
    set mutateReadback(value) { mutateReadback = value } }
}

const draft = {
  calibration: { mm_per_px_x: 0.1, mm_per_px_y: 0.2, valid: true },
  welding_splice: { expected_length_mm: 8, length_tolerance_mm: 0.5, expected_width_mm: 2, width_tolerance_mm: 0.3, position_tolerance_mm: 0.4 },
  heat_shrink_tube: { expected_length_mm: 50, length_tolerance_mm: 1, expected_diameter_mm: 10, diameter_tolerance_mm: 0.4 },
}

test('saving a recipe verifies all checks, values and tolerances; subsequent loads restore and enable it', async () => {
  const f = fixture()
  try {
    await saveRealtimeInspectionForReference({ db: f.db, referenceId: 'REF-165069', getLoadedReferenceId: () => f.loaded, draft })
    assert.equal(f.enabled, true)
    assert.equal(getRealtimeConfiguredReferenceId(), 'REF-165069')
    assert.equal(f.config.welding_splice.checks.width.enabled, true)
    assert.equal(f.config.welding_splice.length_tolerance_mm, 0.5)
    assert.equal(f.config.heat_shrink_tube.diameter_tolerance_mm, 0.4)
    const saved = JSON.parse(f.db.prepare('SELECT realtime_v2_config_json AS value FROM product_references WHERE id = ?').get('REF-165069').value)
    assert.equal(saved.config.calibration, undefined)

    f.loaded = 'REF-OFF'
    const pendingOff = syncRealtimeInspectionForReference({ db: f.db, referenceId: f.loaded, getLoadedReferenceId: () => f.loaded })
    assert.equal(getRealtimeConfiguredReferenceId(), null)
    const off = await pendingOff
    assert.deepEqual(off, { ok: true, state: 'disabled' })
    assert.equal(f.enabled, false)
    assert.equal(getRealtimeConfiguredReferenceId(), null)

    f.loaded = 'REF-165069'
    f.calibration = { mm_per_px_x: 0.11, mm_per_px_y: 0.21, valid: true }
    const on = await syncRealtimeInspectionForReference({ db: f.db, referenceId: f.loaded, getLoadedReferenceId: () => f.loaded })
    assert.deepEqual(on, { ok: true, state: 'enabled' })
    assert.equal(f.enabled, true)
    assert.equal(getRealtimeConfiguredReferenceId(), 'REF-165069')
    assert.equal(f.config.calibration.mm_per_px_x, 0.11)
  } finally { f.db.close() }
})

test('missing or stale reference measurements leave inspection disabled', async () => {
  const f = fixture()
  try {
    const missing = await syncRealtimeInspectionForReference({ db: f.db, referenceId: 'REF-165069', getLoadedReferenceId: () => f.loaded })
    assert.equal(missing.state, 'configuration_required')
    assert.equal(f.enabled, false)
    await saveRealtimeInspectionForReference({ db: f.db, referenceId: 'REF-165069', getLoadedReferenceId: () => f.loaded, draft })
    f.db.prepare('UPDATE shrink_tubes SET length_mm = 51 WHERE id = ?').run('ST-816221')
    const stale = await syncRealtimeInspectionForReference({ db: f.db, referenceId: 'REF-165069', getLoadedReferenceId: () => f.loaded })
    assert.equal(stale.state, 'configuration_required')
    assert.equal(f.enabled, false)
    assert.equal(getRealtimeConfiguredReferenceId(), null)
    const displayed = await getRealtimeConfigForReference(f.db, 'REF-165069')
    assert.equal(displayed.welding_splice.expected_length_mm, undefined)
    assert.equal(displayed.heat_shrink_tube.expected_length_mm, 51)
    assert.equal(displayed.heat_shrink_tube.expected_diameter_mm, 10)
  } finally { f.db.close() }
})

test('incorrect slave readback cannot enable inspection or bind the reference', async () => {
  const f = fixture()
  try {
    f.mutateReadback = true
    await assert.rejects(
      saveRealtimeInspectionForReference({ db: f.db, referenceId: 'REF-165069', getLoadedReferenceId: () => f.loaded, draft }),
      error => /did not retain/.test(error.message) && error.saved === true,
    )
    assert.equal(f.enabled, false)
    assert.equal(getRealtimeConfiguredReferenceId(), null)
    assert.equal(getVisionSettingsForReference(f.db, f.loaded).config.welding_splice.length_tolerance_mm, 0.5)
  } finally { f.db.close() }
})

test('settings load from the master database without calling the slave', () => {
  const f = fixture()
  try {
    globalThis.fetch = async () => { throw new Error('Slave must not be called by settings reads') }
    assert.deepEqual(getVisionSettingsForReference(f.db, null), { reference: null, config: null })
    const settings = getVisionSettingsForReference(f.db, f.loaded)
    assert.equal(settings.reference.id, 'REF-165069')
    assert.equal(settings.reference.name, 'Product 165069')
    assert.equal(settings.reference.vision_checks_config.welding_splice.width_check, true)
    assert.equal(settings.config.heat_shrink_tube.expected_length_mm, 50)
    assert.equal(settings.config.calibration, undefined)
    assert.equal(settings.status, undefined)
  } finally { f.db.close() }
})

test('checks and measurements are committed together before slave I/O and always use live slave calibration', async () => {
  const f = fixture()
  try {
    const checks = getVisionSettingsForReference(f.db, f.loaded).reference.vision_checks_config
    checks.welding_splice.width_check = false
    const changed = structuredClone(draft)
    changed.welding_splice.length_tolerance_mm = 0.75
    // An old or malicious client cannot override camera calibration.
    changed.calibration = { mm_per_px_x: 999, mm_per_px_y: 999, valid: false }
    f.calibration = { mm_per_px_x: 0.31, mm_per_px_y: 0.32, valid: true }
    const slaveFetch = globalThis.fetch
    globalThis.fetch = async (...args) => {
      const saved = getVisionSettingsForReference(f.db, f.loaded)
      assert.equal(saved.reference.vision_checks_config.welding_splice.width_check, false)
      assert.equal(saved.config.welding_splice.length_tolerance_mm, 0.75)
      assert.equal(saved.config.calibration, undefined)
      return slaveFetch(...args)
    }
    await saveRealtimeInspectionForReference({ db: f.db, referenceId: f.loaded, getLoadedReferenceId: () => f.loaded, draft: changed, checks })
    assert.equal(f.config.welding_splice.checks.width.enabled, false)
    assert.equal(f.config.welding_splice.length_tolerance_mm, 0.75)
    assert.deepEqual(f.config.calibration, { mm_per_px_x: 0.31, mm_per_px_y: 0.32, valid: true })
    const settings = getVisionSettingsForReference(f.db, f.loaded)
    assert.equal(settings.config.calibration, undefined)
  } finally { f.db.close() }
})

test('offline slave retains saved values on the master and supports a later retry without client calibration', async () => {
  const f = fixture()
  try {
    const slaveFetch = globalThis.fetch
    globalThis.fetch = async () => Response.json({ error: 'Offline' }, { status: 503 })
    const { calibration: ignored, ...measurements } = draft
    await assert.rejects(saveRealtimeInspectionForReference({ db: f.db, referenceId: f.loaded, getLoadedReferenceId: () => f.loaded, draft: measurements }), error => error.saved === true)
    const settings = getVisionSettingsForReference(f.db, f.loaded)
    assert.equal(settings.config.welding_splice.expected_length_mm, 8)
    assert.equal(getRealtimeConfiguredReferenceId(), null)
    globalThis.fetch = slaveFetch
    await saveRealtimeInspectionForReference({ db: f.db, referenceId: f.loaded, getLoadedReferenceId: () => f.loaded, draft: settings.config, checks: settings.reference.vision_checks_config })
    assert.equal(getRealtimeConfiguredReferenceId(), f.loaded)
    assert.equal(f.enabled, true)
  } finally { f.db.close() }
})

test('invalid dimensions do not partially save changed check selection', async () => {
  const f = fixture()
  try {
    const before = getVisionSettingsForReference(f.db, f.loaded)
    const checks = structuredClone(before.reference.vision_checks_config)
    checks.welding_splice.width_check = false
    const invalid = { ...draft, welding_splice: { ...draft.welding_splice, expected_length_mm: '' } }
    await assert.rejects(saveRealtimeInspectionForReference({ db: f.db, referenceId: f.loaded, getLoadedReferenceId: () => f.loaded, draft: invalid, checks }), /positive/)
    assert.deepEqual(getVisionSettingsForReference(f.db, f.loaded), before)
    assert.equal(f.calls.length, 0)
  } finally { f.db.close() }
})

test('master reference changes reject stale saves before writing or contacting the slave', async () => {
  const f = fixture()
  try {
    const before = getVisionSettingsForReference(f.db, f.loaded)
    f.loaded = 'REF-OFF'
    await assert.rejects(saveRealtimeInspectionForReference({ db: f.db, referenceId: 'REF-165069', getLoadedReferenceId: () => f.loaded, draft }), error => error.status === 409 && !error.saved)
    assert.deepEqual(getVisionSettingsForReference(f.db, 'REF-165069'), before)
    assert.equal(f.calls.length, 0)
  } finally { f.db.close() }
})

test('reference change during transfer retains original reference values but never sends or enables the wrong recipe', async () => {
  const f = fixture()
  try {
    const slaveFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      const response = await slaveFetch(url, init)
      if (new URL(url).pathname.endsWith('/disable')) f.loaded = 'REF-OFF'
      return response
    }
    await assert.rejects(saveRealtimeInspectionForReference({ db: f.db, referenceId: 'REF-165069', getLoadedReferenceId: () => f.loaded, draft }), error => error.status === 409 && error.saved === true)
    assert.equal(getVisionSettingsForReference(f.db, 'REF-165069').config.welding_splice.expected_length_mm, 8)
    assert.equal(getVisionSettingsForReference(f.db, 'REF-OFF').config.welding_splice.expected_length_mm, undefined)
    assert.equal(f.calls.some(call => call.startsWith('PUT ')), false)
    assert.equal(f.enabled, false)
  } finally { f.db.close() }
})

test('invalid slave calibration blocks sending but does not lose the master recipe', async () => {
  const f = fixture()
  try {
    f.calibration = { mm_per_px_x: 0.1, mm_per_px_y: 0.2, valid: false }
    await assert.rejects(saveRealtimeInspectionForReference({ db: f.db, referenceId: f.loaded, getLoadedReferenceId: () => f.loaded, draft }), error => /calibration must be validated/.test(error.message) && error.saved === true)
    assert.equal(getVisionSettingsForReference(f.db, f.loaded).config.welding_splice.expected_length_mm, 8)
    assert.equal(f.calls.some(call => call.startsWith('PUT ')), false)
    assert.equal(f.enabled, false)
  } finally { f.db.close() }
})

test('editing uses stored reference dimensions even when changed checks invalidate automatic sync', async () => {
  const f = fixture()
  try {
    await saveRealtimeInspectionForReference({ db: f.db, referenceId: f.loaded, getLoadedReferenceId: () => f.loaded, draft })
    const checks = getVisionSettingsForReference(f.db, f.loaded).reference.vision_checks_config
    checks.welding_splice.width_check = false
    f.db.prepare('UPDATE product_references SET vision_checks_json = ? WHERE id = ?').run(JSON.stringify(checks), f.loaded)
    assert.equal(getVisionSettingsForReference(f.db, f.loaded).config.welding_splice.expected_length_mm, 8)
    const result = await syncRealtimeInspectionForReference({ db: f.db, referenceId: f.loaded, getLoadedReferenceId: () => f.loaded })
    assert.equal(result.state, 'configuration_required')
    assert.equal(f.enabled, false)
  } finally { f.db.close() }
})
