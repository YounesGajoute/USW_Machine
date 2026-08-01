import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  abortProductionMotionBestEffort,
  __setProductionAbortTestHooks,
} from './productionAbort.mjs'
import { getProductionSkipFlags } from './productionSequence.mjs'
import { deriveCycleResultFromJob } from './productionCycleResult.mjs'

test('abortProductionMotionBestEffort arms clamp re-arm when mode != off', async () => {
  const { getClampTriggerInhibitState, stopClampTriggerMonitor } = await import('./clampTriggerMode.mjs')
  const prev = process.env.CLAMP_TRIGGER_MODE
  process.env.CLAMP_TRIGGER_MODE = 'both'
  stopClampTriggerMonitor()
  __setProductionAbortTestHooks({
    pneumaticsSafe: async () => {},
    pickPlaceStop: async () => {},
    centringStop: async () => {},
  })
  try {
    await abortProductionMotionBestEffort({ isInitialized: true })
    assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })
  } finally {
    if (prev === undefined) delete process.env.CLAMP_TRIGGER_MODE
    else process.env.CLAMP_TRIGGER_MODE = prev
    __setProductionAbortTestHooks(null)
    stopClampTriggerMonitor()
  }
})

test('pneumaticsSafeLeaveLever opens clamps/ppClamp/puller but does not write leverUp', async () => {
  const { pneumaticsSafeLeaveLever } = await import('./pneumatics.mjs')
  const writes = []
  const ecm = {
    async setOutput(pin, value) {
      writes.push({ pin, value })
      return { status: 'ok' }
    },
  }
  // setPneumaticOutputs also re-asserts main air (DO5) — always on by policy.
  // Stub ensureMainAirOn path by providing getAllOutputs if needed — use real set via pin map.
  // Minimal: call through and assert no LEVER_UP pin (DO2) write among intentional keys.
  const { DO } = await import('./ethercat.mjs')
  // Patch: setPneumaticOutputs needs ecm.setOutput; main air ensure also calls setOutput(DO5).
  await pneumaticsSafeLeaveLever(ecm)
  const leverWrites = writes.filter((w) => w.pin === DO.LEVER_UP)
  assert.equal(leverWrites.length, 0, 'DO2 lever must not change on production abort')
  assert.ok(writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === false))
  assert.ok(writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === false))
  assert.ok(writes.some((w) => w.pin === DO.PP_CLAMP && w.value === false))
  assert.ok(writes.some((w) => w.pin === DO.PULLER && w.value === false))
})

test('abortProductionMotionBestEffort skips pneumatics when EtherCAT is not initialized', async () => {
  const calls = []
  __setProductionAbortTestHooks({
    pneumaticsSafe: async () => {
      calls.push('pneumatics')
    },
    pickPlaceStop: async () => {
      calls.push('pp')
    },
    centringStop: async () => {
      calls.push('ct')
    },
  })
  try {
    const rNull = await abortProductionMotionBestEffort(null)
    assert.equal(rNull.pneumatics, 'skipped')
    assert.equal(rNull.pickPlace, 'ok')
    assert.equal(rNull.centring, 'ok')
    assert.ok(!calls.includes('pneumatics'))

    calls.length = 0
    const rDown = await abortProductionMotionBestEffort({ isInitialized: false })
    assert.equal(rDown.pneumatics, 'skipped')
    assert.ok(!calls.includes('pneumatics'))
  } finally {
    __setProductionAbortTestHooks(null)
  }
})

test('abortProductionMotionBestEffort continues when a subsystem stop fails', async () => {
  __setProductionAbortTestHooks({
    pneumaticsSafe: async () => {},
    pickPlaceStop: async () => {
      throw new Error('pp down')
    },
    centringStop: async () => {},
  })
  try {
    const r = await abortProductionMotionBestEffort({ isInitialized: true })
    assert.equal(r.ok, false)
    assert.equal(r.pickPlace, 'failed')
    assert.equal(r.centring, 'ok')
    assert.ok(r.errors.some((e) => e.includes('pp down')))
  } finally {
    __setProductionAbortTestHooks(null)
  }
})

