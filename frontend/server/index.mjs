/**
 * Settings API — SQLite `maindata.db` (system settings + users).
 *
 *   npm install --prefix server
 *   npm run server
 *
 * DB path: `server/data/maindata.db` or `MAIN_DATA_DB_PATH`.
 * Frontend: `VITE_API_BASE_URL=http://127.0.0.1:3333` (see `.env.example`).
 */
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import { openDatabase, getDbPath, DEFAULTS, normalizeReferenceSerial, mergeReferenceSerialPatch } from './lib/db.mjs'
import { migrateStoredRoleValue } from './lib/legacyRoleNames.mjs'
import { verifyPassword, hashPassword } from './lib/crypto.mjs'
import { mergeRoleTabAccess, ensureRequiredTabs } from './lib/roleTabAccessDefaults.mjs'
import { resolveVisionConfig } from '../../backend/lib/visionConfig.mjs'

const PORT = Number(process.env.PORT || 3333)
const SESSION_SECRET = process.env.SESSION_SECRET || 'app-dev-change-me-in-production'

const db = openDatabase(getDbPath())
const app = express()

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
)
app.use(express.json({ limit: '512kb' }))
app.use(
  session({
    name: 'app.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
)

const ROLE_RANK = {
  NONE: 0,
  OPERATOR: 1,
  QUALITY: 2,
  MAINTENANCE: 3,
  ADMIN: 4,
  BYPASS: 5,
}

function rowToPublic(row) {
  const role = migrateStoredRoleValue(row.role)
  return {
    id: row.id,
    username: row.username,
    id_number: row.id_number || '',
    role,
    is_active: !!row.is_active,
    created_at: row.created_at,
    last_login: row.last_login || undefined,
  }
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id)
}

function getUserByUsername(name) {
  return db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(name.trim())
}

function rank(userRow) {
  if (!userRow) return 0
  const r = migrateStoredRoleValue(userRow.role)
  return ROLE_RANK[r] ?? 0
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not authenticated' })
  }
  const row = getUserById(req.session.userId)
  if (!row || !row.is_active) {
    req.session.destroy(() => {})
    return res.status(401).json({ message: 'Not authenticated' })
  }
  req.userRow = row
  next()
}

/** Attach `req.userRow` when a valid session exists; otherwise continue (no 401). */
function optionalAuth(req, res, next) {
  if (!req.session.userId) return next()
  const row = getUserById(req.session.userId)
  if (!row || !row.is_active) return next()
  req.userRow = row
  next()
}

function requireAdmin(req, res, next) {
  if (rank(req.userRow) < ROLE_RANK.ADMIN) {
    return res.status(403).json({ message: 'Admin access required' })
  }
  next()
}

function readSystemSettings() {
  const row = db.prepare('SELECT json FROM system_settings WHERE id = 1').get()
  let parsed = {}
  try {
    parsed = JSON.parse(row?.json || '{}')
  } catch {
    parsed = {}
  }
  const base = { ...DEFAULTS, ...parsed }
  if (parsed.reference_serial && typeof parsed.reference_serial === 'object') {
    base.reference_serial = normalizeReferenceSerial(parsed.reference_serial)
  }
  return base
}

function writeSystemSettings(merge) {
  const cur = readSystemSettings()
  const next = { ...cur, ...merge }
  if (merge.reference_serial && typeof merge.reference_serial === 'object') {
    next.reference_serial = mergeReferenceSerialPatch(cur.reference_serial, merge.reference_serial)
  }
  db.prepare('UPDATE system_settings SET json = ? WHERE id = 1').run(JSON.stringify(next))
  return next
}

function readMergedRoleTabAccess() {
  const settings = readSystemSettings()
  return mergeRoleTabAccess(settings.role_tab_access)
}

function persistRoleTabAccess(map) {
  writeSystemSettings({ role_tab_access: map })
}

