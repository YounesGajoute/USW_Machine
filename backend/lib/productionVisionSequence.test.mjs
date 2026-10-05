/**
 * Deep tests: production sequence × vision check configurations.
 * Uses in-memory SQLite + mocked motion/vision (no EtherCAT or Vision Pi).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  serializeVisionChecksConfig,
  normalizeVisionChecksConfig,
  withWeldingSpliceParentEnabled,
  withHeatShrinkTubeParentEnabled,
  getEnabledWeldingSpliceToolNames,
  getEnabledHeatShrinkToolNames,
  isAnyVisionCheckEnabled,
} from './visionChecksConfigStore.mjs'
import {
  initProductionVisionInspection,
  getVisionChecksConfigForReference,
  getVisionChecksBlockReason,
  isReferenceVisionActive,
  runProductionVisionCheck,
  getLastVisionCanvasMeta,
  __setTestRunInspectionOnce,
  __clearTestRunInspectionOnce,
  __setTestCaptureAndSave,
  __clearTestCaptureAndSave,
  __clearLastVisionCanvas,
} from './productionVisionInspection.mjs'
import {
  captureAndSaveOnPi,
  CAPTURE_AND_SAVE_FOLDERS,
  validateCaptureAndSaveFolder,
} from './visionProgramTools.mjs'
import { initProductionContext } from './productionContext.mjs'
import { refreshAllShrinkTubeDerived } from './centringDerivedRecipe.mjs'
import {
  setLoadedReference,
  clearLoadedReference,
  __setMachineInitStateForTest,
} from './machineInit.mjs'
import { onEtherCATConnected, beginProductionJob, finishProductionJob } from './machineLifecycle.mjs'
import {
  executeProductionSequence,
  getProductionEnqueueBlockReason,
  __setTestMoveAmmT2,
  __clearTestMoveAmmT2,
  __setTestReturnPickPlaceToHome,
  __clearTestReturnPickPlaceToHome,
  __setTestEnsurePickPlaceReady,
  __clearTestEnsurePickPlaceReady,
  __setTestEnsureCentringReady,
  __clearTestEnsureCentringReady,
} from './productionSequence.mjs'
import { __setProductionAbortTestHooks } from './productionAbort.mjs'
import { __setCachedCentringStatusForTest, __setPickPlaceHealthForTest } from './tcpSubsystemHealth.mjs'
import { DO } from './ethercat.mjs'

/** @typedef {import('./visionChecksConfigStore.mjs').DEFAULT_VISION_CHECKS_CONFIG} VisionCfg */

const REF_ID = 'REF-VTEST'
const TUBE_ID = 'TUBE-VTEST'
const PROGRAM_ID = 42

/** Representative vision check configurations */
const CONFIGS = {
  allOff: normalizeVisionChecksConfig(null),
  weldingLengthOnly: withWeldingSpliceParentEnabled(normalizeVisionChecksConfig(null), true),
  weldingAll: normalizeVisionChecksConfig({
    welding_splice: {
      enabled: true,
      length_check: true,
      width_check: true,
      position_check: true,
    },
  }),
  heatShrinkPositionOnly: withHeatShrinkTubeParentEnabled(normalizeVisionChecksConfig(null), true),
  heatShrinkLengthDiameter: normalizeVisionChecksConfig({
    heat_shrink_tube: {
      enabled: true,
      length_check: true,
      diameter_check: true,
      position_check: false,
    },
  }),
  bothDefaults: normalizeVisionChecksConfig({
    welding_splice: { enabled: true, length_check: true, width_check: false, position_check: false },
    heat_shrink_tube: { enabled: true, length_check: false, diameter_check: false, position_check: true },
  }),
  bothFull: normalizeVisionChecksConfig({
    welding_splice: {
      enabled: true,
      length_check: true,
      width_check: true,
      position_check: true,
    },
    heat_shrink_tube: {
      enabled: true,
      length_check: true,
      diameter_check: true,
      position_check: true,
    },
  }),
  weldingParentNoChildren: normalizeVisionChecksConfig({
    welding_splice: { enabled: true, length_check: false, width_check: false, position_check: false },
  }),
}

function createTestDb(visionChecksConfig) {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE product_references (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      vision_program_id INTEGER,
      vision_inspection_enabled INTEGER NOT NULL DEFAULT 1,
      send_barcode_weld_enabled INTEGER NOT NULL DEFAULT 1,
      send_barcode_shrink_enabled INTEGER NOT NULL DEFAULT 1,
      tool_config_mode TEXT NOT NULL DEFAULT 'general',
      specific_tool_template_id INTEGER,
      specific_tools_json TEXT NOT NULL DEFAULT '',
      shrink_tube_id TEXT,
      vision_checks_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE shrink_tubes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      diameter_mm REAL NOT NULL,
      length_mm REAL NOT NULL,
      centring_length_tolerance_mm REAL NOT NULL DEFAULT 0,
      centring_mechanism TEXT NOT NULL DEFAULT 'upper',
      diameter_closing_gap_mm REAL NOT NULL DEFAULT 0,
      diameter_opening_gap_mm REAL NOT NULL DEFAULT 0,
      h_pre_mm REAL,
      h_post_mm REAL,
      l_eff_mm REAL,
      centering_travel_mm REAL,
      centering_input_mm REAL,
      centering_output_mm REAL,
      centering_move_travel_mm REAL,
      centring_axis TEXT,
      centring_derived_updated_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE system_settings (id INTEGER PRIMARY KEY, json TEXT NOT NULL DEFAULT '{}');
    INSERT INTO system_settings (id, json) VALUES (1, '{}');
  `)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO shrink_tubes (id, name, diameter_mm, length_mm, diameter_closing_gap_mm, diameter_opening_gap_mm, is_active, created_at, updated_at)
     VALUES (?, 'Test tube', 5, 100, 4.5, 12, 1, ?, ?)`,
  ).run(TUBE_ID, now, now)
  db.prepare(
    `INSERT INTO product_references (
      id, name, description, is_active, vision_program_id, vision_inspection_enabled,
      shrink_tube_id, vision_checks_json, created_at, updated_at
    ) VALUES (?, 'VisionTestRef', '', 1, ?, 1, ?, ?, ?, ?)`,
  ).run(
    REF_ID,
    PROGRAM_ID,
    TUBE_ID,
    serializeVisionChecksConfig(visionChecksConfig),
    now,
    now,
  )
  refreshAllShrinkTubeDerived(db, {
    centring_frame_config: {
      sideA_guide_spacing_mm: 300,
      sideB_guide_spacing_mm: 55,
      module_length_mm: 200,
    },
    centering_input_start_mm: 120,
    centering_input_offset_mm: 0,
  })
  return db
}

