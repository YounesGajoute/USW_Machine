import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  areConfiguredDoorsClosed,
  getDoorSnapshot,
  initDoorInterlock,
  setPnozArmed,
  startDoorMonitor,
  stopDoorMonitor,
  syncPnozChannel2,
  __setSafetyRootCauseForTest,
} from './doorInterlock.mjs'
import { setPnozResetSuppress, isPnozResetSuppressing } from './safetyRelay.mjs'
import { getLifecycleState, LIFECYCLE_STATE, forceState, onEtherCATConnected, enterSafetyLockout } from './machineLifecycle.mjs'

function mockEcm(inputs) {
  return {
    isInitialized: true,
    async getAllInputs() {
      return { status: 'ok', inputs }
    },
    async setOutput() {
      return { status: 'ok' }
    },
  }
}

beforeEach(() => {
  process.env.DOOR_INTERLOCK_DISABLE = '0'
  process.env.DOOR_INTERLOCK_POLL_MS = '20'
  initDoorInterlock({ readSystemSettings: () => ({ machine_model: 'STCS-evo500' }) })
  onEtherCATConnected()
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test reset' })
})

afterEach(() => {
  stopDoorMonitor()
  setPnozResetSuppress(false)
})

test('syncPnozChannel2 releases DO6 when back door closed (CH2 active)', async () => {
  const writes = []
  const ecm = {
    isInitialized: true,
    async getAllInputs() {
      return { status: 'ok', inputs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
    },
    async setOutput(pin, val) {
      writes.push({ pin, val })
      return { status: 'ok' }
    },
  }
  await syncPnozChannel2(ecm)
  assert.deepEqual(writes, [{ pin: 6, val: 0 }])
  assert.equal(getDoorSnapshot().do6Asserted, false)
})

test('syncPnozChannel2 asserts DO6 when back door open on evo500 (CH2 emergency)', async () => {
  const writes = []
  const ecm = {
    isInitialized: true,
    async getAllInputs() {
      return { status: 'ok', inputs: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0] }
    },
    async setOutput(pin, val) {
      writes.push({ pin, val })
      return { status: 'ok' }
    },
  }
  await syncPnozChannel2(ecm)
  assert.deepEqual(writes, [{ pin: 6, val: 1 }])
  assert.equal(getDoorSnapshot().do6Asserted, true)
})

test('startDoorMonitor activates PNOZ CH2 on connect when back door closed', async () => {
  const writes = []
  const ecm = {
    isInitialized: true,
    async getAllInputs() {
      return { status: 'ok', inputs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
    },
    async setOutput(pin, val) {
      writes.push({ pin, val })
      return { status: 'ok' }
    },
  }
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.ok(writes.some((w) => w.pin === 6 && w.val === 0))
})

test('areConfiguredDoorsClosed respects evo500 back door', () => {
  assert.equal(areConfiguredDoorsClosed({ right1: false, right2: false, back: false }), true)
  assert.equal(areConfiguredDoorsClosed({ right1: true, right2: false, back: false }), false)
  assert.equal(areConfiguredDoorsClosed({ right1: false, right2: false, back: true }), false)
})

test('cold boot: DI3=0 at connect does not infer E-stop or lockout', async () => {
  // PNOZ not yet in release — normal after power-up / before init reset
  const ecm = mockEcm([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  const snap = getDoorSnapshot()
  assert.equal(snap.safetyRootCause, null)
  assert.equal(snap.pnozArmed, false)
})

test('cold boot: DI3=1 at connect arms edge detection without lockout', async () => {
  const ecm = mockEcm([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  assert.equal(getDoorSnapshot().pnozArmed, true)
})

test('live release→trip with doors closed infers EMERGENCY_STOP', async () => {
  const inputs = [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const ecm = mockEcm(inputs)
  setPnozArmed(true)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  inputs[3] = 0
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  assert.equal(getDoorSnapshot().safetyRootCause?.primary, 'EMERGENCY_STOP')
})

test('live release→trip with right door open infers door cause not E-stop', async () => {
  const inputs = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const ecm = mockEcm(inputs)
  setPnozArmed(true)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 50))
  inputs[3] = 0
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  assert.equal(getDoorSnapshot().safetyRootCause?.primary, 'DOOR_RIGHT_1')
})

test('isPnozResetSuppressing prevents trip during DO9 reset window', async () => {
  const inputs = [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const ecm = mockEcm(inputs)
  setPnozArmed(true)
  setPnozResetSuppress(true)
  startDoorMonitor(ecm)
  inputs[3] = 0
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  assert.equal(isPnozResetSuppressing(), true)
})

test('pnozCircuitRestored while locked out and DI3 confirms', async () => {
  forceState(LIFECYCLE_STATE.SAFETY_LOCKOUT, { reason: 'test' })
  const inputs = [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const ecm = mockEcm(inputs)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  const snap = getDoorSnapshot()
  assert.equal(snap.pnozCircuitRestored, true)
  assert.equal(snap.pnozFeedbackRaw, true)
  assert.equal(snap.pnozConfirmed, true)
  assert.equal(snap.pnozInRelease, true)
})

test('startDoorMonitor during lockout preserves safety root cause', async () => {
  const rootCause = {
    codes: ['DOOR_RIGHT_2'],
    primary: 'DOOR_RIGHT_2',
    doorStates: { right1: false, right2: true, back: false },
    source: 'CH1',
    at: Date.now(),
  }
  enterSafetyLockout('Emergency: Right-side door 2', rootCause)
  const inputs = [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const ecm = mockEcm(inputs)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getDoorSnapshot().safetyRootCause?.primary, 'DOOR_RIGHT_2')
})

test('startDoorMonitor rehydrates root cause from lifecycle when door latch was wiped', async () => {
  const rootCause = {
    codes: ['DOOR_RIGHT_2'],
    primary: 'DOOR_RIGHT_2',
    doorStates: { right1: false, right2: true, back: false },
    source: 'CH1',
    at: Date.now(),
  }
  enterSafetyLockout('Emergency: Right-side door 2', rootCause)
  __setSafetyRootCauseForTest(null)
  const inputs = [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const ecm = mockEcm(inputs)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getDoorSnapshot().safetyRootCause?.primary, 'DOOR_RIGHT_2')
})

test('CH1 trip attributes brief door open via peak latch', async () => {
  const inputs = [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const ecm = mockEcm(inputs)
  setPnozArmed(true)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 50))
  inputs[5] = 1
  await new Promise((r) => setTimeout(r, 80))
  inputs[5] = 0
  inputs[3] = 0
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  assert.equal(getDoorSnapshot().safetyRootCause?.primary, 'DOOR_RIGHT_2')
})
