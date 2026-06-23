import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hashPassword } from './crypto.mjs'
import { migrateStoredRoleValue } from './legacyRoleNames.mjs'
import { getDefaultUsersSeed } from './defaultUsers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

/** Defaults per logical port (welding / shrink); maps to node-serialport open options + line ending for payloads. */
const REFERENCE_SERIAL_PORT_DEFAULTS = {
  baudRate: 9600,
  bufferSize: 255,
  dataBits: 8,
  flowControl: 'none',
  parity: 'none',
  stopBits: 1,
  lineEnding: 'CRLF',
}

const DEFAULTS = {
  require_login: false,
  test_mode: 'manual',
  theme: 'light',
  locale: 'en',
  production_sections: {},
  post_update_action: 'reboot',
  /** General settings — machine model shown on main view */
  machine_model: null,
  /** Shrink tubes / centring — pick-place axis input start (mm) */
  centering_input_start_mm: 0,
  /** Fine-tune offset (mm) added to input start for move_to_centering_input; may be negative. */
  centering_input_offset_mm: 0,
  /** Frame constants for centering_travel_mm (shrink-tube centring orchestration). */
  centring_frame_config: {
    sideA_guide_spacing_mm: 300,
    sideB_guide_spacing_mm: 55,
    module_length_mm: 200,
  },
  /** Per–machine model wire take/remove and centering travel (mm) */
  mechanism_positions_by_machine: {},
  /** USB serial fan-out for reference string (FT232). Device paths: `.env` only (`REFERENCE_SERIAL_*_PATH`). */
  vision_general_tool_template: {
    name: 'General',
    description: 'Site-wide default tool configuration',
    template_id: null,
    tools: [
      {
        id: 'outline-presence-default',
        name: 'Tube Presence Check',
        type: 'outline',
        color: '#00B2E3',
        threshold: 65,
        roi: { x: 200, y: 100, width: 240, height: 200 },
      },
      {
        id: 'outline-alignment-default',
        name: 'Tube Alignment Check',
        type: 'outline',
        color: '#4CAF50',
        threshold: 60,
        roi: { x: 180, y: 280, width: 280, height: 120 },
      },
    ],
  },
  reference_serial: {
    baud: 9600,
    line_ending: 'CRLF',
    weld_baud: 9600,
    shrink_baud: 9600,
    weld_line_ending: 'CRLF',
    shrink_line_ending: 'CRLF',
    weld: { ...REFERENCE_SERIAL_PORT_DEFAULTS },
    shrink: { ...REFERENCE_SERIAL_PORT_DEFAULTS },
  },
  /** Pick & place motion/homing — see pickPlaceConfigStore.mjs */
  pick_place_config: {
    movementSpeedMmS: 80,
    homingSpeedMmS: 80,
    backoffMmA: 0.5,
    backoffMmB: 0.8,
    referenceAxis: 'a',
  },
  /** Centring motion/homing — see centringConfigStore.mjs */
  centring_config: {
    movementSpeedDegS: 45,
    homingSpeedDegS: 90,
    gapMoveSpeedDegS: 90,
    mechOffsetMm: 0,
    hRangeMm: { min: 0, max: 67.6 },
  },
  /** Production sequence pneumatic/move delays — see productionSequenceConfigStore.mjs */
  production_sequence_config: {
    delayAfterClampCloseMs: 1000,
    delayAfterLeverUpMs: 1000,
    delayAfterPpClampCloseMs: 1000,
    delayAfterClampOpenMs: 1000,
    delayAfterLeverDownMs: 1000,
    delayAfterPickClampOpenMs: 1000,
    movePositionMm: 320,
    moveSpeedMmS: 0,
  },
}

/** Merge stored JSON with defaults; deep-merge `weld` / `shrink` port option objects. */
export function normalizeReferenceSerial(raw) {
  const d = DEFAULTS.reference_serial
  if (!raw || typeof raw !== 'object') {
    return JSON.parse(JSON.stringify(d))
  }
  const { weld_path: _w, shrink_path: _s, ...rawRest } = raw
  return {
    ...d,
    ...rawRest,
    weld: { ...d.weld, ...(raw.weld && typeof raw.weld === 'object' ? raw.weld : {}) },
    shrink: { ...d.shrink, ...(raw.shrink && typeof raw.shrink === 'object' ? raw.shrink : {}) },
  }
}

