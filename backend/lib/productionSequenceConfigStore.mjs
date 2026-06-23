/**
 * Production sequence timing — persisted in SQLite `system_settings.production_sequence_config`.
 */
import { getDbPath } from './db.mjs'

export const DEFAULT_PRODUCTION_SEQUENCE_CONFIG = {
  delayAfterClampCloseMs: 1000,
  delayAfterLeverUpMs: 1000,
  delayAfterPpClampCloseMs: 1000,
  delayAfterClampOpenMs: 1000,
  delayAfterLeverDownMs: 1000,
  delayAfterPickClampOpenMs: 1000,
  movePositionMm: 320,
  moveSpeedMmS: 0,
}

const DELAY_MS_MIN = 0
const DELAY_MS_MAX = 60_000
const MOVE_POSITION_MM_MIN = 0
const MOVE_POSITION_MM_MAX = 2000
const MOVE_SPEED_MM_S_MAX = 5000

function parseDelayMs(value, field) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < DELAY_MS_MIN || n > DELAY_MS_MAX) {
    throw new Error(`${field} must be ${DELAY_MS_MIN}–${DELAY_MS_MAX} ms`)
  }
  return Math.round(n)
}

export function validateProductionSequenceConfig(raw) {
  const out = { ...DEFAULT_PRODUCTION_SEQUENCE_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) }
  const moveSpeed = Number(out.moveSpeedMmS)
  return {
    delayAfterClampCloseMs: parseDelayMs(out.delayAfterClampCloseMs, 'delayAfterClampCloseMs'),
    delayAfterLeverUpMs: parseDelayMs(out.delayAfterLeverUpMs, 'delayAfterLeverUpMs'),
    delayAfterPpClampCloseMs: parseDelayMs(out.delayAfterPpClampCloseMs, 'delayAfterPpClampCloseMs'),
    delayAfterClampOpenMs: parseDelayMs(out.delayAfterClampOpenMs, 'delayAfterClampOpenMs'),
    delayAfterLeverDownMs: parseDelayMs(out.delayAfterLeverDownMs, 'delayAfterLeverDownMs'),
    delayAfterPickClampOpenMs: parseDelayMs(out.delayAfterPickClampOpenMs, 'delayAfterPickClampOpenMs'),
    movePositionMm: (() => {
      const n = Number(out.movePositionMm)
      if (!Number.isFinite(n) || n < MOVE_POSITION_MM_MIN || n > MOVE_POSITION_MM_MAX) {
        throw new Error(`movePositionMm must be ${MOVE_POSITION_MM_MIN}–${MOVE_POSITION_MM_MAX}`)
      }
      return n
    })(),
    moveSpeedMmS:
      Number.isFinite(moveSpeed) && moveSpeed >= 0 && moveSpeed <= MOVE_SPEED_MM_S_MAX
        ? moveSpeed
        : DEFAULT_PRODUCTION_SEQUENCE_CONFIG.moveSpeedMmS,
  }
}

export function normalizeProductionSequenceConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PRODUCTION_SEQUENCE_CONFIG }
  }
  try {
    return validateProductionSequenceConfig(raw)
  } catch {
    return { ...DEFAULT_PRODUCTION_SEQUENCE_CONFIG }
  }
}

export function mergeProductionSequenceConfigPatch(currentRaw, patch) {
  const cur = normalizeProductionSequenceConfig(currentRaw)
  if (!patch || typeof patch !== 'object') return cur
  return validateProductionSequenceConfig({ ...cur, ...patch })
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

export function createProductionSequenceConfigStore(db) {
  function load() {
    const settings = readSettingsJson(db)
    return normalizeProductionSequenceConfig(settings.production_sequence_config)
  }

  function save(config) {
    const next = validateProductionSequenceConfig(config)
    const settings = readSettingsJson(db)
    writeSettingsJson(db, { ...settings, production_sequence_config: next })
    return { ...next }
  }

  function storagePath() {
    return `${getDbPath()} → system_settings.production_sequence_config`
  }

  return { load, save, storagePath }
}
