/**
 * Pick & place motion config — persisted in SQLite `system_settings.pick_place_config`.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDbPath } from './db.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DEFAULT_PICK_PLACE_CONFIG = {
  movementSpeedMmS: 80,
  homingSpeedMmS: 80,
  backoffMmA: 0.5,
  backoffMmB: 0.8,
  referenceAxis: 'a',
}

const STEP_MAX_HZ = 40_000
const FIRMWARE_STEPS_PER_MM = 10 / 3
const HOME_BACKOFF_MM_MIN = 0.01
const HOME_BACKOFF_MM_MAX = 50

export function validatePickPlaceConfig(raw) {
  const out = { ...DEFAULT_PICK_PLACE_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) }
  const move = Number(out.movementSpeedMmS)
  const home = Number(out.homingSpeedMmS)
  const bkA = Number(out.backoffMmA)
  const bkB = Number(out.backoffMmB)
  const ref = String(out.referenceAxis || 'a').toLowerCase()
  const maxSpd = STEP_MAX_HZ / FIRMWARE_STEPS_PER_MM

  if (!Number.isFinite(move) || move <= 0 || move > maxSpd) {
    throw new Error(`movementSpeedMmS must be 0.01–${maxSpd}`)
  }
  if (!Number.isFinite(home) || home <= 0 || home > maxSpd) {
    throw new Error(`homingSpeedMmS must be 0.01–${maxSpd}`)
  }
  if (!Number.isFinite(bkA) || bkA < HOME_BACKOFF_MM_MIN || bkA > HOME_BACKOFF_MM_MAX) {
    throw new Error(`backoffMmA must be ${HOME_BACKOFF_MM_MIN}–${HOME_BACKOFF_MM_MAX}`)
  }
  if (!Number.isFinite(bkB) || bkB < HOME_BACKOFF_MM_MIN || bkB > HOME_BACKOFF_MM_MAX) {
    throw new Error(`backoffMmB must be ${HOME_BACKOFF_MM_MIN}–${HOME_BACKOFF_MM_MAX}`)
  }
  if (ref !== 'a' && ref !== 'b') throw new Error('referenceAxis must be a or b')

  return {
    movementSpeedMmS: move,
    homingSpeedMmS: home,
    backoffMmA: bkA,
    backoffMmB: bkB,
    referenceAxis: ref,
  }
}

export function normalizePickPlaceConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PICK_PLACE_CONFIG }
  }
  try {
    return validatePickPlaceConfig(raw)
  } catch {
    return { ...DEFAULT_PICK_PLACE_CONFIG }
  }
}

export function mergePickPlaceConfigPatch(currentRaw, patch) {
  const cur = normalizePickPlaceConfig(currentRaw)
  if (!patch || typeof patch !== 'object') return cur
  return validatePickPlaceConfig({ ...cur, ...patch })
}

function readSettingsJson(db) {
  const row = db.prepare('SELECT json FROM system_settings WHERE id = 1').get()
  try {
    return JSON.parse(row?.json || '{}')
  } catch {
    return {}
  }
}

function writeSettingsJson(db, settings) {
  db.prepare('UPDATE system_settings SET json = ? WHERE id = 1').run(JSON.stringify(settings))
}

export function createPickPlaceConfigStore(db) {
  function load() {
    const settings = readSettingsJson(db)
    return normalizePickPlaceConfig(settings.pick_place_config)
  }

  function save(config) {
    const next = validatePickPlaceConfig(config)
    const settings = readSettingsJson(db)
    writeSettingsJson(db, { ...settings, pick_place_config: next })
    return { ...next }
  }

  function migrateFromJson() {
    const settings = readSettingsJson(db)
    if (settings.pick_place_config && typeof settings.pick_place_config === 'object') {
      return false
    }
    const jsonPath = process.env.PICK_PLACE_CONFIG_PATH
      || path.join(__dirname, '..', 'data', 'pick_place_config.json')
    if (!fs.existsSync(jsonPath)) return false
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      save(raw)
      console.log(`[pick-place] migrated config from ${jsonPath} → SQLite (system_settings.pick_place_config)`)
      return true
    } catch (err) {
      console.warn(`[pick-place] JSON migration skipped (${jsonPath}): ${err.message}`)
      return false
    }
  }

  function storagePath() {
    return `${getDbPath()} → system_settings.pick_place_config`
  }

  return { load, save, migrateFromJson, storagePath }
}
