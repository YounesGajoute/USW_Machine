/**
 * Settings domains — split of the legacy system_settings JSON blob.
 */
import { registerDomain } from '../domainRegistry.mjs'
import {
  DEFAULT_PICK_PLACE_CONFIG,
  mergePickPlaceConfigPatch,
  normalizePickPlaceConfig,
  validatePickPlaceConfig,
} from '../../pickPlaceConfigStore.mjs'
import {
  DEFAULT_CENTRING_CONFIG_STORE,
  mergeCentringConfigPatch,
  normalizeCentringConfig,
} from '../../centringConfigStore.mjs'
import {
  DEFAULT_PRODUCTION_SEQUENCE_CONFIG,
  mergeProductionSequenceConfigPatch,
  normalizeProductionSequenceConfig,
  validateProductionSequenceConfig,
} from '../../productionSequenceConfigStore.mjs'
import { DEFAULTS, normalizeReferenceSerial, mergeReferenceSerialPatch } from '../../db.mjs'
import { normalizeCentringFrameConfig } from '../../centring_frame_model.js'
import { mergeRoleTabAccess } from '../../roleTabAccessDefaults.mjs'
import { SettingsError } from '../errors.mjs'

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function identityMigrate(_from, data) {
  return data && typeof data === 'object' ? data : {}
}

function shallowMerge(current, patch) {
  return { ...current, ...(patch && typeof patch === 'object' ? patch : {}) }
}

// ── ui ───────────────────────────────────────────────────────────────────────

registerDomain({
  id: 'ui',
  schemaVersion: 1,
  sensitivity: 'device',
  tabKey: null,
  blobKeys: ['theme', 'locale', 'production_sections'],
  fieldMeta: {
    theme: { enum: ['light', 'dark', 'versigent', 'versigent-light', 'versigent-dark'] },
    locale: { enum: ['en', 'fr'] },
  },
  defaults: () => ({
    theme: DEFAULTS.theme,
    locale: DEFAULTS.locale,
    production_sections: clone(DEFAULTS.production_sections || {}),
  }),
  migrate: identityMigrate,
  normalize(data) {
    const d = this.defaults()
    const raw = data && typeof data === 'object' ? data : {}
    const allowedTheme = new Set(['light', 'dark', 'versigent', 'versigent-light', 'versigent-dark'])
    const theme = allowedTheme.has(raw.theme) ? raw.theme : d.theme
    const locale = raw.locale === 'en' || raw.locale === 'fr' ? raw.locale : d.locale
    const production_sections =
      raw.production_sections && typeof raw.production_sections === 'object' && !Array.isArray(raw.production_sections)
        ? { ...raw.production_sections }
        : { ...d.production_sections }
    return { theme, locale, production_sections }
  },
  mergePatch(current, patch) {
    const next = shallowMerge(current, patch)
    if (patch?.theme != null) {
      const allowed = new Set(['light', 'dark', 'versigent', 'versigent-light', 'versigent-dark'])
      if (!allowed.has(patch.theme)) {
        throw new SettingsError('VALIDATION', 'Invalid theme', {
          status: 422,
          details: [{ path: 'theme', message: 'Invalid theme value' }],
        })
      }
    }
    if (patch?.locale != null && patch.locale !== 'en' && patch.locale !== 'fr') {
      throw new SettingsError('VALIDATION', 'Invalid locale', {
        status: 422,
        details: [{ path: 'locale', message: 'locale must be en or fr' }],
      })
    }
    return this.normalize(next)
  },
  publicProjection(data) {
    return { ...data }
  },
})

// ── general ──────────────────────────────────────────────────────────────────

