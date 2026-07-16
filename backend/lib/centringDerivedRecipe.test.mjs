import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  computeDerivedForTube,
  refreshShrinkTubeDerived,
  refreshAllShrinkTubeDerived,
  assertAllShrinkTubesResolvable,
  requirePersistedCentringRecipe,
  hasCompleteDerivedGeometry,
  centringSettingsAffectDerived,
} from './centringDerivedRecipe.mjs'
import { resolveShrinkTubeCentring } from './centring_frame_model.js'

const SETTINGS = {
  centering_input_start_mm: 150,
  centering_input_offset_mm: 2,
  centring_frame_config: {
    sideA_guide_spacing_mm: 300,
    sideB_guide_spacing_mm: 55,
    module_length_mm: 200,
  },
}

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
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
  return db
}

function insertTube(db, id, overrides = {}) {
  const now = new Date().toISOString()
  const row = {
    id,
    name: id,
    diameter_mm: 5,
    length_mm: 61,
    centring_length_tolerance_mm: 0,
    centring_mechanism: 'upper',
    diameter_closing_gap_mm: 12,
    diameter_opening_gap_mm: 25,
    ...overrides,
  }
  db.prepare(
    `INSERT INTO shrink_tubes (
      id, name, diameter_mm, length_mm, centring_length_tolerance_mm, centring_mechanism,
      diameter_closing_gap_mm, diameter_opening_gap_mm, is_active, created_at, updated_at
    ) VALUES (@id, @name, @diameter_mm, @length_mm, @centring_length_tolerance_mm, @centring_mechanism,
      @diameter_closing_gap_mm, @diameter_opening_gap_mm, 1, ?, ?)`,
  ).run(row, now, now)
  return row
}

test('computeDerivedForTube matches resolveShrinkTubeCentring', () => {
  const tube = {
    length_mm: 61,
    centring_length_tolerance_mm: 0,
    diameter_closing_gap_mm: 12,
    diameter_opening_gap_mm: 25,
    centring_mechanism: 'upper',
  }
  const { resolved, columns } = computeDerivedForTube(tube, SETTINGS)
  const expected = resolveShrinkTubeCentring(tube, SETTINGS, SETTINGS.centring_frame_config)
  assert.equal(columns.h_pre_mm, expected.h_pre_mm)
  assert.equal(columns.h_post_mm, expected.h_post_mm)
  assert.equal(columns.l_eff_mm, expected.L_eff_mm)
  assert.equal(columns.centering_travel_mm, expected.centering_travel_mm)
  assert.equal(columns.centering_input_mm, expected.centering_input_mm)
  assert.equal(columns.centering_output_mm, expected.centering_output_mm)
  assert.equal(columns.centering_move_travel_mm, expected.centering_move_travel_mm)
  assert.equal(columns.centring_axis, expected.centring_axis)
  assert.equal(resolved.from_db, undefined)
  assert.ok(hasCompleteDerivedGeometry(columns))
})

test('refreshShrinkTubeDerived persists centering_output_mm and aliases', () => {
  const db = makeDb()
  insertTube(db, 'T1')
  const { columns } = refreshShrinkTubeDerived(db, 'T1', SETTINGS)
  const row = db.prepare('SELECT * FROM shrink_tubes WHERE id = ?').get('T1')
  assert.equal(row.centering_output_mm, columns.centering_output_mm)
  assert.equal(row.h_pre_mm, 12)
  assert.equal(row.h_post_mm, 25)
  assert.equal(row.centring_axis, 'upper')
  assert.ok(row.centring_derived_updated_at)
  const recipe = requirePersistedCentringRecipe(row, SETTINGS)
  assert.equal(recipe.from_db, true)
  assert.equal(recipe.centering_output_mm, columns.centering_output_mm)
})

test('refreshAllShrinkTubeDerived updates every tube', () => {
  const db = makeDb()
  insertTube(db, 'T1', { length_mm: 61 })
  insertTube(db, 'T2', { length_mm: 80, centring_mechanism: 'lower' })
  refreshAllShrinkTubeDerived(db, SETTINGS)
  const t1 = db.prepare('SELECT centering_output_mm, centring_axis FROM shrink_tubes WHERE id = ?').get('T1')
  const t2 = db.prepare('SELECT centering_output_mm, centring_axis FROM shrink_tubes WHERE id = ?').get('T2')
  assert.notEqual(t1.centering_output_mm, t2.centering_output_mm)
  assert.equal(t2.centring_axis, 'lower')
})

test('assertAllShrinkTubesResolvable rejects L_eff outside frame', () => {
  const db = makeDb()
  insertTube(db, 'BAD', { length_mm: 400 })
  assert.throws(
    () => assertAllShrinkTubesResolvable(db, SETTINGS),
    /cannot resolve|L_eff/,
  )
})

test('centringSettingsAffectDerived detects start/offset/frame changes', () => {
  const a = {
    centring_frame_config: SETTINGS.centring_frame_config,
    centering_input_start_mm: 150,
    centering_input_offset_mm: 0,
  }
  assert.equal(centringSettingsAffectDerived(a, a), false)
  assert.equal(
    centringSettingsAffectDerived(a, { ...a, centering_input_start_mm: 160 }),
    true,
  )
  assert.equal(
    centringSettingsAffectDerived(a, { ...a, centering_input_offset_mm: 1 }),
    true,
  )
})
