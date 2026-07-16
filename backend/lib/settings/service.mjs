/**
 * SettingsService — single write pipeline for configuration domains.
 */
import { createSettingsRegistry } from './registry.mjs'
import { listDomains, getDomain } from './domainRegistry.mjs'
import './domains/all.mjs'
import {
  ensureSettingsDomainTables,
  migrateBlobToDomains,
  loadDomainRow,
  writeDomainRow,
  mirrorDomainsToBlob,
  FRAMEWORK_SCHEMA_VERSION,
} from './migration.mjs'
import { ensureAuditTable, insertAudit, queryAudit } from './audit.mjs'
import { loadSecrets, saveSecrets, maskSecrets, secretKeyNames } from './secrets.mjs'
import {
  buildSettingsPackage,
  verifySettingsPackage,
  writeBackupFile,
  readBackupFile,
  listBackupFiles,
} from './backup.mjs'
import { SettingsError } from './errors.mjs'
import {
  authorizeSystemSettingsPatch,
  pickPublicSystemSettings,
  PAGE_SETTING_TAB_KEYS,
  KIOSK_DEVICE_SETTING_KEYS,
  flatKeysForDomainPatch,
  flatKeysForDomainReset,
} from './settingsAcl.mjs'
import { setSettingsServiceRef } from './settingsBridge.mjs'
import { getMachineModelProfile, isMachineModelId } from './machineModelProfiles.mjs'
import {
  centringSettingsAffectDerived,
  assertAllShrinkTubesResolvable,
  refreshAllShrinkTubeDerived,
} from '../centringDerivedRecipe.mjs'

/**
 * When `machine_model` is set, inject the matching pick_place + production_sequence
 * packs unless the caller already supplied those flat keys (explicit override).
 * Only injects when the model actually changes — same-model re-select must not
 * reclobber custom P&P / sequence tuning. Keeps real model changes atomic under
 * `settings_general` ACL alone.
 *
 * @param {Record<string, unknown>} flatPatch
 * @param {Record<string, object>} byDomain
 * @param {string|null|undefined} currentMachineModel — registry value before this write
 */
export function applyMachineModelProfileToDomainPatch(flatPatch, byDomain, currentMachineModel) {
  const model = byDomain.general?.machine_model
  if (!isMachineModelId(model)) return
  if (model === currentMachineModel) return
  const profile = getMachineModelProfile(model)
  if (!profile) return
  if (!Object.prototype.hasOwnProperty.call(flatPatch || {}, 'pick_place_config')) {
    byDomain.pick_place = { ...profile.pick_place }
  }
  if (!Object.prototype.hasOwnProperty.call(flatPatch || {}, 'production_sequence_config')) {
    byDomain.production_sequence = { ...profile.production_sequence }
  }
}

/**
 * Map a flat system_settings patch onto domain patches.
 */
export function splitFlatPatch(flatPatch) {
  /** @type {Record<string, object>} */
  const byDomain = {}
  const unknown = []

  for (const [key, value] of Object.entries(flatPatch || {})) {
    if (value === undefined) continue
    if (secretKeyNames().includes(key)) {
      byDomain.__secrets = byDomain.__secrets || {}
      byDomain.__secrets[key] = value
      continue
    }

    let placed = false
    for (const domain of listDomains()) {
      const keys = domain.blobKeys || []
      if (domain.id === 'pick_place' && key === 'pick_place_config') {
        byDomain.pick_place = value && typeof value === 'object' ? value : {}
        placed = true
        break
      }
      if (domain.id === 'production_sequence' && key === 'production_sequence_config') {
        byDomain.production_sequence = value && typeof value === 'object' ? value : {}
        placed = true
        break
      }
      if (domain.id === 'serial' && key === 'reference_serial') {
        byDomain.serial = value && typeof value === 'object' ? value : {}
        placed = true
        break
      }
      if (domain.id === 'access' && key === 'role_tab_access') {
        byDomain.access = value
        placed = true
        break
      }
      if (domain.id === 'vision' && (key === 'vision_general_tool_template' || key === 'vision_url')) {
        byDomain.vision = byDomain.vision || {}
        byDomain.vision[key] = value
        placed = true
        break
      }
      if (keys.includes(key)) {
        byDomain[domain.id] = byDomain[domain.id] || {}
        byDomain[domain.id][key] = value
        placed = true
        break
      }
    }
    if (!placed) unknown.push(key)
  }

  return { byDomain, unknown }
}

