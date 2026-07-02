/**
 * Pick & place config: maxPositionMm (stepper soft travel limit) validation and
 * round-trip persistence. Uses in-memory SQLite — no hardware.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  createPickPlaceConfigStore,
  validatePickPlaceConfig,
  DEFAULT_PICK_PLACE_CONFIG,
} from './pickPlaceConfigStore.mjs'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_settings (id INTEGER PRIMARY KEY, json TEXT NOT NULL DEFAULT '{}');
    INSERT INTO system_settings (id, json) VALUES (1, '{}');
  `)
  return db
}

test('pick_place_config: maxPositionMm defaults to 470', () => {
  assert.equal(DEFAULT_PICK_PLACE_CONFIG.maxPositionMm, 470)
  const cfg = validatePickPlaceConfig({})
  assert.equal(cfg.maxPositionMm, 470)
})

test('pick_place_config: maxPositionMm persists and reloads', () => {
  const db = makeDb()
  const store = createPickPlaceConfigStore(db)
  const saved = store.save({ ...DEFAULT_PICK_PLACE_CONFIG, maxPositionMm: 400 })
  assert.equal(saved.maxPositionMm, 400)
  assert.equal(createPickPlaceConfigStore(db).load().maxPositionMm, 400)
  db.close()
})

test('pick_place_config: maxPositionMm must exceed backoff and stay within the hard ceiling', () => {
  assert.throws(() => validatePickPlaceConfig({ maxPositionMm: 0.1, backoffMmA: 0.5 }))
  assert.throws(() => validatePickPlaceConfig({ maxPositionMm: 5000 }))
  assert.throws(() => validatePickPlaceConfig({ maxPositionMm: 'nope' }))
})
