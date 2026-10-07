/**
 * Settings API — SQLite `maindata.db` (system settings + users).
 *
 *   npm install --prefix backend
 *   npm run server   (from frontend/)  OR  npm start (from backend/)
 *
 * DB path: `backend/data/maindata.db` or `MAIN_DATA_DB_PATH`.
 * Frontend: `VITE_API_BASE_URL=http://127.0.0.1:3333` (see `backend/.env.example`).
 */
import './lib/envBootstrap.mjs'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import SqliteStoreFactory from 'better-sqlite3-session-store'
import Busboy from 'busboy'
import { openDatabase, getDbPath } from './lib/db.mjs'
import { resolveSessionSecret } from './lib/sessionSecret.mjs'
import { initProductionContext } from './lib/productionContext.mjs'
import {
  refreshShrinkTubeDerived,
  backfillShrinkTubeDerivedBestEffort,
  hasCompleteDerivedGeometry,
} from './lib/centringDerivedRecipe.mjs'
import { migrateStoredRoleValue } from './lib/legacyRoleNames.mjs'
import { verifyPassword, hashPassword } from './lib/crypto.mjs'
import { mergeRoleTabAccess, ensureRequiredTabs } from './lib/roleTabAccessDefaults.mjs'
import pickPlace, { handlePickPlaceHttpRequest, initPickPlaceSqliteConfig, loadPickPlaceConfig } from './lib/pickPlace.mjs'
import {
  resolveManualTargets,
  runCenteringTravel,
  runMoveToPick,
  runReturnToBackoff,
  runHome,
  setPpClamp,
} from './lib/pickPlaceManualMotion.mjs'
import { handleCentringHttpRequest, initCentringSqliteConfig, loadCentringConfig, closeSerialSession } from './lib/centring.mjs'
import * as heightCalibration from './lib/centringHeightCalibrationService.mjs'
import {
  coerceVisionInspectionWithChecks,
  normalizeVisionChecksConfig,
  parseVisionChecksJson,
  serializeVisionChecksConfig,
} from './lib/visionChecksConfigStore.mjs'
import { getEtherCATManager, DO } from './lib/ethercat.mjs'
import {
  ensureEtherCAT,
  getLifterSnapshot,
  setLifterOutputs,
  lifterSafe,
  runLifterCycle,
  shutdownEtherCAT,
} from './lib/lifter.mjs'
import {
  startCommunicationSupervisor,
  stopCommunicationSupervisor,
  bootEtherCATWithReconnect,
} from './lib/communicationSupervisor.mjs'
import {
  getPneumaticSnapshot,
  setPneumaticOutputs,
  pneumaticsSafe,
  pneumaticsSafeBestEffort,
  emergencyStopPneumatics,
  PNEUMATIC_OUTPUTS,
} from './lib/pneumatics.mjs'
import { insertAudit } from './lib/settings/audit.mjs'
import {
  setLoadedReference,
  clearLoadedReference,
  getMachineInitSnapshot,
  getMachineInitStatus,
  resetMachineInitialization,
  reconcileReferenceReadyAfterHPre,
  applyReferenceHPreAfterLoad,
} from './lib/machineInit.mjs'
import { runMachineSetup, SetupError } from './lib/machineSetup.mjs'
import {
  runProductionSequence,
  stopProductionSequence,
  resetProductionSequence,
  initProductionSequenceConfig,
  reloadProductionSequenceConfig,
  initProductionVision,
} from './lib/productionSequence.mjs'
import { requestProductionStart, clearProductionQueueOnEmergency } from './lib/productionJobQueue.mjs'
import { isProductionActive, getLastJobOutcome } from './lib/machineLifecycle.mjs'
import { getMaintenanceMode, setMaintenanceMode, isMaintenanceActive } from './lib/maintenanceMode.mjs'
import { runMaintenanceCentringCycle } from './lib/centringMaintenance.mjs'
import { getPanelFocus, setPanelFocus, clearPanelFocus, PANEL_FOCUS } from './lib/panelFocus.mjs'
import { setTowerTestOverride, clearTowerTestOverride } from './lib/indicatorTower.mjs'
import {
  setPanelLedTestOverride,
  clearPanelLedTestOverride,
  applyPanelLeds,
  getEffectivePanelLeds,
} from './lib/panelLeds.mjs'
import {
  queryProductionRuns,
  queryErrors,
  exportProductionRuns,
  exportErrors,
  archiveAndPrune,
} from './lib/historyStore.mjs'
import { initDoorInterlock, readSafetyInputsSnapshot } from './lib/doorInterlock.mjs'
import { broadcastReferenceToMachines, setReferenceSerialFromSettings } from './lib/referenceSerialBridge.mjs'
import { createMachineOperationAccess, initMachineOperationAccess } from './lib/machineOperationAccess.mjs'
import { resolveVisionConfig } from './lib/visionConfig.mjs'
import { deleteReferenceVisionOnPi } from './lib/referenceVisionCleanup.mjs'
import { deleteVisionProgramOnPi } from './lib/visionProgramDelete.mjs'
import {
  captureAndSaveOnPi,
  fetchVisionProgramOnPi,
  normalizeInspectionRunData,
  runInspectionOnceOnPi,
  saveProgramToolsOnPi,
  saveToolsAndRunOnceOnPi,
  validateCaptureAndSaveFolder,
} from './lib/visionProgramTools.mjs'
import {
  getLastVisionCanvasImage,
  getLastVisionCanvasMeta,
  publishLastVisionCanvas,
} from './lib/productionVisionInspection.mjs'
import {
  initSettingsService,
  createSettingsRouter,
  settingsErrorResponse,
} from './lib/settings/index.mjs'

const PORT = Number(process.env.PORT || 3333)
// Never fall back to a shared, source-controlled secret: either honour a real
// SESSION_SECRET from the environment or use a persistent random one stored
// next to the database. A weak/placeholder value throws and aborts startup.
const SESSION_SECRET = resolveSessionSecret({ dataDir: path.dirname(getDbPath()) })

