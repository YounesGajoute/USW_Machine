/**
 * Production sequence timing — persisted via SettingsService (domain `production_sequence`).
 */
import { getDbPath } from './db.mjs'
import { tryGetSettingsService } from './settings/settingsBridge.mjs'

export const DEFAULT_PRODUCTION_SEQUENCE_CONFIG = {
  delayAfterClampCloseMs: 1000,
  delayAfterLeverUpMs: 1000,
  delayAfterPpClampCloseMs: 1000,
  delayAfterClampOpenMs: 1000,
  delayAfterLeverDownMs: 1000,
  delayAfterPickClampOpenMs: 1000,
  movePositionMm: 320,
  movePositionEvoMm: 320,
  armDelayBeforeMs: 0,
  armPulseMs: 500,
  armDelayAfterMs: 0,
  moveSpeedMmS: 0,
  twoHandMode: 'sequential',
  twoHandWindowMs: 500,
}

/**
 * `twoHandMode` / `twoHandWindowMs` remain in SQLite for backward compatibility only.
 * Runtime panel behaviour uses `PANEL_TWO_HAND_MODE` in `.env`
 * (`sequential` | `single` — see `getPanelTwoHandMode` in panelModes.mjs).
 */

const DELAY_MS_MIN = 0
const DELAY_MS_MAX = 60_000
const MOVE_POSITION_MM_MIN = 0
const MOVE_POSITION_MM_MAX = 2000
const MOVE_SPEED_MM_S_MAX = 5000
const TWO_HAND_WINDOW_MS_MAX = 5000

/** Panel two-hand start gesture modes (legacy SQLite; runtime uses .env). */
export const TWO_HAND_MODES = Object.freeze(['sequential', 'single'])

function parseTwoHandMode(value) {
  const mode = String(value ?? '').toLowerCase()
  // Map removed "simultaneous" to sequential for old DB rows.
  if (mode === 'simultaneous') return 'sequential'
  return TWO_HAND_MODES.includes(mode) ? mode : DEFAULT_PRODUCTION_SEQUENCE_CONFIG.twoHandMode
}

function parseTwoHandWindowMs(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > TWO_HAND_WINDOW_MS_MAX) {
    return DEFAULT_PRODUCTION_SEQUENCE_CONFIG.twoHandWindowMs
  }
  return Math.round(n)
}

function parseDelayMs(value, field) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < DELAY_MS_MIN || n > DELAY_MS_MAX) {
    throw new Error(`${field} must be ${DELAY_MS_MIN}–${DELAY_MS_MAX} ms`)
  }
  return Math.round(n)
}

function parseMovePositionMm(value, field) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < MOVE_POSITION_MM_MIN || n > MOVE_POSITION_MM_MAX) {
    throw new Error(`${field} must be ${MOVE_POSITION_MM_MIN}–${MOVE_POSITION_MM_MAX}`)
  }
  return n
}

export function validateProductionSequenceConfig(raw) {
  const rawObj = raw && typeof raw === 'object' ? raw : {}
  const out = { ...DEFAULT_PRODUCTION_SEQUENCE_CONFIG, ...rawObj }
  const moveSpeed = Number(out.moveSpeedMmS)
  const movePositionMm = parseMovePositionMm(out.movePositionMm, 'movePositionMm')
  return {
    delayAfterClampCloseMs: parseDelayMs(out.delayAfterClampCloseMs, 'delayAfterClampCloseMs'),
    delayAfterLeverUpMs: parseDelayMs(out.delayAfterLeverUpMs, 'delayAfterLeverUpMs'),
    delayAfterPpClampCloseMs: parseDelayMs(out.delayAfterPpClampCloseMs, 'delayAfterPpClampCloseMs'),
    delayAfterClampOpenMs: parseDelayMs(out.delayAfterClampOpenMs, 'delayAfterClampOpenMs'),
    delayAfterLeverDownMs: parseDelayMs(out.delayAfterLeverDownMs, 'delayAfterLeverDownMs'),
    delayAfterPickClampOpenMs: parseDelayMs(out.delayAfterPickClampOpenMs, 'delayAfterPickClampOpenMs'),
    movePositionMm,
    movePositionEvoMm: parseMovePositionMm(
      rawObj.movePositionEvoMm != null ? rawObj.movePositionEvoMm : movePositionMm,
      'movePositionEvoMm',
    ),
    armDelayBeforeMs: parseDelayMs(out.armDelayBeforeMs, 'armDelayBeforeMs'),
    armPulseMs: parseDelayMs(out.armPulseMs, 'armPulseMs'),
    armDelayAfterMs: parseDelayMs(out.armDelayAfterMs, 'armDelayAfterMs'),
    moveSpeedMmS:
      Number.isFinite(moveSpeed) && moveSpeed >= 0 && moveSpeed <= MOVE_SPEED_MM_S_MAX
        ? moveSpeed
        : DEFAULT_PRODUCTION_SEQUENCE_CONFIG.moveSpeedMmS,
    twoHandMode: parseTwoHandMode(out.twoHandMode),
    twoHandWindowMs: parseTwoHandWindowMs(out.twoHandWindowMs),
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
    const svc = tryGetSettingsService()
    if (svc) return svc.getDomainDocument('production_sequence').data
    const settings = readSettingsJson(db)
    return normalizeProductionSequenceConfig(settings.production_sequence_config)
  }

  function save(config) {
    const next = validateProductionSequenceConfig(config)
    const svc = tryGetSettingsService()
    if (svc) {
      return svc.patchDomain('production_sequence', next, {
        actorUsername: 'production_sequence_store',
      }).data
    }
    const settings = readSettingsJson(db)
    writeSettingsJson(db, { ...settings, production_sequence_config: next })
    return { ...next }
  }

  function storagePath() {
    return `${getDbPath()} → settings_domain:production_sequence`
  }

  return { load, save, storagePath }
}
