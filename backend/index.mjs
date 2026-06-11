/**
 * Settings API — SQLite `maindata.db` (system settings + users).
 *
 *   npm install --prefix backend
 *   npm run server   (from frontend/)  OR  npm start (from backend/)
 *
 * DB path: `backend/data/maindata.db` or `MAIN_DATA_DB_PATH`.
 * Frontend: `VITE_API_BASE_URL=http://127.0.0.1:3333` (see `backend/.env.example`).
 */
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import Busboy from 'busboy'
import { openDatabase, getDbPath, DEFAULTS, normalizeReferenceSerial, mergeReferenceSerialPatch } from './lib/db.mjs'
import { migrateStoredRoleValue } from './lib/legacyRoleNames.mjs'
import { verifyPassword, hashPassword } from './lib/crypto.mjs'
import { mergeRoleTabAccess, ensureRequiredTabs } from './lib/roleTabAccessDefaults.mjs'
import pickPlace, { handlePickPlaceHttpRequest } from './lib/pickPlace.mjs'
import { getEtherCATManager } from './lib/ethercat.mjs'
import {
  ensureEtherCAT,
  getLifterSnapshot,
  setLifterOutputs,
  lifterSafe,
  runLifterCycle,
  shutdownEtherCAT,
} from './lib/lifter.mjs'
import {
  getPneumaticSnapshot,
  setPneumaticOutputs,
  pneumaticsSafe,
  emergencyStopPneumatics,
  PNEUMATIC_OUTPUTS,
} from './lib/pneumatics.mjs'
import {
  setLoadedReference,
  clearLoadedReference,
  getMachineInitSnapshot,
  getMachineInitStatus,
  runMachineInitialization,
  resetMachineInitialization,
} from './lib/machineInit.mjs'
import {
  runProductionSequence,
  stopProductionSequence,
  resetProductionSequence,
} from './lib/productionSequence.mjs'
import { broadcastReferenceToMachines, setReferenceSerialFromSettings } from './lib/referenceSerialBridge.mjs'
import { resolveVisionConfig } from './lib/visionConfig.mjs'
import { deleteReferenceVisionOnPi } from './lib/referenceVisionCleanup.mjs'
import { deleteVisionProgramOnPi } from './lib/visionProgramDelete.mjs'
import {
  fetchVisionProgramOnPi,
  normalizeInspectionRunData,
  runInspectionOnceOnPi,
  saveProgramToolsOnPi,
  saveToolsAndRunOnceOnPi,
} from './lib/visionProgramTools.mjs'

const PORT = Number(process.env.PORT || 3333)
const SESSION_SECRET = process.env.SESSION_SECRET || 'app-dev-change-me-in-production'

/**
 * Whether to spawn the pysoem bridge when the API starts (same default as ./start.sh and
 * us-machine-headless-web.sh after sourcing backend/.env).
 * Unset or empty → connect. Explicit 0 / false / no / off → skip (dev / no hardware).
 */
function envWantsEtherCATAutoConnect() {
  const v = process.env.ETHERCAT_AUTO_CONNECT
  if (v === undefined || v === null) return true
  const s = String(v).trim()
  if (s === '') return true
  const sl = s.toLowerCase()
  if (sl === '0' || sl === 'false' || sl === 'no' || sl === 'off') return false
  return true
}

const db = openDatabase(getDbPath())
const app = express()

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
)
/** Master-image register sends base64 in JSON — allow up to vision slave 10 MB file limit. */
app.use((req, res, next) => {
  const largeBody = req.method === 'POST' && req.path === '/api/vision/master-image'
  express.json({ limit: largeBody ? '20mb' : '512kb' })(req, res, next)
})
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
  setReferenceSerialFromSettings(next.reference_serial)
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