let _testMachineModel = null
/** When true, production vision uses capture-and-save instead of run-once. */
let _visionProductionCaptureOnly = false

function readSystemSettings() {
  return {
    centring_frame_config: {
      sideA_guide_spacing_mm: 300,
      sideB_guide_spacing_mm: 55,
      module_length_mm: 200,
    },
    centering_input_start_mm: 0,
    centering_input_offset_mm: 0,
    machine_model: _testMachineModel,
    vision_production_capture_only: _visionProductionCaptureOnly,
  }
}

function wireProductionTestEnv(db) {
  initProductionContext(db, readSystemSettings)
  initProductionVisionInspection(db, readSystemSettings)
  onEtherCATConnected()
  __setMachineInitStateForTest({ referenceId: REF_ID, initialized: true })
  // Shrink-tube refs gate on centring posture via TCP health cache — seed closed idle
  // so unit tests do not depend on a live Nano (or default reachable=false).
  __setCachedCentringStatusForTest({
    u: 35,
    l: 35,
    cal: true,
    estop: false,
    fault: false,
    estop: false,
    busy: false,
    homing: false,
    asyncCmd: 0,
  })
  __setPickPlaceHealthForTest({ reachable: true })
}

function toolResultsOk(names) {
  return names.map(name => ({ name, status: 'OK', matching_rate: 95, threshold: 60, tool_type: 'outline' }))
}

function installVisionMock(handler) {
  __setTestRunInspectionOnce(async (programId, enabledToolNames) => {
    if (handler) return handler(programId, enabledToolNames)
    return {
      ok: true,
      status: 200,
      data: { status: 'OK', toolResults: toolResultsOk(enabledToolNames), programId },
    }
  })
}

function installCaptureMock(handler) {
  __setTestCaptureAndSave(async (opts) => {
    if (handler) return handler(opts)
    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        folder: opts.folder,
        path: `/tmp/Master_capture_option/${opts.folder}/cap.png`,
        filename: 'cap.png',
        width: 640,
        height: 480,
        format: 'png',
        image: 'AA==',
        timestamp: new Date().toISOString(),
      },
    }
  })
}

function clearVisionTestHooks() {
  __clearTestRunInspectionOnce()
  __clearTestCaptureAndSave()
  __clearLastVisionCanvas()
  _visionProductionCaptureOnly = false
}

const fakeEcm = {
  isInitialized: true,
  async getInput() {
    return { status: 'ok', value: true }
  },
  async setOutput() {
    return { status: 'ok' }
  },
}

function makeRecordingEcm() {
  const outputs = []
  return {
    isInitialized: true,
    async getInput() {
      return { status: 'ok', value: true }
    },
    async setOutput(pin, value) {
      outputs.push({ pin, value })
      return { status: 'ok' }
    },
    _outputs: outputs,
  }
}

function zeroProductionDelays() {
  process.env.PRODUCTION_DELAY_CLAMP_MS = '0'
  process.env.PRODUCTION_DELAY_LEVER_UP_MS = '0'
  process.env.PRODUCTION_DELAY_PP_CLAMP_CLOSE_MS = '0'
  process.env.PRODUCTION_DELAY_CLAMP_OPEN_MS = '0'
  process.env.PRODUCTION_DELAY_LEVER_DOWN_MS = '0'
  process.env.PRODUCTION_DELAY_PICK_CLAMP_OPEN_MS = '0'
}

function restoreEnvVar(name, prev) {
  if (prev === undefined) delete process.env[name]
  else process.env[name] = prev
}

function beginTestProductionJob() {
  beginProductionJob('test-job-vision', 'hmi')
}

function stubProductionAbort() {
  __setProductionAbortTestHooks({
    pneumaticsSafe: async () => {},
    pickPlaceStop: async () => {},
    centringStop: async () => {},
  })
}

function clearProductionAbortStub() {
  __setProductionAbortTestHooks(null)
}

// ── Configuration matrix: tool name resolution ─────────────────────────────

test('CONFIGS matrix: welding tool names', () => {
  assert.deepEqual(getEnabledWeldingSpliceToolNames(CONFIGS.weldingLengthOnly), [
    'Welding Splice Length Check',
  ])
  assert.deepEqual(getEnabledWeldingSpliceToolNames(CONFIGS.weldingAll), [
    'Welding Splice Length Check',
    'Welding Splice Width Check',
    'Welding Splice Position Check',
  ])
  assert.deepEqual(getEnabledWeldingSpliceToolNames(CONFIGS.allOff), [])
})

