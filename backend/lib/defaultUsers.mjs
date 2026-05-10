import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateStoredRoleValue } from './legacyRoleNames.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.resolve(__dirname, '../config/default-users.json')

/** Same defaults as `config/default-users.json` if the file is missing or invalid. */
const FALLBACK_SEED = [
  { id: 'builtin-operator', username: 'operator', password: 'operator', role: 'OPERATOR', id_number: 'OP-001', is_active: true, hidden_from_management: true },
  { id: 'builtin-quality', username: 'quality', password: 'quality', role: 'QUALITY', id_number: 'QA-001', is_active: true, hidden_from_management: true },
  { id: 'builtin-maintenance', username: 'maintenance', password: 'maintenance', role: 'MAINTENANCE', id_number: 'MT-001', is_active: true, hidden_from_management: true },
  { id: 'builtin-admin', username: 'admin', password: 'admin', role: 'ADMIN', id_number: 'AD-001', is_active: true, hidden_from_management: true },
  { id: 'builtin-vendor', username: 'vendor', password: 'vendor', role: 'BYPASS', id_number: 'VB-001', is_active: true, hidden_from_management: true },
]

/**
 * @returns {Array<{ id: string, username: string, password: string, role: string, id_number: string, is_active: boolean, hidden_from_management: boolean }>}
 */
function parseFile(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.users) || raw.users.length === 0) {
    throw new Error('"users" must be a non-empty array')
  }
  const seen = new Set()
  return raw.users.map((u, i) => {
    const username = typeof u.username === 'string' ? u.username.trim() : ''
    if (!username) throw new Error(`user[${i}] missing username`)
    const key = username.toLowerCase()
    if (seen.has(key)) throw new Error(`duplicate username "${username}"`)
    seen.add(key)
    const password = typeof u.password === 'string' ? u.password : ''
    if (!password) throw new Error(`user "${username}" missing password`)
    const role = migrateStoredRoleValue(u.role)
    if (role === 'NONE') throw new Error(`user "${username}" has invalid role`)
    const id = typeof u.id === 'string' && u.id.trim() ? u.id.trim() : String(i + 1)
    return {
      id,
      username,
      password,
      role,
      id_number: typeof u.id_number === 'string' ? u.id_number : '',
      is_active: u.is_active !== false,
      hidden_from_management: u.hidden_from_customer !== false,
    }
  })
}

/**
 * Built-in accounts for first-time SQLite seed (empty users table).
 * Reads `config/default-users.json`; falls back to embedded defaults if unreadable.
 */
export function getDefaultUsersSeed() {
  try {
    const text = fs.readFileSync(CONFIG_PATH, 'utf8')
    return parseFile(JSON.parse(text))
  } catch (e) {
    console.warn('[defaultUsers] Using fallback seed (config/default-users.json unavailable or invalid):', e.message)
    return FALLBACK_SEED.map((r) => ({ ...r }))
  }
}
