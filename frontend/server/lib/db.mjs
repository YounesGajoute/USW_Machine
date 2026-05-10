import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hashPassword } from './crypto.mjs'
import { migrateStoredRoleValue } from './legacyRoleNames.mjs'
import { getDefaultUsersSeed } from './defaultUsers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

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
}

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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  const row = db.prepare('SELECT json FROM system_settings WHERE id = 1').get()
  if (!row) {
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
