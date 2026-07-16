import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  getPnozResetSequence,
  isPnozResetHeldHigh,
  resetPnozSafetyRelay,
  setPnozResetSuppress,
} from './safetyRelay.mjs'
import { DO, DI } from './ethercat.mjs'
import { initDoorInterlock, stopDoorMonitor, __setAuxSafetyStatesForTest } from './doorInterlock.mjs'
import { forceState, LIFECYCLE_STATE, onEtherCATConnected } from './machineLifecycle.mjs'

function mockEcm({ confirmAfterDo6Release = false } = {}) {
  const outputs = Array(16).fill(0)
  outputs[DO.ESTOP_CH2] = 1 // start asserted (CH2 emergency)
  let do9HighCount = 0
  let do9LowCount = 0
  let lastDo9RisingAt = 0
  let di3 = 0
  const writes = []

  return {
    isInitialized: true,
    writes,
    get do9HighCount() {
      return do9HighCount
    },
    get do9LowCount() {
      return do9LowCount
    },
    get outputs() {
      return outputs
    },
    async getInput(pin) {
      if (pin === DI.PNOZ_FEEDBACK) {
        if (confirmAfterDo6Release) {
          // Confirm once DO6 is released while DO9 is high (prime held-high path).
          if (outputs[DO.ESTOP_CH2] === 0 && outputs[DO.PNOZ_RESET] === 1) di3 = 1
        } else if (lastDo9RisingAt > 0 && Date.now() - lastDo9RisingAt >= 30) {
          di3 = 1
        }
        return { status: 'ok', value: di3 }
      }
      if (pin === DI.DOOR_BACK) return { status: 'ok', value: 0 }
      if (pin === DI.DOOR_RIGHT_1) return { status: 'ok', value: 0 }
      if (pin === DI.DOOR_RIGHT_2) return { status: 'ok', value: 0 }
      if (pin === DI.AIR_PRESSURE) return { status: 'ok', value: 1 }
      if (pin === DI.ESTOP_BUTTON) return { status: 'ok', value: 1 }
      return { status: 'ok', value: 0 }
    },
    async getAllInputs() {
      const inputs = Array(16).fill(0)
      inputs[DI.PNOZ_FEEDBACK] = di3
      inputs[DI.AIR_PRESSURE] = 1
      inputs[DI.ESTOP_BUTTON] = 1
      return { status: 'ok', inputs }
    },
    async setOutput(pin, val) {
      outputs[pin] = val ? 1 : 0
      writes.push({ pin, val: val ? 1 : 0 })
      if (pin === DO.PNOZ_RESET && val === 1) {
        do9HighCount += 1
        lastDo9RisingAt = Date.now()
      }
      if (pin === DO.PNOZ_RESET && !val) {
        do9LowCount += 1
      }
      return { status: 'ok' }
    },
    async getAllOutputs() {
      return { status: 'ok', outputs: [...outputs], raw: [] }
    },
  }
}

beforeEach(() => {
  process.env.PNOZ_RESET_PULSE_MS = '40'
  process.env.PNOZ_FEEDBACK_POLL_MS = '15'
  process.env.PNOZ_FEEDBACK_TIMEOUT_MS = '2000'
  delete process.env.PNOZ_RESET_SEQUENCE
  delete process.env.ESTOP_CH2_RELEASE_HIGH
  delete process.env.SAFETY_SKIP_PNOZ_RESET
  initDoorInterlock({ readSystemSettings: () => ({ machine_model: 'STCS-evo500' }) })
  onEtherCATConnected()
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test reset' })
  __setAuxSafetyStatesForTest({ airPressureOk: true, emergencyOk: true })
  setPnozResetSuppress(false)
})

afterEach(() => {
  stopDoorMonitor()
  setPnozResetSuppress(false)
  delete process.env.PNOZ_RESET_SEQUENCE
  delete process.env.PNOZ_RESET_PULSE_MS
  delete process.env.PNOZ_FEEDBACK_POLL_MS
  delete process.env.PNOZ_FEEDBACK_TIMEOUT_MS
})

test('getPnozResetSequence defaults to standard', () => {
  assert.equal(getPnozResetSequence(), 'standard')
  assert.equal(isPnozResetHeldHigh(), false)
  process.env.PNOZ_RESET_SEQUENCE = 'prime'
  assert.equal(getPnozResetSequence(), 'prime')
  assert.equal(isPnozResetHeldHigh(), true)
  process.env.PNOZ_RESET_SEQUENCE = 'RESET_FIRST'
  assert.equal(getPnozResetSequence(), 'prime')
})

test('standard sequence: release DO6 → pulse DO9 once → DI3', async () => {
  const ecm = mockEcm()
  const result = await resetPnozSafetyRelay(ecm)
  assert.equal(result.ok, true)
  assert.equal(result.sequence, 'standard')
  assert.equal(ecm.do9HighCount, 1)
  assert.ok(ecm.do9LowCount >= 1, 'standard pulses DO9 low')

  const do6Writes = ecm.writes.filter((w) => w.pin === DO.ESTOP_CH2)
  const do9High = ecm.writes.findIndex((w) => w.pin === DO.PNOZ_RESET && w.val === 1)
  const firstDo6Release = do6Writes.findIndex((w) => w.val === 0)
  assert.ok(firstDo6Release >= 0, 'DO6 released')
  // First DO6 release must occur before the arming DO9 rising edge.
  const releaseIdx = ecm.writes.findIndex((w) => w.pin === DO.ESTOP_CH2 && w.val === 0)
  assert.ok(releaseIdx < do9High, 'DO6 release before DO9 pulse')
})

test('prime sequence: hold DO9 high → release DO6 → DI3 (never pulse DO9 low)', async () => {
  process.env.PNOZ_RESET_SEQUENCE = 'prime'
  const ecm = mockEcm({ confirmAfterDo6Release: true })
  const result = await resetPnozSafetyRelay(ecm)
  assert.equal(result.ok, true)
  assert.equal(result.sequence, 'prime')
  assert.equal(result.do9HeldHigh, true)
  assert.ok(ecm.do9HighCount >= 1, 'DO9 driven high')
  assert.equal(ecm.do9LowCount, 0, 'prime must never write DO9=0')
  assert.equal(ecm.outputs[DO.PNOZ_RESET], 1, 'DO9 left high after sequence')

  const firstDo9 = ecm.writes.findIndex((w) => w.pin === DO.PNOZ_RESET && w.val === 1)
  const do6Release = ecm.writes.findIndex((w) => w.pin === DO.ESTOP_CH2 && w.val === 0)
  assert.ok(firstDo9 >= 0)
  assert.ok(do6Release > firstDo9, 'DO6 release after DO9 hold high')
  // No further DO9 low writes after the hold.
  assert.equal(
    ecm.writes.some((w) => w.pin === DO.PNOZ_RESET && w.val === 0),
    false,
  )
})
