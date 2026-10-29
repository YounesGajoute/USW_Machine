/** Bind a loaded product reference to the standalone V2 inspection slave. */
import {
  disableRealtimeInspection,
  enableRealtimeInspection,
  getRealtimeConfig,
  getRealtimeSnapshot,
  putRealtimeConfig,
  realtimeStatus,
  setRealtimeConfiguredReferenceId,
  setRealtimeReferenceSyncState,
  verifyRealtimeConfig,
  waitForRealtimeDisabled,
} from './realtimeInspectionClient.mjs'
import { mapRealtimeInspectionConfig, mapRealtimeInspectionMeasurements } from './realtimeInspectionConfig.mjs'
import { hasEnabledVisionInspectionChecks, parseVisionChecksJson, normalizeVisionChecksConfig } from './visionChecksConfigStore.mjs'
import { getVisionSyncMode, isVisionSyncEnabled, PRODUCTION_SYNC_COMMISSIONING_BLOCK_REASON } from './visionSyncMode.mjs'

let operationTail = Promise.resolve()

function queue(operation) {
  const run = operationTail.then(operation)
  operationTail = run.catch(() => undefined)
  return run
}

function readReference(db, referenceId) {
  return db.prepare(`SELECT p.id, p.name, p.vision_inspection_enabled, p.vision_checks_json,
    p.shrink_tube_id, p.realtime_v2_config_json, s.length_mm, s.diameter_mm
    FROM product_references p LEFT JOIN shrink_tubes s ON s.id = p.shrink_tube_id
    WHERE p.id = ?`).get(referenceId)
}

function referenceFingerprint(row) {
  return JSON.stringify({
    vision_inspection_enabled: row.vision_inspection_enabled !== 0,
    checks: normalizeVisionChecksConfig(parseVisionChecksJson(row.vision_checks_json)),
    shrink_tube_id: row.shrink_tube_id,
    length_mm: row.length_mm,
    diameter_mm: row.diameter_mm,
  })
}

function storedRecipe(row) {
  if (!row?.realtime_v2_config_json) return null
  try {
    return JSON.parse(row.realtime_v2_config_json)
  } catch {
    return null
  }
}

function savedRecipe(row) {
  const saved = storedRecipe(row)
  return saved && saved.reference_fingerprint === referenceFingerprint(row) && saved.config
    ? saved.config : null
}

function assertLoaded(db, referenceId, getLoadedReferenceId, sourceFingerprint, getLoadedReferenceSelection, expectedSelectionRevision) {
  const current = readReference(db, referenceId)
  const selectionChanged = getLoadedReferenceSelection &&
    getLoadedReferenceSelection().selectionRevision !== expectedSelectionRevision
  if (getLoadedReferenceId() !== referenceId || selectionChanged || !current ||
      referenceFingerprint(current) !== sourceFingerprint) {
    const error = new Error('Loaded reference changed while configuring V2 inspection')
    error.status = 409
    error.code = 'REFERENCE_CHANGED'
    throw error
  }
}

async function disableAndVerify() {
  const response = await disableRealtimeInspection()
  const snapshot = response?.disable_pending ? await waitForRealtimeDisabled() : await getRealtimeSnapshot()
  const status = realtimeStatus(snapshot)
  if (status.enabled !== false || status.active !== false || status.disable_pending === true) {
    const error = new Error('V2 inspection slave did not disable')
    error.status = 409
    throw error
  }
  return status
}

function expectedChecks(config) {
  return {
    welding_splice: ['length', 'width', 'position'].filter(name => config.welding_splice?.enabled && config.welding_splice?.checks?.[name]?.enabled),
    heat_shrink_tube: ['position', 'length', 'diameter'].filter(name => config.heat_shrink_tube?.enabled && config.heat_shrink_tube?.checks?.[name]?.enabled),
  }
}

async function enableAndVerify(config) {
  await enableRealtimeInspection()
  const status = realtimeStatus(await getRealtimeSnapshot())
  if (status.enabled !== true || status.disable_pending === true) {
    const error = new Error('V2 inspection slave did not enable')
    error.status = 409
    throw error
  }
  if (status.can_run !== true || status.active === true) {
    const issues = status.readiness_issues ?? status.issues ?? []
    const error = new Error(`V2 inspection is enabled but not ready${issues.length ? `: ${issues.join('; ')}` : ''}`)
    error.status = 409
    throw error
  }
  if (status.enabled_checks) {
    const expected = expectedChecks(config)
    for (const group of Object.keys(expected)) {
      const actual = status.enabled_checks[group] ?? []
      if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected[group]].sort())) {
        const error = new Error(`V2 inspection slave enabled checks differ for ${group}`)
        error.status = 409
        throw error
      }
    }
  }
  return status
}

