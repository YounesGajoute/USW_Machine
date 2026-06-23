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
  runProductionVisionCheck,
  __setTestRunInspectionOnce,
  __clearTestRunInspectionOnce,
} from './productionVisionInspection.mjs'
import { initProductionContext } from './productionContext.mjs'
import {
  setLoadedReference,
  clearLoadedReference,
  __setMachineInitStateForTest,
} from './machineInit.mjs'
import { onEtherCATConnected, beginProductionJob, finishProductionJob } from './machineLifecycle.mjs'
import { executeProductionSequence, getProductionEnqueueBlockReason } from './productionSequence.mjs'

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
      diameter_check: true,
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
    welding_splice: { enabled: true, length_check: true, diameter_check: false, position_check: false },
    heat_shrink_tube: { enabled: true, length_check: false, diameter_check: false, position_check: true },
  }),
  bothFull: normalizeVisionChecksConfig({
    welding_splice: {
      enabled: true,
      length_check: true,
      diameter_check: true,
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
    welding_splice: { enabled: true, length_check: false, diameter_check: false, position_check: false },
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
      rbk TEXT NOT NULL DEFAULT 'RBK1',
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
      rbk TEXT NOT NULL DEFAULT 'RBK1',
      centring_length_tolerance_mm REAL NOT NULL DEFAULT 0,
      centring_mechanism TEXT NOT NULL DEFAULT 'upper',
      diameter_closing_gap_mm REAL NOT NULL DEFAULT 0,
      diameter_opening_gap_mm REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE system_settings (id INTEGER PRIMARY KEY, json TEXT NOT NULL DEFAULT '{}');
    INSERT INTO system_settings (id, json) VALUES (1, '{}');
  `)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO shrink_tubes (id, name, diameter_mm, length_mm, is_active, created_at, updated_at)
     VALUES (?, 'Test tube', 5, 20, 1, ?, ?)`,
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
  return db
}

function readSystemSettings() {
  return {
    centring_frame_config: {
      sideA_guide_spacing_mm: 300,
      sideB_guide_spacing_mm: 55,
      module_length_mm: 200,
    },
    centering_input_start_mm: 0,
    centering_input_offset_mm: 0,
  }
}

function wireProductionTestEnv(db) {
  initProductionContext(db, readSystemSettings)
  initProductionVisionInspection(db, readSystemSettings)
  onEtherCATConnected()
  __setMachineInitStateForTest({ referenceId: REF_ID, initialized: true })
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

const fakeEcm = {
  isInitialized: true,
  async getInput() {
    return { status: 'ok', value: true }
  },
  async setOutput() {
    return { status: 'ok' }
  },
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

// ── Configuration matrix: tool name resolution ─────────────────────────────

test('CONFIGS matrix: welding tool names', () => {
  assert.deepEqual(getEnabledWeldingSpliceToolNames(CONFIGS.weldingLengthOnly), [
    'Welding Splice Length Check',
  ])
  assert.deepEqual(getEnabledWeldingSpliceToolNames(CONFIGS.weldingAll), [
    'Welding Splice Length Check',
    'Welding Splice Diameter Check',
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

test('start blocked when vision inspection disabled on reference', () => {
  const db = createTestDb(CONFIGS.weldingLengthOnly)
  db.prepare('UPDATE product_references SET vision_inspection_enabled = 0 WHERE id = ?').run(REF_ID)
  wireProductionTestEnv(db)
  const reason = getVisionChecksBlockReason(REF_ID, CONFIGS.weldingLengthOnly)
  assert.match(reason, /vision inspection is disabled/i)
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
          { name: 'Welding Splice Diameter Check', status: 'NG' },
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
        t.name === 'Welding Splice Diameter Check' ? { ...t, status: 'NG' } : t,
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

  try {
    beginTestProductionJob()
    await assert.rejects(
      () => executeProductionSequence(fakeEcm, { requireButton: false, source: 'hmi' }),
      /Vision welding_splice failed/,
    )
  } finally {
    finishProductionJob({ failed: true, error: 'Vision welding_splice failed' })
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
