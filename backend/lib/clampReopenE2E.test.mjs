/**
 * End-to-end verification of clamp reopen (bad cable placement) flow:
 * live close → panel reopen → inhibit → enqueue blocked → DI low → re-place → enqueue OK.
 * Also verifies panel READY mappings for single vs sequential.
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

import {
  getProductionEnqueueBlockReason,
  canEnqueueProduction,
  refreshClampTriggerEnqueueGate,
} from './productionSequence.mjs'
import { enqueueProductionJob, resetProductionQueue } from './productionJobQueue.mjs'
import {
  openClampsForReplace,
  applyClampTriggerLiveClose,
  getClampTriggerInhibitState,
  getClampTriggerStartBlockReason,
  getOpenClampsForReplaceOutputs,
  setCachedClampTriggerState,
  getCachedClampTriggerState,
  stopClampTriggerMonitor,
  startClampTriggerMonitor,
} from './clampTriggerMode.mjs'
import {
  resolvePanelContext,
  PANEL_ACTION,
  PANEL_CONTEXT,
  TWO_HAND_MODE,
  LED,
} from './panelModes.mjs'
import { DI, DO } from './ethercat.mjs'
import {
  setLoadedReference,
  clearLoadedReference,
  __setMachineInitStateForTest,
} from './machineInit.mjs'
import {
  onEtherCATConnected,
  finishProductionJob,
  forceState,
  LIFECYCLE_STATE,
} from './machineLifecycle.mjs'
import { initProductionContext } from './productionContext.mjs'
import { initProductionVisionInspection } from './productionVisionInspection.mjs'
import { serializeVisionChecksConfig, normalizeVisionChecksConfig } from './visionChecksConfigStore.mjs'
import { __setProductionAbortTestHooks } from './productionAbort.mjs'

const REF_ID = 'REF-REOPEN'
const TUBE_ID = 'TUBE-REOPEN'

function makeEcm({ right = 0, left = 0 } = {}) {
  const outputs = Array(16).fill(0)
  const writes = []
  let rightBit = right
  let leftBit = left
  return {
    isInitialized: true,
    writes,
    outputs,
    setBits(r, l) {
      rightBit = r
      leftBit = l
    },
    async getInput() {
      return { status: 'ok', value: true }
    },
    async getAllInputs() {
      const inputs = Array(16).fill(0)
      inputs[DI.CLAMP_RIGHT_TRIGGER] = rightBit
      inputs[DI.CLAMP_LEFT_TRIGGER] = leftBit
      return { status: 'ok', inputs }
    },
    async setOutput(pin, value) {
      outputs[pin] = value ? 1 : 0
      writes.push({ pin, value: value ? 1 : 0 })
      return { status: 'ok' }
    },
  }
}

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE product_references (
      id TEXT PRIMARY KEY,
      name TEXT,
      vision_program_id INTEGER,
      vision_inspection_enabled INTEGER DEFAULT 0,
      vision_checks_json TEXT,
      shrink_tube_id TEXT
    );
    CREATE TABLE shrink_tubes (
      id TEXT PRIMARY KEY,
      name TEXT,
      length_mm REAL,
      diameter_mm REAL
    );
    CREATE TABLE system_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      machine_model TEXT,
      centering_input_start_mm REAL,
      centering_input_offset_mm REAL
    );
  `)
  const checks = normalizeVisionChecksConfig({})
  db.prepare(
    `INSERT INTO shrink_tubes (id, name, length_mm, diameter_mm) VALUES (?, ?, ?, ?)`,
  ).run(TUBE_ID, 'Tube', 50, 10)
  db.prepare(
    `INSERT INTO product_references
      (id, name, vision_program_id, vision_inspection_enabled, vision_checks_json, shrink_tube_id)
     VALUES (?, ?, NULL, 0, ?, ?)`,
  ).run(REF_ID, 'Reopen Ref', serializeVisionChecksConfig(checks), TUBE_ID)
  db.prepare(
    `INSERT INTO system_settings (id, machine_model, centering_input_start_mm, centering_input_offset_mm)
     VALUES (1, 'STCS-CS19', 0, 0)`,
  ).run()
  return db
}

function wireEnv(db) {
  initProductionContext(db, () => ({
    machine_model: 'STCS-CS19',
    centering_input_start_mm: 0,
    centering_input_offset_mm: 0,
  }))
  initProductionVisionInspection(db, () => ({ machine_model: 'STCS-CS19' }))
  onEtherCATConnected()
  __setMachineInitStateForTest({ referenceId: REF_ID, initialized: true })
  setLoadedReference(REF_ID)
  forceState(LIFECYCLE_STATE.RUN, { reason: 'reopen e2e ready' })
}

function readyPanelBase(overrides = {}) {
  return {
    connected: true,
    lifecycle: {
      lifecycleState: LIFECYCLE_STATE.RUN,
      isProductionActive: false,
      isSafetyLockout: false,
      initActive: false,
    },
    initStatus: {
      referenceLoaded: true,
      initialized: true,
      initInProgress: false,
    },
    canEnqueue: true,
    maintenance: { active: false, target: null },
    twoHandMode: TWO_HAND_MODE.SEQUENTIAL,
    focus: null,
    stepReady: false,
    initHeld: false,
    activeFault: null,
    ...overrides,
  }
}

beforeEach(() => {
  delete process.env.CLAMP_TRIGGER_MODE
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  process.env.PRODUCTION_SKIP_PICK_PLACE = '1'
  process.env.PRODUCTION_SKIP_VISION = '1'
  process.env.ETHERCAT_SKIP_START_BUTTON = '1'
  stopClampTriggerMonitor()
  resetProductionQueue()
  __setProductionAbortTestHooks({
    pneumaticsSafe: async () => {},
    pickPlaceStop: async () => {},
    centringStop: async () => {},
  })
})

afterEach(() => {
  delete process.env.CLAMP_TRIGGER_MODE
  delete process.env.PRODUCTION_SKIP_CENTRING
  delete process.env.PRODUCTION_SKIP_PICK_PLACE
  delete process.env.PRODUCTION_SKIP_VISION
  delete process.env.ETHERCAT_SKIP_START_BUTTON
  stopClampTriggerMonitor()
  resetProductionQueue()
  clearLoadedReference()
  __setProductionAbortTestHooks(null)
  finishProductionJob({ failed: false })
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'reopen e2e cleanup' })
})

test('E2E di10: live close → reopen → inhibit blocks enqueue → remove → re-place → enqueue', async () => {
  const db = createDb()
  wireEnv(db)
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  const ecm = makeEcm({ right: 1, left: 0 })

  // 1) Operator places cable — live close grips right
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: false }, 'di10')
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  setCachedClampTriggerState({ rightTriggered: true, leftTriggered: false })
  assert.equal(getProductionEnqueueBlockReason(), null)
  assert.equal(canEnqueueProduction(), true)

  // Panel READY while canEnqueue — Start begins cycle; short Init opens clamps.
  const ready = resolvePanelContext(readyPanelBase({ canEnqueue: true, twoHandMode: TWO_HAND_MODE.SEQUENTIAL }))
  assert.equal(ready.context, PANEL_CONTEXT.READY)
  assert.equal(ready.twoHand, false)
  assert.equal(ready.di1.action, PANEL_ACTION.START)
  assert.equal(ready.di0.action, PANEL_ACTION.OPEN_CLAMPS)
  assert.equal(ready.di0.trigger, 'edge')
  assert.deepEqual(ready.leds, { init: LED.ON, start: LED.FLASH })

  // 2) Bad placement — reopen opens right only
  ecm.writes.length = 0
  const opened = await openClampsForReplace(ecm)
  assert.equal(opened.wrote, true)
  assert.deepEqual(opened.outputs, { clampRight: false })
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0))
  assert.ok(!ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT))
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: false })

  // 3) DI still high — live close must not re-grip; Start/enqueue blocked
  ecm.writes.length = 0
  const live = await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: false }, 'di10')
  assert.equal(live.wrote, false)
  assert.equal(ecm.writes.length, 0)
  assert.match(getClampTriggerStartBlockReason(getCachedClampTriggerState(), 'di10'), /right clamp/i)
  assert.match(getProductionEnqueueBlockReason(), /right clamp/i)
  assert.equal(canEnqueueProduction(), false)

  // Panel drops to READY_BLOCKED while inhibited — reopen still available
  const blocked = resolvePanelContext(
    readyPanelBase({
      canEnqueue: canEnqueueProduction(),
      twoHandMode: TWO_HAND_MODE.SEQUENTIAL,
      clampTriggerMode: 'di10',
    }),
  )
  assert.equal(blocked.context, PANEL_CONTEXT.READY_BLOCKED)
  assert.equal(blocked.di1.action, PANEL_ACTION.OPEN_CLAMPS)
  assert.equal(canEnqueueProduction(), false)

  await assert.rejects(
    () => enqueueProductionJob('panel', { requireButton: false }, ecm),
    /right clamp/i,
  )

  // 4) Operator removes cable — DI low arms re-place (still canEnqueue=false)
  ecm.setBits(0, 0)
  await refreshClampTriggerEnqueueGate(ecm)
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: false })
  assert.match(getProductionEnqueueBlockReason(), /right clamp/i)
  assert.equal(canEnqueueProduction(), false)

  // 5) Re-place — DI high closes clamp, then canEnqueue=true
  ecm.setBits(1, 0)
  await refreshClampTriggerEnqueueGate(ecm)
  ecm.writes.length = 0
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: false }, 'di10')
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: false })
  assert.equal(getProductionEnqueueBlockReason(), null)
  assert.equal(canEnqueueProduction(), true)

  const job = await enqueueProductionJob('panel', { requireButton: false }, ecm)
  assert.ok(job?.id)
  assert.equal(resolvePanelContext(readyPanelBase({ canEnqueue: true })).context, PANEL_CONTEXT.READY)

  db.close()
})

test('E2E both: reopen opens both; must DI low→high per side before canEnqueue', async () => {
  const db = createDb()
  wireEnv(db)
  process.env.CLAMP_TRIGGER_MODE = 'both'
  const ecm = makeEcm({ right: 1, left: 1 })
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'both')
  setCachedClampTriggerState({ rightTriggered: true, leftTriggered: true })
  assert.equal(canEnqueueProduction(), true)

  await openClampsForReplace(ecm)
  assert.deepEqual(getOpenClampsForReplaceOutputs('both'), { clampRight: false, clampLeft: false })
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })
  assert.match(getProductionEnqueueBlockReason(), /clamps/i)
  assert.equal(canEnqueueProduction(), false)

  // Clear right only — still awaiting both until live closes
  setCachedClampTriggerState({ rightTriggered: false, leftTriggered: true })
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })
  assert.match(getProductionEnqueueBlockReason(), /clamps/i)

  // Clear left too
  setCachedClampTriggerState({ rightTriggered: false, leftTriggered: false })
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })
  assert.match(getProductionEnqueueBlockReason(), /clamps/i)
  assert.equal(canEnqueueProduction(), false)

  // Re-place both — live close clears awaiting; canEnqueue true
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'both')
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: false })
  setCachedClampTriggerState({ rightTriggered: true, leftTriggered: true })
  assert.equal(getProductionEnqueueBlockReason(), null)
  assert.equal(canEnqueueProduction(), true)
  db.close()
})

test('E2E di9 open matrix and off no-op', async () => {
  const ecm = makeEcm()
  process.env.CLAMP_TRIGGER_MODE = 'di9'
  const r = await openClampsForReplace(ecm)
  assert.deepEqual(r.outputs, { clampLeft: false })
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 0))
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: true })

  stopClampTriggerMonitor()
  process.env.CLAMP_TRIGGER_MODE = 'off'
  ecm.writes.length = 0
  const off = await openClampsForReplace(ecm)
  assert.equal(off.wrote, false)
  assert.equal(off.skipped, true)
  assert.equal(ecm.writes.length, 0)
})

test('Panel READY clamps closed: Init flash + short OPEN_CLAMPS; Start flash', () => {
  const single = resolvePanelContext(
    readyPanelBase({ twoHandMode: TWO_HAND_MODE.SINGLE, clampTriggerMode: 'di10' }),
  )
  assert.equal(single.context, PANEL_CONTEXT.READY)
  assert.equal(single.twoHand, false)
  assert.equal(single.di0.action, PANEL_ACTION.OPEN_CLAMPS)
  assert.equal(single.di0.trigger, 'edge')
  assert.equal(single.di1.action, PANEL_ACTION.START)
  assert.deepEqual(single.leds, { init: LED.ON, start: LED.FLASH })

  const seq = resolvePanelContext(
    readyPanelBase({
      twoHandMode: TWO_HAND_MODE.SEQUENTIAL,
      initHeld: false,
      clampTriggerMode: 'di10',
    }),
  )
  assert.equal(seq.twoHand, false)
  assert.equal(seq.di0.action, PANEL_ACTION.OPEN_CLAMPS)
  assert.equal(seq.di0.trigger, 'edge')
  assert.equal(seq.di1.action, PANEL_ACTION.START)
  assert.deepEqual(seq.leds, { init: LED.ON, start: LED.FLASH })

  const seqNoClamp = resolvePanelContext(
    readyPanelBase({
      twoHandMode: TWO_HAND_MODE.SEQUENTIAL,
      initHeld: false,
      clampTriggerMode: 'off',
    }),
  )
  assert.equal(seqNoClamp.twoHand, true)
  assert.equal(seqNoClamp.di0.action, PANEL_ACTION.START)
  assert.equal(seqNoClamp.di0.trigger, 'hold')
  assert.deepEqual(seqNoClamp.leds, { init: LED.FLASH, start: LED.OFF })

  const seqHeld = resolvePanelContext(
    readyPanelBase({
      twoHandMode: TWO_HAND_MODE.SEQUENTIAL,
      initHeld: true,
      clampTriggerMode: 'off',
    }),
  )
  assert.deepEqual(seqHeld.leds, { init: LED.OFF, start: LED.FLASH })
})

test('E2E monitor respects inhibit after reopen while DI stays high', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  process.env.CLAMP_TRIGGER_POLL_MS = '20'
  forceState(LIFECYCLE_STATE.RUN, { reason: 'monitor inhibit' })
  const ecm = makeEcm({ right: 1, left: 0 })

  startClampTriggerMonitor(ecm)
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))

  ecm.writes.length = 0
  await openClampsForReplace(ecm)
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0))

  ecm.writes.length = 0
  await new Promise((r) => setTimeout(r, 80))
  // DI still high but inhibited — must not re-close
  assert.equal(
    ecm.writes.filter((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1).length,
    0,
    'live monitor must not re-close while inhibit active',
  )
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: false })

  ecm.setBits(0, 0)
  await new Promise((r) => setTimeout(r, 60))
  // Still awaiting re-place until DI high closes again
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: false })

  ecm.setBits(1, 0)
  await new Promise((r) => setTimeout(r, 60))
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: false })

  stopClampTriggerMonitor()
})
