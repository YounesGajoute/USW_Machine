/**
 * Inline vision inspection during Phase C production.
 */
import { resolveVisionConfig } from './visionConfig.mjs'
import {
  captureAndSaveOnPi,
  runInspectionOnceOnPi,
  normalizeInspectionRunData,
} from './visionProgramTools.mjs'
import {
  normalizeVisionChecksConfig,
  getEnabledWeldingSpliceToolNames,
  getEnabledHeatShrinkToolNames,
  isAnyVisionCheckEnabled,
  parseVisionChecksJson,
} from './visionChecksConfigStore.mjs'
import {
  isVisionCameraUnavailableHttp,
  isVisionCameraUnavailableMessage,
} from './visionCameraAvailability.mjs'

let _db = null
let _readSystemSettings = null
/** @type {((programId: number, enabledToolNames: string[]) => Promise<{ ok: boolean, status: number, data: object }>)|null} */
let _testRunInspectionOnce = null
/** @type {((opts: object) => Promise<{ ok: boolean, status: number, data: object }>)|null} */
let _testCaptureAndSave = null

/**
 * In-memory last production canvas frame (capture-only).
 * Metadata is published on init-status; image is fetched one-shot by seq.
 * @type {{
 *   seq: number,
 *   mode: 'capture',
 *   folder: string,
 *   checkpoint: string,
 *   format: string,
 *   capturedAt: string,
 *   image_b64: string|null,
 *   path?: string,
 *   filename?: string,
 * } | null}
 */
let _lastVisionCanvas = null
let _lastVisionCanvasSeq = 0

/** @internal Automated tests only */
export function __setTestRunInspectionOnce(fn) {
  _testRunInspectionOnce = fn
}

/** @internal Automated tests only */
export function __clearTestRunInspectionOnce() {
  _testRunInspectionOnce = null
}

/** @internal Automated tests only */
export function __setTestCaptureAndSave(fn) {
  _testCaptureAndSave = fn
}

/** @internal Automated tests only */
export function __clearTestCaptureAndSave() {
  _testCaptureAndSave = null
}

/** @internal Automated tests only */
export function __clearLastVisionCanvas() {
  _lastVisionCanvas = null
  _lastVisionCanvasSeq = 0
}

/**
 * Metadata for HMI poll (no base64 — keep init-status light).
 * @returns {{ seq: number, mode: 'capture', folder?: string, checkpoint?: string, format?: string, capturedAt?: string } | null}
 */
export function getLastVisionCanvasMeta() {
  if (!_lastVisionCanvas) return null
  return {
    seq: _lastVisionCanvas.seq,
    mode: _lastVisionCanvas.mode,
    folder: _lastVisionCanvas.folder,
    checkpoint: _lastVisionCanvas.checkpoint,
    format: _lastVisionCanvas.format,
    capturedAt: _lastVisionCanvas.capturedAt,
  }
}

/**
 * One-shot image payload for GET /api/vision/last-production-capture.
 * Empty / seq-mismatch is a soft miss (null) — never a hard fault at the store layer.
 *
 * @param {number|null|undefined} seq If provided, must match current seq.
 * @returns {{
 *   seq: number,
 *   mode: string,
 *   folder?: string,
 *   checkpoint?: string,
 *   format?: string,
 *   capturedAt?: string,
 *   image_b64: string,
 * } | null}
 */
export function getLastVisionCanvasImage(seq) {
  if (!_lastVisionCanvas?.image_b64) return null
  if (seq != null && Number.isFinite(Number(seq)) && Number(seq) !== _lastVisionCanvas.seq) {
    return null
  }
  return {
    seq: _lastVisionCanvas.seq,
    mode: _lastVisionCanvas.mode,
    folder: _lastVisionCanvas.folder,
    checkpoint: _lastVisionCanvas.checkpoint,
    format: _lastVisionCanvas.format,
    capturedAt: _lastVisionCanvas.capturedAt,
    image_b64: _lastVisionCanvas.image_b64,
  }
}

/** Reverse map for proxy / diagnostics publishing. */
export function checkpointForCaptureFolder(folder) {
  if (folder === 'vision_welding_splice') return 'welding_splice'
  if (folder === 'vision_heat_shrink_tube') return 'heat_shrink_tube'
  return folder || 'capture'
}

/**
 * Publish canvas frame only when a displayable image is present.
 * Avoids advancing seq (and HMI fetch) for path-only / failed-image captures.
 * Used by production capture-only and the master capture-and-save proxy.
 *
 * @param {{
 *   folder: string,
 *   checkpoint?: string,
 *   format?: string,
 *   image_b64?: string|null,
 *   path?: string,
 *   filename?: string,
 * }} payload
 * @returns {boolean} true when canvas seq advanced
 */
export function publishLastVisionCanvas(payload) {
  const image_b64 = payload.image_b64 != null ? String(payload.image_b64) : ''
  if (!image_b64) {
    console.warn(
      `[Production][Vision] canvas not published — no image_b64 (folder=${payload.folder})`,
    )
    return false
  }
  _lastVisionCanvasSeq += 1
  const folder = payload.folder != null ? String(payload.folder) : ''
  _lastVisionCanvas = {
    seq: _lastVisionCanvasSeq,
    mode: 'capture',
    folder,
    checkpoint: payload.checkpoint || checkpointForCaptureFolder(folder),
    format: payload.format || 'png',
    capturedAt: new Date().toISOString(),
    image_b64,
    path: payload.path,
    filename: payload.filename,
  }
  return true
}

