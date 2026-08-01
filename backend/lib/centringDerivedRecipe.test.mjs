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

test('changing centering_input_start_mm updates all tubes centering_output_mm', () => {
  const db = makeDb()
  insertTube(db, 'T1', { length_mm: 61 })
  insertTube(db, 'T2', { length_mm: 80 })
  refreshAllShrinkTubeDerived(db, SETTINGS)
  const before = db
    .prepare('SELECT id, centering_output_mm, centering_travel_mm FROM shrink_tubes ORDER BY id')
    .all()

  const nextSettings = { ...SETTINGS, centering_input_start_mm: 160 }
  refreshAllShrinkTubeDerived(db, nextSettings)
  const after = db
    .prepare('SELECT id, centering_output_mm, centering_travel_mm FROM shrink_tubes ORDER BY id')
    .all()

  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].centering_travel_mm, before[i].centering_travel_mm)
    assert.equal(
      after[i].centering_output_mm,
      nextSettings.centering_input_start_mm + after[i].centering_travel_mm,
    )
    assert.equal(after[i].centering_output_mm, before[i].centering_output_mm + 10)
  }
})

test('changing tube length_mm updates that tube centering_travel_mm and centering_output_mm', () => {
  const db = makeDb()
  insertTube(db, 'T1', { length_mm: 61 })
  const { columns: before } = refreshShrinkTubeDerived(db, 'T1', SETTINGS)

  db.prepare('UPDATE shrink_tubes SET length_mm = ? WHERE id = ?').run(80, 'T1')
  const { columns: after } = refreshShrinkTubeDerived(db, 'T1', SETTINGS)
  const row = db.prepare('SELECT * FROM shrink_tubes WHERE id = ?').get('T1')

  assert.notEqual(after.centering_travel_mm, before.centering_travel_mm)
  assert.notEqual(after.centering_output_mm, before.centering_output_mm)
  assert.equal(row.centering_travel_mm, after.centering_travel_mm)
  assert.equal(row.centering_output_mm, after.centering_output_mm)
  assert.equal(
    row.centering_output_mm,
    SETTINGS.centering_input_start_mm + row.centering_travel_mm,
  )
})

test('changing centring_length_tolerance_mm updates centering_travel_mm', () => {
  const db = makeDb()
  insertTube(db, 'T1', { length_mm: 61, centring_length_tolerance_mm: 0 })
  const { columns: before } = refreshShrinkTubeDerived(db, 'T1', SETTINGS)

  db.prepare('UPDATE shrink_tubes SET centring_length_tolerance_mm = ? WHERE id = ?').run(5, 'T1')
  const { columns: after } = refreshShrinkTubeDerived(db, 'T1', SETTINGS)
  const row = db.prepare('SELECT * FROM shrink_tubes WHERE id = ?').get('T1')

  assert.notEqual(after.centering_travel_mm, before.centering_travel_mm)
  assert.equal(row.centering_travel_mm, after.centering_travel_mm)
  assert.equal(row.l_eff_mm, 66)
  assert.equal(
    row.centering_output_mm,
    SETTINGS.centering_input_start_mm + row.centering_travel_mm,
  )
})

test('changing centring_frame_config updates all tubes centering_travel_mm', () => {
  const db = makeDb()
  insertTube(db, 'T1', { length_mm: 61 })
  insertTube(db, 'T2', { length_mm: 80 })
  refreshAllShrinkTubeDerived(db, SETTINGS)
  const before = db
    .prepare('SELECT id, centering_travel_mm, centering_output_mm FROM shrink_tubes ORDER BY id')
    .all()

  const nextSettings = {
    ...SETTINGS,
    centring_frame_config: {
      sideA_guide_spacing_mm: 300,
      sideB_guide_spacing_mm: 55,
      module_length_mm: 250,
    },
  }
  refreshAllShrinkTubeDerived(db, nextSettings)
  const after = db
    .prepare('SELECT id, centering_travel_mm, centering_output_mm FROM shrink_tubes ORDER BY id')
    .all()

  for (let i = 0; i < before.length; i++) {
    assert.notEqual(after[i].centering_travel_mm, before[i].centering_travel_mm)
    assert.equal(
      after[i].centering_output_mm,
      SETTINGS.centering_input_start_mm + after[i].centering_travel_mm,
    )
  }
})

test('invalid geometry update in TX rolls back inputs and derived columns', () => {
  const db = makeDb()
  insertTube(db, 'T1', { length_mm: 61 })
  refreshShrinkTubeDerived(db, 'T1', SETTINGS)
  const snapshot = db.prepare('SELECT * FROM shrink_tubes WHERE id = ?').get('T1')

  assert.throws(
    () => {
      db.transaction(() => {
        db.prepare('UPDATE shrink_tubes SET length_mm = ? WHERE id = ?').run(400, 'T1')
        refreshShrinkTubeDerived(db, 'T1', SETTINGS)
      })()
    },
    /L_eff|outside/,
  )

  const after = db.prepare('SELECT * FROM shrink_tubes WHERE id = ?').get('T1')
  assert.equal(after.length_mm, snapshot.length_mm)
  assert.equal(after.centering_output_mm, snapshot.centering_output_mm)
  assert.equal(after.centering_travel_mm, snapshot.centering_travel_mm)
  assert.equal(after.l_eff_mm, snapshot.l_eff_mm)
})
