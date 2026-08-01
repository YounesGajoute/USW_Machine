/**
 * Sequence-level integration: clamp enqueue gate + both-mode close_clamps.
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

import {
  prepareProductionRun,
  buildProductionSteps,
  getProductionEnqueueBlockReason,
  refreshClampTriggerEnqueueGate,
  executeProductionSequence,
} from './productionSequence.mjs'
import {
  enqueueProductionJob,
  getProductionQueueSnapshot,
  resetProductionQueue,
} from './productionJobQueue.mjs'
import {
  setCachedClampTriggerState,
  stopClampTriggerMonitor,
} from './clampTriggerMode.mjs'
import { DI, DO } from './ethercat.mjs'
import {
  setLoadedReference,
  clearLoadedReference,
  __setMachineInitStateForTest,
} from './machineInit.mjs'
import {
  onEtherCATConnected,
  beginProductionJob,
  finishProductionJob,
  forceState,
  getLifecycleState,
  isProductionActive,
  LIFECYCLE_STATE,
} from './machineLifecycle.mjs'
import { initProductionContext } from './productionContext.mjs'
import { initProductionVisionInspection } from './productionVisionInspection.mjs'
import { serializeVisionChecksConfig, normalizeVisionChecksConfig } from './visionChecksConfigStore.mjs'
import { __setProductionAbortTestHooks } from './productionAbort.mjs'

const REF_ID = 'REF-CLAMP'
const TUBE_ID = 'TUBE-CLAMP'

function makeClampEcm({ right = 0, left = 0 } = {}) {
  const outputs = Array(16).fill(0)
  const writes = []
  let rightBit = right
  let leftBit = left
  return {
    isInitialized: true,
    writes,
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
  ).run(REF_ID, 'Clamp Ref', serializeVisionChecksConfig(checks), TUBE_ID)
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
  forceState(LIFECYCLE_STATE.RUN, { reason: 'clamp test ready' })
}

beforeEach(() => {
  delete process.env.CLAMP_TRIGGER_MODE
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  process.env.PRODUCTION_SKIP_PICK_PLACE = '1'
  process.env.PRODUCTION_SKIP_VISION = '1'
  process.env.ETHERCAT_SKIP_START_BUTTON = '1'
  process.env.PRODUCTION_DELAY_CLAMP_MS = '0'
  process.env.PRODUCTION_DELAY_LEVER_UP_MS = '0'
  process.env.PRODUCTION_DELAY_PP_CLAMP_CLOSE_MS = '0'
  process.env.PRODUCTION_DELAY_CLAMP_OPEN_MS = '0'
  process.env.PRODUCTION_DELAY_LEVER_DOWN_MS = '0'
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
})

test('refreshClampTriggerEnqueueGate live-reads DI before enqueue block reason', async () => {
  const db = createDb()
  wireEnv(db)
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  // Stale cache says OK, live DI says not triggered.
  setCachedClampTriggerState({ rightTriggered: true, leftTriggered: false })
  const ecm = makeClampEcm({ right: 0, left: 0 })

  await refreshClampTriggerEnqueueGate(ecm)
  assert.match(getProductionEnqueueBlockReason(), /right clamp/i)

  ecm.setBits(1, 0)
  await refreshClampTriggerEnqueueGate(ecm)
  assert.equal(getProductionEnqueueBlockReason(), null)
  db.close()
})

test('enqueueProductionJob rejects when live DI missing (ignores stale cache)', async () => {
  const db = createDb()
  wireEnv(db)
  process.env.CLAMP_TRIGGER_MODE = 'both'
  setCachedClampTriggerState({ rightTriggered: true, leftTriggered: true })
  const ecm = makeClampEcm({ right: 1, left: 0 })

  await assert.rejects(
    () => enqueueProductionJob('hmi', { requireButton: false }, ecm),
    (err) => {
      assert.match(String(err.message), /Place the cable on the clamps/i)
      return true
    },
  )
  db.close()
})

test('enqueueProductionJob accepts when live DI satisfied', async () => {
  const db = createDb()
  wireEnv(db)
  process.env.CLAMP_TRIGGER_MODE = 'di9'
  setCachedClampTriggerState({ rightTriggered: false, leftTriggered: false })
  const ecm = makeClampEcm({ right: 0, left: 1 })

  const job = await enqueueProductionJob('hmi', { requireButton: false }, ecm)
  assert.ok(job?.id)
  resetProductionQueue()
  db.close()
})

test('prepareProductionRun rejects di10 without right trigger', async () => {
  const db = createDb()
  wireEnv(db)
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  const ecm = makeClampEcm({ right: 0, left: 1 })
  await assert.rejects(
    () => prepareProductionRun(ecm, { requireButton: false, source: 'hmi' }),
    /right clamp/i,
  )
  db.close()
})

test('both Pre-Start: stay RUN, arm Start, do not enqueue until Start', async () => {
  const db = createDb()
  wireEnv(db)
  process.env.CLAMP_TRIGGER_MODE = 'both'
  const ecm = makeClampEcm({ right: 0, left: 0 })

  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  await refreshClampTriggerEnqueueGate(ecm)
  assert.match(getProductionEnqueueBlockReason(), /Place the cable on the clamps/i)
  assert.equal(getProductionQueueSnapshot().queueDepth, 0)
  assert.equal(isProductionActive(), false)

  ecm.setBits(1, 1)
  await refreshClampTriggerEnqueueGate(ecm)

  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN, 'Pre-Start must keep lifecycle RUN')
  assert.equal(isProductionActive(), false, 'live close must not begin a production job')
  assert.equal(getProductionEnqueueBlockReason(), null, 'Start armed after both clamps closed')
  assert.equal(getProductionQueueSnapshot().queueDepth, 0, 'live close must not enqueue')
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))
  db.close()
})

test('both Start: full sequence skips close_clamps then runs lever/pp/open', async () => {
  const db = createDb()
  wireEnv(db)
  process.env.CLAMP_TRIGGER_MODE = 'both'
  const ecm = makeClampEcm({ right: 1, left: 1 })

  await refreshClampTriggerEnqueueGate(ecm)
  assert.equal(getProductionEnqueueBlockReason(), null)
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  ecm.writes.length = 0

  beginProductionJob('test-clamp-both-full', 'hmi')
  try {
    const result = await executeProductionSequence(ecm, { requireButton: false, source: 'hmi' })
    assert.equal(result.ok, true)

    const names = result.phases.map((p) => p.phase)
    assert.ok(names.includes('close_clamps_skipped'))
    assert.ok(!names.includes('close_clamps'))
    assert.ok(names.includes('lever_up'))
    assert.ok(names.includes('pp_clamp_close'))
    assert.ok(names.includes('open_clamps'))
    assert.ok(names.includes('lever_down'))
    assert.ok(names.includes('complete') || names.includes('pick_place_skipped') || names.includes('centring_skipped'))

    const skipped = result.phases.find((p) => p.phase === 'close_clamps_skipped')
    assert.match(String(skipped?.reason || ''), /already closed/i)

    // Cycle must not re-close clamps; open_clamps opens both.
    const clampCloses = ecm.writes.filter(
      (w) => (w.pin === DO.CLAMP_RIGHT || w.pin === DO.CLAMP_LEFT) && w.value === 1,
    )
    assert.equal(clampCloses.length, 0)
    assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0))
    assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 0))
    assert.ok(ecm.writes.some((w) => w.pin === DO.LEVER_UP && w.value === 1))
    assert.ok(ecm.writes.some((w) => w.pin === DO.PP_CLAMP && w.value === 1))
  } finally {
    finishProductionJob({ failed: false })
  }
  db.close()
})

test('close_clamps both mode is skipped — clamps already closed before Start', async () => {
  const db = createDb()
  wireEnv(db)
  process.env.CLAMP_TRIGGER_MODE = 'both'
  const ecm = makeClampEcm({ right: 1, left: 1 })

  // Live-close while RUN so Start gate (_satisfied) is met before PRECHECK.
  await refreshClampTriggerEnqueueGate(ecm)
  assert.equal(getProductionEnqueueBlockReason(), null)

  beginProductionJob('test-clamp-both', 'hmi')
  try {
    const ctx = await prepareProductionRun(ecm, { requireButton: false, source: 'hmi' })
    const phases = []
    const state = { centring: null, moveToPick: null, moveToBackoff: null }
    const steps = buildProductionSteps(ecm, ctx, phases, state)
    const close = steps.find((s) => s.name === 'close_clamps')
    const skipped = steps.find((s) => s.name === 'close_clamps_skipped')
    assert.equal(close, undefined)
    assert.ok(skipped)
    await skipped.run()

    const phase = phases.find((p) => p.phase === 'close_clamps_skipped')
    assert.ok(phase)
    assert.match(String(phase?.reason || ''), /already closed/i)
    // No new clamp close writes from the skipped step
    const closeWrites = ecm.writes.filter(
      (w) => (w.pin === DO.CLAMP_RIGHT || w.pin === DO.CLAMP_LEFT) && w.value === 1,
    )
    // refresh may have closed before the job; skipped step must not add more closes
    const writesBeforeSkip = closeWrites.length
    await skipped.run()
    const closeWritesAfter = ecm.writes.filter(
      (w) => (w.pin === DO.CLAMP_RIGHT || w.pin === DO.CLAMP_LEFT) && w.value === 1,
    )
    assert.equal(closeWritesAfter.length, writesBeforeSkip)
  } finally {
    finishProductionJob({ failed: false })
  }
  db.close()
})

test('prepareProductionRun both mode still requires both DIs before Start', async () => {
  const db = createDb()
  wireEnv(db)
  process.env.CLAMP_TRIGGER_MODE = 'both'
  const ecm = makeClampEcm({ right: 1, left: 0 })

  await assert.rejects(
    () => prepareProductionRun(ecm, { requireButton: false, source: 'hmi' }),
    /Place the cable on the clamps/i,
  )
  db.close()
})

test('executeProductionSequence di10 closes left only', async () => {
  const db = createDb()
  wireEnv(db)
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  const ecm = makeClampEcm({ right: 1, left: 0 })

  await refreshClampTriggerEnqueueGate(ecm)
  ecm.writes.length = 0
  beginProductionJob('test-clamp-di10-seq', 'hmi')
  try {
    const result = await executeProductionSequence(ecm, { requireButton: false, source: 'hmi' })
    assert.equal(result.ok, true)
    const closePhase = result.phases.find((p) => p.phase === 'close_clamps')
    assert.deepEqual(closePhase?.outputs, { clampLeft: true })
    assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))
    // Sequence must not write right close in di10 mode (live monitor would, but sequence step does not).
    const rightCloses = ecm.writes.filter((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1)
    assert.equal(rightCloses.length, 0)
  } finally {
    finishProductionJob({ failed: false })
  }
  db.close()
})
