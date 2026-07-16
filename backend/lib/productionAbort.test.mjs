import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  abortProductionMotionBestEffort,
  __setProductionAbortTestHooks,
} from './productionAbort.mjs'
import { getProductionSkipFlags } from './productionSequence.mjs'
import { deriveCycleResultFromJob } from './productionCycleResult.mjs'

test('abortProductionMotionBestEffort safes pneumatics and stops both subsystems', async () => {
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
    const ecm = { isInitialized: true }
    const r = await abortProductionMotionBestEffort(ecm)
    assert.equal(r.ok, true)
    assert.equal(r.pneumatics, 'ok')
    assert.equal(r.pickPlace, 'ok')
    assert.equal(r.centring, 'ok')
    assert.deepEqual(calls.sort(), ['ct', 'pneumatics', 'pp'])
  } finally {
    __setProductionAbortTestHooks(null)
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
  // setPneumaticOutputs also re-asserts main air (DO5) unless allowMainAirOff.
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
