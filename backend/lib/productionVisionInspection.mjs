/**
 * Inline vision inspection during Phase C production.
 */
import { resolveVisionConfig } from './visionConfig.mjs'
import { runInspectionOnceOnPi, normalizeInspectionRunData } from './visionProgramTools.mjs'
import {
  normalizeVisionChecksConfig,
  getEnabledWeldingSpliceToolNames,
  getEnabledHeatShrinkToolNames,
  isAnyVisionCheckEnabled,
  parseVisionChecksJson,
} from './visionChecksConfigStore.mjs'

let _db = null
let _readSystemSettings = null
/** @type {((programId: number, enabledToolNames: string[]) => Promise<{ ok: boolean, status: number, data: object }>)|null} */
let _testRunInspectionOnce = null

/** @internal Automated tests only */
export function __setTestRunInspectionOnce(fn) {
  _testRunInspectionOnce = fn
}

/** @internal Automated tests only */
export function __clearTestRunInspectionOnce() {
  _testRunInspectionOnce = null
}

/** @param {import('better-sqlite3').Database} db */
export function initProductionVisionInspection(db, readSystemSettingsFn) {
  _db = db
  _readSystemSettings = readSystemSettingsFn
}

/**
 * @param {string[]} enabledToolNames
 * @param {{ name?: string, status?: string }[] | undefined} toolResults
 */
export function evaluateVisionToolResults(enabledToolNames, toolResults) {
  const results = Array.isArray(toolResults) ? toolResults : []
  const byName = new Map(results.map(t => [String(t.name ?? ''), t]))
  const missing = []
  const failures = []

  for (const name of enabledToolNames) {
    const row = byName.get(name)
    if (!row) {
      missing.push(name)
      continue
    }
    if (row.status !== 'OK') {
      failures.push(`${name}: ${row.status ?? 'NG'}`)
    }
  }

  if (missing.length > 0) {
    return {
      pass: false,
      result: 'FAIL',
      reason: `Missing tool results: ${missing.join(', ')}`,
      missing,
      failures,
    }
  }
  if (failures.length > 0) {
    return {
      pass: false,
      result: 'FAIL',
      reason: `Failed checks: ${failures.join(', ')}`,
      missing,
      failures,
    }
  }
  return { pass: true, result: 'PASS', reason: null, missing, failures }
}

export function getVisionChecksConfigForReference(referenceId) {
  if (!_db) return normalizeVisionChecksConfig(null)
  if (!referenceId) return normalizeVisionChecksConfig(null)
  const row = _db
    .prepare('SELECT vision_checks_json FROM product_references WHERE id = ?')
    .get(String(referenceId))
  return parseVisionChecksJson(row?.vision_checks_json) ?? normalizeVisionChecksConfig(null)
}

function getReferenceVisionRow(referenceId) {
  if (!_db) throw new Error('Production vision inspection not initialized')
  if (!referenceId) return null
  return _db
    .prepare(
      `SELECT id, vision_program_id, vision_inspection_enabled
       FROM product_references WHERE id = ?`,
    )
    .get(String(referenceId))
}

/**
 * Block reason when vision checks are enabled but reference cannot run them.
 * @param {string|null|undefined} referenceId
 * @param {import('./visionChecksConfigStore.mjs').DEFAULT_VISION_CHECKS_CONFIG} visionChecksConfig
 */
export function getVisionChecksBlockReason(referenceId, visionChecksConfig) {
  if (process.env.PRODUCTION_SKIP_VISION === '1') return null
  if (!isAnyVisionCheckEnabled(visionChecksConfig)) return null
  if (!referenceId) {
    return 'Vision checks enabled — load a reference first'
  }
  const ref = getReferenceVisionRow(referenceId)
  if (!ref) {
    return 'Vision checks enabled — loaded reference not found'
  }
  if (ref.vision_inspection_enabled === 0) {
    return 'Vision checks enabled — vision inspection is disabled on this reference'
  }
  if (ref.vision_program_id == null) {
    return 'Vision checks enabled — assign a vision program to this reference'
  }
  return null
}

function resolveEnabledToolNames(checkpoint, visionChecksConfig) {
  if (checkpoint === 'welding_splice') {
    return getEnabledWeldingSpliceToolNames(visionChecksConfig)
  }
  if (checkpoint === 'heat_shrink_tube') {
    return getEnabledHeatShrinkToolNames(visionChecksConfig)
  }
  throw new Error(`Unknown vision checkpoint: ${checkpoint}`)
}

/**
 * @param {{ checkpoint: 'welding_splice' | 'heat_shrink_tube', referenceId: string, visionChecksConfig?: object }} opts
 */
export async function runProductionVisionCheck(opts) {
  const { checkpoint, referenceId } = opts
  const visionChecksConfig = normalizeVisionChecksConfig(opts.visionChecksConfig)
  const enabledToolNames = resolveEnabledToolNames(checkpoint, visionChecksConfig)

  if (enabledToolNames.length === 0) {
    return {
      skipped: true,
      checkpoint,
      reason: 'No child checks enabled',
    }
  }

  const blockReason = getVisionChecksBlockReason(referenceId, visionChecksConfig)
  if (blockReason) {
    throw new Error(blockReason)
  }

  const ref = getReferenceVisionRow(referenceId)
  const programId = ref.vision_program_id
  const cfg = resolveVisionConfig(null, _readSystemSettings)
  console.log(
    `[Production][Vision] ${checkpoint} — program ${programId}, tools: ${enabledToolNames.join(', ')}`,
  )

  const runOutcome = _testRunInspectionOnce
    ? await _testRunInspectionOnce(programId, enabledToolNames)
    : await runInspectionOnceOnPi(cfg.api, cfg.remoteHeaders, programId, {
        includeImage: false,
      })
  if (!runOutcome.ok) {
    const msg =
      runOutcome.data?.error ??
      runOutcome.data?.message ??
      `Vision inspection request failed (${runOutcome.status})`
    throw new Error(msg)
  }

  const normalized = normalizeInspectionRunData(runOutcome.data)
  const evaluation = evaluateVisionToolResults(enabledToolNames, normalized.toolResults)
  const summary = {
    checkpoint,
    programId,
    result: evaluation.result,
    enabledToolNames,
    toolResults: normalized.toolResults,
    processingTimeMs: normalized.processingTimeMs,
  }

  console.log(
    `[Production][Vision] ${checkpoint} — ${evaluation.result}${evaluation.reason ? `: ${evaluation.reason}` : ''}`,
  )

  if (!evaluation.pass) {
    throw new Error(`Vision ${checkpoint} failed — ${evaluation.reason}`)
  }

  return summary
}
