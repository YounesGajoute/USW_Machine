import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  isCentringAtGapMm,
  noteAdvancedHPreReady,
  getAdvancedHPreReady,
  clearAdvancedHPreReady,
  applyHPreAfterCentringHoming,
  __setCentringAdvancedGapTestDeps,
  __clearCentringAdvancedGapTestDeps,
} from './centringAdvancedGap.mjs'
import { initProductionContext } from './productionContext.mjs'
import { refreshAllShrinkTubeDerived } from './centringDerivedRecipe.mjs'

const REF_SETUP = 'REF-SETUP'
const TUBE_SETUP = 'TUBE-SETUP'
const H_PRE = 12

function createSetupTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE product_references (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      shrink_tube_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
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
      diameter_closing_gap_mm REAL NOT NULL DEFAULT 0,
      diameter_opening_gap_mm REAL NOT NULL DEFAULT 0,
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
  `)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO shrink_tubes (
      id, name, diameter_mm, length_mm, diameter_closing_gap_mm, diameter_opening_gap_mm,
      centring_mechanism, is_active, created_at, updated_at
    ) VALUES (?, 'Setup tube', 5, 100, ?, 25, 'upper', 1, ?, ?)`,
  ).run(TUBE_SETUP, H_PRE, now, now)
  db.prepare(
    `INSERT INTO product_references (id, name, shrink_tube_id, created_at, updated_at)
     VALUES (?, 'SetupRef', ?, ?, ?)`,
  ).run(REF_SETUP, TUBE_SETUP, now, now)
  refreshAllShrinkTubeDerived(db, {
    centering_input_start_mm: 50,
    centering_input_offset_mm: 0,
    centring_frame_config: {
      sideA_guide_spacing_mm: 300,
      sideB_guide_spacing_mm: 55,
      module_length_mm: 200,
    },
  })
  return db
}

test('isCentringAtGapMm accepts STATUS within tolerance', () => {
  assert.equal(isCentringAtGapMm({ cal: 1, estop: 0, busy: 0, h: 12.2, u: -40, l: 35 }, 12), true)
  assert.equal(isCentringAtGapMm({ cal: 1, estop: 0, busy: 0, h: 14, u: -40, l: 35 }, 12), false)
  assert.equal(isCentringAtGapMm({ cal: 0, estop: 0, busy: 0, h: 12, u: -40, l: 35 }, 12), false)
  assert.equal(isCentringAtGapMm(null, 12), false)
})

test('advanced h_pre ready note stores and clears', () => {
  clearAdvancedHPreReady()
  assert.equal(getAdvancedHPreReady(), null)
  noteAdvancedHPreReady('REF-1', 15.5)
  assert.deepEqual(getAdvancedHPreReady(), { referenceId: 'REF-1', hPreMm: 15.5 })
  clearAdvancedHPreReady()
  assert.equal(getAdvancedHPreReady(), null)
})

test('applyHPreAfterCentringHoming skips without reference', async () => {
  const r = await applyHPreAfterCentringHoming(null)
  assert.equal(r.skipped, true)
  assert.equal(r.reason, 'no_reference')
})

test('applyOrAssertHPre skips MOVE when already at h_pre', async () => {
  const { applyOrAssertHPre } = await import('./centringAdvancedGap.mjs')
  let moveCalls = 0
  __setCentringAdvancedGapTestDeps({
    connectWithRetry: async () => {},
    centringStatus: async () => ({
      u: -50,
      l: 35,
      h: H_PRE,
      cal: true,
      estop: false,
      busy: false,
    }),
    applyShrinkTubeGapPhase: async () => {
      moveCalls += 1
      return { phase: 'pre', moveCommand: 'MOVE_UPPERMM' }
    },
  })
  try {
    const r = await applyOrAssertHPre({
      h_pre_mm: H_PRE,
      centring_axis: 'upper',
    })
    assert.equal(r.skipped, true)
    assert.equal(r.alreadyAtHPre, true)
    assert.equal(moveCalls, 0)
  } finally {
    __clearCentringAdvancedGapTestDeps()
  }
})

test('applyHPreAfterCentringHoming applies for loaded reference', async () => {
  const prevDb = process.env.MAIN_DATA_DB_PATH
  const db = createSetupTestDb()
  process.env.MAIN_DATA_DB_PATH = ':memory:'
  initProductionContext(db, () => ({
    centering_input_start_mm: 50,
    centring_frame_config: {
      sideA_guide_spacing_mm: 300,
      sideB_guide_spacing_mm: 55,
      module_length_mm: 200,
    },
  }))
  let parkCalls = 0
  let moveCalls = 0
  __setCentringAdvancedGapTestDeps({
    connectWithRetry: async () => {},
    centringStatus: async () => ({
      u: 35,
      l: 35,
      h: 1.2,
      cal: true,
      estop: false,
      busy: false,
    }),
    prepareCentringProductionPosture: async () => {
      parkCalls += 1
      return { parked: true, status: { u: -80, l: 35, cal: true } }
    },
    applyShrinkTubeGapPhase: async () => {
      moveCalls += 1
      return { phase: 'pre', moveCommand: 'MOVE_UPPERMM' }
    },
    readCentringStatusAfterMove: async (_p, gap) => ({
      u: -50,
      l: 35,
      h: gap,
      cal: true,
      estop: false,
      busy: false,
      moveEnd: 'ok',
    }),
    isProductionActive: () => false,
  })
  try {
    clearAdvancedHPreReady()
    const phases = []
    const r = await applyHPreAfterCentringHoming(REF_SETUP, {
      onPhase: () => {
        phases.push('centring_h_pre')
      },
    })
    assert.equal(r.ok, true)
    assert.equal(r.h_pre_mm, H_PRE)
    assert.equal(r.alreadyAtHPre, false)
    assert.equal(parkCalls, 0, 'h_pre apply must not park')
    assert.equal(moveCalls, 1, 'h_pre apply must MOVE when not at gap')
    assert.equal(phases.join(','), 'centring_h_pre')
    assert.deepEqual(getAdvancedHPreReady(), { referenceId: REF_SETUP, hPreMm: H_PRE })
  } finally {
    __clearCentringAdvancedGapTestDeps()
    clearAdvancedHPreReady()
    db.close()
    if (prevDb === undefined) delete process.env.MAIN_DATA_DB_PATH
    else process.env.MAIN_DATA_DB_PATH = prevDb
  }
})