test('CONFIGS matrix: heat-shrink tool names', () => {
  assert.deepEqual(getEnabledHeatShrinkToolNames(CONFIGS.heatShrinkPositionOnly), [
    'Heat-Shrink Tube Position Check',
  ])
  assert.deepEqual(getEnabledHeatShrinkToolNames(CONFIGS.heatShrinkLengthDiameter), [
    'Heat-Shrink Tube Length Check',
    'Heat-Shrink Tube Diameter Check',
  ])
})

// ── DB load + start guards ─────────────────────────────────────────────────

test('getVisionChecksConfigForReference loads per-reference JSON', () => {
  const db = createTestDb(CONFIGS.bothFull)
  wireProductionTestEnv(db)
  const cfg = getVisionChecksConfigForReference(REF_ID)
  assert.equal(cfg.welding_splice.enabled, true)
  assert.equal(cfg.heat_shrink_tube.diameter_check, true)
  db.close()
})

test('start blocked when vision checks on but no program', () => {
  const db = createTestDb(CONFIGS.weldingLengthOnly)
  db.prepare('UPDATE product_references SET vision_program_id = NULL WHERE id = ?').run(REF_ID)
  wireProductionTestEnv(db)
  const reason = getVisionChecksBlockReason(REF_ID, CONFIGS.weldingLengthOnly)
  assert.match(reason, /vision program/i)
  db.close()
})

test('getVisionChecksBlockReason reports master off (maintenance / explicit check path)', () => {
  const db = createTestDb(CONFIGS.weldingLengthOnly)
  db.prepare('UPDATE product_references SET vision_inspection_enabled = 0 WHERE id = ?').run(REF_ID)
  wireProductionTestEnv(db)
  assert.equal(isReferenceVisionActive(REF_ID), false)
  const reason = getVisionChecksBlockReason(REF_ID, CONFIGS.weldingLengthOnly)
  assert.match(reason, /vision inspection is disabled/i)
  db.close()
})

test('enqueue allowed when vision_inspection_enabled=0 even if check parents still on', () => {
  const db = createTestDb(CONFIGS.weldingLengthOnly)
  db.prepare('UPDATE product_references SET vision_inspection_enabled = 0 WHERE id = ?').run(REF_ID)
  wireProductionTestEnv(db)
  assert.equal(isReferenceVisionActive(REF_ID), false)
  assert.equal(getProductionEnqueueBlockReason(), null)
  db.close()
})

test('getProductionEnqueueBlockReason null when all vision checks off', () => {
  const db = createTestDb(CONFIGS.allOff)
  wireProductionTestEnv(db)
  assert.equal(getProductionEnqueueBlockReason(), null)
  db.close()
})

test('getProductionEnqueueBlockReason requires program when welding enabled', () => {
  const db = createTestDb(CONFIGS.weldingLengthOnly)
  db.prepare('UPDATE product_references SET vision_program_id = NULL WHERE id = ?').run(REF_ID)
  wireProductionTestEnv(db)
  const reason = getProductionEnqueueBlockReason()
  assert.match(reason, /vision program/i)
  db.close()
})

// ── runProductionVisionCheck per checkpoint ────────────────────────────────

test('runProductionVisionCheck welding: evaluates only enabled tools', async () => {
  const db = createTestDb(CONFIGS.weldingLengthOnly)
  wireProductionTestEnv(db)
  installVisionMock((programId, names) => {
    assert.equal(programId, PROGRAM_ID)
    assert.deepEqual(names, ['Welding Splice Length Check'])
    return {
      ok: true,
      status: 200,
      data: {
        status: 'OK',
        toolResults: [
          { name: 'Welding Splice Length Check', status: 'OK' },
          { name: 'Welding Splice Width Check', status: 'NG' },
        ],
      },
    }
  })
  const result = await runProductionVisionCheck({
    checkpoint: 'welding_splice',
    referenceId: REF_ID,
    visionChecksConfig: CONFIGS.weldingLengthOnly,
  })
  assert.equal(result.result, 'PASS')
  __clearTestRunInspectionOnce()
  db.close()
})

test('runProductionVisionCheck welding: FAIL when enabled tool NG', async () => {
  const db = createTestDb(CONFIGS.weldingAll)
  wireProductionTestEnv(db)
  installVisionMock((_pid, names) => ({
    ok: true,
    status: 200,
    data: {
      status: 'NG',
      toolResults: toolResultsOk(names).map(t =>
        t.name === 'Welding Splice Width Check' ? { ...t, status: 'NG' } : t,
      ),
    },
  }))
  await assert.rejects(
    () =>
      runProductionVisionCheck({
        checkpoint: 'welding_splice',
        referenceId: REF_ID,
        visionChecksConfig: CONFIGS.weldingAll,
      }),
    /Vision welding_splice failed/,
  )
  __clearTestRunInspectionOnce()
  db.close()
})

test('runProductionVisionCheck heat-shrink: length + diameter only', async () => {
  const db = createTestDb(CONFIGS.heatShrinkLengthDiameter)
  wireProductionTestEnv(db)
  const seen = []
  installVisionMock((programId, names) => {
    seen.push(...names)
    return {
      ok: true,
      status: 200,
      data: { status: 'OK', toolResults: toolResultsOk(names), programId },
    }
  })
  const result = await runProductionVisionCheck({
    checkpoint: 'heat_shrink_tube',
    referenceId: REF_ID,
    visionChecksConfig: CONFIGS.heatShrinkLengthDiameter,
  })
  assert.equal(result.result, 'PASS')
  assert.deepEqual(seen, [
    'Heat-Shrink Tube Length Check',
    'Heat-Shrink Tube Diameter Check',
  ])
  __clearTestRunInspectionOnce()
  db.close()
})

