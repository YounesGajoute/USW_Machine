/**
 * Persist / load derived centring geometry on shrink_tubes.
 *
 * Computed on tube or centring-settings change via resolveShrinkTubeCentring.
 * Production prepare/start loads these columns — does not recompute.
 *
 * estimatePickPlaceMoveMs is intentionally NOT persisted (runtime / live only).
 */
import { resolveShrinkTubeCentring } from './centring_frame_model.js'

export const DERIVED_GEOMETRY_COLUMNS = Object.freeze([
  'h_pre_mm',
  'h_post_mm',
  'l_eff_mm',
  'centering_travel_mm',
  'centering_input_mm',
  'centering_output_mm',
  'centering_move_travel_mm',
  'centring_axis',
  'centring_derived_updated_at',
])

/**
 * @param {object} resolved — output of resolveShrinkTubeCentring
 */
export function derivedColumnsFromResolved(resolved) {
  return {
    h_pre_mm: Number(resolved.h_pre_mm),
    h_post_mm: Number(resolved.h_post_mm),
    l_eff_mm: Number(resolved.L_eff_mm),
    centering_travel_mm: Number(resolved.centering_travel_mm),
    centering_input_mm: Number(resolved.centering_input_mm),
    centering_output_mm: Number(resolved.centering_output_mm),
    centering_move_travel_mm: Number(resolved.centering_move_travel_mm),
    centring_axis: String(resolved.centring_axis),
    centring_derived_updated_at: new Date().toISOString(),
  }
}

/**
 * Rebuild resolve-shaped recipe from persisted shrink_tubes columns.
 * Position/gap/axis come from DB; start/offset metadata come from current system settings.
 */
export function recipeFromPersistedTube(tubeRow, systemSettings = null) {
  if (!tubeRow || !hasCompleteDerivedGeometry(tubeRow)) return null
  const start = Number(systemSettings?.centering_input_start_mm)
  const offset = Number(systemSettings?.centering_input_offset_mm ?? 0)
  return {
    h_pre_mm: Number(tubeRow.h_pre_mm),
    h_post_mm: Number(tubeRow.h_post_mm),
    L_eff_mm: Number(tubeRow.l_eff_mm),
    centering_travel_mm: Number(tubeRow.centering_travel_mm),
    centering_input_start_mm: Number.isFinite(start) ? start : Number(tubeRow.centering_input_mm),
    centering_input_offset_mm: Number.isFinite(offset) ? offset : 0,
    centering_input_mm: Number(tubeRow.centering_input_mm),
    centering_output_mm: Number(tubeRow.centering_output_mm),
    centering_move_travel_mm: Number(tubeRow.centering_move_travel_mm),
    centring_mechanism: tubeRow.centring_mechanism,
    centring_axis: String(tubeRow.centring_axis),
    from_db: true,
  }
}

export function hasCompleteDerivedGeometry(tubeRow) {
  if (!tubeRow) return false
  const nums = [
    'h_pre_mm',
    'h_post_mm',
    'l_eff_mm',
    'centering_travel_mm',
    'centering_input_mm',
    'centering_output_mm',
    'centering_move_travel_mm',
  ]
  for (const k of nums) {
    const n = Number(tubeRow[k])
    if (!Number.isFinite(n)) return false
  }
  const axis = String(tubeRow.centring_axis || '').toLowerCase()
  return axis === 'upper' || axis === 'lower' || axis === 'both'
}

/**
 * @param {object} tubeRow — shrink_tubes inputs
 * @param {object} systemSettings — assembled settings (frame + start/offset)
 */
export function computeDerivedForTube(tubeRow, systemSettings) {
  const resolved = resolveShrinkTubeCentring(
    tubeRow,
    systemSettings,
    systemSettings?.centring_frame_config,
  )
  return { resolved, columns: derivedColumnsFromResolved(resolved) }
}

const UPDATE_SQL = `
  UPDATE shrink_tubes SET
    h_pre_mm = @h_pre_mm,
    h_post_mm = @h_post_mm,
    l_eff_mm = @l_eff_mm,
    centering_travel_mm = @centering_travel_mm,
    centering_input_mm = @centering_input_mm,
    centering_output_mm = @centering_output_mm,
    centering_move_travel_mm = @centering_move_travel_mm,
    centring_axis = @centring_axis,
    centring_derived_updated_at = @centring_derived_updated_at
  WHERE id = @id
`

