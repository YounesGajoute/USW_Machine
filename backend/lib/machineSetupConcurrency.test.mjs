import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runMachineSetup } from './machineSetup.mjs'
import { forceState, LIFECYCLE_STATE } from './machineLifecycle.mjs'
import { setSetupActive, clearSetupAbort } from './machineSetupHealth.mjs'

test('Initialization owns its lock before asynchronous preflight and releases it on failure', async () => {
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'offline concurrency regression' })
  setSetupActive(false)
  clearSetupAbort()
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true }) // suppress debug telemetry in this offline test
  let reads = 0
  const ecm = {
    get isInitialized() {
      if (++reads > 1) throw new Error('deliberate preflight failure')
      return true
    },
  }
  try {
    const first = runMachineSetup(ecm, { requireButton: false })
    const firstFailure = assert.rejects(first, /deliberate preflight failure/)
    // This call arrives while the first is yielding in preflight, before the
    // old setup-active flag was set. It must never start another setup path.
    await assert.rejects(runMachineSetup({ isInitialized: false }), /Setup already in progress/)
    await firstFailure
    await assert.rejects(runMachineSetup({ isInitialized: false }), /Machine connection lost/)
    await assert.rejects(runMachineSetup({ isInitialized: false }), /Machine connection lost/)
  } finally {
    globalThis.fetch = previousFetch
  }
})