test('runProductionVisionCheck skips when parent on but no children enabled', async () => {
  const db = createTestDb(CONFIGS.weldingParentNoChildren)
  wireProductionTestEnv(db)
  installVisionMock(() => {
    throw new Error('run-once should not be called')
  })
  const result = await runProductionVisionCheck({
    checkpoint: 'welding_splice',
    referenceId: REF_ID,
    visionChecksConfig: CONFIGS.weldingParentNoChildren,
  })
  assert.equal(result.skipped, true)
  __clearTestRunInspectionOnce()
  db.close()
})

// ── Capture-only mode (vision_production_capture_only) ──────────────────────

test('capture-only unset/false still uses run-once; FAIL still throws', async () => {
  const db = createTestDb(CONFIGS.weldingAll)
  _visionProductionCaptureOnly = false
  wireProductionTestEnv(db)
  let captureCalled = false
  installCaptureMock(() => {
    captureCalled = true
    throw new Error('capture should not run')
  })
  installVisionMock((_pid, names) => ({
    ok: true,
    status: 200,
    data: {
      status: 'NG',
      toolResults: toolResultsOk(names).map(t =>
        t.name === 'Welding Splice Width Check' ? { ...t, status: 'NG' } : t,
      ),
    },
  }))
  await assert.rejects(
    () =>
      runProductionVisionCheck({
        checkpoint: 'welding_splice',
        referenceId: REF_ID,
        visionChecksConfig: CONFIGS.weldingAll,
      }),
    /Vision welding_splice failed/,
  )
  assert.equal(captureCalled, false)
  clearVisionTestHooks()
  db.close()
})

test('capture-only true uses capture-and-save with correct folder; not run-once', async () => {
  const db = createTestDb(CONFIGS.weldingLengthOnly)
  _visionProductionCaptureOnly = true
  wireProductionTestEnv(db)
  let runOnceCalled = false
  installVisionMock(() => {
    runOnceCalled = true
    throw new Error('run-once should not be called')
  })
  const captureCalls = []
  installCaptureMock((opts) => {
    captureCalls.push(opts)
    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        folder: opts.folder,
        path: `/pi/Master_capture_option/${opts.folder}/x.png`,
        filename: 'x.png',
        width: 800,
        height: 600,
        format: 'png',
        image: 'AABB',
      },
    }
  })

  const weld = await runProductionVisionCheck({
    checkpoint: 'welding_splice',
    referenceId: REF_ID,
    visionChecksConfig: CONFIGS.weldingLengthOnly,
  })
  assert.equal(weld.result, 'CAPTURED')
  assert.equal(weld.captureOnly, true)
  assert.equal(weld.folder, 'vision_welding_splice')
  assert.equal(runOnceCalled, false)
  assert.equal(captureCalls[0].folder, 'vision_welding_splice')
  assert.equal(captureCalls[0].includeImage, true)
  assert.equal(String(captureCalls[0].referenceId), REF_ID)

  const heat = await runProductionVisionCheck({
    checkpoint: 'heat_shrink_tube',
    referenceId: REF_ID,
    visionChecksConfig: CONFIGS.heatShrinkPositionOnly,
  })
  assert.equal(heat.folder, 'vision_heat_shrink_tube')
  assert.equal(captureCalls[1].folder, 'vision_heat_shrink_tube')

  const meta = getLastVisionCanvasMeta()
  assert.ok(meta)
  assert.equal(meta.mode, 'capture')
  assert.equal(meta.folder, 'vision_heat_shrink_tube')
  assert.ok(meta.seq >= 1)

  clearVisionTestHooks()
  db.close()
})

test('capture-only true + camera unavailable skips (no cycle fault)', async () => {
  const db = createTestDb(CONFIGS.weldingLengthOnly)
  _visionProductionCaptureOnly = true
  wireProductionTestEnv(db)
  installCaptureMock(() => ({
    ok: false,
    status: 503,
    data: { ok: false, error: 'Camera unavailable', code: 'CAMERA_UNAVAILABLE' },
  }))
  const result = await runProductionVisionCheck({
    checkpoint: 'welding_splice',
    referenceId: REF_ID,
    visionChecksConfig: CONFIGS.weldingLengthOnly,
  })
  assert.equal(result.skipped, true)
  assert.match(result.reason ?? '', /Camera not connected/i)
  clearVisionTestHooks()
  db.close()
})

test('capture-only true + empty child tools still captures', async () => {
  const db = createTestDb(CONFIGS.weldingParentNoChildren)
  _visionProductionCaptureOnly = true
  wireProductionTestEnv(db)
  let captured = false
  installCaptureMock((opts) => {
    captured = true
    assert.equal(opts.folder, 'vision_welding_splice')
    return {
      ok: true,
      status: 200,
      data: { ok: true, folder: opts.folder, path: '/p/a.png', filename: 'a.png', format: 'png', image: 'QQ==' },
    }
  })
  installVisionMock(() => {
    throw new Error('run-once should not be called')
  })
  const result = await runProductionVisionCheck({
    checkpoint: 'welding_splice',
    referenceId: REF_ID,
    visionChecksConfig: CONFIGS.weldingParentNoChildren,
  })
  assert.equal(captured, true)
  assert.equal(result.skipped, undefined)
  assert.equal(result.result, 'CAPTURED')
  clearVisionTestHooks()
  db.close()
})