function envFlag(name, fallback = false) {
  const v = process.env[name]
  if (v === undefined || v === null || String(v).trim() === '') return fallback
  const s = String(v).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

/** Absolute session lifetime (default 7 days); refreshed on activity via `rolling`. */
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS) || 7 * 24 * 60 * 60 * 1000
/** Send the session cookie only over HTTPS. Enable in any TLS/reverse-proxy deployment. */
const SESSION_COOKIE_SECURE = envFlag('SESSION_COOKIE_SECURE', false)
/** `lax` is safe for same-site kiosks; use `none` (with secure) for cross-site API origins. */
const SESSION_COOKIE_SAMESITE = (process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase()
/** Trust the first proxy hop so `secure` cookies work behind nginx/traefik. */
const TRUST_PROXY = envFlag('TRUST_PROXY', SESSION_COOKIE_SECURE)

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

initPickPlaceSqliteConfig(db)
initCentringSqliteConfig(db)
initProductionSequenceConfig(db)

/** @type {ReturnType<typeof initSettingsService>} */
const settingsService = initSettingsService({
  db,
  runtime: {
    loadPickPlaceConfig,
    loadCentringConfig,
    closeSerialSession,
    reloadProductionSequenceConfig,
    setReferenceSerialFromSettings,
  },
})

function readSystemSettings() {
  return settingsService.getAssembledSystemView()
}

function readSystemSettingsForInit() {
  return readSystemSettings()
}

function writeSystemSettings(merge) {
  return settingsService.patchSystemFlat(merge, { actorUsername: 'system' })
}

initProductionVision(db, readSystemSettingsForInit)
initProductionContext(db, readSystemSettingsForInit)
try {
  const backfill = backfillShrinkTubeDerivedBestEffort(db, readSystemSettings())
  if (backfill.ok || backfill.skipped) {
    console.log(
      `[CentringDerived] backfill ok=${backfill.ok} skipped=${backfill.skipped}`,
    )
  }
  if (backfill.failures?.length) {
    for (const f of backfill.failures.slice(0, 5)) {
      console.warn(`[CentringDerived] skip tube ${f.name || f.id}: ${f.error}`)
    }
  }
} catch (err) {
  console.warn(
    `[CentringDerived] backfill failed: ${err instanceof Error ? err.message : err}`,
  )
}
initDoorInterlock({ readSystemSettings: readSystemSettingsForInit })
const app = express()

// Required for `secure` cookies to be emitted when running behind a TLS proxy.
if (TRUST_PROXY) app.set('trust proxy', 1)

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

// Persist sessions in SQLite (reusing the main DB) for the lifetime of this
// process — rolling cookies keep an active shift signed in until Logout.
// On every backend start (machine reboot / service restart) wipe the store so
// operators must sign in again; do not carry sessions across boots.
const SqliteStore = SqliteStoreFactory(session)
const sessionStore = new SqliteStore({
  client: db,
  // Sweep expired rows so the table doesn't grow unbounded on a 24/7 kiosk.
  expired: { clear: true, intervalMs: 15 * 60 * 1000 },
})
try {
  db.prepare('DELETE FROM sessions').run()
} catch (err) {
  console.warn('[session] could not clear sessions on startup:', err?.message || err)
}

app.use(
  session({
    name: 'app.sid',
    secret: SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    // Extend the cookie on each authenticated request so an actively-used
    // kiosk isn't logged out mid-shift at the absolute maxAge boundary.
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: SESSION_COOKIE_SAMESITE,
      secure: SESSION_COOKIE_SECURE,
      maxAge: SESSION_MAX_AGE_MS,
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

function requireBypass(req, res, next) {
  if (migrateStoredRoleValue(req.userRow?.role) !== 'BYPASS') {
    return res.status(403).json({
      status: 'error',
      error: { code: 'FORBIDDEN', message: 'Bypass access required', details: [] },
    })
  }
  next()
}

function patchKeys(body) {
  return Object.keys(body || {}).filter(k => body[k] !== undefined)
}

/** Effective role for authorization — the signed-in role, or NONE for a kiosk. */
function effectiveRoleName(req) {
  return req.userRow ? migrateStoredRoleValue(req.userRow.role) : 'NONE'
}

/** Does the caller's effective role grant a settings sub-tab in the access matrix? */
function hasSettingsTabAccess(req, tabKey) {
  // BYPASS (vendor) bypasses every tab gate and is not part of the matrix.
  if (rank(req.userRow) >= ROLE_RANK.BYPASS) return true
  const row = readMergedRoleTabAccess()[effectiveRoleName(req)]
  return !!(row && Array.isArray(row.tabs) && row.tabs.includes(tabKey))
}

/**
 * Settings → Maintenance APIs: Bypass always; others need `settings_maintenance`
 * in Tab Access (Admin is typically granted by Bypass under User Management).
 */
function requireMaintenanceAccess(req, res, next) {
  if (!hasSettingsTabAccess(req, 'settings_maintenance')) {
    return res.status(403).json({ message: 'Maintenance access required' })
  }
  next()
}

function respondSystemSettingsPatch(req, res) {
  const body = req.body
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ message: 'JSON body required' })
  }
  const keys = patchKeys(body)
  if (keys.length === 0) {
    return res.status(400).json({ message: 'No settings to update' })
  }

  const decision = settingsService.authorizeFlatPatch(keys, {
    userRow: req.userRow,
    isMachineOperationAllowed: machineOp.isMachineOperationAllowed(req),
    hasSettingsTabAccess: (tabKey) => hasSettingsTabAccess(req, tabKey),
    rank,
    adminMinRank: ROLE_RANK.ADMIN,
  })
  if (!decision.ok) {
    return res.status(decision.status).json({ message: decision.message })
  }

  try {
    settingsService.patchSystemFlat(body, {
      userRow: req.userRow,
      userId: req.userRow?.id,
      username: req.userRow?.username || 'kiosk',
    })
    // Unauth + require_login ON: return tightened public view (do not leak
    // serial/quickpass/motion into the PUT response / HMI cache).
    // Open kiosk and authenticated callers keep full non-secret assemble.
    const settings =
      !req.userRow && machineOp.requireLoginEnabled()
        ? settingsService.getPublicSystemView()
        : settingsService.getAssembledSystemView({ includeSecretsMasked: !!req.userRow })
    return res.json({ status: 'success', settings })
  } catch (err) {
    const { status, body: errBody } = settingsErrorResponse(err)
    if (status === 422 || status === 409) {
      return res.status(status).json(errBody)
    }
    return res.status(status).json({ message: err.message || 'Settings update failed' })
  }
}

function readMergedRoleTabAccess() {
  const settings = readSystemSettings()
  return mergeRoleTabAccess(settings.role_tab_access)
}

function persistRoleTabAccess(map) {
  writeSystemSettings({ role_tab_access: map })
}

const machineOp = initMachineOperationAccess({ readSystemSettings, getUserById })

function denyMachineOperation(req, res) {
  const reason = machineOp.denialReason(req)
  if (!reason) return false
  res.status(403).json({ ok: false, message: reason, error: reason })
  return true
}

/**
 * Gate shrink-tube catalog writes (POST/PATCH/DELETE) with the same machine-op +
 * settings tab access pattern used for page settings (`settings_shrink_tubes`).
 * GET list stays readable. Returns true when the response was already sent.
 */
function denyShrinkTubeWrite(req, res) {
  if (!machineOp.isMachineOperationAllowed(req)) {
    if (!req.userRow && machineOp.requireLoginEnabled()) {
      res.status(401).json({ message: 'Not authenticated' })
    } else {
      res.status(403).json({ message: machineOp.DENIAL_MESSAGE })
    }
    return true
  }
  if (
    !hasSettingsTabAccess(req, 'settings_shrink_tubes') &&
    !hasSettingsTabAccess(req, 'settings_shrink_tubes_list')
  ) {
    res.status(403).json({ message: 'Not authorized for this settings page' })
    return true
  }
  return false
}

/**
 * Effective main/settings tab keys for this request — mirrors GET /api/settings/role-tab-access.
 * Guest (NONE) uses the NONE matrix row; when require_login is ON, unsigned clients are
 * forced to login+main only (same runtime override as the nav matrix).
 * Returns null when BYPASS (all tabs allowed).
 */
function effectiveTabsForRequest(req) {
  if (rank(req.userRow) >= ROLE_RANK.BYPASS) return null
  const role = effectiveRoleName(req)
  const row = readMergedRoleTabAccess()[role]
  if (!req.userRow && machineOp.requireLoginEnabled()) {
    return ['login', 'main']
  }
  return Array.isArray(row?.tabs) ? row.tabs : []
}

/** True when the caller's effective Tab Access matrix grants `tabKey` (BYPASS always). */
function hasMainTabAccess(req, tabKey) {
  const tabs = effectiveTabsForRequest(req)
  if (tabs == null) return true
  return tabs.includes(tabKey)
}

/**
 * History / error-history reads are gated by Tab Access (`history` / `error-history`),
 * including NONE (Guest). Not by machine-ops require_login alone.
 */
function denyHistoryAccess(req, res, tabKey = 'history') {
  if (hasMainTabAccess(req, tabKey)) return false
  if (!req.userRow && machineOp.requireLoginEnabled()) {
    res.status(401).json({ message: 'Not authenticated' })
  } else {
    res.status(403).json({ message: `Not authorized for tab: ${tabKey}` })
  }
  return true
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
  machineOp.registerKioskOperator(row.id)
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
  const uid = req.session.userId
  req.session.destroy(() => {
    machineOp.clearKioskOperator(uid)
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
  const row = req.userRow ?? getUserById(req.session.userId)
  if (!row || !row.is_active) {
    // Session references a user that was deleted/deactivated after auth.
    req.session.destroy(() => {})
    return res.status(401).json({ message: 'Not authenticated' })
  }
  if (!verifyPassword(String(current_password), row.password_hash, row.password_salt)) {
    return res.status(400).json({ message: 'Current password is incorrect' })
  }
  const { hash, salt } = hashPassword(np)
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, row.id)
  res.json({ status: 'ok' })
})

// ── System settings (facade) + domain Settings API ───────────────────────────

app.get('/api/settings/system', (req, res) => {
  // Authenticated: full assembled view (secrets masked).
  // Unauthenticated + require_login ON: tightened public boot subset only.
  // Unauthenticated + require_login OFF (open kiosk): full non-secret assemble.
  if (req.session?.userId) {
    return res.json({
      status: 'success',
      settings: settingsService.getAssembledSystemView({ includeSecretsMasked: true }),
    })
  }
  if (machineOp.requireLoginEnabled()) {
    return res.json({
      status: 'success',
      settings: settingsService.getPublicSystemView(),
    })
  }
  return res.json({
    status: 'success',
    settings: settingsService.getAssembledSystemView(),
  })
})

app.put('/api/settings/system', optionalAuth, respondSystemSettingsPatch)

// Role tab access MUST be registered before createSettingsRouter(`/api/settings`),
// otherwise GET/PUT `/api/settings/role-tab-access` is captured as domain id
// `role-tab-access` and returns UNKNOWN_DOMAIN 404.
// ── Role tab access (main nav + settings sub-pages) ──────────────────────────

app.get('/api/settings/role-tab-access', optionalAuth, (req, res) => {
  const full = readMergedRoleTabAccess()
  // BYPASS bypasses all tab gates and is never part of the configurable matrix.
  const { BYPASS: _bypass, ...manageable } = full
  if (!req.userRow) {
    const none = manageable.NONE
    // Effective (runtime) navigation for an unsigned-in kiosk:
    //  - require_login OFF → full access to whatever the NONE matrix grants.
    //  - require_login ON  → locked down to the sign-in and main pages only,
    //    regardless of the configured NONE matrix (which admins still edit via
    //    the authenticated branch below).
    if (machineOp.requireLoginEnabled()) {
      return res.json({ roles: { NONE: { ...(none || {}), tabs: ['login', 'main'] } } })
    }
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
    const key = String(t)
    // System is Bypass-only nav — never assignable through Tab Access.
    if (key === 'settings_system') {
      return res.status(400).json({ message: 'System is not managed in Tab Access' })
    }
    if (!allowed.has(key)) {
      return res.status(400).json({ message: `Tab not allowed for role: ${key}` })
    }
  }
  const nextTabs = ensureRequiredTabs(roleKey, tabs.map(String))
  full[roleKey] = { ...row, tabs: nextTabs }
  persistRoleTabAccess(full)
  res.json({ status: 'ok', roles: full })
})

app.use(
  '/api/settings',
  createSettingsRouter({
    express,
    settings: settingsService,
    optionalAuth,
    requireAuth,
    requireAdmin,
    machineOp,
    hasSettingsTabAccess,
    rank,
    adminMinRank: ROLE_RANK.ADMIN,
  }),
)

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

/** GET /api/vision/ping — check if Vision Pi is reachable using saved/env config.
 * Probes /remote/info (fast, canonical) instead of /health, which can block on the
 * vision Pi (camera-bound handler) and hang the reachability check. */
app.get('/api/vision/ping', async (_req, res) => {
  const { api, remoteHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/remote/info`, {
      headers: remoteHeaders,
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

/** GET /api/vision/programs/:id/reference-template — Vision Pi reference template */
app.get('/api/vision/programs/:id/reference-template', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/programs/${req.params.id}/reference-template`, {
      headers: localHeaders,
      signal: AbortSignal.timeout(30000),
    })
    const data = await upstream.json().catch(() => ({}))
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(502).json({ message: `Vision Pi unreachable: ${err.message}` })
  }
})