/** Checkpoint → Vision Pi capture folder (locked mapping). */
export function captureFolderForCheckpoint(checkpoint) {
  if (checkpoint === 'welding_splice') return 'vision_welding_splice'
  if (checkpoint === 'heat_shrink_tube') return 'vision_heat_shrink_tube'
  throw new Error(`Unknown vision checkpoint: ${checkpoint}`)
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
 * Master switch: reference wants inline / HMI vision.
 * False when PRODUCTION_SKIP_VISION=1, missing row, or vision_inspection_enabled=0.
 * Stale vision_checks_json parents must not override this for production gating.
 *
 * @param {string|null|undefined} referenceId
 */
export function isReferenceVisionActive(referenceId) {
  if (process.env.PRODUCTION_SKIP_VISION === '1') return false
  if (!referenceId) return false
  if (!_db) return false
  const ref = getReferenceVisionRow(referenceId)
  if (!ref) return false
  return ref.vision_inspection_enabled !== 0
}

/**
 * Block reason when vision checks are enabled but reference cannot run them.
 * Used when the caller already decided vision should run (master on + check parents).
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

/**
 * Block reason for capture-only mode (no programId / child-tool requirement).
 * @param {string|null|undefined} referenceId
 */
function getCaptureOnlyBlockReason(referenceId) {
  if (process.env.PRODUCTION_SKIP_VISION === '1') {
    return 'Vision capture skipped — PRODUCTION_SKIP_VISION=1'
  }
  if (!referenceId) {
    return 'Vision capture — load a reference first'
  }
  const ref = getReferenceVisionRow(referenceId)
  if (!ref) {
    return 'Vision capture — loaded reference not found'
  }
  if (ref.vision_inspection_enabled === 0) {
    return 'Vision capture — vision inspection is disabled on this reference'
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
 * Capture-only production path: save image on Vision Pi; advance on success; fault on failure.
 * @param {{ checkpoint: 'welding_splice' | 'heat_shrink_tube', referenceId: string }} opts
 */
async function runProductionVisionCaptureOnly(opts) {
  const { checkpoint, referenceId } = opts
  const blockReason = getCaptureOnlyBlockReason(referenceId)
  if (blockReason) {
    throw new Error(blockReason)
  }

  const folder = captureFolderForCheckpoint(checkpoint)
  const ref = getReferenceVisionRow(referenceId)
  const programId = ref?.vision_program_id ?? undefined
  const cfg = resolveVisionConfig(null, _readSystemSettings)

  console.log(
    `[Production][Vision] ${checkpoint} — capture-only folder=${folder}` +
      (programId != null ? ` program ${programId}` : '') +
      ` referenceId=${referenceId}`,
  )

  const captureOpts = {
    folder,
    programId,
    referenceId: String(referenceId),
    triggerType: 'remote',
    includeImage: true,
  }

  const outcome = _testCaptureAndSave
    ? await _testCaptureAndSave(captureOpts)
    : await captureAndSaveOnPi(cfg.api, cfg.remoteHeaders, captureOpts)

  if (!outcome.ok || outcome.data?.ok === false) {
    const msg =
      outcome.data?.error ??
      outcome.data?.detail ??
      outcome.data?.message ??
      `Vision capture request failed (${outcome.status})`
    if (isVisionCameraUnavailableHttp(outcome.status, outcome.data)) {
      console.warn(`[Production][Vision] ${checkpoint} — camera not connected, skipping capture`)
      return {
        skipped: true,
        checkpoint,
        reason: 'Camera not connected',
        captureOnly: true,
        folder,
        programId: programId ?? null,
        enabledToolNames: [],
        toolResults: [],
      }
    }
    throw new Error(msg)
  }

  const data = outcome.data ?? {}
  const image_b64 = data.image ?? data.image_b64 ?? null
  publishLastVisionCanvas({
    folder,
    checkpoint,
    format: data.format || 'png',
    image_b64,
    path: data.path,
    filename: data.filename,
  })

  console.log(
    `[Production][Vision] ${checkpoint} — CAPTURED folder=${folder}` +
      (data.path ? ` path=${data.path}` : '') +
      (data.filename ? ` filename=${data.filename}` : ''),
  )

  return {
    checkpoint,
    programId: programId ?? null,
    result: 'CAPTURED',
    captureOnly: true,
    folder,
    path: data.path,
    filename: data.filename,
    width: data.width,
    height: data.height,
    format: data.format || 'png',
    enabledToolNames: [],
    toolResults: [],
  }
}

/**
 * @param {{
 *   checkpoint: 'welding_splice' | 'heat_shrink_tube',
 *   referenceId: string,
 *   visionChecksConfig?: object,
 *   forceInspection?: boolean,
 * }} opts
 */
export async function runProductionVisionCheck(opts) {
  const { checkpoint, referenceId, forceInspection = false } = opts
  const visionChecksConfig = normalizeVisionChecksConfig(opts.visionChecksConfig)

  // Capture-only: successful save advances the step; capture failure faults the cycle.
  const captureOnly =
    !forceInspection &&
    _readSystemSettings?.()?.vision_production_capture_only === true

  if (captureOnly) {
    return runProductionVisionCaptureOnly({ checkpoint, referenceId })
  }

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
    if (isVisionCameraUnavailableHttp(runOutcome.status, runOutcome.data)) {
      console.warn(`[Production][Vision] ${checkpoint} — camera not connected, skipping inspection`)
      return {
        skipped: true,
        checkpoint,
        reason: 'Camera not connected',
        programId,
        enabledToolNames,
        toolResults: [],
      }
    }
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
    const failMsg = `Vision ${checkpoint} failed — ${evaluation.reason}`
    if (isVisionCameraUnavailableMessage(evaluation.reason)) {
      return {
        skipped: true,
        checkpoint,
        reason: 'Camera not connected',
        programId,
        enabledToolNames,
        toolResults: normalized.toolResults,
      }
    }
    throw new Error(failMsg)
  }

  return summary
}