const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' })
  }
  const row = getUserByUsername(String(username))
  if (!row || !row.is_active) {
    return res.status(401).json({ message: 'Invalid credentials' })
  }
  if (!verifyPassword(String(password), row.password_hash, row.password_salt)) {
    return res.status(401).json({ message: 'Invalid credentials' })
  }
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(new Date().toISOString(), row.id)
  req.session.userId = row.id
  res.json({ status: 'ok', user: rowToPublic(getUserById(row.id)) })
})

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not authenticated' })
  }
  const row = getUserById(req.session.userId)
  if (!row || !row.is_active) {
    req.session.destroy(() => {})
    return res.status(401).json({ message: 'Not authenticated' })
  }
  res.json(rowToPublic(row))
})

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ status: 'ok' })
  })
})

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {}
  if (!current_password || !new_password) {
    return res.status(400).json({ message: 'Current and new password are required' })
  }
  const np = String(new_password)
  if (np.length < PASSWORD_MIN || np.length > PASSWORD_MAX) {
    return res.status(400).json({
      message: `New password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters`,
    })
  }
  const row = getUserById(req.session.userId)
  if (!verifyPassword(String(current_password), row.password_hash, row.password_salt)) {
    return res.status(400).json({ message: 'Current password is incorrect' })
  }
  const { hash, salt } = hashPassword(np)
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, row.id)
  res.json({ status: 'ok' })
})

// ── System settings ───────────────────────────────────────────────────────────

app.get('/api/settings/system', (req, res) => {
  const settings = readSystemSettings()
  // Unauthenticated clients get the fields needed for bootstrap (theme, locale,
  // require_login, production_sections). Authenticated users get the full object.
  if (!req.session?.userId) {
    const { require_login, theme, locale, production_sections } = settings
    return res.json({ status: 'success', settings: { require_login, theme, locale, production_sections } })
  }
  res.json({ status: 'success', settings })
})

app.put('/api/settings/system', requireAuth, requireAdmin, (req, res) => {
  const body = req.body
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ message: 'JSON body required' })
  }
  const next = writeSystemSettings(body)
  res.json({ status: 'success', settings: next })
})

// ── Role tab access (main nav + settings sub-pages) ──────────────────────────

app.get('/api/settings/role-tab-access', optionalAuth, (req, res) => {
  const full = readMergedRoleTabAccess()
  // BYPASS bypasses all tab gates and is never part of the configurable matrix.
  const { BYPASS: _bypass, ...manageable } = full
  if (!req.userRow) {
    const none = manageable.NONE
    return res.json({ roles: none ? { NONE: none } : {} })
  }
  if (rank(req.userRow) >= ROLE_RANK.ADMIN) {
    return res.json({ roles: manageable })
  }
  const role = migrateStoredRoleValue(req.userRow.role)
  const self = manageable[role]
  if (!self) {
    return res.json({ roles: {} })
  }
  return res.json({ roles: { [role]: self } })
})

app.put('/api/settings/role-tab-access', requireAuth, requireAdmin, (req, res) => {
  const { role, tabs } = req.body || {}
  if (!role || !Array.isArray(tabs)) {
    return res.status(400).json({ message: 'role and tabs[] are required' })
  }
  const roleKey = migrateStoredRoleValue(String(role))
  const requesterRole = migrateStoredRoleValue(req.userRow.role)
  // BYPASS bypasses all tab gates and is never configurable through this endpoint.
  if (roleKey === 'BYPASS') {
    return res.status(403).json({ message: 'BYPASS role tab access is not configurable' })
  }
  if (roleKey === 'ADMIN' && requesterRole !== 'BYPASS') {
    return res.status(403).json({ message: 'Only the Bypass (vendor) account may change Admin tab access' })
  }
  const full = readMergedRoleTabAccess()
  const row = full[roleKey]
  if (!row) {
    return res.status(400).json({ message: 'Unknown role' })
  }
  const allowed = new Set(row.available_tabs)
  for (const t of tabs) {
    if (!allowed.has(String(t))) {
      return res.status(400).json({ message: `Tab not allowed for role: ${t}` })
    }
  }
  const nextTabs = ensureRequiredTabs(roleKey, tabs.map(String))
  full[roleKey] = { ...row, tabs: nextTabs }
  persistRoleTabAccess(full)
  res.json({ status: 'ok', roles: full })
})

