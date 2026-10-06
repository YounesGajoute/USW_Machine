/**
 * VERSION 1 HISTORY — advanced-mode production contract (no live EtherCAT / Nano).
 *
 * Production, setup and reference load call the Version 2 centring service
 * (centringV2Production.mjs). The tests below that drove those call sites with
 * the Version 1 contract (restore h_pre after the pick tail, short-L_eff hold,
 * advanced/classic step names) are skipped; the Version 2 contract is locked by
 * centringV2/productionWire.test.mjs and productionSequenceCentringV2.test.mjs.
 * Tests that call the Version 1 modules directly still run as history.
 *
 * Run:
 *   node --test lib/productionAdvancedMode.v1-history.e2e.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { initProductionContext } from './productionContext.mjs'
import {
  initProductionVisionInspection,
  __clearTestRunInspectionOnce,
} from './productionVisionInspection.mjs'
import {
  setLoadedReference,
  clearLoadedReference,
  __setMachineInitStateForTest,
  __setLoadTimeCentringInitForTest,
  applyReferenceHPreAfterLoad,
  getMachineInitStatus,
} from './machineInit.mjs'
import {
  onEtherCATConnected,
  beginProductionJob,
  finishProductionJob,
  forceState,
  LIFECYCLE_STATE,
} from './machineLifecycle.mjs'
import {
  executeProductionSequence,
  getProductionEnqueueBlockReason,
  getProductionSkipFlags,
  buildProductionSteps,
  prepareProductionRun,
  __setTestMoveAmmT2,
  __clearTestMoveAmmT2,
  __setTestReturnPickPlaceToHome,
  __clearTestReturnPickPlaceToHome,
  __setTestEnsurePickPlaceReady,
  __clearTestEnsurePickPlaceReady,
  __setTestEnsureCentringReady,
  __clearTestEnsureCentringReady,
  __setTestProductionCycleVariant,
  __clearTestProductionCycleVariant,
} from './productionSequence.mjs'
import {
  runCentringCycle,
  __setProductionCentringTestDeps,
  __clearProductionCentringTestDeps,
} from './productionCentringSequence.mjs'
import {
  applyHPreAfterCentringHoming,
  onReferenceLoadedAdvancedHPre,
  applyOrAssertReferenceHPre,
  getAdvancedHPreReady,
  clearAdvancedHPreReady,
  noteAdvancedHPreReady,
  isCentringAtGapMm,
  __setCentringAdvancedGapTestDeps,
  __clearCentringAdvancedGapTestDeps,
} from './centringAdvancedGap.mjs'
import { getCentringProductionBlockReason } from './centringIdle.mjs'
import {
  __setCachedCentringStatusForTest,
  __setPickPlaceHealthForTest,
} from './tcpSubsystemHealth.mjs'
import { __setProductionAbortTestHooks } from './productionAbort.mjs'
import { initSettingsService } from './settings/index.mjs'
import { openDatabase } from './db.mjs'
import { refreshAllShrinkTubeDerived } from './centringDerivedRecipe.mjs'
import { serializeVisionChecksConfig, normalizeVisionChecksConfig } from './visionChecksConfigStore.mjs'

const REF_A = 'REF-ADV-A'
const REF_B = 'REF-ADV-B'
const TUBE_A = 'TUBE-ADV-A'
const TUBE_B = 'TUBE-ADV-B'

const V1_WIRED = 'Version 1 production contract through a call site now wired to Version 2'

const H_PRE_A = 12
const H_POST_A = 25
const H_PRE_B = 18
const H_POST_B = 30

function createAdvancedDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE product_references (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      vision_program_id INTEGER,
      vision_inspection_enabled INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE settings_domain (
      domain TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      json TEXT NOT NULL,
      checksum TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );
    CREATE TABLE settings_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT,
      before_json TEXT,
      after_json TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );
  `)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO shrink_tubes (
      id, name, diameter_mm, length_mm, diameter_closing_gap_mm, diameter_opening_gap_mm,
      centring_mechanism, is_active, created_at, updated_at
    ) VALUES (?, 'Tube A', 5, 100, ?, ?, 'upper', 1, ?, ?)`,
  ).run(TUBE_A, H_PRE_A, H_POST_A, now, now)
  db.prepare(
    `INSERT INTO shrink_tubes (
      id, name, diameter_mm, length_mm, diameter_closing_gap_mm, diameter_opening_gap_mm,
      centring_mechanism, is_active, created_at, updated_at
    ) VALUES (?, 'Tube B', 6, 100, ?, ?, 'upper', 1, ?, ?)`,
  ).run(TUBE_B, H_PRE_B, H_POST_B, now, now)

  const visionOff = serializeVisionChecksConfig(normalizeVisionChecksConfig(null))
  for (const [id, name, tubeId] of [
    [REF_A, 'AdvRefA', TUBE_A],
    [REF_B, 'AdvRefB', TUBE_B],
  ]) {
    db.prepare(
      `INSERT INTO product_references (
        id, name, description, is_active, vision_program_id, vision_inspection_enabled,
        shrink_tube_id, vision_checks_json, created_at, updated_at
      ) VALUES (?, ?, '', 1, NULL, 0, ?, ?, ?, ?)`,
    ).run(id, name, tubeId, visionOff, now, now)
  }
  refreshAllShrinkTubeDerived(db, frameSettings())
  return db
}

function frameSettings() {
  return {
    production_cycle_variant: 'advanced',
    centering_input_start_mm: 50,
    centering_input_offset_mm: 2,
    centring_frame_config: {
      sideA_guide_spacing_mm: 300,
      sideB_guide_spacing_mm: 55,
      module_length_mm: 200,
    },
    machine_model: 'STCS-CS19',
  }
}

function wireEnv(db, settingsOverride = {}) {
  const settings = { ...frameSettings(), ...settingsOverride }
  initProductionContext(db, () => settings)
  initProductionVisionInspection(db, () => settings)
  onEtherCATConnected()
  __setMachineInitStateForTest({ referenceId: REF_A, initialized: true })
  setLoadedReference(REF_A)
  __setCachedCentringStatusForTest({
    u: 35,
    l: 35,
    h: 1.2,
    cal: true,
    estop: false,
    fault: false,
    busy: false,
    homing: false,
    asyncCmd: 0,
  })
  __setPickPlaceHealthForTest({ reachable: true })
  return settings
}

function zeroDelays() {
  process.env.PRODUCTION_DELAY_CLAMP_MS = '0'
  process.env.PRODUCTION_DELAY_LEVER_UP_MS = '0'
  process.env.PRODUCTION_DELAY_PP_CLAMP_CLOSE_MS = '0'
  process.env.PRODUCTION_DELAY_CLAMP_OPEN_MS = '0'
  process.env.PRODUCTION_DELAY_LEVER_DOWN_MS = '0'
  process.env.PRODUCTION_DELAY_PICK_CLAMP_OPEN_MS = '0'
  process.env.PRODUCTION_SKIP_VISION = '1'
  process.env.ETHERCAT_SKIP_START_BUTTON = '1'
  delete process.env.PRODUCTION_SKIP_CENTRING
  delete process.env.PRODUCTION_SKIP_PICK_PLACE
  delete process.env.PRODUCTION_SKIP_PICK_TAIL
  delete process.env.PRODUCTION_SKIP_CENTRING_PICK_PLACE
}

function restoreEnv(prev) {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

function envSnapshot() {
  return {
    PRODUCTION_DELAY_CLAMP_MS: process.env.PRODUCTION_DELAY_CLAMP_MS,
    PRODUCTION_DELAY_LEVER_UP_MS: process.env.PRODUCTION_DELAY_LEVER_UP_MS,
    PRODUCTION_DELAY_PP_CLAMP_CLOSE_MS: process.env.PRODUCTION_DELAY_PP_CLAMP_CLOSE_MS,
    PRODUCTION_DELAY_CLAMP_OPEN_MS: process.env.PRODUCTION_DELAY_CLAMP_OPEN_MS,
    PRODUCTION_DELAY_LEVER_DOWN_MS: process.env.PRODUCTION_DELAY_LEVER_DOWN_MS,
    PRODUCTION_DELAY_PICK_CLAMP_OPEN_MS: process.env.PRODUCTION_DELAY_PICK_CLAMP_OPEN_MS,
    PRODUCTION_SKIP_VISION: process.env.PRODUCTION_SKIP_VISION,
    PRODUCTION_SKIP_CENTRING: process.env.PRODUCTION_SKIP_CENTRING,
    PRODUCTION_SKIP_PICK_PLACE: process.env.PRODUCTION_SKIP_PICK_PLACE,
    PRODUCTION_SKIP_PICK_TAIL: process.env.PRODUCTION_SKIP_PICK_TAIL,
    PRODUCTION_SKIP_CENTRING_PICK_PLACE: process.env.PRODUCTION_SKIP_CENTRING_PICK_PLACE,
    ETHERCAT_SKIP_START_BUTTON: process.env.ETHERCAT_SKIP_START_BUTTON,
  }
}

function makeEcm() {
  return {
    isInitialized: true,
    async getInput() {
      return { status: 'ok', value: true }
    },
    async setOutput() {
      return { status: 'ok' }
    },
  }
}

function installHardwareMocks({ startAtHPre = false, hPreMm = H_PRE_A } = {}) {
  const gapCalls = []
  const ppMoves = []
  const restoreIdleCalls = []
  const restoreHPreCalls = []
  let centringH = startAtHPre ? hPreMm : 1.2

  __setLoadTimeCentringInitForTest(async (referenceId) => {
    const { resolveAdvancedGapRecipe } = await import('./centringAdvancedGap.mjs')
    const { shouldSkipCenteringTravel } = await import('./productionCentringSequence.mjs')
    const recipe = resolveAdvancedGapRecipe(referenceId)
    if (recipe && shouldSkipCenteringTravel(recipe.resolved.L_eff_mm)) {
      return {
        ok: true,
        skipped: false,
        didSeek: false,
        procedure: `SEEK_TRAVEL → HOME → MOVE h_pre — short L_eff=${recipe.resolved.L_eff_mm} mm`,
        status: { u: -80, l: 35, h: 1.2, cal: true, estop: false, busy: false },
      }
    }
    return {
      ok: true,
      skipped: false,
      didSeek: true,
      procedure: 'SEEK_TRAVEL → HOME → SEEK_TRAVEL',
      status: { u: 35, l: 35, h: 1.2, cal: true, estop: false, busy: false },
    }
  })

  __setProductionCentringTestDeps({
    connectWithRetry: async () => {},
    ensureCentringReadyForProduction: async (axis, opts) => ({
      status: {
        u: startAtHPre ? -50 : 35,
        l: 35,
        h: centringH,
        cal: true,
        estop: false,
      },
      atClosedIdle: !startAtHPre,
      atProductionPosture: false,
      atHPre: startAtHPre,
      axis,
      ...opts,
    }),
    ensurePickPlaceReadyForProduction: async () => ({
      status: { positionA: 0.5, homedA: true, homedB: true },
      returnPositionMm: 0.5,
    }),
    centringStatus: async () => ({
      u: centringH > 5 ? -50 : 35,
      l: 35,
      h: centringH,
      cal: true,
      estop: false,
      busy: false,
    }),
    readCentringStatusAfterMove: async (_phase, gapMm) => {
      centringH = gapMm
      return { u: -50, l: 35, h: gapMm, cal: true, estop: false, busy: false, moveEnd: 'ok' }
    },
    prepareCentringProductionPosture: async () => ({
      parked: true,
      inactive_axis: 'lower',
      parked_at: 'home',
      status: { u: -80, l: 35, h: 37.1, cal: true, estop: false },
    }),
    pickPlaceStatus: async () => ({ positionA: 0.5 }),
    moveAmmT2: async (mm, speed) => {
      ppMoves.push({ mm, speed, via: 'centring' })
      return { command: 'MOVEAMMT2', positionA: mm }
    },
    applyShrinkTubeGapPhase: async (opts) => {
      gapCalls.push(opts)
      centringH = opts.phase === 'pre' ? opts.resolved.h_pre_mm : opts.resolved.h_post_mm
      return {
        phase: opts.phase,
        moveCommand: 'MOVE_UPPERMM',
        done: { h: centringH },
      }
    },
  })

  __setCentringAdvancedGapTestDeps({
    connectWithRetry: async () => {},
    centringStatus: async () => ({
      u: centringH > 5 ? -50 : 35,
      l: 35,
      h: centringH,
      cal: true,
      estop: false,
      busy: false,
    }),
    prepareCentringProductionPosture: async () => ({
      parked: true,
      status: { u: -80, l: 35, h: 37.1, cal: true, estop: false },
    }),
    applyShrinkTubeGapPhase: async (opts) => {
      gapCalls.push({ ...opts, via: 'advanced_load' })
      centringH = opts.resolved.h_pre_mm
      return { phase: 'pre', moveCommand: 'MOVE_UPPERMM' }
    },
    readCentringStatusAfterMove: async (_phase, gapMm) => {
      centringH = gapMm
      return { u: -50, l: 35, h: gapMm, cal: true, estop: false, busy: false, moveEnd: 'ok' }
    },
    isProductionActive: () => false,
  })

  __setTestMoveAmmT2(async (mm, speed) => {
    ppMoves.push({ mm, speed, via: 'pick_tail' })
    return { command: 'MOVEAMMT2', positionA: mm }
  })
  __setTestReturnPickPlaceToHome(async () => ({
    command: 'MOVEAMMT2 0.5 80',
    positionA: 0.5,
    referenceAxis: 'a',
    targetMm: 0.5,
    homedA: true,
    homedB: true,
  }))
  __setTestEnsurePickPlaceReady(async () => ({
    status: { positionA: 0.5, homedA: true, homedB: true },
    returnPositionMm: 0.5,
  }))
  __setTestEnsureCentringReady(async (axis, opts) => ({
    status: {
      u: startAtHPre ? -50 : 35,
      l: 35,
      h: centringH,
      cal: true,
      estop: false,
    },
    atClosedIdle: !startAtHPre,
    atProductionPosture: false,
    atHPre: startAtHPre,
    axis,
    ...opts,
  }))
  __setProductionAbortTestHooks({
    pneumaticsSafe: async () => {},
    pickPlaceStop: async () => {},
    centringStop: async () => {},
  })

  return {
    gapCalls,
    ppMoves,
    restoreIdleCalls,
    restoreHPreCalls,
    getCentringH: () => centringH,
    setCentringH: (h) => {
      centringH = h
    },
  }
}

function clearAllMocks() {
  __setLoadTimeCentringInitForTest(null)
  __clearProductionCentringTestDeps()
  __clearCentringAdvancedGapTestDeps()
  __clearTestMoveAmmT2()
  __clearTestReturnPickPlaceToHome()
  __clearTestEnsurePickPlaceReady()
  __clearTestEnsureCentringReady()
  __clearTestProductionCycleVariant()
  __setProductionAbortTestHooks(null)
  __clearTestRunInspectionOnce()
  clearAdvancedHPreReady()
  clearLoadedReference()
}

// ── 1. Settings ──────────────────────────────────────────────────────────────

test('E2E settings: production_cycle_variant defaults to advanced; legacy full coerces', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-settings-'))
  const dbPath = path.join(tmpDir, 'adv.db')
  const prevDb = process.env.MAIN_DATA_DB_PATH
  process.env.MAIN_DATA_DB_PATH = dbPath
  let db
  try {
    db = openDatabase(dbPath)
    const svc = initSettingsService({
      db,
      runtime: {
        loadPickPlaceConfig: () => {},
        loadCentringConfig: () => {},
        closeSerialSession: () => {},
        reloadProductionSequenceConfig: () => {},
        setReferenceSerialFromSettings: () => {},
      },
    })
    assert.equal(svc.getAssembledSystemView().production_cycle_variant, 'advanced')
    const coerced = svc.patchSystemFlat(
      { production_cycle_variant: 'full' },
      { actorUsername: 'bypass' },
    )
    assert.equal(coerced.production_cycle_variant, 'advanced')
    svc.hydrateRegistry()
    assert.equal(svc.getAssembledSystemView().production_cycle_variant, 'advanced')
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
    if (prevDb === undefined) delete process.env.MAIN_DATA_DB_PATH
    else process.env.MAIN_DATA_DB_PATH = prevDb
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ── 2. h_pre on scan + initialization ────────────────────────────────────────

test('E2E advanced: reference scan applies h_pre and reconciles RUN when homed', { skip: V1_WIRED }, async () => {
  const prev = envSnapshot()
  const db = createAdvancedDb()
  try {
    zeroDelays()
    wireEnv(db)
    __setTestProductionCycleVariant('advanced')
    const mocks = installHardwareMocks({ startAtHPre: false })

    setLoadedReference(REF_A)
    const scan = await applyReferenceHPreAfterLoad(REF_A)
    assert.equal(scan.ok, true)
    assert.equal(scan.h_pre_mm, H_PRE_A)
    assert.ok(mocks.gapCalls.some((c) => c.phase === 'pre'))
    assert.deepEqual(getAdvancedHPreReady(), { referenceId: REF_A, hPreMm: H_PRE_A })
    assert.equal(getMachineInitStatus().initialized, true)

    __setCachedCentringStatusForTest({
      u: -50,
      l: 35,
      h: H_PRE_A,
      cal: true,
      estop: false,
      busy: false,
    })
    assert.equal(getCentringProductionBlockReason(), null)
    assert.equal(getProductionEnqueueBlockReason(), null)
  } finally {
    clearAllMocks()
    restoreEnv(prev)
    db.close()
  }
})

test('E2E advanced: reference change clears ready then scan applies new h_pre', { skip: V1_WIRED }, async () => {
  const prev = envSnapshot()
  const db = createAdvancedDb()
  try {
    zeroDelays()
    wireEnv(db)
    __setTestProductionCycleVariant('advanced')
    const mocks = installHardwareMocks()

    await applyReferenceHPreAfterLoad(REF_A)
    assert.equal(getAdvancedHPreReady()?.hPreMm, H_PRE_A)

    mocks.setCentringH(1.2)
    setLoadedReference(REF_B)
    assert.equal(getAdvancedHPreReady(), null)
    const scanB = await applyReferenceHPreAfterLoad(REF_B)
    assert.equal(scanB.ok, true)
    assert.equal(scanB.h_pre_mm, H_PRE_B)
    assert.deepEqual(getAdvancedHPreReady(), { referenceId: REF_B, hPreMm: H_PRE_B })
  } finally {
    clearAllMocks()
    restoreEnv(prev)
    db.close()
  }
})

test('E2E advanced: initialization homing path applies h_pre after closed idle', async () => {
  const prev = envSnapshot()
  const db = createAdvancedDb()
  try {
    zeroDelays()
    wireEnv(db)
    __setTestProductionCycleVariant('advanced')
    installHardwareMocks({ startAtHPre: false })
    setLoadedReference(REF_A)

    const initApply = await applyHPreAfterCentringHoming(REF_A)
    assert.equal(initApply.ok, true)
    assert.equal(initApply.h_pre_mm, H_PRE_A)
    assert.deepEqual(getAdvancedHPreReady(), { referenceId: REF_A, hPreMm: H_PRE_A })
  } finally {
    clearAllMocks()
    restoreEnv(prev)
    db.close()
  }
})

test('E2E advanced: skip h_pre while production active', async () => {
  const prev = envSnapshot()
  const db = createAdvancedDb()
  try {
    zeroDelays()
    wireEnv(db)
    __setTestProductionCycleVariant('advanced')
    __setCentringAdvancedGapTestDeps({
      isProductionActive: () => true,
      connectWithRetry: async () => {
        throw new Error('must not connect')
      },
    })
    const r = await onReferenceLoadedAdvancedHPre(REF_A)
    assert.equal(r.skipped, true)
    assert.equal(r.reason, 'production_active')
  } finally {
    clearAllMocks()
    restoreEnv(prev)
    db.close()
  }
})

// ── 3. Centring cycle gap strategy ───────────────────────────────────────────

test('E2E advanced runCentringCycle: hold h_pre, open h_post at output', async () => {
  const prev = envSnapshot()
  const db = createAdvancedDb()
  try {
    zeroDelays()
    wireEnv(db)
    const mocks = installHardwareMocks({ startAtHPre: true, hPreMm: H_PRE_A })
    const { getShrinkTubeById } = await import('./productionContext.mjs')
    const shrinkTube = getShrinkTubeById(TUBE_A)
    assert.ok(shrinkTube?.has_derived_geometry, 'tube A must have persisted derived geometry')
    const result = await runCentringCycle({
      shrinkTube,
      systemSettings: frameSettings(),
      gapStrategy: 'advanced',
      moveSpeedMmS: 80,
    })
    assert.equal(result.gapStrategy, 'advanced')
    const pre = result.phases.find((p) => p.name === 'centring_h_pre')
    assert.equal(pre?.skipped, true)
    assert.equal(pre?.reason, 'assert_only_mid_cycle')
    assert.equal(mocks.gapCalls.filter((c) => c.phase === 'pre').length, 0)
    assert.equal(mocks.gapCalls.filter((c) => c.phase === 'post').length, 1)
    assert.equal(mocks.gapCalls.find((c) => c.phase === 'post')?.resolved.h_post_mm, H_POST_A)
    assert.ok(result.phases.some((p) => p.name === 'move_centering_travel'))
  } finally {
    clearAllMocks()
    restoreEnv(prev)
    db.close()
  }
})

// ── 4. Full production sequence advanced ─────────────────────────────────────

test('E2E advanced executeProductionSequence: restore h_pre after pick-tail, not closed idle', { skip: V1_WIRED }, async () => {
  const prev = envSnapshot()
  const db = createAdvancedDb()
  try {
    zeroDelays()
    wireEnv(db)
    __setTestProductionCycleVariant('advanced')
    noteAdvancedHPreReady(REF_A, H_PRE_A)
    __setCachedCentringStatusForTest({
      u: -50,
      l: 35,
      h: H_PRE_A,
      cal: true,
      estop: false,
      busy: false,
    })
    const mocks = installHardwareMocks({ startAtHPre: true, hPreMm: H_PRE_A })

    assert.deepEqual(getProductionSkipFlags(), {
      cycleVariant: 'advanced',
      gapStrategy: 'advanced',
      skipPickTail: false,
      skipCentringPickPlace: false,
      skipCentring: false,
      skipVision: true,
    })

    beginProductionJob('e2e-adv-1', 'hmi')
    const result = await executeProductionSequence(makeEcm(), {
      requireButton: false,
      source: 'hmi',
    })
    finishProductionJob({ ok: true })

    assert.equal(result.ok, true)
    assert.equal(result.cycleVariant, 'advanced')
    assert.equal(result.cycleResult, 'PASS')

    const phaseNames = result.phases.map((p) => p.phase || p.name).filter(Boolean)
    assert.ok(phaseNames.includes('centring'), 'centring ran')
    assert.ok(
      result.phases.some((p) => p.phase === 'move_to_pick' || p.name === 'move_to_pick'),
      'pick-tail still runs in advanced',
    )
    assert.ok(
      result.phases.some((p) => p.phase === 'centring_restore_h_pre'),
      'must restore h_pre after P&P home',
    )
    assert.ok(
      !result.phases.some((p) => p.phase === 'centring_restore_idle' && p.position === 'closed'),
      'must not force closed idle in advanced',
    )
    assert.equal(mocks.restoreIdleCalls.length, 0)
    assert.deepEqual(mocks.restoreHPreCalls, [H_PRE_A])
    assert.deepEqual(getAdvancedHPreReady(), { referenceId: REF_A, hPreMm: H_PRE_A })

    // Centring sub-cycle opened h_post
    const centringPhase = result.phases.find((p) => p.phase === 'centring')
    assert.ok(centringPhase)
    assert.equal(centringPhase.gapStrategy, 'advanced')
    const post = (centringPhase.phases || []).find((p) => p.name === 'centring_h_post')
    assert.ok(post, 'h_post at traverse output')
  } finally {
    try {
      finishProductionJob({ ok: false })
    } catch {
      /* ignore */
    }
    forceState(LIFECYCLE_STATE.IDLE)
    clearAllMocks()
    restoreEnv(prev)
    db.close()
  }
})

