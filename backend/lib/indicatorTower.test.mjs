import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeTowerOutputs, buzzerOneShot } from './indicatorTower.mjs'
import { LIFECYCLE_STATE } from './machineLifecycle.mjs'

function snap(overrides = {}) {
  return {
    lifecycleState: LIFECYCLE_STATE.IDLE,
    isSafetyLockout: false,
    lastError: null,
    initInProgress: false,
    ...overrides,
  }
}

test('tower: disconnected is all off', () => {
  const out = computeTowerOutputs({ connected: false, snapshot: snap(), anyDoorOpen: false, flashOn: true })
  assert.deepEqual(out, { red: false, green: false, yellow: false, buzzer: false })
})

test('tower: POWER_OFF is all off', () => {
  const out = computeTowerOutputs({
    connected: true,
    snapshot: snap({ lifecycleState: LIFECYCLE_STATE.POWER_OFF }),
    anyDoorOpen: false,
    flashOn: true,
  })
  assert.deepEqual(out, { red: false, green: false, yellow: false, buzzer: false })
})

test('tower: SAFETY_LOCKOUT flashes red; buzzer follows the one-shot gate', () => {
  const s = snap({ lifecycleState: LIFECYCLE_STATE.SAFETY_LOCKOUT, isSafetyLockout: true })
  // Buzzer on during the one-shot window (buzzerOn = true)
  assert.deepEqual(
    computeTowerOutputs({ connected: true, snapshot: s, anyDoorOpen: false, flashOn: true, buzzerOn: true }),
    { red: true, green: false, yellow: false, buzzer: true },
  )
  // Red still flashes with the flash clock; buzzer already auto-silenced (buzzerOn = false)
  assert.deepEqual(
    computeTowerOutputs({ connected: true, snapshot: s, anyDoorOpen: false, flashOn: true, buzzerOn: false }),
    { red: true, green: false, yellow: false, buzzer: false },
  )
  assert.deepEqual(
    computeTowerOutputs({ connected: true, snapshot: s, anyDoorOpen: false, flashOn: false, buzzerOn: false }),
    { red: false, green: false, yellow: false, buzzer: false },
  )
})

test('buzzerOneShot: fires only within the duration window after lockout onset', () => {
  assert.equal(buzzerOneShot({ isLockout: true, lockoutElapsedMs: 0, durationMs: 1500 }), true)
  assert.equal(buzzerOneShot({ isLockout: true, lockoutElapsedMs: 1499, durationMs: 1500 }), true)
  assert.equal(buzzerOneShot({ isLockout: true, lockoutElapsedMs: 1500, durationMs: 1500 }), false)
  assert.equal(buzzerOneShot({ isLockout: true, lockoutElapsedMs: 5000, durationMs: 1500 }), false)
  // Not locked out → never buzzes
  assert.equal(buzzerOneShot({ isLockout: false, lockoutElapsedMs: -1, durationMs: 1500 }), false)
})

test('tower: latched fault flashes red without buzzer', () => {
  const out = computeTowerOutputs({
    connected: true,
    snapshot: snap({ lifecycleState: LIFECYCLE_STATE.IDLE, lastError: 'boom' }),
    anyDoorOpen: false,
    flashOn: true,
  })
  assert.deepEqual(out, { red: true, green: false, yellow: false, buzzer: false })
})

test('tower: door open without lockout flashes yellow', () => {
  const out = computeTowerOutputs({
    connected: true,
    snapshot: snap({ lifecycleState: LIFECYCLE_STATE.IDLE }),
    anyDoorOpen: true,
    flashOn: true,
  })
  assert.deepEqual(out, { red: false, green: false, yellow: true, buzzer: false })
})

test('tower: INIT shows steady yellow', () => {
  const out = computeTowerOutputs({
    connected: true,
    snapshot: snap({ lifecycleState: LIFECYCLE_STATE.INIT }),
    anyDoorOpen: false,
    flashOn: false,
  })
  assert.deepEqual(out, { red: false, green: false, yellow: true, buzzer: false })
})

test('tower: init in progress shows steady yellow', () => {
  const out = computeTowerOutputs({
    connected: true,
    snapshot: snap({ lifecycleState: LIFECYCLE_STATE.IDLE, initInProgress: true }),
    anyDoorOpen: false,
    flashOn: false,
  })
  assert.deepEqual(out, { red: false, green: false, yellow: true, buzzer: false })
})

test('tower: IDLE-ready shows steady green', () => {
  const out = computeTowerOutputs({
    connected: true,
    snapshot: snap({ lifecycleState: LIFECYCLE_STATE.IDLE }),
    anyDoorOpen: false,
    flashOn: false,
  })
  assert.deepEqual(out, { red: false, green: true, yellow: false, buzzer: false })
})

test('tower: production active shows steady green', () => {
  for (const st of [
    LIFECYCLE_STATE.PRECHECK,
    LIFECYCLE_STATE.CYCLE_START,
    LIFECYCLE_STATE.RUN,
    LIFECYCLE_STATE.COMPLETE,
  ]) {
    const out = computeTowerOutputs({
      connected: true,
      snapshot: snap({ lifecycleState: st }),
      anyDoorOpen: false,
      flashOn: false,
    })
    assert.deepEqual(out, { red: false, green: true, yellow: false, buzzer: false }, `state ${st}`)
  }
})

test('tower: lockout takes priority over door open', () => {
  const out = computeTowerOutputs({
    connected: true,
    snapshot: snap({ lifecycleState: LIFECYCLE_STATE.SAFETY_LOCKOUT, isSafetyLockout: true }),
    anyDoorOpen: true,
    flashOn: true,
    buzzerOn: true,
  })
  assert.deepEqual(out, { red: true, green: false, yellow: false, buzzer: true })
})
