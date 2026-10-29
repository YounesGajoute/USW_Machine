import { normalizeVisionChecksConfig, parseVisionChecksJson, hasEnabledVisionInspectionChecks } from '../visionChecksConfigStore.mjs'
import { normalizeRecipe, recipeDigest, canonical, REFERENCE_NAME_MAX_LENGTH } from './protocol.mjs'

/** Installed at ordinary application startup, never by importing this module. */
export function createVisionSyncStore(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS vision_sync_reference_revisions (
        reference_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK(revision > 0)
      );
      CREATE TABLE IF NOT EXISTS vision_sync_devices (
        device_id TEXT PRIMARY KEY,
        ledger_id TEXT NOT NULL,
        discontinuity INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO vision_sync_reference_revisions SELECT id, 1 FROM product_references;
      CREATE TRIGGER IF NOT EXISTS vision_sync_reference_insert AFTER INSERT ON product_references BEGIN
        INSERT INTO vision_sync_reference_revisions VALUES (NEW.id, 1)
        ON CONFLICT(reference_id) DO UPDATE SET revision = revision + 1;
      END;
      CREATE TRIGGER IF NOT EXISTS vision_sync_reference_update AFTER UPDATE ON product_references
      WHEN OLD.vision_inspection_enabled IS NOT NEW.vision_inspection_enabled
        OR OLD.vision_checks_json IS NOT NEW.vision_checks_json
        OR OLD.realtime_v2_config_json IS NOT NEW.realtime_v2_config_json
        OR OLD.shrink_tube_id IS NOT NEW.shrink_tube_id
        OR OLD.is_active IS NOT NEW.is_active
      BEGIN
        UPDATE vision_sync_reference_revisions SET revision = revision + 1 WHERE reference_id = NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS vision_sync_reference_delete AFTER DELETE ON product_references BEGIN
        UPDATE vision_sync_reference_revisions SET revision = revision + 1 WHERE reference_id = OLD.id;
      END;
      CREATE TRIGGER IF NOT EXISTS vision_sync_tube_update AFTER UPDATE ON shrink_tubes
      WHEN OLD.length_mm IS NOT NEW.length_mm OR OLD.diameter_mm IS NOT NEW.diameter_mm BEGIN
        UPDATE vision_sync_reference_revisions SET revision = revision + 1
          WHERE reference_id IN (SELECT id FROM product_references WHERE shrink_tube_id = NEW.id);
      END;
      CREATE TRIGGER IF NOT EXISTS vision_sync_tube_delete AFTER DELETE ON shrink_tubes BEGIN
        UPDATE vision_sync_reference_revisions SET revision = revision + 1
          WHERE reference_id IN (SELECT id FROM product_references WHERE shrink_tube_id = OLD.id);
      END;
      CREATE TRIGGER IF NOT EXISTS vision_sync_tube_insert AFTER INSERT ON shrink_tubes BEGIN
        UPDATE vision_sync_reference_revisions SET revision = revision + 1
          WHERE reference_id IN (SELECT id FROM product_references WHERE shrink_tube_id = NEW.id);
      END;
    `)
  })()
  const read = db.prepare(`SELECT p.id, p.name, p.is_active, p.vision_inspection_enabled,
    p.vision_checks_json, p.shrink_tube_id, p.realtime_v2_config_json,
    s.length_mm, s.diameter_mm, CAST(v.revision AS TEXT) AS recipe_revision
    FROM product_references p
    LEFT JOIN shrink_tubes s ON s.id = p.shrink_tube_id
    LEFT JOIN vision_sync_reference_revisions v ON v.reference_id = p.id WHERE p.id = ?`)

  function desired(referenceId) {
    if (referenceId === null) return { referenceId: null, referenceName: null, recipeRevision: null,
      requiredByReference: false, desiredMode: 'disabled', recipe: null,
      recipeDigest: recipeDigest(false, null), issues: [] }
    const row = read.get(referenceId)
    const validName = typeof row?.name === 'string' && row.name.length <= REFERENCE_NAME_MAX_LENGTH
    const referenceName = validName ? row.name : null
    const hold = (issue, requiredByReference = null) => ({ referenceId, referenceName,
      recipeRevision: row?.recipe_revision ?? null, requiredByReference, desiredMode: 'hold',
      recipe: null, recipeDigest: null, issues: [issue] })
    if (!row) return hold('LOADED_REFERENCE_NOT_FOUND')
    if (!validName) return hold('INVALID_REFERENCE_NAME')
    if (!row.is_active) return hold('LOADED_REFERENCE_INACTIVE')
    const checks = parseVisionChecksJson(row.vision_checks_json)
    if (row.vision_inspection_enabled !== 0 && !checks) return hold('INVALID_REFERENCE_CHECKS')
    const required = row.vision_inspection_enabled !== 0
    // An inconsistent stored requirement is not authority to disable inspection.
    // Ordinary reference writes may explicitly clear the flag; do not infer it here.
    if (required && !hasEnabledVisionInspectionChecks(checks)) return hold('NO_ENABLED_VISION_CHECKS', true)
    if (!required) return { referenceId, referenceName: row.name, recipeRevision: row.recipe_revision,
      requiredByReference: false, desiredMode: 'disabled', recipe: null,
      recipeDigest: recipeDigest(false, null), issues: [] }
    let saved
    try { saved = JSON.parse(row.realtime_v2_config_json) } catch { return hold('RECIPE_NOT_SAVED', true) }
    // This is the existing saved-recipe dependency fingerprint, not a new source
    // of defaults. Changed tube/check dependencies require validated re-saving.
    const fingerprint = {
      vision_inspection_enabled: row.vision_inspection_enabled !== 0,
      checks: normalizeVisionChecksConfig(checks), shrink_tube_id: row.shrink_tube_id,
      length_mm: row.length_mm, diameter_mm: row.diameter_mm,
    }
    try {
      if (!saved?.config || canonical(JSON.parse(saved.reference_fingerprint)) !== canonical(fingerprint)) {
        return hold('RECIPE_REVALIDATION_REQUIRED', true)
      }
      const recipe = normalizeRecipe(checks, saved.config)
      return { referenceId, referenceName: row.name, recipeRevision: row.recipe_revision,
        requiredByReference: true, desiredMode: 'enabled', recipe,
        recipeDigest: recipeDigest(true, recipe), issues: [] }
    } catch { return hold('INVALID_RECIPE', true) }
  }
  return {
    readDesired: desired,
    // Persist only ledger identity/discontinuity, never an active reference or grant.
    observeLedger: db.transaction((deviceId, ledgerId, reportedDiscontinuity = false) => {
      const previous = db.prepare('SELECT * FROM vision_sync_devices WHERE device_id = ?').get(deviceId)
      const discontinuity = !!(reportedDiscontinuity || previous?.discontinuity || (previous && previous.ledger_id !== ledgerId))
      db.prepare(`INSERT INTO vision_sync_devices VALUES (?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET ledger_id = excluded.ledger_id, discontinuity = excluded.discontinuity`)
        .run(deviceId, ledgerId, discontinuity ? 1 : 0)
      return discontinuity
    }),
  }
}