test('capture-only true + forceInspection still uses run-once (panel path)', async () => {
  const db = createTestDb(CONFIGS.weldingLengthOnly)
  _visionProductionCaptureOnly = true
  wireProductionTestEnv(db)
  let captureCalled = false
  installCaptureMock(() => {
    captureCalled = true
    throw new Error('capture should not run')
  })
  installVisionMock((programId, names) => ({
    ok: true,
    status: 200,
    data: { status: 'OK', toolResults: toolResultsOk(names), programId },
  }))
  const result = await runProductionVisionCheck({
    checkpoint: 'welding_splice',
    referenceId: REF_ID,
    visionChecksConfig: CONFIGS.weldingLengthOnly,
    forceInspection: true,
  })
  assert.equal(result.result, 'PASS')
  assert.equal(captureCalled, false)
  clearVisionTestHooks()
  db.close()
})

test('captureAndSaveOnPi rejects invalid folder before HTTP', async () => {
  const outcome = await captureAndSaveOnPi('http://127.0.0.1:9/api', {}, { folder: 'evil_folder' })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.status, 400)
  assert.match(outcome.data.error, /Invalid folder/)
  assert.equal(outcome.data.code, 'INVALID_FOLDER')
  assert.ok(CAPTURE_AND_SAVE_FOLDERS.includes('vision_welding_splice'))
  assert.ok(CAPTURE_AND_SAVE_FOLDERS.includes('vision_heat_shrink_tube'))
})

test('validateCaptureAndSaveFolder deep allowlist guards', () => {
  assert.equal(validateCaptureAndSaveFolder('vision_welding_splice').ok, true)
  assert.equal(validateCaptureAndSaveFolder('  vision_heat_shrink_tube  ').ok, true)
  assert.equal(validateCaptureAndSaveFolder('  vision_heat_shrink_tube  ').folder, 'vision_heat_shrink_tube')

  for (const bad of [null, undefined, '', '   ', '../evil', 'a/b', 'vision_welding_splice/../x', '.hidden', 'evil']) {
    const r = validateCaptureAndSaveFolder(bad)
    assert.equal(r.ok, false, `expected reject for ${JSON.stringify(bad)}`)
    assert.equal(r.status, 400)
    assert.equal(r.code, 'INVALID_FOLDER')
  }
})

// ── Full production sequence phase order (motion mocked via env) ─────────────

test('executeProductionSequence phase order: both vision checkpoints', async () => {
  const prev = {
    centring: process.env.PRODUCTION_SKIP_CENTRING,
    pick: process.env.PRODUCTION_SKIP_PICK_PLACE,
    vision: process.env.PRODUCTION_SKIP_VISION,
    button: process.env.ETHERCAT_SKIP_START_BUTTON,
  }
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  process.env.PRODUCTION_SKIP_PICK_PLACE = '1'
  process.env.PRODUCTION_SKIP_VISION = '0'
  process.env.ETHERCAT_SKIP_START_BUTTON = '1'
  zeroProductionDelays()

  const db = createTestDb(CONFIGS.bothDefaults)
  wireProductionTestEnv(db)

  const visionCalls = []
  installVisionMock((programId, names) => {
    visionCalls.push({ programId, names: [...names] })
    return {
      ok: true,
      status: 200,
      data: { status: 'OK', toolResults: toolResultsOk(names), programId },
    }
  })

  try {
    beginTestProductionJob()
    const result = await executeProductionSequence(fakeEcm, { requireButton: false, source: 'hmi' })
    const phaseKeys = result.phases.map(p => p.phase)

    assert.equal(phaseKeys[0], 'vision_welding_splice')
    assert.ok(phaseKeys.includes('pp_clamp_close'))
    const ppIdx = phaseKeys.indexOf('pp_clamp_close')
    const heatIdx = phaseKeys.indexOf('vision_heat_shrink_tube')
    assert.ok(heatIdx > ppIdx, 'heat-shrink vision must run after pp_clamp_close')
    assert.equal(result.ok, true)
    assert.ok(phaseKeys.includes('centring_skipped'))

    assert.equal(visionCalls.length, 2)
    assert.deepEqual(visionCalls[0].names, ['Welding Splice Length Check'])
    assert.deepEqual(visionCalls[1].names, ['Heat-Shrink Tube Position Check'])
  } finally {
    finishProductionJob({ failed: false })
    __clearTestRunInspectionOnce()
    if (prev.centring === undefined) delete process.env.PRODUCTION_SKIP_CENTRING
    else process.env.PRODUCTION_SKIP_CENTRING = prev.centring
    if (prev.pick === undefined) delete process.env.PRODUCTION_SKIP_PICK_PLACE
    else process.env.PRODUCTION_SKIP_PICK_PLACE = prev.pick
    if (prev.vision === undefined) delete process.env.PRODUCTION_SKIP_VISION
    else process.env.PRODUCTION_SKIP_VISION = prev.vision
    if (prev.button === undefined) delete process.env.ETHERCAT_SKIP_START_BUTTON
    else process.env.ETHERCAT_SKIP_START_BUTTON = prev.button
    clearLoadedReference()
    db.close()
  }
})