/** A missing or stale recipe leaves the slave disabled until the operator saves values. */
export function syncRealtimeInspectionForReference({ db, referenceId, getLoadedReferenceId }) {
  // Close the production gate before waiting for an earlier slave operation.
  setRealtimeConfiguredReferenceId(null)
  if (isVisionSyncEnabled()) {
    const warning = getVisionSyncMode() === 'commissioning'
      ? PRODUCTION_SYNC_COMMISSIONING_BLOCK_REASON
      : 'Vision Slave synchronization is pending; check machine status for the current production block'
    setRealtimeReferenceSyncState(referenceId, warning)
    return Promise.resolve({ ok: false, state: 'awaiting_slave', warning })
  }
  setRealtimeReferenceSyncState(referenceId, 'V2 inspection state is being synchronized')
  return queue(async () => {
    const row = readReference(db, referenceId)
    if (!row) throw Object.assign(new Error('Loaded reference not found'), { status: 404 })
    const fingerprint = referenceFingerprint(row)
    setRealtimeConfiguredReferenceId(null)
    setRealtimeReferenceSyncState(referenceId, 'V2 inspection state is being synchronized')
    try {
      await disableAndVerify()
      assertLoaded(db, referenceId, getLoadedReferenceId, fingerprint)
      const checks = parseVisionChecksJson(row.vision_checks_json)
      if (row.vision_inspection_enabled === 0 || !hasEnabledVisionInspectionChecks(checks)) {
        setRealtimeReferenceSyncState(referenceId)
        return { ok: true, state: 'disabled' }
      }
      const recipe = savedRecipe(row)
      if (!recipe) {
        const warning = 'Save validated V2 inspection values and tolerances for this reference'
        setRealtimeReferenceSyncState(referenceId, warning)
        return { ok: false, state: 'configuration_required', warning }
      }
      // Calibration belongs to the camera. Keep its current validated value
      // when switching product recipes.
      const live = await getRealtimeConfig()
      const mapped = mapRealtimeInspectionConfig({
        saved: live, draft: { ...recipe, calibration: live.calibration }, checks, shrinkTube: row,
      })
      await putRealtimeConfig(mapped)
      const actual = await verifyRealtimeConfig(mapped)
      assertLoaded(db, referenceId, getLoadedReferenceId, fingerprint)
      await enableAndVerify(mapped)
      assertLoaded(db, referenceId, getLoadedReferenceId, fingerprint)
      setRealtimeConfiguredReferenceId(referenceId, actual)
      setRealtimeReferenceSyncState(referenceId)
      return { ok: true, state: 'enabled' }
    } catch (error) {
      setRealtimeConfiguredReferenceId(null)
      setRealtimeReferenceSyncState(referenceId, `V2 inspection sync failed: ${error.message}`)
      try { await disableAndVerify() } catch (disableError) {
        error.message += `; V2 disable could not be confirmed: ${disableError.message}`
      }
      throw error
    }
  })
}

export function disableRealtimeInspectionForClearedReference() {
  setRealtimeConfiguredReferenceId(null)
  if (isVisionSyncEnabled()) {
    setRealtimeReferenceSyncState(null)
    return Promise.resolve({ ok: true, state: 'disabled_requested' })
  }
  return queue(async () => {
    setRealtimeConfiguredReferenceId(null)
    setRealtimeReferenceSyncState(null)
    await disableAndVerify()
    return { ok: true, state: 'disabled' }
  })
}

