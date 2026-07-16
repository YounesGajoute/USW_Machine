import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  areConfiguredDoorsClosed,
  getAuxSafetyStatesCached,
  getDoorSnapshot,
  initDoorInterlock,
  isAirPressureOkCached,
  isBlockingDoorOpenCached,
  isDoorInterlockModel,
  isEmergencyOkCached,
  readAuxSafetyInputs,
  setPnozArmed,
  startDoorMonitor,
  stopDoorMonitor,
  syncPnozChannel2,
  __setSafetyRootCauseForTest,
} from './doorInterlock.mjs'
import { DI, DO } from './ethercat.mjs'
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

test('ESTOP_CH2_RELEASE_HIGH=1: release writes DO6=1 (CH2 active), assert writes DO6=0', async () => {
  process.env.ESTOP_CH2_RELEASE_HIGH = '1'
  try {
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
    assert.deepEqual(writes, [{ pin: 6, val: 1 }], 'CH2 active → DO6=1')
    assert.equal(getDoorSnapshot().do6Asserted, false)

    writes.length = 0
    const ecmOpen = {
      isInitialized: true,
      async getAllInputs() {
        return { status: 'ok', inputs: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0] }
      },
      async setOutput(pin, val) {
        writes.push({ pin, val })
        return { status: 'ok' }
      },
    }
    await syncPnozChannel2(ecmOpen)
    assert.deepEqual(writes, [{ pin: 6, val: 0 }], 'CH2 emergency → DO6=0')
    assert.equal(getDoorSnapshot().do6Asserted, true)
  } finally {
    delete process.env.ESTOP_CH2_RELEASE_HIGH
  }
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

test('POWER_OFF holds DO6 at CH2 emergency even with doors closed', async () => {
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'test power off' })
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
  assert.equal(getDoorSnapshot().do6Asserted, true)
  assert.ok(writes.some((w) => w.pin === 6 && w.val === 1))
  // DO6 must not be released while powered off, even though the doors are closed.
  const lastDo6 = writes.filter((w) => w.pin === 6).at(-1)
  assert.deepEqual(lastDo6, { pin: 6, val: 1 })
})

test('DO6 policy per lifecycle state: released (0) when energized, asserted (1) when de-energized', async () => {
  // Energized states must release DO6 (PNOZ Channel 2 active); de-energized states hold
  // it in emergency (drive power cut). Back door closed, E-stop released throughout.
  const energized = [
    LIFECYCLE_STATE.INIT,
    LIFECYCLE_STATE.IDLE,
    LIFECYCLE_STATE.PRECHECK,
    LIFECYCLE_STATE.CYCLE_START,
    LIFECYCLE_STATE.RUN,
    LIFECYCLE_STATE.COMPLETE,
    LIFECYCLE_STATE.RESET,
  ]
  for (const state of energized) {
    forceState(state, { reason: 'test DO6 policy' })
    const inputs = Array(16).fill(0)
    inputs[DI.ESTOP_BUTTON] = 1 // released
    const ecm = mockEcm(inputs)
    startDoorMonitor(ecm)
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(getDoorSnapshot().do6Asserted, false, `${state} should release DO6`)
    stopDoorMonitor()
  }

  for (const state of [LIFECYCLE_STATE.POWER_OFF, LIFECYCLE_STATE.SAFETY_LOCKOUT]) {
    forceState(state, { reason: 'test DO6 policy' })
    const inputs = Array(16).fill(0)
    inputs[DI.ESTOP_BUTTON] = 1 // released (POWER_OFF still holds DO6; lockout too until recover)
    const ecm = mockEcm(inputs)
    startDoorMonitor(ecm)
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(getDoorSnapshot().do6Asserted, true, `${state} should assert DO6`)
    stopDoorMonitor()
  }
})

test('monitor caches DI8 air pressure and DI15 emergency inputs', async () => {
  const inputs = Array(16).fill(0)
  inputs[8] = 1 // DI8 AIR_PRESSURE ok
  inputs[DI.ESTOP_BUTTON] = 1 // DI15 ESTOP_BUTTON released
  const ecm = mockEcm(inputs)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(isAirPressureOkCached(), true)
  assert.equal(isEmergencyOkCached(), true)
  const snap = getDoorSnapshot()
  assert.equal(snap.airPressureOk, true)
  assert.equal(snap.emergencyOk, true)
})

