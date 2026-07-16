/**
 * Production centring context — shrink tube + system settings for the loaded reference.
 */
import { normalizeCentringFrameConfig, normalizeCentringMechanism } from './centring_frame_model.js'
import {
  hasCompleteDerivedGeometry,
  requirePersistedCentringRecipe,
} from './centringDerivedRecipe.mjs'

let _db = null
let _readSystemSettings = null

function mapDerivedNumber(row, key) {
  const n = Number(row[key])
  return Number.isFinite(n) ? n : null
}

function mapShrinkTubeRow(row) {
  return {
    ...row,
    diameter_mm: Number(row.diameter_mm),
    length_mm: Number(row.length_mm),
    diameter_closing_gap_mm: Number(row.diameter_closing_gap_mm ?? 0),
    diameter_opening_gap_mm: Number(row.diameter_opening_gap_mm ?? 0),
    centring_length_tolerance_mm: Number(row.centring_length_tolerance_mm ?? 0),
    centring_mechanism: normalizeCentringMechanism(row.centring_mechanism),
    is_active: !!row.is_active,
    h_pre_mm: mapDerivedNumber(row, 'h_pre_mm'),
    h_post_mm: mapDerivedNumber(row, 'h_post_mm'),
    l_eff_mm: mapDerivedNumber(row, 'l_eff_mm'),
    centering_travel_mm: mapDerivedNumber(row, 'centering_travel_mm'),
    centering_input_mm: mapDerivedNumber(row, 'centering_input_mm'),
    centering_output_mm: mapDerivedNumber(row, 'centering_output_mm'),
    centering_move_travel_mm: mapDerivedNumber(row, 'centering_move_travel_mm'),
    centring_axis: row.centring_axis != null ? String(row.centring_axis) : null,
    centring_derived_updated_at: row.centring_derived_updated_at ?? null,
    has_derived_geometry: hasCompleteDerivedGeometry(row),
  }
}

/** @param {import('better-sqlite3').Database} db */
export function initProductionContext(db, readSystemSettingsFn) {
  _db = db
  _readSystemSettings = readSystemSettingsFn
}

export function getShrinkTubeById(id) {
  if (!_db) throw new Error('production context not initialized')
  const row = _db.prepare('SELECT * FROM shrink_tubes WHERE id = ? AND is_active = 1').get(String(id))
  return row ? mapShrinkTubeRow(row) : null
}

export function getSystemSettingsForProduction() {
  if (!_readSystemSettings) throw new Error('production context not initialized')
  const settings = _readSystemSettings()
  return {
    ...settings,
    centring_frame_config: normalizeCentringFrameConfig(settings.centring_frame_config),
  }
}

/** Production centring is mandatory unless bench bypass env is set. */
export function isProductionShrinkTubeRequired() {
  return process.env.PRODUCTION_SKIP_CENTRING !== '1'
}

/**
 * Every production reference must have shrink_tube_id → active shrink_tubes row.
 * @returns {{ ok: true, centringContext: { shrinkTube: object, systemSettings: object } } | { ok: false, error: string }}
 */
export function validateReferenceShrinkTube(referenceId) {
  if (!_db) {
    return { ok: false, error: 'Production context not initialized' }
  }
  if (!referenceId) {
    return { ok: false, error: 'No reference loaded — scan a reference first' }
  }
  const ref = _db
    .prepare('SELECT shrink_tube_id FROM product_references WHERE id = ?')
    .get(String(referenceId))
  if (!ref) {
    return { ok: false, error: 'Loaded reference not found in database' }
  }
  const tubeId = ref.shrink_tube_id != null ? String(ref.shrink_tube_id).trim() : ''
  if (!tubeId) {
    return {
      ok: false,
      error: 'Reference must have a shrink tube profile — assign one in References before production',
    }
  }
  const shrinkTube = getShrinkTubeById(tubeId)
  if (!shrinkTube) {
    return {
      ok: false,
      error: 'Shrink tube profile on this reference is missing or inactive — choose an active profile',
    }
  }
  if (!shrinkTube.has_derived_geometry) {
    return {
      ok: false,
      error:
        'Shrink tube has no persisted centring geometry — re-save the tube or centring settings '
        + '(centering_output_mm / h_pre / travel must be stored in the database)',
    }
  }
  const systemSettings = getSystemSettingsForProduction()
  let resolved
  try {
    resolved = requirePersistedCentringRecipe(shrinkTube, systemSettings)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
  return {
    ok: true,
    centringContext: {
      shrinkTube,
      systemSettings,
      resolved,
    },
  }
}

/**
 * Build centring inputs for runCentringCycle from a loaded reference id.
 * @returns {{ shrinkTube: object, systemSettings: object } | null}
 */
export function getCentringContextForReference(referenceId) {
  const result = validateReferenceShrinkTube(referenceId)
  return result.ok ? result.centringContext : null
}