export function saveRealtimeInspectionForReference({ db, referenceId, getLoadedReferenceId, getLoadedReferenceSelection, expectedSelectionRevision, draft, checks: selectedChecks, delivery = 'direct' }) {
  // A save may queue behind a load; the previous recipe must not run meanwhile.
  setRealtimeConfiguredReferenceId(null)
  return queue(async () => {
    if (!['direct', 'pull'].includes(delivery)) throw new Error('Invalid inspection recipe delivery mode')
    const syncEnabled = isVisionSyncEnabled()
    const row = readReference(db, referenceId)
    if (!row) throw Object.assign(new Error('Loaded reference not found'), { status: 404 })
    const sourceFingerprint = referenceFingerprint(row)
    assertLoaded(db, referenceId, getLoadedReferenceId, sourceFingerprint, getLoadedReferenceSelection, expectedSelectionRevision)
    const checks = normalizeVisionChecksConfig(selectedChecks ?? parseVisionChecksJson(row.vision_checks_json))
    if (row.vision_inspection_enabled === 0 || !hasEnabledVisionInspectionChecks(checks)) {
      throw Object.assign(new Error('Enable Vision Inspection and select checks on the reference first'), { status: 409 })
    }
    // A recipe must supply its own measurements; the slave may hold another product's values.
    let measurements
    try { measurements = mapRealtimeInspectionMeasurements({ draft, checks, shrinkTube: row }) }
    catch (error) { error.status = 400; throw error }
    const checksJson = JSON.stringify(checks)
    const fingerprint = referenceFingerprint({ ...row, vision_checks_json: checksJson })
    // Commit checks and dimensions together before contacting the slave. Calibration
    // is camera-owned and must never be stored in the product recipe.
    db.transaction(() => {
      assertLoaded(db, referenceId, getLoadedReferenceId, sourceFingerprint, getLoadedReferenceSelection, expectedSelectionRevision)
      db.prepare('UPDATE product_references SET vision_checks_json = ?, realtime_v2_config_json = ?, updated_at = ? WHERE id = ?')
        .run(checksJson, JSON.stringify({ reference_fingerprint: fingerprint, config: measurements }), new Date().toISOString(), referenceId)
    })()
    setRealtimeConfiguredReferenceId(null)
    setRealtimeReferenceSyncState(referenceId, 'V2 inspection configuration is being saved')
    // Vision Settings publishes reference data for the authenticated, revisioned
    // Slave pull protocol. Never fall back to unversioned control when it is off.
    if (delivery === 'pull') {
      const sync_state = syncEnabled ? 'awaiting_slave' : 'not_configured'
      const sync_message = syncEnabled
        ? 'Saved on the Master. Awaiting Vision Slave synchronization; production inspection remains disabled.'
        : 'Saved on the Master. Master–Slave synchronization is not configured; these changes have not been applied to the Slave.'
      setRealtimeReferenceSyncState(referenceId, sync_message)
      return { saved: true, synced: false, sync_state, sync_message }
    }
    if (syncEnabled) {
      const message = 'Saved on Master; awaiting Slave pull synchronization. Direct inspection writes are disabled.'
      setRealtimeReferenceSyncState(referenceId, message)
      throw Object.assign(new Error(message), { saved: true, status: 409, code: 'PRODUCTION_INHIBITED' })
    }
    try {
      await disableAndVerify()
      assertLoaded(db, referenceId, getLoadedReferenceId, fingerprint, getLoadedReferenceSelection, expectedSelectionRevision)
      const live = await getRealtimeConfig()
      const mapped = mapRealtimeInspectionConfig({ saved: live, draft: { ...measurements, calibration: live.calibration }, checks, shrinkTube: row })
      assertLoaded(db, referenceId, getLoadedReferenceId, fingerprint, getLoadedReferenceSelection, expectedSelectionRevision)
      await putRealtimeConfig(mapped)
      const actual = await verifyRealtimeConfig(mapped)
      assertLoaded(db, referenceId, getLoadedReferenceId, fingerprint, getLoadedReferenceSelection, expectedSelectionRevision)
      await enableAndVerify(mapped)
      assertLoaded(db, referenceId, getLoadedReferenceId, fingerprint, getLoadedReferenceSelection, expectedSelectionRevision)
      setRealtimeConfiguredReferenceId(referenceId, actual)
      setRealtimeReferenceSyncState(referenceId)
      return actual
    } catch (error) {
      error.saved = true
      setRealtimeConfiguredReferenceId(null)
      setRealtimeReferenceSyncState(referenceId, `V2 inspection sync failed: ${error.message}`)
      try { await disableAndVerify() } catch (disableError) {
        error.message += `; V2 disable could not be confirmed: ${disableError.message}`
      }
      throw error
    }
  })
}

/** Settings reads come exclusively from the master's loaded reference and database. */
export function getVisionSettingsForReference(db, referenceId) {
  const row = referenceId ? readReference(db, referenceId) : null
  if (!row) return { reference: null, config: null }
  // Keep stored dimensions editable even if reference checks have since changed.
  // Automatic production sync still requires a matching fingerprint via savedRecipe.
  const recipe = storedRecipe(row)?.config
  return {
    reference: {
      id: row.id, name: row.name,
      vision_inspection_enabled: row.vision_inspection_enabled !== 0,
      vision_checks_config: normalizeVisionChecksConfig(parseVisionChecksJson(row.vision_checks_json)),
    },
    config: {
      welding_splice: recipe?.welding_splice ?? { enabled: false, checks: {} },
      heat_shrink_tube: recipe?.heat_shrink_tube ?? {
        enabled: false, checks: {}, expected_length_mm: row.length_mm ?? undefined,
        expected_diameter_mm: row.diameter_mm ?? undefined,
      },
    },
  }
}

export async function getRealtimeConfigForReference(db, referenceId) {
  const live = await getRealtimeConfig()
  const row = referenceId ? readReference(db, referenceId) : null
  const recipe = savedRecipe(row)
  if (recipe) return { ...live, ...recipe, calibration: live.calibration }
  return {
    ...live,
    welding_splice: { enabled: false, checks: {} },
    heat_shrink_tube: {
      enabled: false, checks: {},
      expected_length_mm: row?.length_mm ?? undefined,
      expected_diameter_mm: row?.diameter_mm ?? undefined,
    },
  }
}