test('readAuxSafetyInputs reflects DI8=0 (air low) and DI15=0 (estop pressed)', async () => {
  const ecm = mockEcm(Array(16).fill(0))
  const aux = await readAuxSafetyInputs(ecm)
  assert.deepEqual(aux, { airPressureOk: false, emergencyOk: false })
  assert.deepEqual(getAuxSafetyStatesCached(), { airPressureOk: false, emergencyOk: false })
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

test('POWER_OFF DO6 assert: DI3 glitch during settle does not false-trip Emergency', async () => {
  process.env.DOOR_CH1_SETTLE_MS = '400'
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'test power off' })
  const inputs = Array(16).fill(0)
  inputs[DI.AIR_PRESSURE] = 1
  inputs[DI.ESTOP_BUTTON] = 1 // released
  const ecm = mockEcm(inputs)
  startDoorMonitor(ecm)
  // sync releases DO6 then first poll asserts it for POWER_OFF — opens CH1 settle window
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(getDoorSnapshot().do6Asserted, true)
  // Glitch DI3 high then low inside settle window (observed on cold-boot CH2 write)
  inputs[DI.PNOZ_FEEDBACK] = 1
  await new Promise((r) => setTimeout(r, 40))
  inputs[DI.PNOZ_FEEDBACK] = 0
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.POWER_OFF)
  assert.equal(getDoorSnapshot().safetyRootCause, null)
  delete process.env.DOOR_CH1_SETTLE_MS
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

test('evo500: back door already open at monitor start trips SAFETY_LOCKOUT (state-based)', async () => {
  const inputs = Array(16).fill(0)
  inputs[DI.DOOR_BACK] = 1 // back door open at start; model = evo500 (beforeEach)
  const ecm = mockEcm(inputs)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  assert.equal(getDoorSnapshot().safetyRootCause?.primary, 'DOOR_BACK')
  assert.equal(getDoorSnapshot().do6Asserted, true)
})

test('CS19: back door open is ignored — no lockout, DO6 not held for it', async () => {
  initDoorInterlock({ readSystemSettings: () => ({ machine_model: 'STCS-CS19' }) })
  const inputs = Array(16).fill(0)
  inputs[DI.DOOR_BACK] = 1 // back door open — does not matter on CS19
  const ecm = mockEcm(inputs)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  assert.equal(getDoorSnapshot().safetyRootCause, null)
  assert.equal(getDoorSnapshot().do6Asserted, false)
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

test('SAFETY_LOCKOUT auto-exits to POWER_OFF when E-stop released + doors closed', async () => {
  forceState(LIFECYCLE_STATE.SAFETY_LOCKOUT, { reason: 'test' })
  // Doors closed, DI3 still low (PNOZ not re-armed), DI15 released.
  const inputs = Array(16).fill(0)
  inputs[DI.ESTOP_BUTTON] = 1
  const ecm = mockEcm(inputs)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.POWER_OFF)
  assert.equal(getDoorSnapshot().safetyRootCause, null)
})

test('SAFETY_LOCKOUT stays locked while E-stop still pressed (DI15=0)', async () => {
  forceState(LIFECYCLE_STATE.SAFETY_LOCKOUT, { reason: 'test' })
  const inputs = Array(16).fill(0) // DI15 = 0 (E-stop pressed), doors closed
  const ecm = mockEcm(inputs)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
})

test('SAFETY_LOCKOUT de-energizes: DO5 (main air) OFF and DO6 (ESTOP_CH2) ON', async () => {
  forceState(LIFECYCLE_STATE.SAFETY_LOCKOUT, { reason: 'test' })
  const writes = []
  const inputs = Array(16).fill(0) // E-stop pressed (DI15=0) → stays locked out
  const ecm = {
    isInitialized: true,
    async getAllInputs() {
      return { status: 'ok', inputs }
    },
    async setOutput(pin, val) {
      writes.push({ pin, val })
      return { status: 'ok' }
    },
  }
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  assert.equal(getDoorSnapshot().do6Asserted, true)
  assert.ok(writes.some((w) => w.pin === DO.ESTOP_CH2 && w.val === 1), 'DO6 ESTOP_CH2 ON')
  assert.ok(writes.some((w) => w.pin === DO.MAIN_AIR && w.val === 0), 'DO5 MAIN_AIR OFF')
})

test('ERROR keeps DO5 MAIN_AIR ON (drive CH2 still cut via DO6)', async () => {
  forceState(LIFECYCLE_STATE.ERROR, { reason: 'test error main air' })
  const writes = []
  const inputs = Array(16).fill(0)
  inputs[DI.ESTOP_BUTTON] = 1
  const ecm = {
    isInitialized: true,
    async getAllInputs() {
      return { status: 'ok', inputs }
    },
    async setOutput(pin, val) {
      writes.push({ pin, val })
      return { status: 'ok' }
    },
  }
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  assert.ok(writes.some((w) => w.pin === DO.MAIN_AIR && w.val === 1), 'DO5 MAIN_AIR ON in ERROR')
  assert.ok(!writes.some((w) => w.pin === DO.MAIN_AIR && w.val === 0), 'DO5 not cut in ERROR')
  assert.equal(getDoorSnapshot().do6Asserted, true, 'DO6 still asserted in ERROR')
})

test('IDLE energizes: DO5 MAIN_AIR ON', async () => {
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test idle main air' })
  const writes = []
  const inputs = Array(16).fill(0)
  inputs[DI.ESTOP_BUTTON] = 1
  inputs[DI.PNOZ_FEEDBACK] = 1
  const ecm = {
    isInitialized: true,
    async getAllInputs() {
      return { status: 'ok', inputs }
    },
    async setOutput(pin, val) {
      writes.push({ pin, val })
      return { status: 'ok' }
    },
  }
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  assert.ok(writes.some((w) => w.pin === DO.MAIN_AIR && w.val === 1), 'DO5 MAIN_AIR ON in IDLE')
  assert.ok(!writes.some((w) => w.pin === DO.MAIN_AIR && w.val === 0), 'DO5 not cut in IDLE')
})

test('MAIN_AIR stays ON across IDLE → CYCLE_START → IDLE', async () => {
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test cycle main air' })
  const writes = []
  const inputs = Array(16).fill(0)
  inputs[DI.ESTOP_BUTTON] = 1
  inputs[DI.PNOZ_FEEDBACK] = 1
  const ecm = {
    isInitialized: true,
    async getAllInputs() {
      return { status: 'ok', inputs }
    },
    async setOutput(pin, val) {
      writes.push({ pin, val })
      return { status: 'ok' }
    },
  }
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 60))
  forceState(LIFECYCLE_STATE.CYCLE_START, { reason: 'test cycle' })
  await new Promise((r) => setTimeout(r, 60))
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test return idle' })
  await new Promise((r) => setTimeout(r, 60))
  const mainAirWrites = writes.filter((w) => w.pin === DO.MAIN_AIR)
  assert.ok(mainAirWrites.length >= 1, 'MAIN_AIR commanded at least once')
  assert.equal(mainAirWrites[0].val, 1, 'first MAIN_AIR write is ON')
  assert.ok(
    mainAirWrites.every((w) => w.val === 1),
    'MAIN_AIR never cut during IDLE / CYCLE_START / return IDLE',
  )
})