// ── 5. Step list contract ────────────────────────────────────────────────────

test('E2E advanced buildProductionSteps includes centring_restore_h_pre step name', { skip: V1_WIRED }, async () => {
  const prev = envSnapshot()
  const db = createAdvancedDb()
  try {
    zeroDelays()
    wireEnv(db)
    __setTestProductionCycleVariant('advanced')
    noteAdvancedHPreReady(REF_A, H_PRE_A)
    __setCachedCentringStatusForTest({
      u: -50,
      l: 35,
      h: H_PRE_A,
      cal: true,
      estop: false,
      busy: false,
    })
    installHardwareMocks({ startAtHPre: true, hPreMm: H_PRE_A })

    const ctx = await prepareProductionRun(makeEcm(), { requireButton: false, source: 'hmi' })
    assert.equal(ctx.gapStrategy, 'advanced')
    const steps = buildProductionSteps(makeEcm(), ctx, [], {
      centring: null,
      moveToPick: null,
      moveToBackoff: null,
    })
    assert.ok(steps.some((s) => s.name === 'centring_restore_h_pre'))
    assert.ok(steps.some((s) => s.name === 'pick_place_tail'))
    assert.ok(steps.some((s) => s.name === 'centring'))
    assert.ok(!steps.some((s) => s.name === 'centring_restore_idle'))
  } finally {
    clearAllMocks()
    restoreEnv(prev)
    db.close()
  }
})