test('executeProductionSequence: no vision phases when all checks off', async () => {
  const prev = {
    centring: process.env.PRODUCTION_SKIP_CENTRING,
    pick: process.env.PRODUCTION_SKIP_PICK_PLACE,
    button: process.env.ETHERCAT_SKIP_START_BUTTON,
  }
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  process.env.PRODUCTION_SKIP_PICK_PLACE = '1'
  process.env.ETHERCAT_SKIP_START_BUTTON = '1'
  zeroProductionDelays()

  const db = createTestDb(CONFIGS.allOff)
  wireProductionTestEnv(db)
  installVisionMock(() => {
    throw new Error('vision should not run')
  })

  try {
    beginTestProductionJob()
    const result = await executeProductionSequence(fakeEcm, { requireButton: false, source: 'hmi' })
    const phaseKeys = result.phases.map(p => p.phase)
    assert.ok(!phaseKeys.includes('vision_welding_splice'))
    assert.ok(!phaseKeys.includes('vision_heat_shrink_tube'))
    assert.equal(result.ok, true)
  } finally {
    finishProductionJob({ failed: false })
    __clearTestRunInspectionOnce()
    if (prev.centring === undefined) delete process.env.PRODUCTION_SKIP_CENTRING
    else process.env.PRODUCTION_SKIP_CENTRING = prev.centring
    if (prev.pick === undefined) delete process.env.PRODUCTION_SKIP_PICK_PLACE
    else process.env.PRODUCTION_SKIP_PICK_PLACE = prev.pick
    if (prev.button === undefined) delete process.env.ETHERCAT_SKIP_START_BUTTON
    else process.env.ETHERCAT_SKIP_START_BUTTON = prev.button
    clearLoadedReference()
    db.close()
  }
})

test('executeProductionSequence: vision_inspection_enabled=0 skips inline vision even if check parents on', async () => {
  const prev = {
    centring: process.env.PRODUCTION_SKIP_CENTRING,
    pick: process.env.PRODUCTION_SKIP_PICK_PLACE,
    vision: process.env.PRODUCTION_SKIP_VISION,
    button: process.env.ETHERCAT_SKIP_START_BUTTON,
  }
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  process.env.PRODUCTION_SKIP_PICK_PLACE = '1'
  process.env.PRODUCTION_SKIP_VISION = '0'
  process.env.ETHERCAT_SKIP_START_BUTTON = '1'
  zeroProductionDelays()

  const db = createTestDb(CONFIGS.weldingLengthOnly)
  db.prepare('UPDATE product_references SET vision_inspection_enabled = 0 WHERE id = ?').run(REF_ID)
  wireProductionTestEnv(db)
  installVisionMock(() => {
    throw new Error('vision should not run when master flag is off')
  })

  try {
    assert.equal(isReferenceVisionActive(REF_ID), false)
    assert.equal(getProductionEnqueueBlockReason(), null)
    beginTestProductionJob()
    const result = await executeProductionSequence(fakeEcm, { requireButton: false, source: 'hmi' })
    const phaseKeys = result.phases.map(p => p.phase)
    assert.ok(!phaseKeys.includes('vision_welding_splice'))
    assert.ok(!phaseKeys.includes('vision_heat_shrink_tube'))
    assert.equal(result.ok, true)
    assert.equal(result.cycleResult, 'PASS')
  } finally {
    finishProductionJob({ failed: false })
    __clearTestRunInspectionOnce()
    if (prev.centring === undefined) delete process.env.PRODUCTION_SKIP_CENTRING
    else process.env.PRODUCTION_SKIP_CENTRING = prev.centring
    if (prev.pick === undefined) delete process.env.PRODUCTION_SKIP_PICK_PLACE
    else process.env.PRODUCTION_SKIP_PICK_PLACE = prev.pick
    if (prev.vision === undefined) delete process.env.PRODUCTION_SKIP_VISION
    else process.env.PRODUCTION_SKIP_VISION = prev.vision
    if (prev.button === undefined) delete process.env.ETHERCAT_SKIP_START_BUTTON
    else process.env.ETHERCAT_SKIP_START_BUTTON = prev.button
    clearLoadedReference()
    db.close()
  }
})

test('executeProductionSequence: vision FAIL aborts before centring', async () => {
  const prev = {
    centring: process.env.PRODUCTION_SKIP_CENTRING,
    pick: process.env.PRODUCTION_SKIP_PICK_PLACE,
    vision: process.env.PRODUCTION_SKIP_VISION,
    button: process.env.ETHERCAT_SKIP_START_BUTTON,
  }
  process.env.PRODUCTION_SKIP_CENTRING = '0'
  process.env.PRODUCTION_SKIP_PICK_PLACE = '1'
  process.env.PRODUCTION_SKIP_VISION = '0'
  process.env.ETHERCAT_SKIP_START_BUTTON = '1'
  zeroProductionDelays()
  __setTestEnsureCentringReady(async () => ({
    status: { u: 35, l: 35, h: 1.2, cal: true, estop: false },
    atClosedIdle: true,
  }))

  const db = createTestDb(CONFIGS.weldingLengthOnly)
  wireProductionTestEnv(db)
  installVisionMock(() => ({
    ok: true,
    status: 200,
    data: {
      status: 'NG',
      toolResults: [{ name: 'Welding Splice Length Check', status: 'NG' }],
    },
  }))
  stubProductionAbort()

  try {
    beginTestProductionJob()
    await assert.rejects(
      () => executeProductionSequence(fakeEcm, { requireButton: false, source: 'hmi' }),
      /Vision welding_splice failed/,
    )
  } finally {
    finishProductionJob({ failed: true, error: 'Vision welding_splice failed' })
    __clearTestRunInspectionOnce()
    __clearTestEnsureCentringReady()
    clearProductionAbortStub()
    if (prev.centring === undefined) delete process.env.PRODUCTION_SKIP_CENTRING
    else process.env.PRODUCTION_SKIP_CENTRING = prev.centring
    if (prev.pick === undefined) delete process.env.PRODUCTION_SKIP_PICK_PLACE
    else process.env.PRODUCTION_SKIP_PICK_PLACE = prev.pick
    if (prev.vision === undefined) delete process.env.PRODUCTION_SKIP_VISION
    else process.env.PRODUCTION_SKIP_VISION = prev.vision
    if (prev.button === undefined) delete process.env.ETHERCAT_SKIP_START_BUTTON
    else process.env.ETHERCAT_SKIP_START_BUTTON = prev.button
    clearLoadedReference()
    db.close()
  }
})