registerDomain({
  id: 'general',
  schemaVersion: 1,
  sensitivity: 'medium',
  tabKey: 'settings_general',
  blobKeys: ['require_login', 'test_mode', 'history_retention_days', 'machine_model'],
  fieldMeta: {
    machine_model: { enum: ['STCS-CS19', 'STCS-evo500', null] },
    test_mode: { enum: ['manual', 'reference', 'sequential'] },
    history_retention_days: { min: 1, max: 3650, unit: 'days' },
  },
  defaults: () => ({
    require_login: DEFAULTS.require_login,
    test_mode: DEFAULTS.test_mode,
    history_retention_days: DEFAULTS.history_retention_days,
    machine_model: DEFAULTS.machine_model,
  }),
  migrate: identityMigrate,
  normalize(data) {
    const d = this.defaults()
    const raw = data && typeof data === 'object' ? data : {}
    const test_mode =
      raw.test_mode === 'manual' || raw.test_mode === 'reference' || raw.test_mode === 'sequential'
        ? raw.test_mode
        : d.test_mode
    let machine_model = raw.machine_model ?? d.machine_model
    if (machine_model != null && machine_model !== 'STCS-CS19' && machine_model !== 'STCS-evo500') {
      machine_model = d.machine_model
    }
    const retention = Number(raw.history_retention_days)
    return {
      require_login: Boolean(raw.require_login ?? d.require_login),
      test_mode,
      history_retention_days: Number.isFinite(retention) && retention >= 1 ? Math.round(retention) : d.history_retention_days,
      machine_model,
    }
  },
  mergePatch(current, patch) {
    const next = shallowMerge(current, patch)
    if (patch?.machine_model != null && patch.machine_model !== 'STCS-CS19' && patch.machine_model !== 'STCS-evo500') {
      throw new SettingsError('VALIDATION', 'Invalid machine_model', {
        status: 422,
        details: [{ path: 'machine_model', message: 'Must be STCS-CS19 or STCS-evo500' }],
      })
    }
    if (patch?.test_mode != null) {
      const ok = patch.test_mode === 'manual' || patch.test_mode === 'reference' || patch.test_mode === 'sequential'
      if (!ok) {
        throw new SettingsError('VALIDATION', 'Invalid test_mode', {
          status: 422,
          details: [{ path: 'test_mode', message: 'Must be manual|reference|sequential' }],
        })
      }
    }
    return this.normalize(next)
  },
  publicProjection(data) {
    return {
      require_login: data.require_login,
      test_mode: data.test_mode,
      machine_model: data.machine_model,
    }
  },
})

// ── pick_place ───────────────────────────────────────────────────────────────

registerDomain({
  id: 'pick_place',
  schemaVersion: 1,
  sensitivity: 'high',
  tabKey: 'settings_pick_place',
  blobKeys: ['pick_place_config'],
  fieldMeta: {
    movementSpeedMmS: { min: 0.01, max: 12000, unit: 'mm/s' },
    homingSpeedMmS: { min: 0.01, max: 12000, unit: 'mm/s' },
    backoffMmA: { min: 0.01, max: 50, unit: 'mm' },
    backoffMmB: { min: 0.01, max: 50, unit: 'mm' },
    maxPositionMm: { min: 1, max: 2000, unit: 'mm' },
    referenceAxis: { enum: ['a', 'b'] },
  },
  defaults: () => ({ ...DEFAULT_PICK_PLACE_CONFIG }),
  migrate: identityMigrate,
  normalize(data) {
    return normalizePickPlaceConfig(data)
  },
  mergePatch(current, patch) {
    try {
      return mergePickPlaceConfigPatch(current, patch)
    } catch (e) {
      throw new SettingsError('VALIDATION', e.message, {
        status: 422,
        details: [{ path: 'pick_place', message: e.message }],
      })
    }
  },
  publicProjection(data) {
    return { ...data }
  },
  onApply(data, runtime) {
    runtime?.loadPickPlaceConfig?.()
  },
})

// ── centring ─────────────────────────────────────────────────────────────────