test('E2E isCentringAtGapMm supports gate tolerance used by advanced ready note', () => {
  assert.equal(
    isCentringAtGapMm({ cal: 1, estop: 0, busy: 0, h: H_PRE_A, u: -50, l: 35 }, H_PRE_A),
    true,
  )
  noteAdvancedHPreReady(REF_A, H_PRE_A)
  assert.deepEqual(getAdvancedHPreReady(), { referenceId: REF_A, hPreMm: H_PRE_A })
  clearAdvancedHPreReady()
})

function makeShortTubeDb(db) {
  db.prepare('UPDATE shrink_tubes SET length_mm = 50 WHERE id = ?').run(TUBE_A)
  refreshAllShrinkTubeDerived(db, {
    ...frameSettings(),
    centring_frame_config: {
      sideA_guide_spacing_mm: 300,
      sideB_guide_spacing_mm: 40,
      module_length_mm: 200,
    },
  })
}

test('E2E short L_eff: load uses short establish (no closed-idle SEEK) then MOVE h_pre', { skip: V1_WIRED }, async () => {
  const prev = envSnapshot()
  const db = createAdvancedDb()
  try {
    makeShortTubeDb(db)
    zeroDelays()
    wireEnv(db, {
      centring_frame_config: {
        sideA_guide_spacing_mm: 300,
        sideB_guide_spacing_mm: 40,
        module_length_mm: 200,
      },
    })
    __setTestProductionCycleVariant('advanced')
    const mocks = installHardwareMocks({ startAtHPre: false })
    const initCalls = []
    __setLoadTimeCentringInitForTest(async (referenceId) => {
      const { resolveAdvancedGapRecipe } = await import('./centringAdvancedGap.mjs')
      const { shouldSkipCenteringTravel } = await import('./productionCentringSequence.mjs')
      const recipe = resolveAdvancedGapRecipe(referenceId)
      if (recipe && shouldSkipCenteringTravel(recipe.resolved.L_eff_mm)) {
        initCalls.push('short')
        return {
          ok: true,
          didSeek: false,
          procedure: 'SEEK_TRAVEL → HOME → MOVE h_pre',
          status: { u: -80, l: 35, cal: true, estop: false, busy: false },
        }
      }
      initCalls.push('long')
      return { ok: true, didSeek: true, status: { u: 35, l: 35, cal: true, estop: false, busy: false } }
    })

    setLoadedReference(REF_A)
    const scan = await applyReferenceHPreAfterLoad(REF_A)
    assert.equal(scan.ok, true, scan.error || JSON.stringify(scan))
    assert.deepEqual(initCalls, ['short'])
    assert.ok(mocks.gapCalls.some((c) => c.phase === 'pre'))
    assert.equal(getMachineInitStatus().initialized, true)
  } finally {
    clearAllMocks()
    restoreEnv(prev)
    db.close()
  }
})