test('PRODUCTION_SKIP_VISION=1 bypasses inline checks', async () => {
  const prev = {
    centring: process.env.PRODUCTION_SKIP_CENTRING,
    pick: process.env.PRODUCTION_SKIP_PICK_PLACE,
    vision: process.env.PRODUCTION_SKIP_VISION,
    button: process.env.ETHERCAT_SKIP_START_BUTTON,
  }
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  process.env.PRODUCTION_SKIP_PICK_PLACE = '1'
  process.env.PRODUCTION_SKIP_VISION = '1'
  process.env.ETHERCAT_SKIP_START_BUTTON = '1'
  zeroProductionDelays()

  const db = createTestDb(CONFIGS.bothFull)
  wireProductionTestEnv(db)
  installVisionMock(() => {
    throw new Error('vision should not run when PRODUCTION_SKIP_VISION=1')
  })

  try {
    beginTestProductionJob()
    const result = await executeProductionSequence(fakeEcm, { requireButton: false, source: 'hmi' })
    const phaseKeys = result.phases.map(p => p.phase)
    assert.ok(!phaseKeys.includes('vision_welding_splice'))
  } finally {
    finishProductionJob({ failed: false })
    __clearTestRunInspectionOnce()
    if (prev.centring === undefined) delete process.env.PRODUCTION_SKIP_CENTRING
    else process.env.PRODUCTION_SKIP_CENTRING = prev.centring
    if (prev.pick === undefined) delete process.env.PRODUCTION_SKIP_PICK_PLACE
    else process.env.PRODUCTION_SKIP_PICK_PLACE = prev.pick
    if (prev.vision === undefined) delete process.env.PRODUCTION_SKIP_VISION
    else process.env.PRODUCTION_SKIP_VISION = prev.vision
    if (prev.button === undefined) delete process.env.ETHERCAT_SKIP_START_BUTTON
    else process.env.ETHERCAT_SKIP_START_BUTTON = prev.button
    clearLoadedReference()
    db.close()
  }
})

test('documented edge: parent enabled without children still blocks start', () => {
  assert.equal(isAnyVisionCheckEnabled(CONFIGS.weldingParentNoChildren), true)
  assert.deepEqual(getEnabledWeldingSpliceToolNames(CONFIGS.weldingParentNoChildren), [])
})

// ── STCS-evo500 ARM step × per-model pick position (motion mocked via seam) ──

function saveArmSequenceEnv() {
  return {
    centring: process.env.PRODUCTION_SKIP_CENTRING,
    pick: process.env.PRODUCTION_SKIP_PICK_PLACE,
    vision: process.env.PRODUCTION_SKIP_VISION,
    button: process.env.ETHERCAT_SKIP_START_BUTTON,
    posCs19: process.env.PRODUCTION_MOVE_POSITION_MM,
    posEvo: process.env.PRODUCTION_MOVE_POSITION_EVO_MM,
    armBefore: process.env.PRODUCTION_ARM_DELAY_BEFORE_MS,
    armPulse: process.env.PRODUCTION_ARM_PULSE_MS,
    armAfter: process.env.PRODUCTION_ARM_DELAY_AFTER_MS,
  }
}

function applyArmSequenceEnv() {
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  process.env.PRODUCTION_SKIP_PICK_PLACE = '0'
  process.env.PRODUCTION_SKIP_VISION = '1'
  process.env.ETHERCAT_SKIP_START_BUTTON = '1'
  process.env.PRODUCTION_MOVE_POSITION_MM = '100'
  process.env.PRODUCTION_MOVE_POSITION_EVO_MM = '200'
  process.env.PRODUCTION_ARM_DELAY_BEFORE_MS = '0'
  process.env.PRODUCTION_ARM_PULSE_MS = '0'
  process.env.PRODUCTION_ARM_DELAY_AFTER_MS = '0'
  zeroProductionDelays()
  __setTestEnsurePickPlaceReady(async () => ({
    status: { positionA: 0.6, homedA: true, homedB: true },
    returnPositionMm: 0.6,
  }))
  __setTestReturnPickPlaceToHome(async () => ({
    command: 'MOVEAMMT2 0.5 80',
    positionA: 0.6,
  }))
}

