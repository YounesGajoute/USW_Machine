/**
 * Centring motion config — persisted in SQLite `system_settings.centring_config`.
 * Transport is TCP-only (Double_Actuator STATUS + SETCAL contract).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDbPath } from './db.mjs'
import { tryGetSettingsService } from './settings/settingsBridge.mjs'
import {
  DEFAULT_CENTRING_CONFIG,
  DEFAULT_CENTRING_TCP,
} from './centringMaster/centring_master.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DEFAULT_CENTRING_CONFIG_STORE = {
  transport: 'tcp',
  tcp: { ...DEFAULT_CENTRING_TCP },
  movementSpeedDegS: DEFAULT_CENTRING_CONFIG.movementSpeedDegS,
  homingSpeedDegS: DEFAULT_CENTRING_CONFIG.homingSpeedDegS,
  gapMoveSpeedDegS: DEFAULT_CENTRING_CONFIG.gapMoveSpeedDegS,
  mechOffsetMm: DEFAULT_CENTRING_CONFIG.mechOffsetMm,
  hRangeMm: { ...DEFAULT_CENTRING_CONFIG.hRangeMm },
  slaveCal: null,
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

function normalizeSlaveCal(raw) {
  if (raw == null || typeof raw !== 'object') return null
  const calId = String(raw.calId ?? '').trim()
  const hu = Number(raw.hu)
  const tu = Number(raw.tu)
  const hl = Number(raw.hl)
  const tl = Number(raw.tl)
  if (!calId || calId.length > 15) return null
  if (![hu, tu, hl, tl].every(Number.isFinite)) return null
  if (!(hu > tu) || !(hl > tl)) return null
  if ((hu - tu) < 80 || (hl - tl) < 80) return null
  const out = {
    calId,
    hu: Math.round(hu),
    tu: Math.round(tu),
    hl: Math.round(hl),
    tl: Math.round(tl),
  }
  for (const key of ['A', 'B', 'C', 'sHome', 'sTravel']) {
    if (raw[key] != null && raw[key] !== '') {
      const n = Number(raw[key])
      if (Number.isFinite(n)) out[key] = n
    }
  }
  return out
}

export function normalizeCentringConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_CENTRING_CONFIG_STORE,
      tcp: { ...DEFAULT_CENTRING_CONFIG_STORE.tcp },
      hRangeMm: { ...DEFAULT_CENTRING_CONFIG_STORE.hRangeMm },
      slaveCal: null,
    }
  }
  const hRange = raw.hRangeMm && typeof raw.hRangeMm === 'object' ? raw.hRangeMm : {}
  const tcp = raw.tcp && typeof raw.tcp === 'object' ? raw.tcp : {}
  return {
    transport: 'tcp',
    tcp: {
      host: String(tcp.host ?? DEFAULT_CENTRING_CONFIG_STORE.tcp.host),
      port: Number(tcp.port ?? DEFAULT_CENTRING_CONFIG_STORE.tcp.port),
    },
    movementSpeedDegS: Number(raw.movementSpeedDegS ?? DEFAULT_CENTRING_CONFIG_STORE.movementSpeedDegS),
    homingSpeedDegS: Number(raw.homingSpeedDegS ?? DEFAULT_CENTRING_CONFIG_STORE.homingSpeedDegS),
    gapMoveSpeedDegS: Number(raw.gapMoveSpeedDegS ?? DEFAULT_CENTRING_CONFIG_STORE.gapMoveSpeedDegS),
    mechOffsetMm: Number(raw.mechOffsetMm ?? DEFAULT_CENTRING_CONFIG_STORE.mechOffsetMm),
    hRangeMm: {
      min: Number(hRange.min ?? DEFAULT_CENTRING_CONFIG_STORE.hRangeMm.min),
      max: Number(hRange.max ?? DEFAULT_CENTRING_CONFIG_STORE.hRangeMm.max),
    },
    slaveCal: normalizeSlaveCal(raw.slaveCal),
  }
}

export function mergeCentringConfigPatch(currentRaw, patch) {
  const cur = normalizeCentringConfig(currentRaw)
  if (!patch || typeof patch !== 'object') return cur
  const hPatch = patch.hRangeMm && typeof patch.hRangeMm === 'object' ? patch.hRangeMm : {}
  const tcpPatch = patch.tcp && typeof patch.tcp === 'object' ? patch.tcp : {}
  const next = {
    ...cur,
    ...patch,
    transport: 'tcp',
    tcp: { ...cur.tcp, ...tcpPatch },
    hRangeMm: { ...cur.hRangeMm, ...hPatch },
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'slaveCal')) {
    next.slaveCal = patch.slaveCal
  }
  return normalizeCentringConfig(next)
}

export function createCentringConfigStore(db) {
  function load() {
    const svc = tryGetSettingsService()
    if (svc) return svc.getDomainDocument('centring').data.centring_config
    const settings = readSettingsJson(db)
    return normalizeCentringConfig(settings.centring_config)
  }

  function save(config) {
    const next = normalizeCentringConfig(config)
    const svc = tryGetSettingsService()
    if (svc) return svc.writeCentringConfig(next)
    const settings = readSettingsJson(db)
    writeSettingsJson(db, { ...settings, centring_config: next })
    return {
      ...next,
      tcp: { ...next.tcp },
      hRangeMm: { ...next.hRangeMm },
      slaveCal: next.slaveCal ? { ...next.slaveCal } : null,
    }
  }

  function migrateFromJson() {
    const settings = readSettingsJson(db)
    if (settings.centring_config && typeof settings.centring_config === 'object') {
      return false
    }
    const jsonPath = process.env.CENTRING_CONFIG_PATH
      || path.join(__dirname, 'centringMaster', 'data', 'centring_config.json')
    if (!fs.existsSync(jsonPath)) return false
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      save(raw)
      console.log(`[centring] migrated config from ${jsonPath} → SQLite (system_settings.centring_config)`)
      return true
    } catch (err) {
      console.warn(`[centring] JSON migration skipped (${jsonPath}): ${err.message}`)
      return false
    }
  }

  function storagePath() {
    return `${getDbPath()} → system_settings.centring_config`
  }

  return { load, save, migrateFromJson, storagePath }
}

/**
 * Legacy no-op — serial transport retired; Double_Actuator slave is TCP-only.
 */
export function migrateCentringTransportIfNeeded(_db) {
  return false
}