/** DELETE /api/vision/programs/:id — delete a program on the Vision Pi (remote API, 120s) */
app.delete('/api/vision/programs/:id', optionalAuth, async (req, res) => {
  const cfg = visionConfig({})
  try {
    const outcome = await deleteVisionProgramOnPi(cfg, req.params.id)
    if (outcome.ok) {
      return res.status(outcome.status === 404 ? 404 : 200).json({ status: 'ok', via: outcome.via })
    }
    const status = outcome.status && outcome.status >= 400 ? outcome.status : 502
    return res.status(status).json({
      message: outcome.error ?? 'Vision program delete failed',
      via: outcome.via,
    })
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** GET /api/vision/programs — list programs on the Vision Pi */
app.get('/api/vision/programs', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  const qs = new URLSearchParams()
  if (req.query.active_only === 'true') qs.set('active_only', 'true')
  const suffix = qs.toString() ? `?${qs}` : ''
  try {
    const upstream = await fetch(`${api}/programs${suffix}`, { headers: localHeaders })
    const data = await upstream.json()
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** GET /api/vision/programs/:id — single program (full config) from Vision Pi */
app.get('/api/vision/programs/:id', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const outcome = await fetchVisionProgramOnPi(api, localHeaders, req.params.id)
    res.status(outcome.status).json(outcome.data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** PUT /api/vision/programs/:id — update program (tools, config) on the Vision Pi */
app.put('/api/vision/programs/:id', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/programs/${req.params.id}`, {
      method: 'PUT',
      headers: localHeaders,
      body: JSON.stringify(req.body),
    })
    const data = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/**
 * POST /api/vision/camera/recover — restart vision Pi camera (remote API).
 * Stops stuck live feeds, closes/reopens Picamera2, optional probe capture.
 */
app.post('/api/vision/camera/recover', optionalAuth, async (req, res) => {
  const { api, remoteHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/remote/camera/recover`, {
      method: 'POST',
      headers: remoteHeaders,
      body: JSON.stringify({
        stopLiveFeeds: req.body?.stopLiveFeeds !== false,
        probeCapture: req.body?.probeCapture !== false,
      }),
      signal: AbortSignal.timeout(120000),
    })
    const data = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** POST /api/vision/camera/capture — capture frame from Vision Pi camera */
app.post('/api/vision/camera/capture', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/camera/capture`, {
      method: 'POST',
      headers: localHeaders,
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(60000),
    })
    const data = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** Parse multipart master-image upload from browser (avoids huge JSON bodies). */
function parseMasterImageMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    })
    let programId = null
    let fileBuf = null
    let filename = 'master.png'
    let mime = 'image/png'

    bb.on('field', (name, val) => {
      if (name === 'programId') programId = val
    })
    bb.on('file', (_name, stream, info) => {
      const chunks = []
      stream.on('data', chunk => chunks.push(chunk))
      stream.on('limit', () => reject(new Error('Image file is too large (max 10 MB)')))
      stream.on('end', () => {
        fileBuf = Buffer.concat(chunks)
        filename = info.filename || filename
        mime = info.mimeType || mime
      })
    })
    bb.on('finish', () => {
      if (programId == null || !fileBuf?.length) {
        reject(new Error('programId and file required'))
        return
      }
      resolve({ programId, fileBuf, filename, mime })
    })
    bb.on('error', reject)
    req.pipe(bb)
  })
}

async function forwardMasterImageToVision(cfg, programId, fileBuf, filename, mime) {
  const hdr = {}
  if (cfg.localHeaders['X-Vision-Local-Key']) {
    hdr['X-Vision-Local-Key'] = cfg.localHeaders['X-Vision-Local-Key']
  }
  const form = new FormData()
  form.append('programId', String(programId))
  form.append('file', new Blob([fileBuf], { type: mime }), filename)
  const upstream = await fetch(`${cfg.api}/master-image`, {
    method: 'POST',
    headers: hdr,
    body: form,
    signal: AbortSignal.timeout(120000),
  })
  const text = await upstream.text()
  let data = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { error: text.slice(0, 500) }
    }
  }
  return { status: upstream.status, data }
}

/** POST /api/vision/master-image — multipart (preferred) or JSON image_b64 fallback */
app.post('/api/vision/master-image', optionalAuth, async (req, res) => {
  const cfg = visionConfig({})
  try {
    if (req.is('multipart/form-data')) {
      const { programId, fileBuf, filename, mime } = await parseMasterImageMultipart(req)
      const { status, data } = await forwardMasterImageToVision(cfg, programId, fileBuf, filename, mime)
      return res.status(status).json(data)
    }

    const programId = req.body?.programId
    const imageB64 = req.body?.image_b64
    if (programId == null || !imageB64) {
      return res.status(400).json({ message: 'programId and file (multipart) or image_b64 required' })
    }
    const buf = Buffer.from(String(imageB64), 'base64')
    const filename = String(req.body?.filename ?? `master-${programId}.jpg`)
    const fmt = String(req.body?.format ?? '').toLowerCase()
    const mime =
      fmt === 'png' || /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg'
    const { status, data } = await forwardMasterImageToVision(cfg, programId, buf, filename, mime)
    res.status(status).json(data)
  } catch (err) {
    const msg = err.message || 'Master image upload failed'
    const code = /too large/i.test(msg) ? 413 : /required/i.test(msg) ? 400 : 502
    res.status(code).json({ message: msg, error: msg })
  }
})

/** GET /api/vision/master-image/:programId — fetch registered master image */
app.get('/api/vision/master-image/:programId', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/master-image/${req.params.programId}`, {
      headers: localHeaders,
      signal: AbortSignal.timeout(60000),
    })
    const data = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** GET /api/vision/tool-templates — list tool templates on Vision Pi */
app.get('/api/vision/tool-templates', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/tool-templates`, { headers: localHeaders })
    const data = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** GET /api/vision/tool-templates/:id — fetch one template */
app.get('/api/vision/tool-templates/:id', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/tool-templates/${req.params.id}`, { headers: localHeaders })
    const data = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** GET /api/vision/tool-templates/:id/for-program/:programId — template ROIs scaled to program */
app.get('/api/vision/tool-templates/:id/for-program/:programId', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(
      `${api}/tool-templates/${req.params.id}/for-program/${req.params.programId}`,
      { headers: localHeaders },
    )
    const data = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** DELETE /api/vision/tool-templates/:id */
app.delete('/api/vision/tool-templates/:id', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/tool-templates/${req.params.id}`, {
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

/** POST /api/vision/tool-templates — create tool template on Vision Pi */
app.post('/api/vision/tool-templates', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/tool-templates`, {
      method: 'POST',
      headers: localHeaders,
      body: JSON.stringify(req.body),
    })
    const data = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/**
 * POST /api/vision/tool-judgment — push tools to Vision Pi and run inspection (no image).
 * Used for real-time threshold tuning in Settings → Vision → Tool configuration.
 */
app.post('/api/vision/tool-judgment', optionalAuth, async (req, res) => {
  const { programId, tools } = req.body ?? {}
  if (programId == null) {
    return res.status(400).json({ message: 'programId is required' })
  }
  if (!Array.isArray(tools)) {
    return res.status(400).json({ message: 'tools must be an array' })
  }

  const cfg = visionConfig({})
  try {
    const outcome = await saveToolsAndRunOnceOnPi(cfg, programId, tools, { includeImage: false })
    if (!outcome.ok) {
      const payload = outcome.data ?? {}
      return res.status(outcome.status && outcome.status >= 400 ? outcome.status : 502).json({
        error: payload.error ?? payload.message ?? `Vision ${outcome.phase ?? 'request'} failed`,
        ...payload,
      })
    }
    const d = outcome.data
    res.json({
      status: d.status,
      result: d.result,
      toolResults: d.toolResults,
      processingTimeMs: d.processingTimeMs,
      programId: d.programId ?? programId,
    })
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** POST /api/vision/save-tools — merge tools into program config (GET + PUT on Vision Pi). */
app.post('/api/vision/save-tools', optionalAuth, async (req, res) => {
  const { programId, tools } = req.body ?? {}
  if (programId == null) {
    return res.status(400).json({ message: 'programId is required' })
  }
  if (!Array.isArray(tools)) {
    return res.status(400).json({ message: 'tools must be an array' })
  }

  const { api, localHeaders } = visionConfig({})
  try {
    const outcome = await saveProgramToolsOnPi(api, localHeaders, programId, tools)
    if (!outcome.ok) {
      return res.status(outcome.status).json(outcome.data)
    }
    res.json({ ok: true, programId })
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/**
 * POST /api/vision/save-and-run-once — save tools then run inspection (proxied remote API).
 * Body: { programId, tools, includeImage?: boolean }
 */
app.post('/api/vision/save-and-run-once', optionalAuth, async (req, res) => {
  const { programId, tools, includeImage } = req.body ?? {}
  if (programId == null) {
    return res.status(400).json({ message: 'programId is required' })
  }
  if (!Array.isArray(tools)) {
    return res.status(400).json({ message: 'tools must be an array' })
  }

  const cfg = visionConfig({})
  try {
    const outcome = await saveToolsAndRunOnceOnPi(cfg, programId, tools, {
      includeImage: includeImage !== false,
    })
    if (!outcome.ok) {
      const payload = outcome.data ?? {}
      return res.status(outcome.status && outcome.status >= 400 ? outcome.status : 502).json({
        error: payload.error ?? payload.message ?? `Vision ${outcome.phase ?? 'request'} failed`,
        ...normalizeInspectionRunData(payload),
      })
    }
    res.json(outcome.data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** POST /api/vision/run-once — run inspection without saving tools (proxied remote API). */
app.post('/api/vision/run-once', optionalAuth, async (req, res) => {
  const { programId, includeImage } = req.body ?? {}
  if (programId == null) {
    return res.status(400).json({ message: 'programId is required' })
  }

  const cfg = visionConfig({})
  try {
    const outcome = await runInspectionOnceOnPi(cfg.api, cfg.remoteHeaders, programId, {
      includeImage: includeImage === true,
    })
    if (!outcome.ok) {
      const payload = outcome.data ?? {}
      return res.status(outcome.status).json({
        error: payload.error ?? payload.message ?? `Inspection failed (${outcome.status})`,
        ...normalizeInspectionRunData(payload),
      })
    }
    res.json(normalizeInspectionRunData(outcome.data))
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** POST /api/vision/run-with-template — apply template to program inspection */
app.post('/api/vision/run-with-template', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/inspection/run-with-template`, {
      method: 'POST',
      headers: localHeaders,
      body: JSON.stringify(req.body),
    })
    const data = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

// ── References ────────────────────────────────────────────────────────────────

const RBK_VALUES = new Set(['RBK1', 'RBK2', 'RBK3'])
const TOOL_CONFIG_MODES = new Set(['general', 'specific'])

function normalizeRbk(value) {
  const s = String(value ?? 'RBK1').toUpperCase().replace(/\s+/g, '')
  return RBK_VALUES.has(s) ? s : 'RBK1'
}

function normalizeToolConfigMode(value) {
  const s = String(value ?? 'general').toLowerCase()
  return TOOL_CONFIG_MODES.has(s) ? s : 'general'
}

function parseSpecificToolsJson(raw) {
  if (!raw || raw === '') return null
  try {
    const parsed = JSON.parse(String(raw))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function serializeSpecificTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return ''
  return JSON.stringify(tools)
}

function mapReferenceRow(row) {
  const { specific_tools_json, ...rest } = row
  const mode = normalizeToolConfigMode(row.tool_config_mode)
  const specific_tools = parseSpecificToolsJson(specific_tools_json)
  return {
    ...rest,
    is_active: !!row.is_active,
    vision_inspection_enabled: row.vision_inspection_enabled !== 0,
    send_barcode_weld_enabled: row.send_barcode_weld_enabled !== 0,
    send_barcode_shrink_enabled: row.send_barcode_shrink_enabled !== 0,
    rbk: normalizeRbk(row.rbk),
    tool_config_mode: mode,
    specific_tool_template_id: row.specific_tool_template_id ?? null,
    specific_tools: mode === 'specific' ? specific_tools : null,
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
    tool_config_mode,
    specific_tool_template_id,
    specific_tools,
  } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ message: 'Name is required' })
  const exists = db.prepare('SELECT id FROM product_references WHERE LOWER(name) = LOWER(?)').get(String(name).trim())
  if (exists) return res.status(400).json({ message: `Reference "${name}" already exists` })
  const id = `REF-${String(Date.now()).slice(-6)}`
  const now = new Date().toISOString()
  const mode = normalizeToolConfigMode(tool_config_mode)
  const toolsJson = mode === 'specific' ? serializeSpecificTools(specific_tools) : ''
  db.prepare(`
    INSERT INTO product_references (
      id, name, description, is_active, vision_program_id,
      vision_inspection_enabled, send_barcode_weld_enabled, send_barcode_shrink_enabled,
      rbk, tool_config_mode, specific_tool_template_id, specific_tools_json, created_at, updated_at
    )
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(name).trim(),
    description ? String(description).trim() : '',
    vision_program_id ?? null,
    vision_inspection_enabled === false ? 0 : 1,
    send_barcode_weld_enabled === false ? 0 : 1,
    send_barcode_shrink_enabled === false ? 0 : 1,
    normalizeRbk(rbk),
    mode,
    mode === 'specific' ? (specific_tool_template_id ?? null) : null,
    toolsJson,
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
    tool_config_mode,
    specific_tool_template_id,
    specific_tools,
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
  if (tool_config_mode !== undefined) {
    const mode = normalizeToolConfigMode(tool_config_mode)
    db.prepare('UPDATE product_references SET tool_config_mode = ?, updated_at = ? WHERE id = ?').run(mode, now, id)
    if (mode === 'general') {
      db.prepare('UPDATE product_references SET specific_tool_template_id = NULL, specific_tools_json = ?, updated_at = ? WHERE id = ?').run('', now, id)
    }
  }
  if (specific_tool_template_id !== undefined) {
    db.prepare('UPDATE product_references SET specific_tool_template_id = ?, updated_at = ? WHERE id = ?').run(specific_tool_template_id ?? null, now, id)
  }
  if (specific_tools !== undefined) {
    const modeRow = db.prepare('SELECT tool_config_mode FROM product_references WHERE id = ?').get(id)
    const mode = normalizeToolConfigMode(tool_config_mode ?? modeRow?.tool_config_mode)
    const json = mode === 'specific' ? serializeSpecificTools(specific_tools) : ''
    db.prepare('UPDATE product_references SET specific_tools_json = ?, updated_at = ? WHERE id = ?').run(json, now, id)
  }
  const updated = db.prepare('SELECT * FROM product_references WHERE id = ?').get(id)
  res.json(mapReferenceRow(updated))
})

app.delete('/api/references/:id', optionalAuth, async (req, res) => {
  const { id } = req.params
  const row = db.prepare('SELECT * FROM product_references WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'Reference not found' })

  let vision = null
  if (row.vision_program_id != null) {
    try {
      vision = await deleteReferenceVisionOnPi(visionConfig({}), {
        name: row.name,
        vision_program_id: row.vision_program_id,
        specific_tool_template_id: row.specific_tool_template_id,
      })
    } catch (err) {
      vision = {
        programId: row.vision_program_id,
        programDeleted: false,
        templatesDeleted: [],
        warnings: [err.message || 'Vision Pi cleanup failed'],
      }
    }
  }

  db.prepare('DELETE FROM product_references WHERE id = ?').run(id)
  res.json({ status: 'ok', vision })
})

/**
 * POST /api/references/broadcast
 * Body: { code: string } or { name: string } — scanned or typed reference; must match an **active** row in product_references (case-insensitive name).
 * On success: sends canonical `name` from DB over both USB serial ports (welding + shrink), same framing as a barcode scanner (text + line ending).
 */
app.post('/api/references/broadcast', optionalAuth, async (req, res) => {
  try {
    const code = String(req.body?.code ?? req.body?.name ?? '').trim()
    if (!code) return res.status(400).json({ message: 'code or name required' })
    const row = db
      .prepare('SELECT * FROM product_references WHERE LOWER(name) = LOWER(?) AND is_active = 1')
      .get(code)
    if (!row) return res.status(404).json({ message: 'Reference not found or inactive' })
    const mapped = mapReferenceRow(row)
    setLoadedReference(mapped.id)
    const { sentTo, skipped } = await broadcastReferenceToMachines(String(row.name), {
      weld: mapped.send_barcode_weld_enabled,
      shrink: mapped.send_barcode_shrink_enabled,
    })
    res.json({
      ok: true,
      name: row.name,
      reference: mapped,
      rbk: mapped.rbk,
      vision_inspection_enabled: mapped.vision_inspection_enabled,
      sentTo,
      serialSkipped: skipped,
    })
  } catch (err) {
    console.error('[references/broadcast]', err)
    res.status(500).json({ message: err.message || 'broadcast failed' })
  }
})

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: getDbPath() })
})

// ── Pick & Place (New_version_pick&place — shared HTTP handler) ───────────────

pickPlace.onEvent(line => console.log(`[pick-place] ${line}`))

app.use(async (req, res, next) => {
  try {
    const handled = await handlePickPlaceHttpRequest(req, res, { apiPort: PORT })
    if (!handled) next()
  } catch (err) {
    next(err)
  }
})

const asyncRoute = fn => (req, res, next) => fn(req, res).catch(next)

// ── Lifter (EtherCAT) ───────────────────────────────────────────────────────────

/** GET /api/lifter/status — reads DI/DO for lifter when bridge is up */
app.get('/api/lifter/status', asyncRoute(async (_req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.json({ connected: false, ethercat: ecm.getStatus() })
  }
  try {
    const snap = await getLifterSnapshot(ecm)
    res.json({ connected: true, ethercat: ecm.getStatus(), ...snap })
  } catch (err) {
    res.status(503).json({ connected: true, error: err.message, ethercat: ecm.getStatus() })
  }
}))

/** POST /api/lifter/connect — spawn pysoem bridge and init slave OP */
app.post('/api/lifter/connect', asyncRoute(async (_req, res) => {
  try {
    await ensureEtherCAT()
    const ecm = getEtherCATManager()
    const snap = await getLifterSnapshot(ecm)
    res.json({ ok: true, ethercat: ecm.getStatus(), ...snap })
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message })
  }
}))

/** POST /api/lifter/disconnect */
app.post('/api/lifter/disconnect', asyncRoute(async (_req, res) => {
  try {
    await shutdownEtherCAT()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[EtherCAT] Disconnect cleanup: ${msg}`)
  }
  res.json({ ok: true, ethercat: getEtherCATManager().getStatus() })
}))

/**
 * POST /api/lifter/outputs
 * Body: { gripA?, gripB?, cylUp?, cylDn? } booleans — omitted keys unchanged is NOT supported;
 * always send all four for a full snapshot write.
 */
app.post('/api/lifter/outputs', asyncRoute(async (req, res) => {
  const b = req.body || {}
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'EtherCAT not connected' })
  }
  const gripA = !!b.gripA
  const gripB = !!b.gripB
  const cylUp = !!b.cylUp
  const cylDn = !!b.cylDn
  await setLifterOutputs(ecm, { gripA, gripB, cylUp, cylDn })
  const snap = await getLifterSnapshot(ecm)
  res.json({ ok: true, ...snap })
}))

/** POST /api/lifter/safe — all lifter DOs off */
app.post('/api/lifter/safe', asyncRoute(async (_req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'EtherCAT not connected' })
  }
  await lifterSafe(ecm)
  const snap = await getLifterSnapshot(ecm)
  res.json({ ok: true, ...snap })
}))

/**
 * POST /api/lifter/cycle — full automated sequence (close → up → dwell → open → down)
 * Body: { waitAfterUpMs?: number } — time at top before opening grippers (pick-and-place window)
 */
app.post('/api/lifter/cycle', asyncRoute(async (req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'EtherCAT not connected' })
  }
  const waitAfterUpMs = req.body?.waitAfterUpMs
  try {
    const result = await runLifterCycle(ecm, { waitAfterUpMs })
    const snap = await getLifterSnapshot(ecm)
    res.json({ ok: true, ...result, ...snap })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: msg })
  }
}))

// ── Pneumatics (EtherCAT DO0–DO5) ─────────────────────────────────────────────

/** GET /api/pneumatics/status — DO0–DO5 state and signal map */
app.get('/api/pneumatics/status', asyncRoute(async (_req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.json({ connected: false, ethercat: ecm.getStatus(), map: PNEUMATIC_OUTPUTS })
  }
  try {
    const snap = await getPneumaticSnapshot(ecm)
    res.json({ connected: true, ethercat: ecm.getStatus(), ...snap })
  } catch (err) {
    res.status(503).json({ connected: true, error: err.message, ethercat: ecm.getStatus() })
  }
}))

/**
 * POST /api/pneumatics/outputs
 * Body: partial booleans — clampRight, clampLeft, leverUp, ppClamp, puller
 * (only keys sent are written; mainAir is always on — off only via /api/pneumatics/emergency-stop)
 */
app.post('/api/pneumatics/outputs', asyncRoute(async (req, res) => {
  const b = req.body || {}
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'EtherCAT not connected' })
  }
  const state = {}
  for (const key of Object.keys(PNEUMATIC_OUTPUTS)) {
    if (key === 'mainAir') continue
    if (key in b) state[key] = !!b[key]
  }
  if (!Object.keys(state).length) {
    return res.status(400).json({ ok: false, error: 'No pneumatic output keys in body' })
  }
  await setPneumaticOutputs(ecm, state)
  const snap = await getPneumaticSnapshot(ecm)
  res.json({ ok: true, ...snap })
}))

/** POST /api/pneumatics/safe — clamps open, lever down, puller off (main air unchanged) */
app.post('/api/pneumatics/safe', asyncRoute(async (_req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'EtherCAT not connected' })
  }
  await pneumaticsSafe(ecm)
  const snap = await getPneumaticSnapshot(ecm)
  res.json({ ok: true, ...snap })
}))

/** POST /api/pneumatics/emergency-stop — all DO0–DO5 off including main air */
app.post('/api/pneumatics/emergency-stop', asyncRoute(async (_req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'EtherCAT not connected' })
  }
  await emergencyStopPneumatics(ecm)
  resetMachineInitialization()
  resetProductionSequence()
  const snap = await getPneumaticSnapshot(ecm)
  res.json({ ok: true, ...snap })
}))

// ── Machine initialization (reference gate + DI0 panel button) ────────────────

/** GET /api/machine/init-status — reference loaded, initialized, DI0 button state */
app.get('/api/machine/init-status', asyncRoute(async (_req, res) => {
  const ecm = getEtherCATManager()
  const snap = await getMachineInitSnapshot(ecm)
  res.json({ ok: true, ethercat: ecm.getStatus(), ...snap })
}))

/**
 * POST /api/machine/initialize
 * Initialization sequence — normally triggered by DI0 (panel); HMI/dev may pass requireButton: false.
 * Body: { referenceId?: string, requireButton?: boolean }
 */
app.post('/api/machine/initialize', asyncRoute(async (req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'EtherCAT not connected' })
  }
  const bodyRef = req.body?.referenceId != null ? String(req.body.referenceId) : null
  const status = getMachineInitStatus()
  if (bodyRef && status.referenceId && bodyRef !== status.referenceId) {
    return res.status(409).json({
      ok: false,
      error: 'Reference changed — scan the current reference again before initializing',
    })
  }
  const requireButton = req.body?.requireButton !== false
  const source = requireButton ? 'api' : 'hmi'
  try {
    const result = await runMachineInitialization(ecm, { requireButton, source })
    const initSnap = await getMachineInitSnapshot(ecm)
    res.json({ ok: true, ...result, ...initSnap })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = /not pressed|no reference/i.test(msg) ? 409 : 503
    res.status(code).json({ ok: false, error: msg })
  }
}))

/** POST /api/machine/reference-loaded — sync active reference after HMI reload */
app.post('/api/machine/reference-loaded', asyncRoute(async (req, res) => {
  const id = req.body?.referenceId != null ? String(req.body.referenceId).trim() : ''
  if (!id) return res.status(400).json({ ok: false, error: 'referenceId required' })
  setLoadedReference(id)
  const snap = await getMachineInitSnapshot(getEtherCATManager())
  res.json({ ok: true, ...snap })
}))

/** POST /api/machine/clear-reference — clear loaded reference and init gate */
app.post('/api/machine/clear-reference', asyncRoute(async (_req, res) => {
  clearLoadedReference()
  resetProductionSequence()
  const snap = await getMachineInitSnapshot(getEtherCATManager())
  res.json({ ok: true, ...snap })
}))

/**
 * POST /api/machine/start-production
 * Full production cycle (DI1 Start or HMI). Body: { referenceId?, requireButton?: false }
 */
app.post('/api/machine/start-production', asyncRoute(async (req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'EtherCAT not connected' })
  }
  const bodyRef = req.body?.referenceId != null ? String(req.body.referenceId) : null
  const status = getMachineInitStatus()
  if (bodyRef && status.referenceId && bodyRef !== status.referenceId) {
    return res.status(409).json({
      ok: false,
      error: 'Reference changed — scan the current reference again',
    })
  }
  const requireButton = req.body?.requireButton !== false
  const source = requireButton ? 'api' : 'hmi'
  try {
    const result = await runProductionSequence(ecm, { requireButton, source })
    const snap = await getMachineInitSnapshot(ecm)
    res.json({ ok: true, ...result, ...snap })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = /not pressed|not initialized|no reference|cannot start/i.test(msg) ? 409 : 503
    res.status(code).json({ ok: false, error: msg })
  }
}))

/** POST /api/machine/stop-production — end production sequence */
app.post('/api/machine/stop-production', asyncRoute(async (_req, res) => {
  const result = stopProductionSequence()
  const snap = await getMachineInitSnapshot(getEtherCATManager())
  res.json({ ok: true, ...result, ...snap })
}))

// ── Express error handler (asyncRoute + vision failures) ────────────────────

app.use((err, _req, res, _next) => {
  const msg = err instanceof Error ? err.message : String(err)
  const status = Number(err?.statusCode) || 500
  console.error('[api]', msg)
  if (res.headersSent) return
  res.status(status).json({ ok: false, error: msg })
})

// ─────────────────────────────────────────────────────────────────────────────

setReferenceSerialFromSettings(readSystemSettings().reference_serial)

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[maindata-api] http://0.0.0.0:${PORT}  db=${getDbPath()}`)
  if (envWantsEtherCATAutoConnect()) {
    ensureEtherCAT()
      .then(() => {
        console.log('[EtherCAT] Auto-connect finished')
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[EtherCAT] Auto-connect failed: ${msg}`)
      })
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[maindata-api] Port ${PORT} already in use — another instance is running. Exiting.`)
    process.exit(0)
  } else {
    throw err
  }
})

// ── Graceful shutdown (release EtherCAT master when API / kiosk stops) ─────────

let _shuttingDown = false

async function gracefulShutdown(signal) {
  if (_shuttingDown) return
  _shuttingDown = true
  console.log(`[maindata-api] ${signal} — shutting down…`)

  const forceExit = setTimeout(() => {
    console.error('[maindata-api] Shutdown timed out — forcing exit')
    process.exit(1)
  }, 20000)

  try {
    await shutdownEtherCAT()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[EtherCAT] Shutdown cleanup failed: ${msg}`)
  }

  await new Promise((resolve) => {
    server.close(() => resolve())
  })

  try {
    db.close()
  } catch (_) {
    /* ignore */
  }

  clearTimeout(forceExit)
  console.log('[maindata-api] Shutdown complete')
  process.exit(0)
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    gracefulShutdown(sig).catch((err) => {
      console.error('[maindata-api] Shutdown error:', err)
      process.exit(1)
    })
  })
}