/** PUT /api/vision/programs/:id/reference-template — upsert reference template on Vision Pi */
app.put('/api/vision/programs/:id/reference-template', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/programs/${req.params.id}/reference-template`, {
      method: 'PUT',
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

/** POST /api/vision/programs/:id/reference-template/rebuild — rebuild from master image */
app.post('/api/vision/programs/:id/reference-template/rebuild', optionalAuth, async (req, res) => {
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/programs/${req.params.id}/reference-template/rebuild`, {
      method: 'POST',
      headers: localHeaders,
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(120000),
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
  const { isVisionCameraUnavailableHttp } = await import('./lib/visionCameraAvailability.mjs')
  const { api, localHeaders } = visionConfig({})
  try {
    const upstream = await fetch(`${api}/camera/capture`, {
      method: 'POST',
      headers: localHeaders,
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(60000),
    })
    const data = await upstream.json().catch(() => ({}))
    if (isVisionCameraUnavailableHttp(upstream.status, data)) {
      return res.json({
        status: 'success',
        cameraUnavailable: true,
        message: data.message ?? data.error ?? 'Camera not connected',
      })
    }
    res.status(upstream.status).json(data)
  } catch (err) {
    return res.json({
      status: 'success',
      cameraUnavailable: true,
      message: 'Camera not connected or vision system unreachable',
    })
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

/**
 * POST /api/vision/camera/capture-and-save — capture+save on Vision Pi (no tool judgment).
 * Proxies POST /api/remote/camera/capture-and-save with the remote key from resolveVisionConfig.
 *
 * Errors use the project envelope `{ status:'error', error:{ code, message, details } }`
 * plus Vision-compatible `ok: false` for diagnostics.
 */
app.post('/api/vision/camera/capture-and-save', optionalAuth, async (req, res) => {
  const body = req.body ?? {}
  const validated = validateCaptureAndSaveFolder(body.folder)
  if (!validated.ok) {
    return res.status(validated.status).json({
      status: 'error',
      ok: false,
      error: {
        code: validated.code,
        message: validated.message,
        details: validated.details,
      },
    })
  }

  const cfg = visionConfig({})
  try {
    const outcome = await captureAndSaveOnPi(cfg.api, cfg.remoteHeaders, {
      folder: validated.folder,
      programId: body.programId,
      referenceId: body.referenceId,
      triggerType: body.triggerType ?? 'remote',
      includeImage: body.includeImage !== false,
      filenameHint: body.filenameHint,
    })
    if (!outcome.ok) {
      const payload = outcome.data ?? {}
      const message =
        payload.error ??
        payload.detail ??
        payload.message ??
        `Capture failed (${outcome.status})`
      const code =
        payload.code ||
        (outcome.status === 401
          ? 'UNAUTHORIZED'
          : outcome.status === 503
            ? 'CAMERA_UNAVAILABLE'
            : outcome.status === 400
              ? 'INVALID_REQUEST'
              : 'CAPTURE_FAILED')
      return res.status(outcome.status || 500).json({
        status: 'error',
        ok: false,
        error: {
          code,
          message: String(message),
          details: payload.detail != null ? [{ message: String(payload.detail) }] : [],
        },
      })
    }
    const data = outcome.data ?? {}
    const image_b64 = data.image_b64 ?? data.image ?? undefined
    // Publish for HMI canvas when Vision returned a frame (proxy + production share store).
    if (image_b64) {
      publishLastVisionCanvas({
        folder: validated.folder,
        format: data.format || 'png',
        image_b64,
        path: data.path,
        filename: data.filename,
      })
    }
    return res.json({
      status: 'success',
      ok: true,
      data: {
        ...data,
        image_b64,
        canvas: getLastVisionCanvasMeta(),
      },
    })
  } catch (err) {
    return res.status(502).json({
      status: 'error',
      ok: false,
      error: {
        code: 'VISION_UNREACHABLE',
        message: `Vision Pi unreachable: ${err.message}`,
        details: [],
      },
    })
  }
})

/**
 * GET /api/vision/last-production-capture — one-shot image for HMI canvas after capture-only.
 * Poll metadata via lastVisionCanvas.seq on /api/machine/init-status; fetch image when seq advances.
 *
 * Soft empty: HTTP 200 + `{ status:'success', data: null }` when nothing is available yet
 * (or seq mismatch). This is not an operator fault — do not use 404 for the idle case.
 */
app.get('/api/vision/last-production-capture', optionalAuth, (req, res) => {
  const rawSeq = req.query.seq
  const wantSeq =
    rawSeq != null && String(rawSeq) !== '' && Number.isFinite(Number(rawSeq))
      ? Number(rawSeq)
      : null
  const payload = getLastVisionCanvasImage(wantSeq)
  if (!payload) {
    return res.json({
      status: 'success',
      data: null,
    })
  }
  return res.json({
    status: 'success',
    data: payload,
  })
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

// ── Shrink tubes & references (shared helpers) ────────────────────────────────

const TOOL_CONFIG_MODES = new Set(['general', 'specific'])

function normalizeToolConfigMode(value) {
  const s = String(value ?? 'general').toLowerCase()
  return TOOL_CONFIG_MODES.has(s) ? s : 'general'
}

// ── Shrink tubes ──────────────────────────────────────────────────────────────

const CENTRING_MECHANISMS = new Set(['upper', 'lower', 'upper_and_lower'])

function normalizeCentringMechanism(value) {
  const raw = String(value ?? 'upper').toLowerCase().replace(/\s+/g, '_')
  if (raw === 'upper_centring_mechanism' || raw === 'upper') return 'upper'
  if (raw === 'lower_centring_mechanism' || raw === 'lower') return 'lower'
  if (
    raw === 'upper_and_lower_centring_mechanism' ||
    raw === 'upper_and_lower' ||
    raw === 'both'
  ) {
    return 'upper_and_lower'
  }
  return CENTRING_MECHANISMS.has(raw) ? raw : 'upper'
}

function mapShrinkTubeRow(row) {
  const numOrNull = (key) => {
    const n = Number(row[key])
    return Number.isFinite(n) ? n : null
  }
  const { rbk: _legacyRbk, ...rest } = row
  return {
    ...rest,
    diameter_mm: Number(row.diameter_mm),
    length_mm: Number(row.length_mm),
    diameter_closing_gap_mm: Number(row.diameter_closing_gap_mm ?? 0),
    diameter_opening_gap_mm: Number(row.diameter_opening_gap_mm ?? 0),
    centring_length_tolerance_mm: Number(row.centring_length_tolerance_mm ?? 0),
    centring_mechanism: normalizeCentringMechanism(row.centring_mechanism),
    is_active: !!row.is_active,
    h_pre_mm: numOrNull('h_pre_mm'),
    h_post_mm: numOrNull('h_post_mm'),
    l_eff_mm: numOrNull('l_eff_mm'),
    centering_travel_mm: numOrNull('centering_travel_mm'),
    centering_input_mm: numOrNull('centering_input_mm'),
    centering_output_mm: numOrNull('centering_output_mm'),
    centering_move_travel_mm: numOrNull('centering_move_travel_mm'),
    centring_axis: row.centring_axis != null ? String(row.centring_axis) : null,
    centring_derived_updated_at: row.centring_derived_updated_at ?? null,
    has_derived_geometry: hasCompleteDerivedGeometry(row),
  }
}

function parsePositiveNumber(value, fieldName) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${fieldName} must be a positive number`)
  }
  return n
}

function parseNonNegativeNumber(value, fieldName) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${fieldName} must be zero or greater`)
  }
  return n
}

app.get('/api/shrink-tubes', optionalAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM shrink_tubes ORDER BY name COLLATE NOCASE').all()
  res.json(rows.map(mapShrinkTubeRow))
})

app.post('/api/shrink-tubes', optionalAuth, (req, res) => {
  if (denyShrinkTubeWrite(req, res)) return
  try {
    const {
      name,
      diameter_mm,
      length_mm,
      diameter_closing_gap_mm,
      diameter_opening_gap_mm,
      centring_length_tolerance_mm,
      centring_mechanism,
    } = req.body || {}
    if (!name?.trim()) return res.status(400).json({ message: 'Name is required' })
    const diameter = parsePositiveNumber(diameter_mm, 'Diameter')
    const length = parsePositiveNumber(length_mm, 'Length')
    const closingGap = parseNonNegativeNumber(diameter_closing_gap_mm ?? 0, 'Diameter closing gap')
    const openingGap = parseNonNegativeNumber(diameter_opening_gap_mm ?? 0, 'Diameter opening gap')
    const tolerance = parseNonNegativeNumber(centring_length_tolerance_mm ?? 0, 'Centring length tolerance')
    const mechanism = normalizeCentringMechanism(centring_mechanism)
    const exists = db.prepare('SELECT id FROM shrink_tubes WHERE LOWER(name) = LOWER(?)').get(String(name).trim())
    if (exists) return res.status(400).json({ message: `Shrink tube "${name}" already exists` })
    const id = `ST-${String(Date.now()).slice(-6)}`
    const now = new Date().toISOString()
    const insertTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO shrink_tubes (
          id, name, diameter_mm, length_mm, diameter_closing_gap_mm, diameter_opening_gap_mm,
          centring_length_tolerance_mm, centring_mechanism,
          is_active, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id,
        String(name).trim(),
        diameter,
        length,
        closingGap,
        openingGap,
        tolerance,
        mechanism,
        now,
        now,
      )
      refreshShrinkTubeDerived(db, id, readSystemSettings())
    })
    insertTx()
    const row = db.prepare('SELECT * FROM shrink_tubes WHERE id = ?').get(id)
    res.status(201).json(mapShrinkTubeRow(row))
  } catch (err) {
    res.status(400).json({ message: err.message || 'Invalid shrink tube data' })
  }
})