/**
 * Assemble flat SystemSettings-compatible document from domain cache.
 */
export function assembleFlatFromDomains(registry, secrets = {}) {
  const flat = {}
  for (const domain of listDomains()) {
    const entry = registry.get(domain.id)
    const data = entry?.data ?? domain.normalize(domain.defaults())
    if (domain.id === 'pick_place') {
      flat.pick_place_config = data
      continue
    }
    if (domain.id === 'production_sequence') {
      flat.production_sequence_config = data
      continue
    }
    if (domain.id === 'serial') {
      flat.reference_serial = data
      continue
    }
    if (domain.id === 'access') {
      flat.role_tab_access = data
      continue
    }
    if (domain.id === 'vision') {
      flat.vision_general_tool_template = data.vision_general_tool_template
      if (data.vision_url != null) flat.vision_url = data.vision_url
      continue
    }
    Object.assign(flat, data)
  }
  // Never put raw secrets into the public flat document by default
  void secrets
  return flat
}

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {object} [opts.runtime] — onApply hooks (loadPickPlaceConfig, etc.)
 */
export function createSettingsService({ db, runtime = {} }) {
  ensureSettingsDomainTables(db)
  ensureAuditTable(db)
  migrateBlobToDomains(db)

  const registry = createSettingsRegistry()
  let writeLocked = false
  const writeQueue = []

  function hydrateRegistry() {
    for (const domain of listDomains()) {
      const loaded = loadDomainRow(db, domain)
      registry.set(domain.id, loaded.schemaVersion, loaded.data, loaded.updatedAt)
    }
  }

  hydrateRegistry()

  function applyAllRuntime() {
    for (const domain of listDomains()) {
      const entry = registry.get(domain.id)
      if (entry && typeof domain.onApply === 'function') {
        try {
          domain.onApply(entry.data, runtime)
        } catch (err) {
          console.warn(`[settings] onApply(${domain.id}) failed:`, err?.message || err)
        }
      }
    }
  }

  function withWriteLock(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        writeLocked = true
        try {
          const result = fn()
          resolve(result)
        } catch (err) {
          reject(err)
        } finally {
          writeLocked = false
          const next = writeQueue.shift()
          if (next) next()
        }
      }
      if (writeLocked) writeQueue.push(run)
      else run()
    })
  }

  function withWriteLockSync(fn) {
    // better-sqlite3 is sync; serialize overlapping sync callers via flag + queue micro-loop
    if (writeLocked) {
      // Nested sync write: run inline (same tick caller) — still protected by SQLite transaction
      return fn()
    }
    writeLocked = true
    try {
      return fn()
    } finally {
      writeLocked = false
    }
  }

  function actorFromCtx(ctx = {}) {
    return {
      actorUserId: ctx.userId ?? ctx.userRow?.id ?? null,
      actorUsername: ctx.username ?? ctx.userRow?.username ?? ctx.actorUsername ?? 'system',
    }
  }

  function getDomainDocument(domainId) {
    const domain = getDomain(domainId)
    if (!domain) {
      throw new SettingsError('UNKNOWN_DOMAIN', `Unknown domain: ${domainId}`, { status: 404 })
    }
    let entry = registry.get(domainId)
    if (!entry) {
      const loaded = loadDomainRow(db, domain)
      entry = registry.set(domainId, loaded.schemaVersion, loaded.data, loaded.updatedAt)
    }
    return {
      domain: domainId,
      schemaVersion: entry.schemaVersion,
      etag: entry.etag,
      updatedAt: entry.updatedAt,
      data: entry.data,
      sensitivity: domain.sensitivity,
      tabKey: domain.tabKey,
      fieldMeta: domain.fieldMeta || null,
    }
  }

  function getAssembledSystemView({ includeSecretsMasked = false } = {}) {
    const flat = assembleFlatFromDomains(registry)
    if (includeSecretsMasked) {
      Object.assign(flat, maskSecrets(loadSecrets(db)))
    }
    return flat
  }

  function getPublicSystemView() {
    // Phase 3 tightened public allowlist: device prefs + boot-critical general fields only.
    const flat = getAssembledSystemView()
    const ui = registry.get('ui')?.data || {}
    const general = registry.get('general')?.data || {}
    return {
      theme: ui.theme ?? flat.theme,
      locale: ui.locale ?? flat.locale,
      production_sections: ui.production_sections ?? flat.production_sections ?? {},
      require_login: general.require_login ?? flat.require_login,
      machine_model: general.machine_model ?? flat.machine_model,
      test_mode: general.test_mode ?? flat.test_mode,
    }
  }

  /** Legacy-compatible helper — prefer getPublicSystemView() for live unauth GET. */
  function getLegacyPublicSystemView() {
    return pickPublicSystemSettings(getAssembledSystemView())
  }

  function persistMirror() {
    mirrorDomainsToBlob(db, assembleFlatFromDomains(registry))
  }

  function patchDomainSync(domainId, patch, ctx = {}) {
    const domain = getDomain(domainId)
    if (!domain) {
      throw new SettingsError('UNKNOWN_DOMAIN', `Unknown domain: ${domainId}`, { status: 404 })
    }
    if (ctx.ifMatch) {
      const current = registry.get(domainId)
      if (current && ctx.ifMatch !== current.etag) {
        throw new SettingsError('VERSION_CONFLICT', 'ETag mismatch', {
          status: 409,
          details: { etag: current.etag },
        })
      }
    }

    const before = registry.get(domainId)?.data ?? domain.normalize(domain.defaults())
    const merged = domain.mergePatch(before, patch || {})
    const actor = actorFromCtx(ctx)

    // Centring frame/start/offset → recompute derived geometry on all shrink tubes
    // in the same SQLite transaction as the settings write (or reject the patch).
    let prospectiveSettingsForDerived = null
    if (domainId === 'centring' && centringSettingsAffectDerived(before, merged)) {
      prospectiveSettingsForDerived = {
        ...assembleFlatFromDomains(registry),
        centring_frame_config: merged.centring_frame_config,
        centering_input_start_mm: merged.centering_input_start_mm,
        centering_input_offset_mm: merged.centering_input_offset_mm,
      }
      try {
        assertAllShrinkTubesResolvable(db, prospectiveSettingsForDerived)
      } catch (err) {
        throw new SettingsError(
          'VALIDATION',
          err instanceof Error ? err.message : String(err),
          {
            status: 422,
            details: [{ path: 'centring', message: err instanceof Error ? err.message : String(err) }],
          },
        )
      }
    }

    const tx = db.transaction(() => {
      const written = writeDomainRow(db, domain, merged, { updatedBy: actor.actorUsername })
      insertAudit(db, {
        domain: domainId,
        actorUserId: actor.actorUserId,
        actorUsername: actor.actorUsername,
        action: ctx.action || 'patch',
        beforeJson: before,
        afterJson: written.data,
        reason: ctx.reason || null,
      })
      if (prospectiveSettingsForDerived) {
        refreshAllShrinkTubeDerived(db, prospectiveSettingsForDerived)
      }
      return written
    })
    const written = tx()
    const entry = registry.set(domainId, domain.schemaVersion, written.data, written.updatedAt)
    persistMirror()
    if (typeof domain.onApply === 'function') {
      domain.onApply(written.data, runtime)
    }
    return {
      domain: domainId,
      schemaVersion: domain.schemaVersion,
      etag: entry.etag,
      updatedAt: entry.updatedAt,
      data: written.data,
    }
  }

  function patchDomain(domainId, patch, ctx = {}) {
    return withWriteLockSync(() => patchDomainSync(domainId, patch, ctx))
  }

  /**
   * Flat PUT /api/settings/system facade — splits into domain patches.
   */
  function patchSystemFlat(flatPatch, ctx = {}) {
    return withWriteLockSync(() => {
      const { byDomain, unknown } = splitFlatPatch(flatPatch)
      if (unknown.length) {
        // Preserve legacy behavior: unknown keys still merge into system domain if admin
        const sysPatch = {}
        for (const key of unknown) {
          sysPatch[key] = flatPatch[key]
        }
        byDomain.system = { ...(byDomain.system || {}), ...sysPatch }
      }

      // Model selection persists matching motion/timing packs in the same write
      // only when the model actually changes (same-model re-select is a no-op).
      const currentMachineModel = registry.get('general')?.data?.machine_model
      applyMachineModelProfileToDomainPatch(flatPatch, byDomain, currentMachineModel)

      if (byDomain.__secrets) {
        saveSecrets(db, byDomain.__secrets)
        delete byDomain.__secrets
      }

      const domainIds = Object.keys(byDomain)
      if (domainIds.length === 0) {
        throw new SettingsError('EMPTY_PATCH', 'No settings to update', { status: 400 })
      }

      for (const domainId of domainIds) {
        patchDomainSync(domainId, byDomain[domainId], { ...ctx, action: 'patch' })
      }

      // Always refresh serial bridge from assembled view (legacy writeSystemSettings did this)
      const serial = registry.get('serial')?.data
      if (serial) runtime?.setReferenceSerialFromSettings?.(serial)

      return getAssembledSystemView({ includeSecretsMasked: false })
    })
  }

  function resetDomain(domainId, ctx = {}) {
    return withWriteLockSync(() => {
      const domain = getDomain(domainId)
      if (!domain) {
        throw new SettingsError('UNKNOWN_DOMAIN', `Unknown domain: ${domainId}`, { status: 404 })
      }
      const backupPath = createBackupSync({ prefix: `pre-reset-${domainId}` })
      const defaults = domain.normalize(domain.defaults())
      const before = registry.get(domainId)?.data ?? null
      const actor = actorFromCtx(ctx)
      let prospectiveSettingsForDerived = null
      if (domainId === 'centring') {
        prospectiveSettingsForDerived = {
          ...assembleFlatFromDomains(registry),
          centring_frame_config: defaults.centring_frame_config,
          centering_input_start_mm: defaults.centering_input_start_mm,
          centering_input_offset_mm: defaults.centering_input_offset_mm,
        }
        try {
          assertAllShrinkTubesResolvable(db, prospectiveSettingsForDerived)
        } catch (err) {
          throw new SettingsError(
            'VALIDATION',
            err instanceof Error ? err.message : String(err),
            {
              status: 422,
              details: [{ path: 'centring', message: err instanceof Error ? err.message : String(err) }],
            },
          )
        }
      }
      const tx = db.transaction(() => {
        const written = writeDomainRow(db, domain, defaults, { updatedBy: actor.actorUsername })
        insertAudit(db, {
          domain: domainId,
          actorUserId: actor.actorUserId,
          actorUsername: actor.actorUsername,
          action: 'reset',
          beforeJson: before,
          afterJson: written.data,
          reason: ctx.reason || `backup:${backupPath}`,
        })
        if (prospectiveSettingsForDerived) {
          refreshAllShrinkTubeDerived(db, prospectiveSettingsForDerived)
        }
        return written
      })
      const written = tx()
      const entry = registry.set(domainId, domain.schemaVersion, written.data, written.updatedAt)
      persistMirror()
      domain.onApply?.(written.data, runtime)
      return {
        domain: domainId,
        schemaVersion: domain.schemaVersion,
        etag: entry.etag,
        updatedAt: entry.updatedAt,
        data: written.data,
        backupPath,
      }
    })
  }

  function resetAll(ctx = {}) {
    const backupPath = createBackupSync({ prefix: 'pre-reset-all' })
    const results = {}
    for (const domain of listDomains()) {
      if (domain.id === 'access') continue // do not wipe RBAC matrix on full reset unless forced
      results[domain.id] = resetDomain(domain.id, {
        ...ctx,
        reason: ctx.reason || `full reset (backup: ${backupPath})`,
      })
    }
    return { backupPath, results }
  }

  function createBackupSync({ prefix = 'settings-backup', includeSecrets = false } = {}) {
    const domainsPayload = {}
    for (const domain of listDomains()) {
      const entry = registry.get(domain.id)
      domainsPayload[domain.id] = {
        schemaVersion: entry?.schemaVersion ?? domain.schemaVersion,
        data: entry?.data ?? domain.normalize(domain.defaults()),
      }
    }
    const pkg = buildSettingsPackage({
      domains: domainsPayload,
      meta: { frameworkSchemaVersion: FRAMEWORK_SCHEMA_VERSION },
      includeSecrets,
      secrets: includeSecrets ? loadSecrets(db) : null,
    })
    return writeBackupFile(pkg, prefix)
  }

  function createBackup(opts) {
    return withWriteLockSync(() => ({
      status: 'success',
      backup_path: createBackupSync(opts),
    }))
  }

  function exportPackage({ domains: domainFilter = null, includeSecrets = false } = {}) {
    const domainsPayload = {}
    for (const domain of listDomains()) {
      if (domainFilter && !domainFilter.includes(domain.id)) continue
      const entry = registry.get(domain.id)
      domainsPayload[domain.id] = {
        schemaVersion: entry?.schemaVersion ?? domain.schemaVersion,
        data: entry?.data ?? domain.normalize(domain.defaults()),
      }
    }
    return buildSettingsPackage({
      domains: domainsPayload,
      meta: { frameworkSchemaVersion: FRAMEWORK_SCHEMA_VERSION },
      includeSecrets,
      secrets: includeSecrets ? loadSecrets(db) : null,
    })
  }

  function importPackage(pkg, { dryRun = true, ctx = {} } = {}) {
    verifySettingsPackage(pkg)
    const diffs = {}
    for (const [domainId, payload] of Object.entries(pkg.domains || {})) {
      const domain = getDomain(domainId)
      if (!domain) {
        diffs[domainId] = { status: 'unknown_domain' }
        continue
      }
      const current = registry.get(domainId)?.data
      const next = domain.normalize(payload.data ?? payload)
      diffs[domainId] = {
        status: 'ok',
        changed: JSON.stringify(current) !== JSON.stringify(next),
      }
    }
    if (dryRun) {
      return { dryRun: true, diffs }
    }
    return withWriteLockSync(() => {
      const backupPath = createBackupSync({ prefix: 'pre-import' })
      for (const [domainId, payload] of Object.entries(pkg.domains || {})) {
        const domain = getDomain(domainId)
        if (!domain) continue
        const data = domain.normalize(payload.data ?? payload)
        patchDomainSync(domainId, data, {
          ...ctx,
          action: 'import',
          reason: ctx.reason || `import (backup: ${backupPath})`,
        })
        // Force replace with imported data
        const actor = actorFromCtx(ctx)
        const before = registry.get(domainId)?.data
        const tx = db.transaction(() => {
          const written = writeDomainRow(db, domain, data, { updatedBy: actor.actorUsername })
          insertAudit(db, {
            domain: domainId,
            actorUserId: actor.actorUserId,
            actorUsername: actor.actorUsername,
            action: 'import',
            beforeJson: before,
            afterJson: written.data,
            reason: `backup:${backupPath}`,
          })
          return written
        })
        const written = tx()
        registry.set(domainId, domain.schemaVersion, written.data, written.updatedAt)
        domain.onApply?.(written.data, runtime)
      }
      if (pkg.secrets) {
        saveSecrets(db, pkg.secrets)
      }
      persistMirror()
      return { dryRun: false, backupPath, diffs }
    })
  }

  function restoreFromPath(filePath, ctx = {}) {
    const pkg = readBackupFile(filePath)
    return importPackage(pkg, { dryRun: false, ctx: { ...ctx, action: 'restore' } })
  }

  function catalogForCaller({ canSeeHigh = false, canSeeAdmin = false } = {}) {
    return listDomains()
      .filter((d) => {
        if (d.sensitivity === 'admin' || d.sensitivity === 'bypass') return canSeeAdmin
        if (d.sensitivity === 'high' || d.sensitivity === 'secret') return canSeeHigh || canSeeAdmin
        return true
      })
      .map((d) => {
        const entry = registry.get(d.id)
        return {
          id: d.id,
          schemaVersion: d.schemaVersion,
          sensitivity: d.sensitivity,
          tabKey: d.tabKey,
          etag: entry?.etag ?? null,
          updatedAt: entry?.updatedAt ?? null,
          fieldMeta: d.fieldMeta || null,
        }
      })
  }

  function authorizeFlatPatch(keys, authCtx) {
    return authorizeSystemSettingsPatch({
      keys,
      userRow: authCtx.userRow,
      isMachineOperationAllowed: authCtx.isMachineOperationAllowed,
      hasSettingsTabAccess: authCtx.hasSettingsTabAccess,
      rank: authCtx.rank,
      adminMinRank: authCtx.adminMinRank,
    })
  }

  /**
   * Field-level ACL for domain PATCH — same rules as PUT /api/settings/system.
   * Replaces coarse domainAuthz for writes so mixed domains (general, ui) cannot
   * escalate admin-only keys via tab/device sensitivity alone.
   */
  function authorizeDomainPatch(domainId, patch, authCtx) {
    const domain = getDomain(domainId)
    if (!domain) {
      return { ok: false, status: 404, message: 'Unknown domain' }
    }
    const keys = flatKeysForDomainPatch(domainId, patch)
    if (keys.length === 0) {
      return { ok: false, status: 400, message: 'Empty patch' }
    }
    return authorizeFlatPatch(keys, authCtx)
  }

  /** Full-domain reset must be allowed to rewrite every owned flat key. */
  function authorizeDomainReset(domainId, authCtx) {
    const domain = getDomain(domainId)
    if (!domain) {
      return { ok: false, status: 404, message: 'Unknown domain' }
    }
    const keys = flatKeysForDomainReset(domainId, domain.blobKeys || [])
    if (keys.length === 0) {
      return { ok: false, status: 400, message: 'Domain has no writable keys' }
    }
    return authorizeFlatPatch(keys, authCtx)
  }

  /**
   * Coarse read/catalog gate (not used for PATCH). Prefer authorizeDomainPatch for writes.
   * @deprecated for write paths — kept for callers that only need domain existence + sensitivity.
   */
  function domainAuthz(domainId, authCtx) {
    const domain = getDomain(domainId)
    if (!domain) {
      return { ok: false, status: 404, message: 'Unknown domain' }
    }
    // Device domain is still readable without auth; writes use authorizeDomainPatch.
    if (domain.sensitivity === 'device') return { ok: true }
    if (domain.tabKey) {
      if (!authCtx.isMachineOperationAllowed) {
        return { ok: false, status: 401, message: 'Not authenticated' }
      }
      if (!authCtx.hasSettingsTabAccess(domain.tabKey)) {
        return { ok: false, status: 403, message: 'Not authorized for this settings page' }
      }
      return { ok: true }
    }
    if (!authCtx.userRow) {
      return { ok: false, status: 401, message: 'Not authenticated' }
    }
    if (authCtx.rank(authCtx.userRow) < (authCtx.adminMinRank ?? 4)) {
      return { ok: false, status: 403, message: 'Admin access required' }
    }
    return { ok: true }
  }

  // Initial runtime apply once hydrated
  applyAllRuntime()

  return {
    registry,
    hydrateRegistry,
    applyAllRuntime,
    getDomainDocument,
    getAssembledSystemView,
    getPublicSystemView,
    getLegacyPublicSystemView,
    patchDomain,
    patchSystemFlat,
    resetDomain,
    resetAll,
    createBackup,
    exportPackage,
    importPackage,
    restoreFromPath,
    listBackups: listBackupFiles,
    queryAudit: (q) => queryAudit(db, q),
    catalogForCaller,
    authorizeFlatPatch,
    authorizeDomainPatch,
    authorizeDomainReset,
    domainAuthz,
    loadSecrets: () => loadSecrets(db),
    saveSecrets: (patch) => saveSecrets(db, patch),
    maskSecrets: () => maskSecrets(loadSecrets(db)),
    /** Sync write used by config stores */
    writePickPlaceConfig(config) {
      return patchDomain('pick_place', config, { actorUsername: 'pick_place_store', action: 'patch' }).data
    },
    writeCentringConfig(config) {
      return patchDomain('centring', { centring_config: config }, {
        actorUsername: 'centring_store',
        action: 'patch',
      }).data.centring_config
    },
    FRAMEWORK_SCHEMA_VERSION,
    PAGE_SETTING_TAB_KEYS,
    KIOSK_DEVICE_SETTING_KEYS,
    withWriteLock,
  }
}

/** @type {ReturnType<typeof createSettingsService>|null} */
let singleton = null

export function initSettingsService(opts) {
  singleton = createSettingsService(opts)
  // Sync bridge for config stores (settingsBridge has no import cycle with domains).
  setSettingsServiceRef(singleton)
  return singleton
}

export function getSettingsService() {
  if (!singleton) {
    throw new Error('SettingsService not initialized')
  }
  return singleton
}
