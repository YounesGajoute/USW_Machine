/**
 * Storage round-trip: production_sequence_config must persist to SQLite and
 * reload exactly when the application starts up (new store instance, same DB).
 * Uses in-memory SQLite — no EtherCAT / hardware.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  createProductionSequenceConfigStore,
  DEFAULT_PRODUCTION_SEQUENCE_CONFIG,
} from './productionSequenceConfigStore.mjs'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_settings (id INTEGER PRIMARY KEY, json TEXT NOT NULL DEFAULT '{}');
    INSERT INTO system_settings (id, json) VALUES (1, '{}');
  `)
  return db
}

test('production_sequence_config: every parameter persists to SQLite and reloads on startup', () => {
  const db = makeDb()
  const store = createProductionSequenceConfigStore(db)

  const cfg = {
    ...DEFAULT_PRODUCTION_SEQUENCE_CONFIG,
    delayAfterClampCloseMs: 1200,
    delayAfterLeverUpMs: 1300,
    delayAfterPpClampCloseMs: 1400,
    delayAfterClampOpenMs: 1500,
    delayAfterLeverDownMs: 1600,
    delayAfterPickClampOpenMs: 1700,
    movePositionMm: 0, // boundary value must round-trip (min = 0)
    movePositionEvoMm: 415,
    armDelayBeforeMs: 250,
    armPulseMs: 750,
    armDelayAfterMs: 125,
    moveSpeedMmS: 90,
  }

  const saved = store.save(cfg)
  assert.equal(saved.movePositionMm, 0)
  assert.equal(saved.movePositionEvoMm, 415)

  // The values must actually be written into the SQLite row (not just memory).
  const rawJson = db.prepare('SELECT json FROM system_settings WHERE id = 1').get().json
  const rawCfg = JSON.parse(rawJson).production_sequence_config
  assert.equal(rawCfg.movePositionMm, 0)
  assert.equal(rawCfg.movePositionEvoMm, 415)
  assert.equal(rawCfg.armDelayBeforeMs, 250)
  assert.equal(rawCfg.armPulseMs, 750)
  assert.equal(rawCfg.armDelayAfterMs, 125)

  // Simulate an application restart: a brand-new store over the same DB (this is
  // exactly what initProductionSequenceConfig(db) does at boot) must reload all
  // parameters identically.
  const freshStore = createProductionSequenceConfigStore(db)
  const loaded = freshStore.load()
  assert.deepEqual(loaded, saved)
  db.close()
})

test('production_sequence_config: two-hand mode + window persist and invalid values fall back', () => {
  const db = makeDb()
  const store = createProductionSequenceConfigStore(db)

  const saved = store.save({
    ...DEFAULT_PRODUCTION_SEQUENCE_CONFIG,
    twoHandMode: 'sequential',
    twoHandWindowMs: 750,
  })
  assert.equal(saved.twoHandMode, 'sequential')
  assert.equal(saved.twoHandWindowMs, 750)

  const reloaded = createProductionSequenceConfigStore(db).load()
  assert.equal(reloaded.twoHandMode, 'sequential')
  assert.equal(reloaded.twoHandWindowMs, 750)

  // Invalid mode/window must fall back to defaults (no throw).
  const fallback = store.save({
    ...DEFAULT_PRODUCTION_SEQUENCE_CONFIG,
    twoHandMode: 'bogus',
    twoHandWindowMs: 999999,
  })
  assert.equal(fallback.twoHandMode, DEFAULT_PRODUCTION_SEQUENCE_CONFIG.twoHandMode)
  assert.equal(fallback.twoHandWindowMs, DEFAULT_PRODUCTION_SEQUENCE_CONFIG.twoHandWindowMs)
  db.close()
})

test('production_sequence_config: legacy row without movePositionEvoMm migrates from movePositionMm on load', () => {
  const db = makeDb()
  db.prepare('UPDATE system_settings SET json = ? WHERE id = 1').run(
    JSON.stringify({ production_sequence_config: { movePositionMm: 275 } }),
  )

  const store = createProductionSequenceConfigStore(db)
  const loaded = store.load()

  assert.equal(loaded.movePositionMm, 275)
  assert.equal(loaded.movePositionEvoMm, 275)
  assert.equal(loaded.armPulseMs, DEFAULT_PRODUCTION_SEQUENCE_CONFIG.armPulseMs)
  db.close()
})