function restoreArmSequenceEnv(prev) {
  restoreEnvVar('PRODUCTION_SKIP_CENTRING', prev.centring)
  restoreEnvVar('PRODUCTION_SKIP_PICK_PLACE', prev.pick)
  restoreEnvVar('PRODUCTION_SKIP_VISION', prev.vision)
  restoreEnvVar('ETHERCAT_SKIP_START_BUTTON', prev.button)
  restoreEnvVar('PRODUCTION_MOVE_POSITION_MM', prev.posCs19)
  restoreEnvVar('PRODUCTION_MOVE_POSITION_EVO_MM', prev.posEvo)
  restoreEnvVar('PRODUCTION_ARM_DELAY_BEFORE_MS', prev.armBefore)
  restoreEnvVar('PRODUCTION_ARM_PULSE_MS', prev.armPulse)
  restoreEnvVar('PRODUCTION_ARM_DELAY_AFTER_MS', prev.armAfter)
  __clearTestEnsurePickPlaceReady()
  __clearTestReturnPickPlaceToHome()
}

test('executeProductionSequence: STCS-evo500 fires ARM (DO15) pulse with evo pick position', async () => {
  const prev = saveArmSequenceEnv()
  applyArmSequenceEnv()
  _testMachineModel = 'STCS-evo500'

  const db = createTestDb(CONFIGS.allOff)
  wireProductionTestEnv(db)

  const ecm = makeRecordingEcm()
  const movePositions = []
  let homeReturnCalls = 0
  __setTestMoveAmmT2((pos) => {
    movePositions.push(pos)
    return { command: 'MOVEAMMT2', positionA: pos }
  })
  __setTestReturnPickPlaceToHome(async () => {
    homeReturnCalls += 1
    return { command: 'MOVEAMMT2 0.5 80', positionA: 0.6 }
  })

  try {
    beginTestProductionJob()
    const result = await executeProductionSequence(ecm, { requireButton: false, source: 'hmi' })
    const phases = result.phases
    const phaseKeys = phases.map(p => p.phase)

    const moveToPickIdx = phaseKeys.indexOf('move_to_pick')
    const armOnIdx = phases.findIndex(p => p.phase === 'arm_evo500' && p.outputs?.armEvo500 === true)
    const armOffIdx = phases.findIndex(p => p.phase === 'arm_evo500' && p.outputs?.armEvo500 === false)
    const pickClampIdx = phaseKeys.indexOf('pick_clamp_open')

    assert.ok(moveToPickIdx >= 0, 'move_to_pick must run')
    assert.ok(armOnIdx > moveToPickIdx, 'ARM on must follow move_to_pick')
    assert.ok(armOffIdx > armOnIdx, 'ARM off must follow ARM on')
    assert.ok(pickClampIdx > armOffIdx, 'pick_clamp_open must follow ARM off')

    const arm = ecm._outputs.filter(o => o.pin === DO.ARM_EVO500)
    assert.deepEqual(arm, [{ pin: DO.ARM_EVO500, value: 1 }, { pin: DO.ARM_EVO500, value: 0 }])

    assert.equal(movePositions.length, 1, 'only move_to_pick uses injected MOVEAMMT2 hook')
    assert.equal(movePositions[0], 200, 'evo500 must use movePositionEvoMm')
    assert.equal(homeReturnCalls, 1, 'return_to_backoff must MOVEAMMT2 to backoff')
    assert.equal(result.ok, true)
  } finally {
    __clearTestMoveAmmT2()
    __clearTestReturnPickPlaceToHome()
    _testMachineModel = null
    finishProductionJob({ failed: false })
    restoreArmSequenceEnv(prev)
    clearLoadedReference()
    db.close()
  }
})

test('executeProductionSequence: STCS-CS19 skips ARM (DO15) and uses CS19 pick position', async () => {
  const prev = saveArmSequenceEnv()
  applyArmSequenceEnv()
  _testMachineModel = 'STCS-CS19'

  const db = createTestDb(CONFIGS.allOff)
  wireProductionTestEnv(db)

  const ecm = makeRecordingEcm()
  const movePositions = []
  let homeReturnCalls = 0
  __setTestMoveAmmT2((pos) => {
    movePositions.push(pos)
    return { command: 'MOVEAMMT2', positionA: pos }
  })
  __setTestReturnPickPlaceToHome(async () => {
    homeReturnCalls += 1
    return { command: 'MOVEAMMT2 0.5 80', positionA: 0.6 }
  })

  try {
    beginTestProductionJob()
    const result = await executeProductionSequence(ecm, { requireButton: false, source: 'hmi' })
    const phases = result.phases
    const phaseKeys = phases.map(p => p.phase)

    const moveToPickIdx = phaseKeys.indexOf('move_to_pick')
    const armOnIdx = phases.findIndex(p => p.phase === 'arm_evo500' && p.outputs?.armEvo500 === true)
    const pickClampIdx = phaseKeys.indexOf('pick_clamp_open')

    assert.ok(moveToPickIdx >= 0, 'move_to_pick must run')
    assert.equal(armOnIdx, -1, 'CS19 must not pulse ARM/DO15')
    assert.ok(pickClampIdx > moveToPickIdx, 'pick_clamp_open must follow move_to_pick')

    const arm = ecm._outputs.filter(o => o.pin === DO.ARM_EVO500)
    assert.deepEqual(arm, [], 'CS19 must never drive ARM_EVO500')

    assert.equal(movePositions.length, 1, 'only move_to_pick uses injected MOVEAMMT2 hook')
    assert.equal(movePositions[0], 100, 'CS19 must use movePositionMm')
    assert.equal(homeReturnCalls, 1, 'return_to_backoff must MOVEAMMT2 to backoff')
    assert.equal(result.ok, true)
  } finally {
    __clearTestMoveAmmT2()
    __clearTestReturnPickPlaceToHome()
    _testMachineModel = null
    finishProductionJob({ failed: false })
    restoreArmSequenceEnv(prev)
    clearLoadedReference()
    db.close()
  }
})
