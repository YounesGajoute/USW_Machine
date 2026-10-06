/**
 * Dual-slave TCP session check at production cycle start.
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  prepareProductionRun,
  getProductionEnqueueBlockReason,
  __setTestEnsurePickPlaceReady,
  __clearTestEnsurePickPlaceReady,
  __setTestEnsureCentringReady,
  __clearTestEnsureCentringReady,
} from './productionSequence.mjs'
import {
  getPickPlaceProductionBlockReason,
  isPickPlaceRequiredForProduction,
} from './pickPlaceIdle.mjs'
import { getReferenceProductionReadyBlockReason } from './referenceProductionReady.mjs'
import {
  __setMachineInitStateForTest,
  clearLoadedReference,
  setLoadedReference,
} from './machineInit.mjs'
import { onEtherCATConnected } from './machineLifecycle.mjs'
import { initProductionContext } from './productionContext.mjs'
import { initProductionVisionInspection } from './productionVisionInspection.mjs'
import { refreshAllShrinkTubeDerived } from './centringDerivedRecipe.mjs'
import {
  __setCachedCentringStatusForTest,
  __setPickPlaceHealthForTest,
} from './tcpSubsystemHealth.mjs'
import { statusAtHPre, useTestSlaveCal } from './testSupport/centringV2Rest.mjs'

const REF_ID = 'REF-TCP-DUAL'
const TUBE_ID = 'TUBE-TCP-DUAL'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE product_references (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      vision_program_id INTEGER,
      vision_inspection_enabled INTEGER NOT NULL DEFAULT 0,
      shrink_tube_id TEXT,
      vision_checks_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE shrink_tubes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      diameter_mm REAL NOT NULL,
      length_mm REAL NOT NULL,
      centring_length_tolerance_mm REAL NOT NULL DEFAULT 0,
      centring_mechanism TEXT NOT NULL DEFAULT 'upper',
      diameter_closing_gap_mm REAL NOT NULL DEFAULT 4.5,
      diameter_opening_gap_mm REAL NOT NULL DEFAULT 12,
      h_pre_mm REAL,
      h_post_mm REAL,
      l_eff_mm REAL,
      centering_travel_mm REAL,
      centering_input_mm REAL,
      centering_output_mm REAL,
      centering_move_travel_mm REAL,
      centring_axis TEXT,
      centring_derived_updated_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE system_settings (id INTEGER PRIMARY KEY, json TEXT NOT NULL DEFAULT '{}');
    INSERT INTO system_settings (id, json) VALUES (1, '{}');
  `)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO shrink_tubes (id, name, diameter_mm, length_mm, diameter_closing_gap_mm, diameter_opening_gap_mm, is_active, created_at, updated_at)
     VALUES (?, 'Tube', 5, 100, 4.5, 12, 1, ?, ?)`,
  ).run(TUBE_ID, now, now)
  db.prepare(
    `INSERT INTO product_references (id, name, shrink_tube_id, created_at, updated_at)
     VALUES (?, 'Ref', ?, ?, ?)`,
  ).run(REF_ID, TUBE_ID, now, now)
  refreshAllShrinkTubeDerived(db, readSettings())
  return db
}

function readSettings() {
  return {
    centring_frame_config: {
      sideA_guide_spacing_mm: 300,
      sideB_guide_spacing_mm: 55,
      module_length_mm: 200,
    },
    centering_input_start_mm: 120,
    centering_input_offset_mm: 0,
    machine_model: 'STCS-CS19',
  }
}

function seedReady() {
  // Version 2 rest gate: the loaded reference's centring_axis at H_PRE.
  useTestSlaveCal()
  __setCachedCentringStatusForTest(statusAtHPre(REF_ID))
  __setPickPlaceHealthForTest({ reachable: true })
}

function makeEcm() {
  return {
    isInitialized: true,
    async getInput() {
      return { status: 'ok', value: true }
    },
    async setOutput() {
      return { status: 'ok' }
    },
  }
}

beforeEach(() => {
  delete process.env.PRODUCTION_SKIP_CENTRING
  delete process.env.PRODUCTION_SKIP_PICK_PLACE
  delete process.env.PRODUCTION_SKIP_PICK_TAIL
  delete process.env.PRODUCTION_SKIP_CENTRING_PICK_PLACE
  process.env.PRODUCTION_SKIP_VISION = '1'
  process.env.ETHERCAT_SKIP_START_BUTTON = '1'
  process.env.CLAMP_TRIGGER_MODE = 'off'
  clearLoadedReference()
  onEtherCATConnected()
  const db = createDb()
  initProductionContext(db, readSettings)
  initProductionVisionInspection(db, readSettings)
  __setMachineInitStateForTest({ referenceId: REF_ID, initialized: true })
  setLoadedReference(REF_ID)
  seedReady()
})

afterEach(() => {
  __clearTestEnsurePickPlaceReady()
  __clearTestEnsureCentringReady()
  delete process.env.PRODUCTION_SKIP_CENTRING
  delete process.env.PRODUCTION_SKIP_PICK_PLACE
  delete process.env.PRODUCTION_SKIP_PICK_TAIL
  delete process.env.PRODUCTION_SKIP_CENTRING_PICK_PLACE
  delete process.env.PRODUCTION_SKIP_VISION
  delete process.env.ETHERCAT_SKIP_START_BUTTON
  delete process.env.CLAMP_TRIGGER_MODE
  clearLoadedReference()
})

test('isPickPlaceRequiredForProduction false when both pick paths skipped', () => {
  process.env.PRODUCTION_SKIP_PICK_PLACE = '1'
  assert.equal(isPickPlaceRequiredForProduction(), false)
  assert.equal(getPickPlaceProductionBlockReason(), null)
})

test('getPickPlaceProductionBlockReason blocks when unreachable', () => {
  __setPickPlaceHealthForTest({ reachable: false, lastError: 'ECONNREFUSED' })
  const reason = getPickPlaceProductionBlockReason()
  assert.match(reason ?? '', /Pick & Place controller unreachable/)
  assert.match(reason ?? '', /ECONNREFUSED/)
  assert.match(getReferenceProductionReadyBlockReason(REF_ID) ?? '', /Pick & Place/)
  assert.match(getProductionEnqueueBlockReason() ?? '', /Pick & Place/)
})

test('getPickPlaceProductionBlockReason null when health reachable', () => {
  __setPickPlaceHealthForTest({ reachable: true })
  assert.equal(getPickPlaceProductionBlockReason(), null)
  assert.equal(getProductionEnqueueBlockReason(), null)
})

test('prepareProductionRun opens centring and pick-place TCP in parallel', async () => {
  let centringStarted = 0
  let ppStarted = 0
  let bothRunning = false
  let centringRelease
  let ppRelease
  const centringGate = new Promise((r) => {
    centringRelease = r
  })
  const ppGate = new Promise((r) => {
    ppRelease = r
  })

  __setTestEnsureCentringReady(async () => {
    centringStarted += 1
    if (ppStarted === 1) bothRunning = true
    await centringGate
    return {
      status: { u: 35, l: 35, h: 1.2, cal: true, estop: false },
      atClosedIdle: true,
    }
  })
  __setTestEnsurePickPlaceReady(async () => {
    ppStarted += 1
    if (centringStarted === 1) bothRunning = true
    await ppGate
    return {
      status: { positionA: 0.5, homedA: true, homedB: true },
      returnPositionMm: 0.5,
    }
  })

  const runPromise = prepareProductionRun(makeEcm(), { requireButton: false, source: 'hmi' })
  // Let both stubs start before releasing.
  await new Promise((r) => setImmediate(r))
  assert.equal(centringStarted, 1)
  assert.equal(ppStarted, 1)
  assert.equal(bothRunning, true)
  centringRelease()
  ppRelease()

  const ctx = await runPromise
  assert.ok(ctx.centringReady)
  assert.ok(ctx.pickPlaceReady)
  assert.equal(ctx.centringReady.atClosedIdle, true)
  assert.equal(ctx.pickPlaceReady.returnPositionMm, 0.5)
})

test('prepareProductionRun skips centring TCP when PRODUCTION_SKIP_CENTRING=1', async () => {
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  let centringCalls = 0
  let ppCalls = 0
  __setTestEnsureCentringReady(async () => {
    centringCalls += 1
    return { status: {} }
  })
  __setTestEnsurePickPlaceReady(async () => {
    ppCalls += 1
    return { status: { positionA: 0.5 }, returnPositionMm: 0.5 }
  })

  const ctx = await prepareProductionRun(makeEcm(), { requireButton: false, source: 'hmi' })
  assert.equal(centringCalls, 0)
  assert.equal(ppCalls, 1)
  assert.equal(ctx.centringReady, null)
  assert.ok(ctx.pickPlaceReady)
})

test('prepareProductionRun skips pick-place TCP when PRODUCTION_SKIP_PICK_PLACE=1 and centring skipped', async () => {
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  process.env.PRODUCTION_SKIP_PICK_PLACE = '1'
  let centringCalls = 0
  let ppCalls = 0
  __setTestEnsureCentringReady(async () => {
    centringCalls += 1
    return { status: {} }
  })
  __setTestEnsurePickPlaceReady(async () => {
    ppCalls += 1
    return { status: {} }
  })

  const ctx = await prepareProductionRun(makeEcm(), { requireButton: false, source: 'hmi' })
  assert.equal(centringCalls, 0)
  assert.equal(ppCalls, 0)
  assert.equal(ctx.centringReady, null)
  assert.equal(ctx.pickPlaceReady, null)
})

test('prepareProductionRun fails fast when either slave TCP preflight rejects', async () => {
  __setTestEnsureCentringReady(async () => {
    throw new Error('Centring not ready: cal=0')
  })
  __setTestEnsurePickPlaceReady(async () => ({
    status: { positionA: 0.5 },
    returnPositionMm: 0.5,
  }))

  await assert.rejects(
    () => prepareProductionRun(makeEcm(), { requireButton: false, source: 'hmi' }),
    /Centring not ready: cal=0/,
  )
})