/**
 * Persist derived columns for one tube. Caller supplies transaction if needed.
 * @param {import('better-sqlite3').Database} db
 */
export function persistDerivedForTubeId(db, tubeId, columns) {
  db.prepare(UPDATE_SQL).run({ ...columns, id: String(tubeId) })
}

/**
 * Recompute + persist one tube. Throws if geometry invalid (e.g. L_eff outside frame).
 * @param {import('better-sqlite3').Database} db
 */
export function refreshShrinkTubeDerived(db, tubeId, systemSettings) {
  const row = db.prepare('SELECT * FROM shrink_tubes WHERE id = ?').get(String(tubeId))
  if (!row) throw new Error(`Shrink tube not found: ${tubeId}`)
  const { resolved, columns } = computeDerivedForTube(row, systemSettings)
  persistDerivedForTubeId(db, tubeId, columns)
  return { tubeId: String(tubeId), resolved, columns }
}

/**
 * Recompute + persist all tubes. Throws on first invalid geometry.
 * @param {import('better-sqlite3').Database} db
 */
export function refreshAllShrinkTubeDerived(db, systemSettings) {
  const rows = db.prepare('SELECT * FROM shrink_tubes').all()
  const results = []
  for (const row of rows) {
    results.push(refreshShrinkTubeDerived(db, row.id, systemSettings))
  }
  return results
}

/**
 * Validate every tube resolves against prospective system settings (no write).
 * @param {import('better-sqlite3').Database} db
 */
export function assertAllShrinkTubesResolvable(db, systemSettings) {
  const rows = db.prepare('SELECT id, name, length_mm, centring_length_tolerance_mm, diameter_closing_gap_mm, diameter_opening_gap_mm, centring_mechanism FROM shrink_tubes').all()
  const errors = []
  for (const row of rows) {
    try {
      computeDerivedForTube(row, systemSettings)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${row.name || row.id}: ${msg}`)
    }
  }
  if (errors.length) {
    throw new Error(
      `Centring settings rejected — ${errors.length} shrink tube(s) cannot resolve: ${errors.join('; ')}`,
    )
  }
}

/**
 * Boot / migration best-effort backfill. Skips invalid tubes (leaves derived NULL).
 * @param {import('better-sqlite3').Database} db
 */
export function backfillShrinkTubeDerivedBestEffort(db, systemSettings) {
  const rows = db.prepare('SELECT * FROM shrink_tubes').all()
  let ok = 0
  let skipped = 0
  const failures = []
  for (const row of rows) {
    try {
      refreshShrinkTubeDerived(db, row.id, systemSettings)
      ok += 1
    } catch (err) {
      skipped += 1
      failures.push({
        id: row.id,
        name: row.name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { ok, skipped, failures }
}

/**
 * True when centring domain data change affects derived geometry.
 */
export function centringSettingsAffectDerived(before, after) {
  if (!after) return false
  if (!before) return true
  const frameA = JSON.stringify(before.centring_frame_config ?? null)
  const frameB = JSON.stringify(after.centring_frame_config ?? null)
  if (frameA !== frameB) return true
  if (Number(before.centering_input_start_mm) !== Number(after.centering_input_start_mm)) return true
  if (Number(before.centering_input_offset_mm ?? 0) !== Number(after.centering_input_offset_mm ?? 0)) {
    return true
  }
  return false
}

/**
 * Production helper: require persisted recipe (load-only).
 * @param {object} tubeRow
 * @param {object} [systemSettings]
 */
export function requirePersistedCentringRecipe(tubeRow, systemSettings = null) {
  const recipe = recipeFromPersistedTube(tubeRow, systemSettings)
  if (!recipe) {
    throw new Error(
      'Shrink tube has no persisted centring geometry (centering_output_mm / derived columns). '
      + 'Re-save the shrink tube or centring settings so derived values are calculated and stored.',
    )
  }
  return recipe
}