app.patch('/api/shrink-tubes/:id', optionalAuth, (req, res) => {
  if (denyShrinkTubeWrite(req, res)) return
  const { id } = req.params
  const row = db.prepare('SELECT * FROM shrink_tubes WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'Shrink tube not found' })
  try {
    const {
      name,
      diameter_mm,
      length_mm,
      diameter_closing_gap_mm,
      diameter_opening_gap_mm,
      centring_length_tolerance_mm,
      centring_mechanism,
      is_active,
    } = req.body || {}
    // Validate before writing so a failed parse never leaves a partial row.
    if (name !== undefined) {
      const conflict = db
        .prepare('SELECT id FROM shrink_tubes WHERE LOWER(name) = LOWER(?) AND id != ?')
        .get(String(name).trim(), id)
      if (conflict) return res.status(400).json({ message: `Shrink tube "${name}" already exists` })
    }
    const diameter = diameter_mm !== undefined ? parsePositiveNumber(diameter_mm, 'Diameter') : undefined
    const length = length_mm !== undefined ? parsePositiveNumber(length_mm, 'Length') : undefined
    const closingGap =
      diameter_closing_gap_mm !== undefined
        ? parseNonNegativeNumber(diameter_closing_gap_mm, 'Diameter closing gap')
        : undefined
    const openingGap =
      diameter_opening_gap_mm !== undefined
        ? parseNonNegativeNumber(diameter_opening_gap_mm, 'Diameter opening gap')
        : undefined
    const tolerance =
      centring_length_tolerance_mm !== undefined
        ? parseNonNegativeNumber(centring_length_tolerance_mm, 'Centring length tolerance')
        : undefined
    const mechanism =
      centring_mechanism !== undefined ? normalizeCentringMechanism(centring_mechanism) : undefined
    const geometryTouched =
      length_mm !== undefined ||
      diameter_closing_gap_mm !== undefined ||
      diameter_opening_gap_mm !== undefined ||
      centring_length_tolerance_mm !== undefined ||
      centring_mechanism !== undefined

    const now = new Date().toISOString()
    const patchTx = db.transaction(() => {
      if (name !== undefined) {
        db.prepare('UPDATE shrink_tubes SET name = ?, updated_at = ? WHERE id = ?').run(
          String(name).trim(),
          now,
          id,
        )
      }
      if (diameter !== undefined) {
        db.prepare('UPDATE shrink_tubes SET diameter_mm = ?, updated_at = ? WHERE id = ?').run(diameter, now, id)
      }
      if (length !== undefined) {
        db.prepare('UPDATE shrink_tubes SET length_mm = ?, updated_at = ? WHERE id = ?').run(length, now, id)
      }
      if (closingGap !== undefined) {
        db.prepare('UPDATE shrink_tubes SET diameter_closing_gap_mm = ?, updated_at = ? WHERE id = ?').run(
          closingGap,
          now,
          id,
        )
      }
      if (openingGap !== undefined) {
        db.prepare('UPDATE shrink_tubes SET diameter_opening_gap_mm = ?, updated_at = ? WHERE id = ?').run(
          openingGap,
          now,
          id,
        )
      }
      if (tolerance !== undefined) {
        db.prepare('UPDATE shrink_tubes SET centring_length_tolerance_mm = ?, updated_at = ? WHERE id = ?').run(
          tolerance,
          now,
          id,
        )
      }
      if (mechanism !== undefined) {
        db.prepare('UPDATE shrink_tubes SET centring_mechanism = ?, updated_at = ? WHERE id = ?').run(
          mechanism,
          now,
          id,
        )
      }
      if (is_active !== undefined) {
        db.prepare('UPDATE shrink_tubes SET is_active = ?, updated_at = ? WHERE id = ?').run(
          is_active ? 1 : 0,
          now,
          id,
        )
      }
      // Geometry-affecting fields → refresh derived recipe in the same TX (rollback on failure).
      if (geometryTouched) {
        refreshShrinkTubeDerived(db, id, readSystemSettings())
      }
    })
    patchTx()
    const updated = db.prepare('SELECT * FROM shrink_tubes WHERE id = ?').get(id)
    res.json(mapShrinkTubeRow(updated))
  } catch (err) {
    res.status(400).json({ message: err.message || 'Invalid shrink tube data' })
  }
})
app.delete('/api/shrink-tubes/:id', optionalAuth, (req, res) => {
  if (denyShrinkTubeWrite(req, res)) return
  const { id } = req.params
  const row = db.prepare('SELECT * FROM shrink_tubes WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'Shrink tube not found' })
  const inUse = db.prepare('SELECT id FROM product_references WHERE shrink_tube_id = ? LIMIT 1').get(id)
  if (inUse) {
    return res.status(400).json({ message: 'Cannot delete shrink tube — it is assigned to one or more references' })
  }
  db.prepare('DELETE FROM shrink_tubes WHERE id = ?').run(id)
  res.json({ status: 'ok' })
})

// ── References ────────────────────────────────────────────────────────────────

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
  const { specific_tools_json, vision_checks_json, rbk: _legacyRbk, ...rest } = row
  const mode = normalizeToolConfigMode(row.tool_config_mode)
  const specific_tools = parseSpecificToolsJson(specific_tools_json)
  const coerced = coerceVisionInspectionWithChecks(
    row.vision_inspection_enabled !== 0,
    parseVisionChecksJson(vision_checks_json) ?? normalizeVisionChecksConfig(null),
  )
  return {
    ...rest,
    is_active: !!row.is_active,
    vision_inspection_enabled: coerced.visionEnabled,
    send_barcode_weld_enabled: row.send_barcode_weld_enabled !== 0,
    send_barcode_shrink_enabled: row.send_barcode_shrink_enabled !== 0,
    tool_config_mode: mode,
    specific_tool_template_id: row.specific_tool_template_id ?? null,
    specific_tools: mode === 'specific' ? specific_tools : null,
    shrink_tube_id: row.shrink_tube_id ?? null,
    vision_checks_config: coerced.checks,
  }
}

/** Persist vision-off when legacy rows have vision on but no concrete checks. */
function healReferenceVisionChecksInDb() {
  const rows = db.prepare('SELECT id, vision_inspection_enabled, vision_checks_json FROM product_references').all()
  const now = new Date().toISOString()
  const upd = db.prepare(
    'UPDATE product_references SET vision_inspection_enabled = ?, vision_checks_json = ?, updated_at = ? WHERE id = ?',
  )
  for (const row of rows) {
    const coerced = coerceVisionInspectionWithChecks(
      row.vision_inspection_enabled !== 0,
      parseVisionChecksJson(row.vision_checks_json),
    )
    const wasOn = row.vision_inspection_enabled !== 0
    if (wasOn && !coerced.visionEnabled) {
      upd.run(0, serializeVisionChecksConfig(coerced.checks), now, row.id)
    }
  }
}

try {
  healReferenceVisionChecksInDb()
} catch (err) {
  console.warn('[maindata-api] healReferenceVisionChecksInDb:', err.message)
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
    tool_config_mode,
    specific_tool_template_id,
    specific_tools,
    shrink_tube_id,
    vision_checks_config,
  } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ message: 'Name is required' })
  const exists = db.prepare('SELECT id FROM product_references WHERE LOWER(name) = LOWER(?)').get(String(name).trim())
  if (exists) return res.status(400).json({ message: `Reference "${name}" already exists` })
  if (shrink_tube_id == null || String(shrink_tube_id).trim() === '') {
    return res.status(400).json({ message: 'Shrink tube profile is required' })
  }
  const tube = db.prepare('SELECT id FROM shrink_tubes WHERE id = ? AND is_active = 1').get(shrink_tube_id)
  if (!tube) return res.status(400).json({ message: 'Invalid or inactive shrink tube' })
  const id = `REF-${String(Date.now()).slice(-6)}`
  const now = new Date().toISOString()
  const mode = normalizeToolConfigMode(tool_config_mode)
  const toolsJson = mode === 'specific' ? serializeSpecificTools(specific_tools) : ''
  const visionCoerced = coerceVisionInspectionWithChecks(
    vision_inspection_enabled !== false,
    vision_checks_config,
  )
  const visionEnabled = visionCoerced.visionEnabled
  const visionChecksJson = serializeVisionChecksConfig(visionCoerced.checks)
  db.prepare(`
    INSERT INTO product_references (
      id, name, description, is_active, vision_program_id,
      vision_inspection_enabled, send_barcode_weld_enabled, send_barcode_shrink_enabled,
      tool_config_mode, specific_tool_template_id, specific_tools_json, shrink_tube_id,
      vision_checks_json, created_at, updated_at
    )
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(name).trim(),
    description ? String(description).trim() : '',
    vision_program_id ?? null,
    visionEnabled ? 1 : 0,
    send_barcode_weld_enabled === false ? 0 : 1,
    send_barcode_shrink_enabled === false ? 0 : 1,
    mode,
    mode === 'specific' ? (specific_tool_template_id ?? null) : null,
    toolsJson,
    shrink_tube_id,
    visionChecksJson,
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
    tool_config_mode,
    specific_tool_template_id,
    specific_tools,
    shrink_tube_id,
    vision_checks_config,
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
  if (vision_inspection_enabled !== undefined || vision_checks_config !== undefined) {
    const wantVision =
      vision_inspection_enabled !== undefined
        ? !!vision_inspection_enabled
        : row.vision_inspection_enabled !== 0
    const rawChecks =
      vision_checks_config !== undefined
        ? vision_checks_config
        : parseVisionChecksJson(row.vision_checks_json)
    const coerced = coerceVisionInspectionWithChecks(wantVision, rawChecks)
    db.prepare(
      'UPDATE product_references SET vision_inspection_enabled = ?, vision_checks_json = ?, updated_at = ? WHERE id = ?',
    ).run(coerced.visionEnabled ? 1 : 0, serializeVisionChecksConfig(coerced.checks), now, id)
  }
  if (send_barcode_weld_enabled !== undefined) {
    db.prepare('UPDATE product_references SET send_barcode_weld_enabled = ?, updated_at = ? WHERE id = ?').run(send_barcode_weld_enabled ? 1 : 0, now, id)
  }
  if (send_barcode_shrink_enabled !== undefined) {
    db.prepare('UPDATE product_references SET send_barcode_shrink_enabled = ?, updated_at = ? WHERE id = ?').run(send_barcode_shrink_enabled ? 1 : 0, now, id)
  }
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
  if (shrink_tube_id !== undefined) {
    if (shrink_tube_id === null || shrink_tube_id === '') {
      return res.status(400).json({ message: 'Shrink tube profile is required' })
    }
    // Keep an already-assigned tube even if deactivated; new assignments must be active.
    const sameAsCurrent = row.shrink_tube_id != null && String(row.shrink_tube_id) === String(shrink_tube_id)
    const tube = sameAsCurrent
      ? db.prepare('SELECT id FROM shrink_tubes WHERE id = ?').get(shrink_tube_id)
      : db.prepare('SELECT id FROM shrink_tubes WHERE id = ? AND is_active = 1').get(shrink_tube_id)
    if (!tube) {
      return res.status(400).json({
        message: sameAsCurrent ? 'Shrink tube profile not found' : 'Invalid or inactive shrink tube',
      })
    }
    db.prepare('UPDATE product_references SET shrink_tube_id = ?, updated_at = ? WHERE id = ?').run(shrink_tube_id, now, id)
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
 * Body: { code: string } or { name: string } — scanned or typed reference; must match an **active**
 * row in product_references by case-insensitive **name** or exact **id** (REF-…).
 * On success: loads reference, applies centring h_pre when enabled, sends canonical `name` from DB over both USB serial ports (welding + shrink), same framing as a barcode scanner (text + line ending).
 */
app.post('/api/references/broadcast', optionalAuth, async (req, res) => {
  try {
    if (denyMachineOperation(req, res)) return
    const code = String(req.body?.code ?? req.body?.name ?? '').trim()
    if (!code) return res.status(400).json({ message: 'code or name required' })
    const row = db
      .prepare(
        `SELECT * FROM product_references
         WHERE is_active = 1 AND (LOWER(name) = LOWER(?) OR id = ?)
         LIMIT 1`,
      )
      .get(code, code)
    if (!row) return res.status(404).json({ message: 'Reference not found or inactive' })
    const mapped = mapReferenceRow(row)
    setLoadedReference(mapped.id)
    const { sentTo, failed, skipped } = await broadcastReferenceToMachines(String(row.name), {
      weld: mapped.send_barcode_weld_enabled,
      shrink: mapped.send_barcode_shrink_enabled,
    })
    const advancedHPre = await applyReferenceHPreAfterLoad(mapped.id)
    res.json({
      ok: true,
      name: row.name,
      reference: mapped,
      vision_inspection_enabled: mapped.vision_inspection_enabled,
      sentTo,
      serialFailed: failed,
      serialSkipped: skipped,
      ...(advancedHPre ? { advancedHPre } : {}),
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

/** Local async wrapper — global asyncRoute is declared after this block. */
const asyncPickPlaceManual = fn => (req, res, next) => fn(req, res).catch(next)

function sendPickPlaceManualError(res, err) {
  const status = Number(err?.statusCode) || 500
  const message = err instanceof Error ? err.message : String(err)
  return res.status(status).json({ ok: false, error: message })
}

/**
 * Manual production-step presets (Settings → Pick & Place → Manual move).
 * Registered before the catch-all handler so /api/pick-place/manual/* is not 404'd.
 */
app.get('/api/pick-place/manual/targets', optionalAuth, asyncPickPlaceManual(async (req, res) => {
  const speedMmS = req.query.speedMmS != null ? Number(req.query.speedMmS) : undefined
  res.json(resolveManualTargets({ speedMmS }))
}))

app.post('/api/pick-place/manual/centering-travel', requireAuth, asyncPickPlaceManual(async (req, res) => {
  try {
    const speedMmS = req.body?.speedMmS != null ? Number(req.body.speedMmS) : undefined
    res.json(await runCenteringTravel({ speedMmS }))
  } catch (err) {
    sendPickPlaceManualError(res, err)
  }
}))

app.post('/api/pick-place/manual/move-to-pick', requireAuth, asyncPickPlaceManual(async (req, res) => {
  try {
    const speedMmS = req.body?.speedMmS != null ? Number(req.body.speedMmS) : undefined
    res.json(await runMoveToPick({ speedMmS }))
  } catch (err) {
    sendPickPlaceManualError(res, err)
  }
}))

app.post('/api/pick-place/manual/return-to-backoff', requireAuth, asyncPickPlaceManual(async (req, res) => {
  try {
    const speedMmS = req.body?.speedMmS != null ? Number(req.body.speedMmS) : undefined
    res.json(await runReturnToBackoff({ speedMmS }))
  } catch (err) {
    sendPickPlaceManualError(res, err)
  }
}))

app.post('/api/pick-place/manual/home', requireAuth, asyncPickPlaceManual(async (req, res) => {
  try {
    const homingSpeedMmS =
      req.body?.homingSpeedMmS != null ? Number(req.body.homingSpeedMmS) : undefined
    res.json(await runHome({ homingSpeedMmS }))
  } catch (err) {
    sendPickPlaceManualError(res, err)
  }
}))

app.post('/api/pick-place/manual/pp-clamp', requireAuth, asyncPickPlaceManual(async (req, res) => {
  try {
    if (typeof req.body?.closed !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'closed (boolean) is required' })
    }
    const ecm = getEtherCATManager()
    res.json(await setPpClamp(ecm, req.body.closed))
  } catch (err) {
    sendPickPlaceManualError(res, err)
  }
}))

app.use(async (req, res, next) => {
  try {
    const handled = await handlePickPlaceHttpRequest(req, res, { apiPort: PORT })
    if (!handled) next()
  } catch (err) {
    next(err)
  }
})

function heightCalOk(res, data) {
  res.json({ status: 'success', data, error: null })
}

function heightCalFail(res, err) {
  const statusCode = err.statusCode || 400
  res.status(statusCode).json({
    status: 'error',
    data: null,
    error: {
      code: err.code || 'HEIGHT_CALIBRATION',
      message: err.message || 'Height calibration failed',
      details: err.details || [],
    },
  })
}

app.get('/api/centring/v2/height-calibration', requireAuth, requireBypass, (_req, res) => {
  heightCalOk(res, heightCalibration.calibrationSnapshot())
})

app.get('/api/centring/v2/height-calibration/manual', requireAuth, requireBypass, async (_req, res) => {
  try {
    heightCalOk(res, await heightCalibration.getManualMoveSnapshot())
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.post('/api/centring/v2/height-calibration/manual/jog', requireAuth, requireBypass, (_req, res) => {
  const err = new Error('Reload Manual move. This screen still sends a millimetre jog. The page now steps the servo pulse.')
  err.statusCode = 409
  err.code = 'STALE_MANUAL_MOVE'
  heightCalFail(res, err)
})

app.post('/api/centring/v2/height-calibration/manual/nudge', requireAuth, requireBypass, async (req, res) => {
  try {
    const actor = { username: req.userRow?.username || 'bypass' }
    heightCalOk(res, await heightCalibration.nudgeManualMove(req.body || {}, actor))
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.post('/api/centring/v2/height-calibration/pulse-ends/run', requireAuth, requireBypass, async (req, res) => {
  try {
    heightCalOk(res, await heightCalibration.runPulseEndCycle())
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.post('/api/centring/v2/height-calibration/pulse-ends/drive', requireAuth, requireBypass, async (req, res) => {
  try {
    const { axis, position } = req.body || {}
    heightCalOk(res, await heightCalibration.drivePulseEnd(axis, position))
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.post('/api/centring/v2/height-calibration/pulse-ends/step', requireAuth, requireBypass, async (req, res) => {
  try {
    const { axis, direction } = req.body || {}
    heightCalOk(res, await heightCalibration.stepPulseEnd(axis, direction))
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.get('/api/centring/v2/height-calibration/pulse-ends/status', requireAuth, requireBypass, async (req, res) => {
  try {
    const axis = req.query?.axis
    const position = req.query?.position
    heightCalOk(res, await heightCalibration.pulseEndLiveStatus(axis, position))
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.post('/api/centring/v2/height-calibration/pulse-ends/read', requireAuth, requireBypass, async (req, res) => {
  try {
    const { axis, position } = req.body || {}
    heightCalOk(res, await heightCalibration.readPulseEnd(axis, position))
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.post('/api/centring/v2/height-calibration/pulse-ends/apply', requireAuth, requireBypass, async (req, res) => {
  try {
    const actor = { username: req.userRow?.username || 'bypass' }
    heightCalOk(res, await heightCalibration.applyPulseEnds(req.body || {}, actor))
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.post('/api/centring/v2/height-calibration/curve/pose', requireAuth, requireBypass, async (req, res) => {
  try {
    heightCalOk(res, await heightCalibration.driveCurvePose(req.body?.pose))
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.post('/api/centring/v2/height-calibration/curve/build', requireAuth, requireBypass, (req, res) => {
  try {
    heightCalOk(res, { curve: heightCalibration.buildCurve(req.body || {}) })
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.post('/api/centring/v2/height-calibration/curve/apply', requireAuth, requireBypass, async (req, res) => {
  try {
    const actor = { username: req.userRow?.username || 'bypass' }
    heightCalOk(res, await heightCalibration.applyCurve(req.body?.curve || req.body || {}, actor))
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.post('/api/centring/v2/height-calibration/setcal', requireAuth, requireBypass, async (req, res) => {
  try {
    const actor = { username: req.userRow?.username || 'bypass' }
    heightCalOk(res, await heightCalibration.sendSavedSetCal(actor))
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.post('/api/centring/v2/height-calibration/backup/restore', requireAuth, requireBypass, async (req, res) => {
  try {
    const actor = { username: req.userRow?.username || 'bypass' }
    heightCalOk(res, await heightCalibration.restoreBackup(req.body || {}, actor))
  } catch (err) {
    heightCalFail(res, err)
  }
})

app.use(async (req, res, next) => {
  try {
    const handled = await handleCentringHttpRequest(req, res, { apiPort: PORT })
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
    stopCommunicationSupervisor()
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
  if (isProductionActive()) {
    return res.status(409).json({ ok: false, error: 'Cannot control lifter while production is running' })
  }
  const b = req.body || {}
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'Machine connection lost' })
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
  if (isProductionActive()) {
    return res.status(409).json({ ok: false, error: 'Cannot control lifter while production is running' })
  }
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'Machine connection lost' })
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
  if (isProductionActive()) {
    return res.status(409).json({ ok: false, error: 'Cannot control lifter while production is running' })
  }
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'Machine connection lost' })
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
 * (only keys sent are written; mainAir is system-managed and always on)
 *
 * Requires auth + BYPASS + maintenance mode (same gate as hardware-test).
 * Intentional escape paths without maintenance: POST /api/pneumatics/safe and
 * POST /api/pneumatics/emergency-stop. Prefer hardware-test for Maintenance HMI toggles.
 */
app.post('/api/pneumatics/outputs', requireAuth, requireMaintenanceAccess, asyncRoute(async (req, res) => {
  if (isProductionActive()) {
    return res.status(409).json({ ok: false, error: 'Cannot write pneumatics while production is running' })
  }
  if (!isMaintenanceActive()) {
    return res.status(409).json({ ok: false, error: 'Enable maintenance mode before writing pneumatic outputs' })
  }
  const b = req.body || {}
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'Machine connection lost' })
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

/** POST /api/pneumatics/safe — clamps open, lever down, puller off (main air unchanged); escape without maintenance */
app.post('/api/pneumatics/safe', asyncRoute(async (_req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'Machine connection lost' })
  }
  await pneumaticsSafe(ecm)
  const snap = await getPneumaticSnapshot(ecm)
  res.json({ ok: true, ...snap })
}))

/** POST /api/pneumatics/emergency-stop — DO0–DO4 off; MAIN_AIR (DO5) stays on */
app.post('/api/pneumatics/emergency-stop', asyncRoute(async (_req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'Machine connection lost' })
  }
  await emergencyStopPneumatics(ecm)
  resetMachineInitialization()
  clearProductionQueueOnEmergency()
  await resetProductionSequence()
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
 * POST /api/machine/setup
 * Unified machine setup — initialize, re-arm after lockout, or recover from fault.
 * Body: { referenceId?: string, requireButton?: boolean }
 */
app.post('/api/machine/setup', asyncRoute(async (req, res) => {
  if (denyMachineOperation(req, res)) return
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    const initSnap = await getMachineInitSnapshot(ecm)
    return res.status(503).json({ ok: false, error: 'Machine connection lost', ...initSnap })
  }
  const bodyRef = req.body?.referenceId != null ? String(req.body.referenceId) : null
  const status = getMachineInitStatus()
  if (bodyRef && status.referenceId && bodyRef !== status.referenceId) {
    const initSnap = await getMachineInitSnapshot(ecm)
    return res.status(409).json({
      ok: false,
      error: 'Reference changed — scan the current reference again before setup',
      ...initSnap,
    })
  }
  const requireButton = req.body?.requireButton !== false
  const source = requireButton ? 'api' : 'hmi'
  try {
    const result = await runMachineSetup(ecm, { requireButton, source })
    const initSnap = await getMachineInitSnapshot(ecm)
    res.json({ ok: true, ...result, ...initSnap })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = /not pressed|no reference|while production|already in progress/i.test(msg)
      ? 409
      : 503
    const initSnap =
      err instanceof SetupError && err.snapshot
        ? { ...(await getMachineInitSnapshot(ecm)), ...err.snapshot }
        : await getMachineInitSnapshot(ecm)
    res.status(code).json({ ok: false, error: msg, ...initSnap })
  }
}))

/**
 * POST /api/machine/initialize
 * @deprecated Use POST /api/machine/setup — thin wrapper.
 * Body: { referenceId?: string, requireButton?: boolean }
 */
app.post('/api/machine/initialize', asyncRoute(async (req, res) => {
  if (denyMachineOperation(req, res)) return
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    const initSnap = await getMachineInitSnapshot(ecm)
    return res.status(503).json({ ok: false, error: 'Machine connection lost', ...initSnap })
  }
  const bodyRef = req.body?.referenceId != null ? String(req.body.referenceId) : null
  const status = getMachineInitStatus()
  if (bodyRef && status.referenceId && bodyRef !== status.referenceId) {
    const initSnap = await getMachineInitSnapshot(ecm)
    return res.status(409).json({
      ok: false,
      error: 'Reference changed — scan the current reference again before initializing',
      ...initSnap,
    })
  }
  const requireButton = req.body?.requireButton !== false
  const source = requireButton ? 'api' : 'hmi'
  try {
    const result = await runMachineSetup(ecm, { requireButton, source })
    const initSnap = await getMachineInitSnapshot(ecm)
    res.json({ ok: true, ...result, ...initSnap })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = /not pressed|no reference|while production is running/i.test(msg) ? 409 : 503
    const initSnap = await getMachineInitSnapshot(ecm)
    res.status(code).json({ ok: false, error: msg, ...initSnap })
  }
}))

/**
 * POST /api/machine/recover
 * @deprecated Use POST /api/machine/setup — thin wrapper.
 * Body: { referenceId?, requireButton?: boolean }
 */
app.post('/api/machine/recover', asyncRoute(async (req, res) => {
  if (denyMachineOperation(req, res)) return
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    const initSnap = await getMachineInitSnapshot(ecm)
    return res.status(503).json({ ok: false, error: 'Machine connection lost', ...initSnap })
  }
  const bodyRef = req.body?.referenceId != null ? String(req.body.referenceId) : null
  const status = getMachineInitStatus()
  if (bodyRef && status.referenceId && bodyRef !== status.referenceId) {
    const initSnap = await getMachineInitSnapshot(ecm)
    return res.status(409).json({
      ok: false,
      error: 'Reference changed — scan the current reference again before recovering',
      ...initSnap,
    })
  }
  const requireButton = req.body?.requireButton !== false
  const source = requireButton ? 'api' : 'hmi'
  try {
    const result = await runMachineSetup(ecm, { requireButton, source })
    const initSnap = await getMachineInitSnapshot(ecm)
    res.json({ ok: true, ...result, ...initSnap })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = /not pressed|no reference|while production|no active fault|already in progress/i.test(msg)
      ? 409
      : 503
    const initSnap = await getMachineInitSnapshot(ecm)
    res.status(code).json({ ok: false, error: msg, ...initSnap })
  }
}))

/** POST /api/machine/reference-loaded — sync reference + apply h_pre after HMI reload */
app.post('/api/machine/reference-loaded', asyncRoute(async (req, res) => {
  if (denyMachineOperation(req, res)) return
  const id = req.body?.referenceId != null ? String(req.body.referenceId).trim() : ''
  if (!id) return res.status(400).json({ ok: false, error: 'referenceId required' })
  setLoadedReference(id)
  const advancedHPre = await applyReferenceHPreAfterLoad(id)
  const snap = await getMachineInitSnapshot(getEtherCATManager())
  res.json({ ok: true, ...snap, ...(advancedHPre ? { advancedHPre } : {}) })
}))

/** POST /api/machine/clear-reference — clear loaded reference and init gate */
app.post('/api/machine/clear-reference', asyncRoute(async (_req, res) => {
  // clearLoadedReference() already resets the production queue internally
  // (matches setLoadedReference); no separate resetProductionSequence() needed.
  clearLoadedReference()
  const snap = await getMachineInitSnapshot(getEtherCATManager())
  res.json({ ok: true, ...snap })
}))

/**
 * POST /api/machine/start-production
 * Full production cycle (DI1 Start or HMI). Body: { referenceId?, requireButton?: false }
 */
app.post('/api/machine/start-production', asyncRoute(async (req, res) => {
  if (denyMachineOperation(req, res)) return
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'Machine connection lost' })
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
  const operatorId = req.session?.userId ?? null
  const operatorName = operatorId ? getUserById(operatorId)?.username ?? null : null
  try {
    const result = await requestProductionStart(ecm, { requireButton, source, operatorId, operatorName, wait: true })
    const snap = await getMachineInitSnapshot(ecm)
    res.json({ ok: true, ...result, ...snap })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = /not pressed|not initialized|no reference|cannot|queue full|lifecycle/i.test(msg) ? 409 : 503
    const jobId = err?.jobId ?? getLastJobOutcome()?.jobId ?? null
    const cycleResult = err?.cycleResult ?? getLastJobOutcome()?.cycleResult ?? null
    const status = err?.status ?? getLastJobOutcome()?.status ?? null
    res.status(code).json({
      ok: false,
      error: msg,
      ...(jobId ? { jobId } : {}),
      ...(cycleResult ? { cycleResult } : {}),
      ...(status ? { status } : {}),
    })
  }
}))

/** POST /api/machine/stop-production — cancel queued jobs, best-effort abort, reset lifecycle */
app.post('/api/machine/stop-production', asyncRoute(async (_req, res) => {
  const ecm = getEtherCATManager()
  const result = await stopProductionSequence(ecm)
  const snap = await getMachineInitSnapshot(ecm)
  res.json({ ok: true, ...result, ...snap })
}))

/**
 * GET /api/machine/maintenance-mode — current maintenance state.
 */
app.get('/api/machine/maintenance-mode', requireAuth, asyncRoute(async (_req, res) => {
  res.json({ ok: true, maintenance: getMaintenanceMode() })
}))

/**
 * POST /api/machine/panel-focus — a setup page claims/releases DI0/DI1.
 * Currently only the Vision master-image tab uses focus 'vision-master', which
 * maps DI1 → capture and DI0 → register (the page polls init-status counters
 * and performs the actual browser-side capture/register).
 * Body: { focus: 'vision-master' | null }
 */
app.post('/api/machine/panel-focus', asyncRoute(async (req, res) => {
  if (denyMachineOperation(req, res)) return
  const requested = req.body?.focus ?? null
  const focus = requested === PANEL_FOCUS.VISION_MASTER ? setPanelFocus(requested) : clearPanelFocus()
  res.json({ ok: true, panelFocus: focus })
}))

/**
 * GET /api/machine/panel-focus — current focus + capture/register counters.
 */
app.get('/api/machine/panel-focus', asyncRoute(async (_req, res) => {
  res.json({ ok: true, panelFocus: getPanelFocus() })
}))

/**
 * POST /api/machine/maintenance-mode — enable/disable maintenance and/or set the
 * active target (pickplace | centering | vision | step). While active the panel
 * buttons drive the selected module instead of the automatic init/start flow.
 * Body: { active?: boolean, target?: string|null }
 * Requires `settings_maintenance` Tab Access (or Bypass).
 *
 * Exit contract: on transition to inactive, clear tower/LED hardware-test overrides
 * and best-effort pneumaticsSafe so valves do not stay energized after leaving the page.
 */
app.post('/api/machine/maintenance-mode', requireAuth, requireMaintenanceAccess, asyncRoute(async (req, res) => {
  try {
    const before = getMaintenanceMode()
    const next = {}
    if (req.body?.active !== undefined) next.active = !!req.body.active
    if (req.body?.target !== undefined) next.target = req.body.target
    // Opaque HMI session — stale leave from an older mount is ignored (M-8/M-3).
    if (req.body?.clientSession !== undefined) next.clientSession = req.body.clientSession
    const result = setMaintenanceMode(next)
    const transitioningOff = before.active && !result.active && !result.ignoredStaleDisable
    // Leaving maintenance must release tower/LED overrides immediately. Valve safe
    // runs in the background so a congested EtherCAT bridge cannot delay the HTTP
    // response — mode is already cleared in the store.
    if (transitioningOff) {
      clearTowerTestOverride()
      clearPanelLedTestOverride()
      const ecm = getEtherCATManager()
      void pneumaticsSafeBestEffort(ecm, { context: 'maintenance-exit', timeoutMs: 2000 })
    }
    if (!result.ignoredStaleDisable) {
      try {
        const action = result.active
          ? before.active
            ? 'update'
            : 'enable'
          : 'disable'
        insertAudit(db, {
          domain: 'maintenance_mode',
          actorUserId: req.userRow?.id != null ? String(req.userRow.id) : null,
          actorUsername: req.userRow?.username != null ? String(req.userRow.username) : null,
          action,
          beforeJson: before,
          afterJson: {
            active: result.active,
            target: result.target,
            since: result.since,
          },
          reason: 'POST /api/machine/maintenance-mode',
        })
      } catch (auditErr) {
        const msg = auditErr instanceof Error ? auditErr.message : String(auditErr)
        console.warn(`[Maintenance] audit insert failed: ${msg}`)
      }
      console.info(
        '[Maintenance] mode change',
        JSON.stringify({
          actorUserId: req.userRow?.id ?? null,
          actorUsername: req.userRow?.username ?? null,
          previous: before,
          next: { active: result.active, target: result.target, since: result.since },
        }),
      )
    } else {
      console.info(
        '[Maintenance] ignored stale disable',
        JSON.stringify({
          actorUserId: req.userRow?.id ?? null,
          staleSession: req.body?.clientSession ?? null,
          active: result.active,
        }),
      )
    }
    // Disable / ignored-stale: respond without waiting on ECM snapshot I/O (M-8 stress).
    if (!result.active || result.ignoredStaleDisable || transitioningOff) {
      return res.json({
        ok: true,
        ignoredStaleDisable: !!result.ignoredStaleDisable,
        maintenance: getMaintenanceMode(),
        connected: getEtherCATManager().isInitialized === true,
      })
    }
    const ecm = getEtherCATManager()
    try {
      const snap = await Promise.race([
        getMachineInitSnapshot(ecm),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('maintenance snapshot budget exceeded')), 1500)
        }),
      ])
      res.json({ ok: true, ...snap })
    } catch {
      // Congested bridge — mode is already active; client will refresh via poll.
      res.json({
        ok: true,
        maintenance: getMaintenanceMode(),
        connected: ecm.isInitialized === true,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(409).json({ ok: false, error: msg })
  }
}))

/**
 * POST /api/machine/centring-production-cycle — test-style production centring cycle (serial-safe).
 * Requires `settings_maintenance` Tab Access (or Bypass) + maintenance mode.
 * Short L_eff (< 55): SEEK_TRAVEL → HOME → MOVE h_pre once, then assert h_pre (no closed-idle restore).
 * Long L_eff: production cycle; restoreIdle (default true) closes to travel afterward.
 * Body: { referenceId?, skipPickPlace?, restoreIdle? }
 */
app.post('/api/machine/centring-production-cycle', requireAuth, requireMaintenanceAccess, asyncRoute(async (req, res) => {
  if (!isMaintenanceActive()) {
    return res.status(409).json({ ok: false, error: 'Enable maintenance mode before running centring production cycle' })
  }
  if (isProductionActive()) {
    return res.status(409).json({ ok: false, error: 'Cannot run centring production cycle while production is active' })
  }
  const refId = req.body?.referenceId ?? getMachineInitStatus().referenceId
  if (!refId) {
    return res.status(400).json({ ok: false, error: 'No reference loaded — scan or pass referenceId' })
  }
  try {
    const phases = []
    const result = await runMaintenanceCentringCycle({
      referenceId: refId,
      skipPickPlace: req.body?.skipPickPlace !== false,
      restoreIdle: req.body?.restoreIdle !== false,
      onPhase: (name) => phases.push(name),
    })
    res.json({
      ok: true,
      referenceId: refId,
      phaseLog: phases,
      centring_axis: result.centring_axis,
      resolved: result.resolved,
      phases: result.phases,
      finalPosture: result.finalPosture,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(503).json({ ok: false, error: msg })
  }
}))

/**
 * GET /api/machine/io-snapshot — raw EtherCAT input/output state for diagnostics.
 */
app.get('/api/machine/io-snapshot', asyncRoute(async (_req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.json({ ok: false, connected: false, error: 'Machine connection lost' })
  }
  try {
    const [inputs, outputs, safety] = await Promise.all([
      ecm.getAllInputs(),
      ecm.getAllOutputs(),
      readSafetyInputsSnapshot(ecm),
    ])
    res.json({
      ok: true,
      connected: true,
      inputs: inputs.inputs ?? inputs.raw ?? null,
      outputs: outputs.outputs ?? outputs.raw ?? null,
      safety: {
        doors: {
          right1Open: safety.right1,
          right2Open: safety.right2,
          backOpen: safety.back,
          anyOpen: safety.anyOpen,
        },
        pnozRaw: safety.pnozRaw,
        pnozConfirmed: safety.pnozConfirmed,
        airPressureRaw: safety.airPressureRaw,
        airPressureOk: safety.airPressureOk,
        emergencyRaw: safety.emergencyRaw,
        emergencyOk: safety.emergencyOk,
      },
    })
  } catch (err) {
    res.status(503).json({ ok: false, connected: true, error: err instanceof Error ? err.message : String(err) })
  }
}))

// ── Lighting (EtherCAT DO8) ───────────────────────────────────────────────────

/** GET /api/machine/lighting — current DO8 work-light state */
app.get('/api/machine/lighting', asyncRoute(async (_req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.json({ ok: false, connected: false, error: 'Machine connection lost' })
  }
  try {
    const out = await ecm.getAllOutputs()
    const raw = out.outputs ?? out.raw ?? []
    const on = Array.isArray(raw) ? raw[DO.LIGHTING] === 1 : undefined
    res.json({ ok: true, connected: true, pin: DO.LIGHTING, on })
  } catch (err) {
    res.status(503).json({ ok: false, connected: true, error: err instanceof Error ? err.message : String(err) })
  }
}))

/**
 * POST /api/machine/lighting — turn the DO8 machine work light on/off.
 * Body: { on: boolean }
 */
app.post('/api/machine/lighting', asyncRoute(async (req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'Machine connection lost' })
  }
  const on = req.body?.on === true || req.body?.on === 1 || req.body?.on === 'on' || req.body?.on === 'true'
  try {
    await ecm.setOutput(DO.LIGHTING, on ? 1 : 0)
    res.json({ ok: true, pin: DO.LIGHTING, on })
  } catch (err) {
    res.status(503).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}))

/**
 * POST /api/machine/hardware-test — manual hardware self-tests (Maintenance only).
 * Requires `settings_maintenance` Tab Access (or Bypass) + maintenance mode active.
 * Body (any subset):
 *   { tower: { red?, green?, yellow?, buzzer? } }   — force the indicator tower
 *   { buttonLeds: { init?: 'on'|'off'|'flash', start?: ... } } — force button LEDs
 *   { pneumatics: { clampRight?, clampLeft?, leverUp?, ppClamp?, puller? } } — valves
 *   { clear: true }                                  — release all tower/LED overrides
 */
app.post('/api/machine/hardware-test', requireAuth, requireMaintenanceAccess, asyncRoute(async (req, res) => {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized) {
    return res.status(503).json({ ok: false, error: 'Machine connection lost' })
  }
  if (!isMaintenanceActive()) {
    return res.status(409).json({ ok: false, error: 'Enable maintenance mode before running hardware tests' })
  }
  const b = req.body || {}
  const hasTower = b.tower && typeof b.tower === 'object'
  const hasLeds = b.buttonLeds && typeof b.buttonLeds === 'object'
  const hasPneumatics = b.pneumatics && typeof b.pneumatics === 'object'
  const hasClear = b.clear === true
  if (!hasTower && !hasLeds && !hasPneumatics && !hasClear) {
    return res.status(400).json({
      ok: false,
      error: 'Provide tower, buttonLeds, pneumatics, and/or clear:true',
    })
  }
  try {
    if (hasClear) {
      clearTowerTestOverride()
      clearPanelLedTestOverride()
    }
    if (hasTower) {
      setTowerTestOverride({
        red: !!b.tower.red,
        green: !!b.tower.green,
        yellow: !!b.tower.yellow,
        buzzer: !!b.tower.buzzer,
      })
    }
    if (hasLeds) {
      setPanelLedTestOverride({
        init: typeof b.buttonLeds.init === 'string' ? b.buttonLeds.init : 'off',
        start: typeof b.buttonLeds.start === 'string' ? b.buttonLeds.start : 'off',
      })
    }
    if (hasPneumatics) {
      const state = {}
      for (const key of Object.keys(PNEUMATIC_OUTPUTS)) {
        if (key === 'mainAir') continue
        if (key in b.pneumatics) state[key] = !!b.pneumatics[key]
      }
      if (Object.keys(state).length) await setPneumaticOutputs(ecm, state)
    }
    const snap = await getMachineInitSnapshot(ecm)
    // Push DO13/DO14 immediately — do not wait for the next 50 ms panel poll.
    if (hasLeds || hasClear) {
      await applyPanelLeds(
        ecm,
        snap.panel?.leds ?? getEffectivePanelLeds({ init: 'off', start: 'off' }),
        Date.now(),
      )
    }
    res.json({ ok: true, ...snap })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(503).json({ ok: false, error: msg })
  }
}))

// ── Production traceability (test history + error history) ───────────────────

/** GET /api/history — paginated production-run history. */
app.get('/api/history', optionalAuth, (req, res) => {
  if (denyHistoryAccess(req, res)) return
  const { records, total } = queryProductionRuns({
    limit: req.query.limit,
    offset: req.query.offset,
    start_date: req.query.start_date,
    end_date: req.query.end_date,
    search: req.query.search,
  })
  res.json({ records, total })
})

/** GET /api/history/export?format=csv|json — full production-run export. */
app.get('/api/history/export', optionalAuth, (req, res) => {
  if (denyHistoryAccess(req, res)) return
  const format = req.query.format === 'csv' ? 'csv' : 'json'
  const body = exportProductionRuns(format)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')
  res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename="test-history-${stamp}.${format}"`)
  res.send(body)
})