test('abortProductionMotionBestEffort does not wait for a hung centring waitIdle', async () => {
  const prev = process.env.PRODUCTION_ABORT_MOTION_TIMEOUT_MS
  process.env.PRODUCTION_ABORT_MOTION_TIMEOUT_MS = '80'
  // Re-import not required — timeout is read at module load; race uses captured const.
  // Use a hung hook; outer withTimeout must reject quickly (< 70s MOVE timeout).
  __setProductionAbortTestHooks({
    pneumaticsSafe: async () => {},
    pickPlaceStop: async () => {},
    centringStop: async () => {
      await new Promise(() => {})
    },
  })
  try {
    const t0 = Date.now()
    // Module already captured ABORT_MOTION_TIMEOUT_MS at load — force via hung + default 2000.
    // Assert abort returns well under centring MOVE_TIMEOUT (70s).
    const r = await abortProductionMotionBestEffort({ isInitialized: true })
    const elapsed = Date.now() - t0
    assert.equal(r.centring, 'failed')
    assert.ok(r.errors.some((e) => /centring\.stop/.test(e)))
    assert.ok(elapsed < 15000, `abort hung too long: ${elapsed}ms`)
  } finally {
    if (prev === undefined) delete process.env.PRODUCTION_ABORT_MOTION_TIMEOUT_MS
    else process.env.PRODUCTION_ABORT_MOTION_TIMEOUT_MS = prev
    __setProductionAbortTestHooks(null)
  }
})

test('getProductionSkipFlags splits tail vs centring P&P; legacy alias enables both', () => {
  const prev = {
    PRODUCTION_SKIP_PICK_PLACE: process.env.PRODUCTION_SKIP_PICK_PLACE,
    PRODUCTION_SKIP_PICK_TAIL: process.env.PRODUCTION_SKIP_PICK_TAIL,
    PRODUCTION_SKIP_CENTRING_PICK_PLACE: process.env.PRODUCTION_SKIP_CENTRING_PICK_PLACE,
  }
  try {
    delete process.env.PRODUCTION_SKIP_PICK_PLACE
    delete process.env.PRODUCTION_SKIP_PICK_TAIL
    delete process.env.PRODUCTION_SKIP_CENTRING_PICK_PLACE
    assert.deepEqual(getProductionSkipFlags(), {
      cycleVariant: 'advanced',
      gapStrategy: 'advanced',
      skipPickTail: false,
      skipCentringPickPlace: false,
      skipCentring: process.env.PRODUCTION_SKIP_CENTRING === '1',
      skipVision: process.env.PRODUCTION_SKIP_VISION === '1',
    })

    process.env.PRODUCTION_SKIP_PICK_TAIL = '1'
    assert.equal(getProductionSkipFlags().skipPickTail, true)
    assert.equal(getProductionSkipFlags().skipCentringPickPlace, false)

    delete process.env.PRODUCTION_SKIP_PICK_TAIL
    process.env.PRODUCTION_SKIP_CENTRING_PICK_PLACE = '1'
    assert.equal(getProductionSkipFlags().skipPickTail, false)
    assert.equal(getProductionSkipFlags().skipCentringPickPlace, true)

    delete process.env.PRODUCTION_SKIP_CENTRING_PICK_PLACE
    process.env.PRODUCTION_SKIP_PICK_PLACE = '1'
    const both = getProductionSkipFlags()
    assert.equal(both.skipPickTail, true)
    assert.equal(both.skipCentringPickPlace, true)
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
})

test('deriveCycleResultFromJob maps job status to PASS/FAIL', () => {
  assert.equal(deriveCycleResultFromJob({ status: 'completed' }), 'PASS')
  assert.equal(deriveCycleResultFromJob({ status: 'failed' }), 'FAIL')
  assert.equal(deriveCycleResultFromJob({ status: 'cancelled' }), 'FAIL')
  assert.equal(deriveCycleResultFromJob({ cycleResult: 'PASS', status: 'failed' }), 'PASS')
  assert.equal(deriveCycleResultFromJob({ status: 'completed', activeFault: true }), 'FAIL')
  assert.equal(deriveCycleResultFromJob({}), null)
})