// ── Users (User Management) ───────────────────────────────────────────────────

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM users WHERE hidden_from_management = 0 ORDER BY username COLLATE NOCASE')
    .all()
  res.json(rows.map(rowToPublic))
})

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role, id_number, is_active } = req.body || {}
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' })
  }
  const requested = migrateStoredRoleValue(role != null && String(role).trim() !== '' ? String(role) : 'OPERATOR')
  if (requested === 'NONE') {
    return res.status(400).json({ message: 'Invalid role' })
  }
  if (requested === 'BYPASS') {
    return res.status(400).json({ message: 'Bypass cannot be assigned. It is reserved for the built-in account.' })
  }
  const exists = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(String(username))
  if (exists) {
    return res.status(400).json({ message: `Username "${username}" is already taken` })
  }
  const { hash, salt } = hashPassword(String(password))
  const id = String(Date.now())
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO users (id, username, id_number, role, is_active, hidden_from_management, created_at, password_hash, password_salt)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(
    id,
    String(username).trim(),
    id_number != null ? String(id_number) : '',
    requested,
    is_active === false ? 0 : 1,
    now,
    hash,
    salt,
  )
  res.status(201).json(rowToPublic(getUserById(id)))
})

app.patch('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params
  const row = getUserById(id)
  if (!row) return res.status(404).json({ message: 'User not found' })
  if (row.hidden_from_management) {
    return res.status(400).json({ message: 'This account cannot be edited from User Management' })
  }
  const { username, role, id_number, is_active, password } = req.body || {}
  if (username !== undefined) {
    const conflict = db
      .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?')
      .get(String(username).trim(), id)
    if (conflict) {
      return res.status(400).json({ message: `Username "${username}" is already taken` })
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(String(username).trim(), id)
  }
  if (id_number !== undefined) {
    db.prepare('UPDATE users SET id_number = ? WHERE id = ?').run(String(id_number), id)
  }
  if (role !== undefined) {
    const requested = migrateStoredRoleValue(String(role))
    if (requested === 'NONE') {
      return res.status(400).json({ message: 'Invalid role' })
    }
    if (requested === 'BYPASS') {
      return res.status(400).json({ message: 'Bypass cannot be assigned. It is reserved for the built-in account.' })
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(requested, id)
  }
  if (is_active !== undefined) {
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, id)
  }
  if (password) {
    const { hash, salt } = hashPassword(String(password))
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, id)
  }
  res.json(rowToPublic(getUserById(id)))
})

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params
  const target = getUserById(id)
  if (!target) return res.status(404).json({ message: 'User not found' })
  if (target.hidden_from_management) {
    return res.status(400).json({ message: 'This account cannot be removed from User Management' })
  }
  const targetRole = migrateStoredRoleValue(target.role)
  if (targetRole === 'ADMIN') {
    const others = db.prepare('SELECT role FROM users WHERE id != ?').all(id)
    const adminLeft = others.filter(row => migrateStoredRoleValue(row.role) === 'ADMIN').length
    if (adminLeft === 0) {
      return res.status(400).json({ message: 'Cannot delete the last Admin account' })
    }
  }
  if (targetRole === 'BYPASS') {
    const others = db.prepare('SELECT role FROM users WHERE id != ?').all(id)
    const bypassLeft = others.filter(row => migrateStoredRoleValue(row.role) === 'BYPASS').length
    if (bypassLeft === 0) {
      return res.status(400).json({ message: 'Cannot delete the last Bypass account' })
    }
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  res.json({ status: 'ok' })
})

