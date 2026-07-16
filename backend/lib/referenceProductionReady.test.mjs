import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  reconcileReferenceProductionReady,
  getReferenceProductionReadyBlockReason,
  isCentringSetupRecoverableBlock,
} from './referenceProductionReady.mjs'
import {
  setLoadedReference,
  clearLoadedReference,
  getMachineInitStatus,
  markReferenceInitialized,
  resetMachineInitialization,
  __setMachineInitStateForTest,
} from './machineInit.mjs'
import {
  onEtherCATConnected,
  syncIdleInitFromReference,
  getLifecycleState,
  LIFECYCLE_STATE,
} from './machineLifecycle.mjs'
import { initProductionContext } from './productionContext.mjs'
import { initProductionVisionInspection } from './productionVisionInspection.mjs'
import { canStartProduction } from './productionSequence.mjs'
import { __setCachedCentringStatusForTest } from './tcpSubsystemHealth.mjs'

const REF_A = 'REF-AUTO-A'
const REF_B = 'REF-AUTO-B'
const TUBE_ID = 'TUBE-AUTO'

function createTestDb() {
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
      diameter_opening_gap_mm REAL NOT NULL DEFAULT 4.5,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE system_settings (id INTEGER PRIMARY KEY, json TEXT NOT NULL DEFAULT '{}');
    INSERT INTO system_settings (id, json) VALUES (1, '{}');
  `)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO shrink_tubes (id, name, diameter_mm, length_mm, is_active, created_at, updated_at)
     VALUES (?, 'Auto tube', 5, 20, 1, ?, ?)`,
  ).run(TUBE_ID, now, now)
  for (const refId of [REF_A, REF_B]) {
    db.prepare(
      `INSERT INTO product_references (id, name, shrink_tube_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(refId, refId, TUBE_ID, now, now)
  }
  return db
}

function readSystemSettings() {
  return {
    centring_frame_config: {
      sideA_guide_spacing_mm: 300,
      sideB_guide_spacing_mm: 55,
      module_length_mm: 200,
    },
    centering_input_start_mm: 0,
    centering_input_offset_mm: 0,
    machine_model: null,
  }
}

function seedCentringTravelIdle() {
  __setCachedCentringStatusForTest({
    u: 35,
    l: 35,
    cal: true,
    estop: false,
    fault: false,
    estop: false,
    busy: false,
    homing: false,
    asyncCmd: 0,
  })
}

beforeEach(() => {
  delete process.env.CLAMP_TRIGGER_MODE
  process.env.CLAMP_TRIGGER_MODE = 'off'
  process.env.PANEL_TWO_HAND_MODE = 'single'
  process.env.PRODUCTION_SKIP_VISION = '1'
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  process.env.PRODUCTION_SKIP_PICK_PLACE = '1'
  clearLoadedReference()
  onEtherCATConnected()
  const db = createTestDb()
  initProductionContext(db, readSystemSettings)
  initProductionVisionInspection(db, readSystemSettings)
  seedCentringTravelIdle()
})

afterEach(() => {
  delete process.env.CLAMP_TRIGGER_MODE
  delete process.env.PANEL_TWO_HAND_MODE
  delete process.env.PRODUCTION_SKIP_VISION
  delete process.env.PRODUCTION_SKIP_CENTRING
  delete process.env.PRODUCTION_SKIP_PICK_PLACE
})

test('reconcileReferenceProductionReady marks reference when machine is homed', () => {
  __setMachineInitStateForTest({ referenceId: REF_A, initialized: true })
  resetMachineInitialization()
  assert.equal(getMachineInitStatus().initialized, false)

  const result = reconcileReferenceProductionReady({
    referenceId: REF_A,
    markReferenceInitialized,
    syncIdleInitFromReference,
    getMachineInitStatus,
  })

  assert.equal(result.marked, true)
  assert.equal(result.blockReason, null)
  assert.equal(getMachineInitStatus().initialized, true)
  assert.equal(canStartProduction(), true)
})

test('setLoadedReference on homed machine requires scan h_pre or Initialization before production', () => {
  __setMachineInitStateForTest({ referenceId: REF_A, initialized: true })
  assert.equal(canStartProduction(), true)

  setLoadedReference(REF_B)

  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  assert.equal(getMachineInitStatus().referenceId, REF_B)
  assert.equal(getMachineInitStatus().initialized, false)
  assert.equal(canStartProduction(), false)
})

test('setLoadedReference does not mark when machine is not homed', () => {
  setLoadedReference(REF_A)
  assert.equal(getMachineInitStatus().initialized, false)
  const result = reconcileReferenceProductionReady({
    referenceId: REF_A,
    markReferenceInitialized,
    syncIdleInitFromReference,
    getMachineInitStatus,
  })
  assert.equal(result.marked, false)
  assert.match(result.blockReason, /not initialized/i)
  assert.equal(canStartProduction(), false)
})

test('isCentringSetupRecoverableBlock detects centring-only recovery', () => {
  assert.equal(isCentringSetupRecoverableBlock('Centring not at closed idle (u=0 l=90)'), true)
  assert.equal(
    isCentringSetupRecoverableBlock('Centring not at closed idle (u=-80 l=35) — press Recover first'),
    true,
  )
  assert.equal(isCentringSetupRecoverableBlock('Vision program missing'), false)
})