/** POST /api/history/archive — archive + prune records older than retention. */
app.post('/api/history/archive', requireAuth, (req, res) => {
  const settings = readSystemSettings()
  const retentionDays = Number(req.body?.retentionDays ?? settings.history_retention_days ?? 365)
  const result = archiveAndPrune({ retentionDays })
  res.json({ ok: true, ...result })
})

/** GET /api/error-history — paginated error log. */
app.get('/api/error-history', optionalAuth, (req, res) => {
  if (denyHistoryAccess(req, res, 'error-history')) return
  const { errors, total } = queryErrors({
    limit: req.query.limit,
    offset: req.query.offset,
    severity: req.query.severity,
    phase: req.query.phase,
    error_code: req.query.error_code,
    start_date: req.query.start_date,
    end_date: req.query.end_date,
  })
  res.json({ errors, total })
})

/** GET /api/error-history/export?format=csv|json — full error-log export. */
app.get('/api/error-history/export', optionalAuth, (req, res) => {
  if (denyHistoryAccess(req, res, 'error-history')) return
  const format = req.query.format === 'csv' ? 'csv' : 'json'
  const body = exportErrors(format)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')
  res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename="error-history-${stamp}.${format}"`)
  res.send(body)
})

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
  try {
    const retentionDays = Number(readSystemSettings().history_retention_days ?? 365)
    const pruned = archiveAndPrune({ retentionDays })
    if (pruned.archivedRuns || pruned.archivedErrors) {
      console.log(
        `[maindata-api] History retention: archived ${pruned.archivedRuns} runs + ${pruned.archivedErrors} errors`,
      )
    }
  } catch (err) {
    console.warn('[maindata-api] History retention prune failed:', err?.message ?? err)
  }
  startCommunicationSupervisor()
  if (envWantsEtherCATAutoConnect()) {
    bootEtherCATWithReconnect()
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
    // Non-zero so systemd Restart=on-failure brings the unit back instead of
    // treating a port collision as a clean success (which left the API dead).
    process.exit(1)
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
    stopCommunicationSupervisor()
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
