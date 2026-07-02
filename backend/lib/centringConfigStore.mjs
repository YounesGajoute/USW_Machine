/**
 * Centring motion config — persisted in SQLite `system_settings.centring_config`.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDbPath } from './db.mjs'
import {
  DEFAULT_CENTRING_CONFIG,
  DEFAULT_CENTRING_SERIAL,
  DEFAULT_CENTRING_TCP,
} from '../../New_version_centring_systeme/centring_master.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DEFAULT_CENTRING_CONFIG_STORE = {
  transport: DEFAULT_CENTRING_CONFIG.transport,
  tcp: { ...DEFAULT_CENTRING_TCP },
  serial: { ...DEFAULT_CENTRING_SERIAL },
  movementSpeedDegS: DEFAULT_CENTRING_CONFIG.movementSpeedDegS,
  homingSpeedDegS: DEFAULT_CENTRING_CONFIG.homingSpeedDegS,
  gapMoveSpeedDegS: DEFAULT_CENTRING_CONFIG.gapMoveSpeedDegS,
  mechOffsetMm: DEFAULT_CENTRING_CONFIG.mechOffsetMm,
  hRangeMm: { ...DEFAULT_CENTRING_CONFIG.hRangeMm },
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

function transportFromEnv() {
  const env = (process.env.CENTRING_TRANSPORT || '').trim().toLowerCase()
  if (env === 'serial' || env === 'tcp') return env
  return null
}

export function normalizeCentringConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_CENTRING_CONFIG_STORE,
      tcp: { ...DEFAULT_CENTRING_CONFIG_STORE.tcp },
      serial: { ...DEFAULT_CENTRING_CONFIG_STORE.serial },
      hRangeMm: { ...DEFAULT_CENTRING_CONFIG_STORE.hRangeMm },
    }
  }
  const hRange = raw.hRangeMm && typeof raw.hRangeMm === 'object' ? raw.hRangeMm : {}
  const tcp = raw.tcp && typeof raw.tcp === 'object' ? raw.tcp : {}
  const serial = raw.serial && typeof raw.serial === 'object' ? raw.serial : {}
  const transport = String(raw.transport || transportFromEnv() || DEFAULT_CENTRING_CONFIG_STORE.transport).toLowerCase() === 'serial'
    ? 'serial'
    : 'tcp'
  return {
    transport,
    tcp: {
      host: String(tcp.host ?? DEFAULT_CENTRING_CONFIG_STORE.tcp.host),
      port: Number(tcp.port ?? DEFAULT_CENTRING_CONFIG_STORE.tcp.port),
    },
    serial: {
      baudRate: Number(serial.baudRate ?? DEFAULT_CENTRING_CONFIG_STORE.serial.baudRate),
    },
    movementSpeedDegS: Number(raw.movementSpeedDegS ?? DEFAULT_CENTRING_CONFIG_STORE.movementSpeedDegS),
    homingSpeedDegS: Number(raw.homingSpeedDegS ?? DEFAULT_CENTRING_CONFIG_STORE.homingSpeedDegS),
    gapMoveSpeedDegS: Number(raw.gapMoveSpeedDegS ?? DEFAULT_CENTRING_CONFIG_STORE.gapMoveSpeedDegS),
    mechOffsetMm: Number(raw.mechOffsetMm ?? DEFAULT_CENTRING_CONFIG_STORE.mechOffsetMm),
    hRangeMm: {
      min: Number(hRange.min ?? DEFAULT_CENTRING_CONFIG_STORE.hRangeMm.min),
      max: Number(hRange.max ?? DEFAULT_CENTRING_CONFIG_STORE.hRangeMm.max),
    },
  }
}

export function mergeCentringConfigPatch(currentRaw, patch) {
  const cur = normalizeCentringConfig(currentRaw)
  if (!patch || typeof patch !== 'object') return cur
  const hPatch = patch.hRangeMm && typeof patch.hRangeMm === 'object' ? patch.hRangeMm : {}
  const tcpPatch = patch.tcp && typeof patch.tcp === 'object' ? patch.tcp : {}
  const serialPatch = patch.serial && typeof patch.serial === 'object' ? patch.serial : {}
  return normalizeCentringConfig({
    ...cur,
    ...patch,
    tcp: { ...cur.tcp, ...tcpPatch },
    serial: { ...cur.serial, ...serialPatch },
    hRangeMm: { ...cur.hRangeMm, ...hPatch },
  })
}

export function createCentringConfigStore(db) {
  function load() {
    const settings = readSettingsJson(db)
    return normalizeCentringConfig(settings.centring_config)
  }

  function save(config) {
    const next = normalizeCentringConfig(config)
    const settings = readSettingsJson(db)
    writeSettingsJson(db, { ...settings, centring_config: next })
    return {
      ...next,
      tcp: { ...next.tcp },
      serial: { ...next.serial },
      hRangeMm: { ...next.hRangeMm },
    }
  }

  function migrateFromJson() {
    const settings = readSettingsJson(db)
    if (settings.centring_config && typeof settings.centring_config === 'object') {
      return false
    }
    const jsonPath = process.env.CENTRING_CONFIG_PATH
      || path.join(__dirname, '..', '..', 'New_version_centring_systeme', 'data', 'centring_config.json')
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

/** Upgrade legacy centring_config to serial when env requests USB transport. */
export function migrateCentringTransportIfNeeded(db) {
  const settings = readSettingsJson(db)
  const raw = settings.centring_config
  const envTransport = transportFromEnv()
  const serialPath = (process.env.CENTRING_SERIAL_PATH || '').trim()
  const wantSerial =
    envTransport === 'serial' ||
    (envTransport !== 'tcp' && !raw?.transport && !!serialPath)
  if (!wantSerial) return false

  const current = normalizeCentringConfig(raw)
  if (current.transport === 'serial') return false

  const next = mergeCentringConfigPatch(current, { transport: 'serial' })
  writeSettingsJson(db, { ...settings, centring_config: next })
  console.log('[centring] migrated centring_config.transport → serial (CENTRING_TRANSPORT / CENTRING_SERIAL_PATH)')
  return true
}