test('E2E short L_eff: cycle holds h_pre without h_post', async () => {
  const prev = envSnapshot()
  const db = createAdvancedDb()
  try {
    makeShortTubeDb(db)
    zeroDelays()
    wireEnv(db, {
      centring_frame_config: {
        sideA_guide_spacing_mm: 300,
        sideB_guide_spacing_mm: 40,
        module_length_mm: 200,
      },
    })
    const mocks = installHardwareMocks({ startAtHPre: true, hPreMm: H_PRE_A })
    const { getShrinkTubeById } = await import('./productionContext.mjs')
    const shrinkTube = getShrinkTubeById(TUBE_A)
    assert.ok(shrinkTube.l_eff_mm < 55)
    const result = await runCentringCycle({
      shrinkTube,
      systemSettings: {
        ...frameSettings(),
        centring_frame_config: {
          sideA_guide_spacing_mm: 300,
          sideB_guide_spacing_mm: 40,
          module_length_mm: 200,
        },
      },
      gapStrategy: 'advanced',
    })
    assert.equal(result.holdHPreEntireCycle, true)
    assert.equal(result.deferGapsToPickTail, false)
    assert.equal(mocks.gapCalls.filter((c) => c.phase === 'post').length, 0)
    assert.ok(result.phases.some((p) => p.name === 'move_centering_travel_skipped'))
  } finally {
    clearAllMocks()
    restoreEnv(prev)
    db.close()
  }
})

test('E2E applyOrAssertReferenceHPre notes readiness for REF-A', async () => {
  const prev = envSnapshot()
  const db = createAdvancedDb()
  try {
    zeroDelays()
    wireEnv(db)
    installHardwareMocks({ startAtHPre: false })
    const r = await applyOrAssertReferenceHPre(REF_A)
    assert.equal(r.h_pre_mm, H_PRE_A)
    assert.deepEqual(getAdvancedHPreReady(), { referenceId: REF_A, hPreMm: H_PRE_A })
  } finally {
    clearAllMocks()
    restoreEnv(prev)
    db.close()
  }
})