test('POWER_OFF → IDLE re-asserts DO5 MAIN_AIR ON', async () => {
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'test power off' })
  const writes = []
  const inputs = Array(16).fill(0)
  inputs[DI.ESTOP_BUTTON] = 1
  const ecm = {
    isInitialized: true,
    async getAllInputs() {
      return { status: 'ok', inputs }
    },
    async setOutput(pin, val) {
      writes.push({ pin, val })
      return { status: 'ok' }
    },
  }
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 60))
  assert.ok(writes.some((w) => w.pin === DO.MAIN_AIR && w.val === 0), 'cut in POWER_OFF')
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test leave power off' })
  await new Promise((r) => setTimeout(r, 80))
  const lastMainAir = [...writes].reverse().find((w) => w.pin === DO.MAIN_AIR)
  assert.ok(lastMainAir, 'MAIN_AIR written after leaving POWER_OFF')
  assert.equal(lastMainAir.val, 1, 'MAIN_AIR ON when entering IDLE')
})

test('SAFETY_LOCKOUT stays locked while a right door is open even if E-stop released', async () => {
  forceState(LIFECYCLE_STATE.SAFETY_LOCKOUT, { reason: 'test' })
  const inputs = Array(16).fill(0)
  inputs[DI.ESTOP_BUTTON] = 1 // released
  inputs[DI.DOOR_RIGHT_1] = 1 // still open
  const ecm = mockEcm(inputs)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
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

// ── STCS-CS19 mode: back door OPEN is normal; only right doors (CH1) are enforced ──

/** Re-wire the interlock to report the CS19 model for the current test. */
function useCs19Model() {
  initDoorInterlock({ readSystemSettings: () => ({ machine_model: 'STCS-CS19' }) })
}

test('STCS-CS19: not a door-interlock model and back door excluded from areConfiguredDoorsClosed', () => {
  useCs19Model()
  assert.equal(isDoorInterlockModel(), false)
  // Back door open is the normal CS19 operating state — must still count as "closed".
  assert.equal(areConfiguredDoorsClosed({ right1: false, right2: false, back: true }), true)
  // Right doors are always enforced (PNOZ Channel 1 hardware).
  assert.equal(areConfiguredDoorsClosed({ right1: true, right2: false, back: true }), false)
  assert.equal(areConfiguredDoorsClosed({ right1: false, right2: true, back: false }), false)
})

test('STCS-CS19: back door open never asserts DO6 (syncPnozChannel2 keeps CH2 active)', async () => {
  useCs19Model()
  const writes = []
  const inputs = Array(16).fill(0)
  inputs[DI.DOOR_BACK] = 1 // back door open — normal for CS19
  const ecm = {
    isInitialized: true,
    async getAllInputs() {
      return { status: 'ok', inputs }
    },
    async setOutput(pin, val) {
      writes.push({ pin, val })
      return { status: 'ok' }
    },
  }
  await syncPnozChannel2(ecm)
  assert.deepEqual(writes, [{ pin: DO.ESTOP_CH2, val: 0 }])
  const snap = getDoorSnapshot()
  assert.equal(snap.do6Asserted, false)
  assert.equal(snap.doorInterlockModel, false)
  assert.equal(snap.blockingDoorOpen, false)
})

test('STCS-CS19: back door open at boot — no lockout, not blocking', async () => {
  useCs19Model()
  const inputs = Array(16).fill(0)
  inputs[DI.DOOR_BACK] = 1 // back open (normal); DI3=0 at boot (not armed)
  const ecm = mockEcm(inputs)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  assert.equal(isBlockingDoorOpenCached(), false)
  const snap = getDoorSnapshot()
  assert.equal(snap.doorBackOpen, true)
  assert.equal(snap.blockingDoorOpen, false)
  assert.equal(snap.safetyRootCause, null)
})

test('STCS-CS19: right-door CH1 trip still locks out (back open does not confuse attribution)', async () => {
  useCs19Model()
  const inputs = Array(16).fill(0)
  inputs[DI.PNOZ_FEEDBACK] = 1 // armed
  inputs[DI.DOOR_RIGHT_1] = 1 // right door open
  inputs[DI.DOOR_BACK] = 1 // back open — normal CS19 state
  const ecm = mockEcm(inputs)
  setPnozArmed(true)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 50))
  inputs[DI.PNOZ_FEEDBACK] = 0 // PNOZ trips
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  assert.equal(getDoorSnapshot().safetyRootCause?.primary, 'DOOR_RIGHT_1')
})

test('STCS-CS19: CH1 trip with back open + right doors closed infers EMERGENCY_STOP', async () => {
  useCs19Model()
  const inputs = Array(16).fill(0)
  inputs[DI.PNOZ_FEEDBACK] = 1 // armed
  inputs[DI.DOOR_BACK] = 1 // back open — ignored on CS19, so E-stop is the only explanation
  const ecm = mockEcm(inputs)
  setPnozArmed(true)
  startDoorMonitor(ecm)
  await new Promise((r) => setTimeout(r, 50))
  inputs[DI.PNOZ_FEEDBACK] = 0 // PNOZ trips with all configured doors closed
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  assert.equal(getDoorSnapshot().safetyRootCause?.primary, 'EMERGENCY_STOP')
})