registerDomain({
  id: 'centring',
  schemaVersion: 1,
  sensitivity: 'high',
  tabKey: 'settings_shrink_tubes',
  blobKeys: [
    'centring_config',
    'centring_frame_config',
    'centering_input_start_mm',
    'centering_input_offset_mm',
    'mechanism_positions_by_machine',
  ],
  defaults: () => ({
    centring_config: clone(DEFAULT_CENTRING_CONFIG_STORE),
    centring_frame_config: clone(DEFAULTS.centring_frame_config),
    centering_input_start_mm: DEFAULTS.centering_input_start_mm,
    centering_input_offset_mm: DEFAULTS.centering_input_offset_mm,
    mechanism_positions_by_machine: {},
  }),
  migrate: identityMigrate,
  normalize(data) {
    const d = this.defaults()
    const raw = data && typeof data === 'object' ? data : {}
    const start = Number(raw.centering_input_start_mm)
    const offset = Number(raw.centering_input_offset_mm)
    return {
      centring_config: normalizeCentringConfig(raw.centring_config ?? d.centring_config),
      centring_frame_config: normalizeCentringFrameConfig(
        raw.centring_frame_config ?? d.centring_frame_config,
        d.centring_frame_config,
      ),
      centering_input_start_mm: Number.isFinite(start) && start >= 0 ? start : d.centering_input_start_mm,
      centering_input_offset_mm: Number.isFinite(offset) ? offset : d.centering_input_offset_mm,
      mechanism_positions_by_machine:
        raw.mechanism_positions_by_machine && typeof raw.mechanism_positions_by_machine === 'object'
          ? raw.mechanism_positions_by_machine
          : {},
    }
  },
  mergePatch(current, patch) {
    const next = { ...current }
    if (patch?.centring_config && typeof patch.centring_config === 'object') {
      next.centring_config = mergeCentringConfigPatch(current.centring_config, patch.centring_config)
    }
    if (patch?.centring_frame_config && typeof patch.centring_frame_config === 'object') {
      next.centring_frame_config = normalizeCentringFrameConfig(
        patch.centring_frame_config,
        current.centring_frame_config,
      )
    }
    if (patch?.centering_input_start_mm != null) {
      const n = Number(patch.centering_input_start_mm)
      if (!Number.isFinite(n) || n < 0) {
        throw new SettingsError('VALIDATION', 'centering_input_start_mm must be ≥ 0', {
          status: 422,
          details: [{ path: 'centering_input_start_mm', message: 'Must be a finite number ≥ 0' }],
        })
      }
      next.centering_input_start_mm = n
    }
    if (patch?.centering_input_offset_mm != null) {
      const n = Number(patch.centering_input_offset_mm)
      if (!Number.isFinite(n)) {
        throw new SettingsError('VALIDATION', 'centering_input_offset_mm must be finite', {
          status: 422,
          details: [{ path: 'centering_input_offset_mm', message: 'Must be a finite number' }],
        })
      }
      next.centering_input_offset_mm = n
    }
    if (patch?.mechanism_positions_by_machine && typeof patch.mechanism_positions_by_machine === 'object') {
      const curMap =
        current.mechanism_positions_by_machine && typeof current.mechanism_positions_by_machine === 'object'
          ? current.mechanism_positions_by_machine
          : {}
      const out = { ...curMap }
      for (const [modelKey, modelPatch] of Object.entries(patch.mechanism_positions_by_machine)) {
        if (!modelPatch || typeof modelPatch !== 'object') continue
        const prev = out[modelKey] && typeof out[modelKey] === 'object' ? out[modelKey] : {}
        const nextProfile = { ...prev, ...modelPatch }
        if (modelPatch.centering && typeof modelPatch.centering === 'object') {
          nextProfile.centering = {
            ...(prev.centering && typeof prev.centering === 'object' ? prev.centering : {}),
            ...modelPatch.centering,
          }
        }
        out[modelKey] = nextProfile
      }
      next.mechanism_positions_by_machine = out
    }
    return this.normalize(next)
  },
  publicProjection(data) {
    return { ...data }
  },
  onApply(data, runtime) {
    if (runtime?.loadCentringConfig) runtime.loadCentringConfig()
    if (runtime?.closeSerialSession) runtime.closeSerialSession()
  },
})

// ── production_sequence ──────────────────────────────────────────────────────

registerDomain({
  id: 'production_sequence',
  schemaVersion: 1,
  sensitivity: 'high',
  tabKey: 'settings_production_sequence',
  blobKeys: ['production_sequence_config'],
  defaults: () => ({ ...DEFAULT_PRODUCTION_SEQUENCE_CONFIG }),
  migrate: identityMigrate,
  normalize(data) {
    return normalizeProductionSequenceConfig(data)
  },
  mergePatch(current, patch) {
    try {
      return mergeProductionSequenceConfigPatch(current, patch)
    } catch (e) {
      throw new SettingsError('VALIDATION', e.message, {
        status: 422,
        details: [{ path: 'production_sequence', message: e.message }],
      })
    }
  },
  publicProjection(data) {
    return { ...data }
  },
  onApply(data, runtime) {
    runtime?.reloadProductionSequenceConfig?.(data)
  },
})

// ── vision ───────────────────────────────────────────────────────────────────

registerDomain({
  id: 'vision',
  schemaVersion: 1,
  sensitivity: 'high',
  tabKey: 'settings_vision',
  blobKeys: ['vision_general_tool_template', 'vision_url'],
  defaults: () => ({
    vision_general_tool_template: clone(DEFAULTS.vision_general_tool_template),
    vision_url: null,
  }),
  migrate: identityMigrate,
  normalize(data) {
    const d = this.defaults()
    const raw = data && typeof data === 'object' ? data : {}
    const tplRaw = raw.vision_general_tool_template
    const baseTpl = d.vision_general_tool_template
    let vision_general_tool_template
    if (!tplRaw || typeof tplRaw !== 'object') {
      vision_general_tool_template = clone(baseTpl)
    } else {
      const tools = Array.isArray(tplRaw.tools) && tplRaw.tools.length ? tplRaw.tools : baseTpl.tools
      vision_general_tool_template = { ...baseTpl, ...tplRaw, tools }
    }
    return {
      vision_general_tool_template,
      vision_url: raw.vision_url != null ? String(raw.vision_url) : null,
    }
  },
  mergePatch(current, patch) {
    const next = { ...current }
    if (patch?.vision_general_tool_template && typeof patch.vision_general_tool_template === 'object') {
      const curTpl = current.vision_general_tool_template
      const p = patch.vision_general_tool_template
      next.vision_general_tool_template = {
        ...curTpl,
        ...p,
        tools: Array.isArray(p.tools) ? p.tools : curTpl.tools,
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'vision_url')) {
      next.vision_url = patch.vision_url != null ? String(patch.vision_url) : null
    }
    return this.normalize(next)
  },
  publicProjection(data) {
    return {
      vision_general_tool_template: data.vision_general_tool_template,
    }
  },
})