/** Apply a PATCH from PUT /api/settings/system (shallow top-level + deep weld/shrink). */
export function mergeReferenceSerialPatch(currentRaw, patch) {
  const cur = normalizeReferenceSerial(currentRaw)
  if (!patch || typeof patch !== 'object') return cur
  return normalizeReferenceSerial({
    ...cur,
    ...patch,
    weld: { ...cur.weld, ...(patch.weld && typeof patch.weld === 'object' ? patch.weld : {}) },
    shrink: { ...cur.shrink, ...(patch.shrink && typeof patch.shrink === 'object' ? patch.shrink : {}) },
  })
}

/**
 * Legacy installs seeded `admin` as BYPASS. Current defaults use ADMIN + separate `vendor` (BYPASS).
 * Promote `admin` to ADMIN when still BYPASS; insert missing BYPASS seed user if none remain.
 */
function migrateLegacyAdminBypassSplit(db) {
  const adminRow = db.prepare(`SELECT id, role FROM users WHERE username = ?`).get('admin')
  if (adminRow && migrateStoredRoleValue(adminRow.role) === 'BYPASS') {
    db.prepare(`UPDATE users SET role = 'ADMIN' WHERE id = ?`).run(adminRow.id)
  }
  const bypassLeft = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'BYPASS'`).get().c
  if (bypassLeft > 0) return
  const vendor = getDefaultUsersSeed().find((s) => s.role === 'BYPASS')
  if (!vendor) return
  if (db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(vendor.username)) return
  const ins = db.prepare(`
    INSERT INTO users (id, username, id_number, role, is_active, hidden_from_management, created_at, password_hash, password_salt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const { hash, salt } = hashPassword(vendor.password)
  const now = new Date().toISOString()
  ins.run(
    vendor.id,
    vendor.username,
    vendor.id_number,
    vendor.role,
    vendor.is_active ? 1 : 0,
    vendor.hidden_from_management ? 1 : 0,
    now,
    hash,
    salt,
  )
}

/** One-time rename: legacy kiosk.db → maindata.db (with WAL sidecars). */
function migrateLegacyDbFile(mainPath) {
  const legacy = path.join(path.dirname(mainPath), 'kiosk.db')
  if (fs.existsSync(mainPath) || !fs.existsSync(legacy)) return
  try {
    fs.renameSync(legacy, mainPath)
    for (const ext of ['-wal', '-shm']) {
      const a = legacy + ext
      if (fs.existsSync(a)) fs.renameSync(a, mainPath + ext)
    }
  } catch (e) {
    console.warn('[db] Could not migrate kiosk.db → maindata.db:', e.message)
  }
}

/** Add per-reference machine / RBK options on existing databases. */
function migrateProductReferencesColumns(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(product_references)').all().map(r => r.name))
  if (!cols.has('vision_inspection_enabled')) {
    db.exec('ALTER TABLE product_references ADD COLUMN vision_inspection_enabled INTEGER NOT NULL DEFAULT 1')
  }
  if (!cols.has('send_barcode_weld_enabled')) {
    db.exec('ALTER TABLE product_references ADD COLUMN send_barcode_weld_enabled INTEGER NOT NULL DEFAULT 1')
  }
  if (!cols.has('send_barcode_shrink_enabled')) {
    db.exec('ALTER TABLE product_references ADD COLUMN send_barcode_shrink_enabled INTEGER NOT NULL DEFAULT 1')
  }
  if (!cols.has('rbk')) {
    db.exec("ALTER TABLE product_references ADD COLUMN rbk TEXT NOT NULL DEFAULT 'RBK1'")
  }
  if (!cols.has('tool_config_mode')) {
    db.exec("ALTER TABLE product_references ADD COLUMN tool_config_mode TEXT NOT NULL DEFAULT 'general'")
  }
  if (!cols.has('specific_tool_template_id')) {
    db.exec('ALTER TABLE product_references ADD COLUMN specific_tool_template_id INTEGER')
  }
  if (!cols.has('specific_tools_json')) {
    db.exec("ALTER TABLE product_references ADD COLUMN specific_tools_json TEXT NOT NULL DEFAULT ''")
  }
  if (!cols.has('shrink_tube_id')) {
    db.exec('ALTER TABLE product_references ADD COLUMN shrink_tube_id TEXT')
  }
  if (!cols.has('vision_checks_json')) {
    db.exec("ALTER TABLE product_references ADD COLUMN vision_checks_json TEXT NOT NULL DEFAULT ''")
  }
}

/** Add centring fields on shrink tube profiles. */
function migrateShrinkTubesColumns(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(shrink_tubes)').all().map(r => r.name))
  if (!cols.has('centring_length_tolerance_mm')) {
    db.exec('ALTER TABLE shrink_tubes ADD COLUMN centring_length_tolerance_mm REAL NOT NULL DEFAULT 0')
  }
  if (!cols.has('centring_mechanism')) {
    db.exec("ALTER TABLE shrink_tubes ADD COLUMN centring_mechanism TEXT NOT NULL DEFAULT 'upper'")
  }
  if (!cols.has('diameter_closing_gap_mm')) {
    db.exec('ALTER TABLE shrink_tubes ADD COLUMN diameter_closing_gap_mm REAL NOT NULL DEFAULT 0')
  }
  if (!cols.has('diameter_opening_gap_mm')) {
    db.exec('ALTER TABLE shrink_tubes ADD COLUMN diameter_opening_gap_mm REAL NOT NULL DEFAULT 0')
  }
}

export function openDatabase(dbPath) {
  migrateLegacyDbFile(dbPath)
  const dir = path.dirname(dbPath)
  fs.mkdirSync(dir, { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      id_number TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      hidden_from_management INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login TEXT,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_references (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      vision_program_id INTEGER,
      vision_inspection_enabled INTEGER NOT NULL DEFAULT 1,
      send_barcode_weld_enabled INTEGER NOT NULL DEFAULT 1,
      send_barcode_shrink_enabled INTEGER NOT NULL DEFAULT 1,
      rbk TEXT NOT NULL DEFAULT 'RBK1',
      tool_config_mode TEXT NOT NULL DEFAULT 'general',
      specific_tool_template_id INTEGER,
      specific_tools_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      shrink_tube_id TEXT,
      vision_checks_json TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS shrink_tubes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      diameter_mm REAL NOT NULL,
      length_mm REAL NOT NULL,
      rbk TEXT NOT NULL DEFAULT 'RBK1',
      centring_length_tolerance_mm REAL NOT NULL DEFAULT 0,
      centring_mechanism TEXT NOT NULL DEFAULT 'upper',
      diameter_closing_gap_mm REAL NOT NULL DEFAULT 0,
      diameter_opening_gap_mm REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  migrateProductReferencesColumns(db)
  migrateShrinkTubesColumns(db)
  const settingsRow = db.prepare('SELECT id FROM system_settings WHERE id = 1').get()
  if (!settingsRow) {
    db.prepare('INSERT INTO system_settings (id, json) VALUES (1, ?)').run(JSON.stringify(DEFAULTS))
  }

  try {
    const legacyRows = db.prepare('SELECT id, role FROM users').all()
    const updateRole = db.prepare('UPDATE users SET role = ? WHERE id = ?')
    for (const row of legacyRows) {
      const next = migrateStoredRoleValue(row.role)
      if (next !== row.role) {
        updateRole.run(next, row.id)
      }
    }
  } catch {
    /* ignore if column/table mismatch on very old DBs */
  }

  try {
    migrateLegacyAdminBypassSplit(db)
  } catch (e) {
    console.warn('[db] admin / bypass split migration:', e.message)
  }

  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
  const now = new Date().toISOString()
  if (count === 0) {
    const ins = db.prepare(`
      INSERT INTO users (id, username, id_number, role, is_active, hidden_from_management, created_at, password_hash, password_salt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const b of getDefaultUsersSeed()) {
      const { hash, salt } = hashPassword(b.password)
      ins.run(
        b.id,
        b.username,
        b.id_number,
        b.role,
        b.is_active ? 1 : 0,
        b.hidden_from_management ? 1 : 0,
        now,
        hash,
        salt,
      )
    }
  } else {
    // Sync built-in seed users from config on every startup so changes to
    // default-users.json (username, password, role, active state) are applied
    // automatically without needing to wipe the database.
    const upsert = db.prepare(`
      INSERT INTO users (id, username, id_number, role, is_active, hidden_from_management, created_at, password_hash, password_salt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username               = excluded.username,
        id_number              = excluded.id_number,
        role                   = excluded.role,
        is_active              = excluded.is_active,
        hidden_from_management = excluded.hidden_from_management,
        password_hash          = excluded.password_hash,
        password_salt          = excluded.password_salt
    `)
    for (const b of getDefaultUsersSeed()) {
      const { hash, salt } = hashPassword(b.password)
      upsert.run(
        b.id,
        b.username,
        b.id_number,
        b.role,
        b.is_active ? 1 : 0,
        b.hidden_from_management ? 1 : 0,
        now,
        hash,
        salt,
      )
    }
    console.log('[db] Built-in seed users synced from config/default-users.json')
  }

  return db
}

export function getDbPath() {
  const fromEnv = process.env.MAIN_DATA_DB_PATH
  if (fromEnv) return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(ROOT, fromEnv)
  return path.join(ROOT, 'data', 'maindata.db')
}

export { DEFAULTS }