// ── Vision Pi proxy ───────────────────────────────────────────────────────────
// The browser cannot call the Vision Pi directly due to CORS (browser origin is
// 127.0.0.1, Vision Pi CORS allows 192.168.10.1). All Vision Pi management calls
// are proxied through this server — server-to-server has no CORS restriction.

function visionConfig(body) {
  return resolveVisionConfig(body, readSystemSettings)
}

/** GET /api/vision/ping — check if Vision Pi is reachable using saved/env config */
app.get('/api/vision/ping', async (_req, res) => {
  const { api } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/health`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
    })
    if (upstream.ok || upstream.status < 500) {
      return res.json({ reachable: true, status: upstream.status })
    }
    return res.json({ reachable: false, status: upstream.status })
  } catch (err) {
    return res.json({ reachable: false, error: err.message })
  }
})

/**
 * POST /api/vision/info — fetch /remote/info from the Vision Pi.
 * Body: { vision_url?, vision_remote_key?, vision_local_key? } — overrides env/settings for this request.
 * Used by the Hardware → Vision Inspection settings panel to test connectivity.
 */
app.post('/api/vision/info', requireAuth, async (req, res) => {
  const { api, remoteHeaders } = visionConfig(req.body)
  try {
    const upstream = await fetch(`${api}/remote/info`, {
      headers: remoteHeaders,
      signal: AbortSignal.timeout(5000),
    })
    const data = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json({ reachable: upstream.ok, ...data })
  } catch (err) {
    res.json({ reachable: false, error: err.message })
  }
})

/** POST /api/vision/programs — create a program on the Vision Pi */
app.post('/api/vision/programs', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/programs`, {
      method: 'POST',
      headers: localHeaders,
      body: JSON.stringify(req.body),
    })
    const data = await upstream.json()
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** DELETE /api/vision/programs/:id — delete a program on the Vision Pi */
app.delete('/api/vision/programs/:id', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/programs/${req.params.id}`, {
      method: 'DELETE',
      headers: localHeaders,
    })
    const text = await upstream.text()
    const data = text ? JSON.parse(text) : { status: 'ok' }
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** GET /api/vision/programs — list programs on the Vision Pi */
app.get('/api/vision/programs', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/programs`, { headers: localHeaders })
    const data = await upstream.json()
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

// ── References ────────────────────────────────────────────────────────────────

const RBK_VALUES = new Set(['RBK1', 'RBK2', 'RBK3'])

function normalizeRbk(value) {
  const s = String(value ?? 'RBK1').toUpperCase().replace(/\s+/g, '')
  return RBK_VALUES.has(s) ? s : 'RBK1'
}

const TOOL_CONFIG_MODES = new Set(['general', 'specific'])

function normalizeToolConfigMode(value) {
  const s = String(value ?? 'general').toLowerCase()
  return TOOL_CONFIG_MODES.has(s) ? s : 'general'
}

function mapReferenceRow(row) {
  return {
    ...row,
    is_active: !!row.is_active,
    vision_inspection_enabled: row.vision_inspection_enabled !== 0,
    send_barcode_weld_enabled: row.send_barcode_weld_enabled !== 0,
    send_barcode_shrink_enabled: row.send_barcode_shrink_enabled !== 0,
    rbk: normalizeRbk(row.rbk),
    tool_config_mode: normalizeToolConfigMode(row.tool_config_mode),
    specific_tool_template_id: row.specific_tool_template_id ?? null,
  }
}

app.get('/api/references', optionalAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM product_references ORDER BY name COLLATE NOCASE').all()
  res.json(rows.map(mapReferenceRow))
})