// ── serial ───────────────────────────────────────────────────────────────────

registerDomain({
  id: 'serial',
  schemaVersion: 1,
  sensitivity: 'medium',
  tabKey: null,
  blobKeys: ['reference_serial'],
  defaults: () => clone(DEFAULTS.reference_serial),
  migrate: identityMigrate,
  normalize(data) {
    return normalizeReferenceSerial(data)
  },
  mergePatch(current, patch) {
    return mergeReferenceSerialPatch(current, patch)
  },
  publicProjection() {
    return {}
  },
  onApply(data, runtime) {
    runtime?.setReferenceSerialFromSettings?.(data)
  },
})

// ── access ───────────────────────────────────────────────────────────────────

registerDomain({
  id: 'access',
  schemaVersion: 1,
  sensitivity: 'admin',
  tabKey: null,
  blobKeys: ['role_tab_access'],
  defaults: () => ({}),
  migrate: identityMigrate,
  normalize(data) {
    return mergeRoleTabAccess(data)
  },
  mergePatch(_current, patch) {
    return mergeRoleTabAccess(patch)
  },
  publicProjection() {
    return {}
  },
})

// ── system ───────────────────────────────────────────────────────────────────

/** Sole production mode. Legacy `full` / `centring` values coerce to `advanced`. */
export const PRODUCTION_CYCLE_VARIANTS = Object.freeze(['advanced'])

function coerceProductionCycleVariant(raw) {
  // Legacy mode names → advanced (only mode supported).
  if (raw === 'full' || raw === 'centring' || raw === 'advanced') return 'advanced'
  return null
}

registerDomain({
  id: 'system',
  schemaVersion: 1,
  sensitivity: 'admin',
  tabKey: null,
  blobKeys: ['serial_number', 'quickpass', 'post_update_action', 'production_cycle_variant'],
  defaults: () => ({
    serial_number: null,
    quickpass: false,
    post_update_action: DEFAULTS.post_update_action || 'reboot',
    production_cycle_variant: DEFAULTS.production_cycle_variant || 'advanced',
  }),
  migrate: identityMigrate,
  normalize(data) {
    const d = this.defaults()
    const raw = data && typeof data === 'object' ? data : {}
    // Canonical HMI values: reboot | restart-service | nothing.
    // Legacy aliases: none → nothing, shutdown → reboot.
    let action = raw.post_update_action
    if (action === 'none') action = 'nothing'
    else if (action === 'shutdown') action = 'reboot'
    const allowed = action === 'reboot' || action === 'restart-service' || action === 'nothing'
    const coerced = coerceProductionCycleVariant(raw.production_cycle_variant)
    return {
      serial_number: raw.serial_number != null ? String(raw.serial_number) : null,
      quickpass: Boolean(raw.quickpass ?? d.quickpass),
      post_update_action: allowed ? action : d.post_update_action,
      production_cycle_variant: coerced ?? d.production_cycle_variant,
    }
  },
  mergePatch(current, patch) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'post_update_action')) {
      let action = patch.post_update_action
      if (action === 'none') action = 'nothing'
      else if (action === 'shutdown') action = 'reboot'
      const ok =
        action === 'reboot' || action === 'restart-service' || action === 'nothing'
      if (!ok) {
        throw new SettingsError('VALIDATION', 'Invalid post_update_action', {
          status: 422,
          details: [
            {
              path: 'post_update_action',
              message: 'Must be reboot|restart-service|nothing',
            },
          ],
        })
      }
      patch = { ...patch, post_update_action: action }
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'production_cycle_variant')) {
      const v = coerceProductionCycleVariant(patch.production_cycle_variant)
      if (v == null) {
        throw new SettingsError('VALIDATION', 'Invalid production_cycle_variant', {
          status: 422,
          details: [
            {
              path: 'production_cycle_variant',
              message: 'Must be advanced (sole production mode)',
            },
          ],
        })
      }
      patch = { ...patch, production_cycle_variant: v }
    }
    return this.normalize(shallowMerge(current, patch))
  },
  publicProjection() {
    return {}
  },
})

// Ensure validate helpers are tree-shaken-safe references for tests
void validatePickPlaceConfig
void validateProductionSequenceConfig

export function ensureDomainsRegistered() {
  // Side-effect import registers all domains above.
  return true
}