app.post('/api/references', optionalAuth, (req, res) => {
  const {
    name,
    description,
    vision_program_id,
    vision_inspection_enabled,
    send_barcode_weld_enabled,
    send_barcode_shrink_enabled,
    rbk,
  } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ message: 'Name is required' })
  const exists = db.prepare('SELECT id FROM product_references WHERE LOWER(name) = LOWER(?)').get(String(name).trim())
  if (exists) return res.status(400).json({ message: `Reference "${name}" already exists` })
  const id = `REF-${String(Date.now()).slice(-6)}`
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO product_references (
      id, name, description, is_active, vision_program_id,
      vision_inspection_enabled, send_barcode_weld_enabled, send_barcode_shrink_enabled,
      rbk, created_at, updated_at
    )
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(name).trim(),
    description ? String(description).trim() : '',
    vision_program_id ?? null,
    vision_inspection_enabled === false ? 0 : 1,
    send_barcode_weld_enabled === false ? 0 : 1,
    send_barcode_shrink_enabled === false ? 0 : 1,
    normalizeRbk(rbk),
    now,
    now,
  )
  const row = db.prepare('SELECT * FROM product_references WHERE id = ?').get(id)
  res.status(201).json(mapReferenceRow(row))
})

app.patch('/api/references/:id', optionalAuth, (req, res) => {
  const { id } = req.params
  const row = db.prepare('SELECT * FROM product_references WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'Reference not found' })
  const {
    name,
    description,
    is_active,
    vision_program_id,
    vision_inspection_enabled,
    send_barcode_weld_enabled,
    send_barcode_shrink_enabled,
    rbk,
  } = req.body || {}
  const now = new Date().toISOString()
  if (name !== undefined) {
    const conflict = db.prepare('SELECT id FROM product_references WHERE LOWER(name) = LOWER(?) AND id != ?').get(String(name).trim(), id)
    if (conflict) return res.status(400).json({ message: `Reference "${name}" already exists` })
    db.prepare('UPDATE product_references SET name = ?, updated_at = ? WHERE id = ?').run(String(name).trim(), now, id)
  }
  if (description !== undefined) db.prepare('UPDATE product_references SET description = ?, updated_at = ? WHERE id = ?').run(String(description).trim(), now, id)
  if (is_active !== undefined) db.prepare('UPDATE product_references SET is_active = ?, updated_at = ? WHERE id = ?').run(is_active ? 1 : 0, now, id)
  if (vision_program_id !== undefined) db.prepare('UPDATE product_references SET vision_program_id = ?, updated_at = ? WHERE id = ?').run(vision_program_id ?? null, now, id)
  if (vision_inspection_enabled !== undefined) {
    db.prepare('UPDATE product_references SET vision_inspection_enabled = ?, updated_at = ? WHERE id = ?').run(vision_inspection_enabled ? 1 : 0, now, id)
  }
  if (send_barcode_weld_enabled !== undefined) {
    db.prepare('UPDATE product_references SET send_barcode_weld_enabled = ?, updated_at = ? WHERE id = ?').run(send_barcode_weld_enabled ? 1 : 0, now, id)
  }
  if (send_barcode_shrink_enabled !== undefined) {
    db.prepare('UPDATE product_references SET send_barcode_shrink_enabled = ?, updated_at = ? WHERE id = ?').run(send_barcode_shrink_enabled ? 1 : 0, now, id)
  }
  if (rbk !== undefined) db.prepare('UPDATE product_references SET rbk = ?, updated_at = ? WHERE id = ?').run(normalizeRbk(rbk), now, id)
  const updated = db.prepare('SELECT * FROM product_references WHERE id = ?').get(id)
  res.json(mapReferenceRow(updated))
})

app.delete('/api/references/:id', optionalAuth, (req, res) => {
  const { id } = req.params
  const row = db.prepare('SELECT * FROM product_references WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'Reference not found' })
  db.prepare('DELETE FROM product_references WHERE id = ?').run(id)
  res.json({ status: 'ok' })
})

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: getDbPath() })
})

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[maindata-api] http://0.0.0.0:${PORT}  db=${getDbPath()}`)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[maindata-api] Port ${PORT} already in use — another instance is running. Exiting.`)
    process.exit(0)
  } else {
    throw err
  }
})
