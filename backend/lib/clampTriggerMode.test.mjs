import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  getClampTriggerMode,
  getClampTriggerStartBlockReason,
  getCloseClampsOutputs,
  getOpenClampsForReplaceOutputs,
  openClampsForReplace,
  getClampTriggerInhibitState,
  getEffectiveClampTriggerState,
  readClampTriggerState,
  applyClampTriggerLiveClose,
  canClampTriggerLiveClose,
  getCachedClampTriggerState,
  setCachedClampTriggerState,
  startClampTriggerMonitor,
  stopClampTriggerMonitor,
  isClampTriggerMonitorRunning,
} from './clampTriggerMode.mjs'
import { DI, DO } from './ethercat.mjs'
import { forceState, LIFECYCLE_STATE, onEtherCATConnected } from './machineLifecycle.mjs'

function mockEcm({ right = 0, left = 0 } = {}) {
  const outputs = Array(16).fill(0)
  const writes = []
  return {
    isInitialized: true,
    writes,
    outputs,
    async getAllInputs() {
      const inputs = Array(16).fill(0)
      inputs[DI.CLAMP_RIGHT_TRIGGER] = right
      inputs[DI.CLAMP_LEFT_TRIGGER] = left
      return { status: 'ok', inputs }
    },
    async setOutput(pin, value) {
      outputs[pin] = value ? 1 : 0
      writes.push({ pin, value: value ? 1 : 0 })
      return { status: 'ok' }
    },
  }
}

beforeEach(() => {
  delete process.env.CLAMP_TRIGGER_MODE
  delete process.env.CLAMP_TRIGGER_POLL_MS
  stopClampTriggerMonitor()
  onEtherCATConnected()
  forceState(LIFECYCLE_STATE.RUN, { reason: 'test ready' })
})

afterEach(() => {
  delete process.env.CLAMP_TRIGGER_MODE
  delete process.env.CLAMP_TRIGGER_POLL_MS
  stopClampTriggerMonitor()
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'test cleanup' })
})

test('getClampTriggerMode defaults to off and accepts aliases', () => {
  assert.equal(getClampTriggerMode(), 'off')
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  assert.equal(getClampTriggerMode(), 'di10')
  process.env.CLAMP_TRIGGER_MODE = 'DI9'
  assert.equal(getClampTriggerMode(), 'di9')
  process.env.CLAMP_TRIGGER_MODE = 'DI11'
  assert.equal(getClampTriggerMode(), 'di9')  // legacy alias
  process.env.CLAMP_TRIGGER_MODE = 'both'
  assert.equal(getClampTriggerMode(), 'both')
  process.env.CLAMP_TRIGGER_MODE = 'bogus'
  assert.equal(getClampTriggerMode(), 'off')
  process.env.CLAMP_TRIGGER_MODE = 'right'
  assert.equal(getClampTriggerMode(), 'di10')
})

test('getCloseClampsOutputs matrix', () => {
  assert.deepEqual(getCloseClampsOutputs('off'), { clampRight: true, clampLeft: true })
  assert.deepEqual(getCloseClampsOutputs('di10'), { clampLeft: true })
  assert.deepEqual(getCloseClampsOutputs('di9'), { clampRight: true })
  assert.equal(getCloseClampsOutputs('both'), null)
})

test('getClampTriggerStartBlockReason per mode', () => {
  assert.equal(getClampTriggerStartBlockReason(null, 'off'), null)
  assert.match(getClampTriggerStartBlockReason(null, 'di10'), /right clamp/i)
  assert.match(getClampTriggerStartBlockReason({ rightTriggered: false, leftTriggered: true }, 'di10'), /right clamp/i)
  assert.equal(getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: false }, 'di10'), null)
  assert.match(getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: false }, 'di9'), /left clamp/i)
  assert.match(getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: false }, 'both'), /clamps/i)
  assert.equal(getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'), null)
})

test('readClampTriggerState decodes DI10/DI9', async () => {
  const ecm = mockEcm({ right: 1, left: 0 })
  const s = await readClampTriggerState(ecm)
  assert.equal(s.rightTriggered, true)
  assert.equal(s.leftTriggered, false)
})

test('applyClampTriggerLiveClose di10 writes DO0 only', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  const ecm = mockEcm()
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'di10')
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.ok(!ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT))
})

test('applyClampTriggerLiveClose di9 writes DO1 only', async () => {
  const ecm = mockEcm()
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'di9')
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))
  assert.ok(!ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT))
})

test('applyClampTriggerLiveClose both writes DO0 and DO1', async () => {
  const ecm = mockEcm()
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'both')
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))
})

test('applyClampTriggerLiveClose off writes nothing', async () => {
  const ecm = mockEcm()
  const r = await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'off')
  assert.equal(r.wrote, false)
  assert.equal(ecm.writes.length, 0)
})

test('canClampTriggerLiveClose only in RUN', () => {
  forceState(LIFECYCLE_STATE.RUN, { reason: 'test' })
  assert.equal(canClampTriggerLiveClose(), true)
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test' })
  assert.equal(canClampTriggerLiveClose(), false)
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'test' })
  assert.equal(canClampTriggerLiveClose(), false)
  forceState(LIFECYCLE_STATE.CYCLE_START, { reason: 'test' })
  assert.equal(canClampTriggerLiveClose(), false)
})

test('applyClampTriggerLiveClose skips when not ready', async () => {
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test not ready' })
  const ecm = mockEcm()
  const r = await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'di10')
  assert.equal(r.wrote, false)
  assert.equal(r.skipped, true)
  assert.equal(ecm.writes.length, 0)
})

test('monitor di10 closes right when DI10 high and ready', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  process.env.CLAMP_TRIGGER_POLL_MS = '20'
  forceState(LIFECYCLE_STATE.RUN, { reason: 'test ready' })
  const ecm = mockEcm({ right: 1, left: 1 })
  startClampTriggerMonitor(ecm)
  assert.equal(isClampTriggerMonitorRunning(), true)
  await new Promise((r) => setTimeout(r, 60))
  stopClampTriggerMonitor()
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.ok(!ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT))
})

test('monitor does not close when not in RUN', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  process.env.CLAMP_TRIGGER_POLL_MS = '20'
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test not ready' })
  const ecm = mockEcm({ right: 1, left: 1 })
  startClampTriggerMonitor(ecm)
  await new Promise((r) => setTimeout(r, 60))
  stopClampTriggerMonitor()
  assert.equal(ecm.writes.length, 0)
})

test('monitor off writes nothing', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'off'
  process.env.CLAMP_TRIGGER_POLL_MS = '20'
  const ecm = mockEcm({ right: 1, left: 1 })
  startClampTriggerMonitor(ecm)
  await new Promise((r) => setTimeout(r, 60))
  stopClampTriggerMonitor()
  assert.equal(ecm.writes.length, 0)
})

test('readClampTriggerState updates sync cache for enqueue gate', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  const ecm = mockEcm({ right: 0, left: 0 })
  await readClampTriggerState(ecm)
  assert.deepEqual(getCachedClampTriggerState(), { rightTriggered: false, leftTriggered: false })
  assert.match(getClampTriggerStartBlockReason(getCachedClampTriggerState(), 'di10'), /right clamp/i)

  setCachedClampTriggerState({ rightTriggered: true, leftTriggered: false })
  assert.equal(getClampTriggerStartBlockReason(getCachedClampTriggerState(), 'di10'), null)
})

test('monitor refreshes cache even when not in RUN (no live close)', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  process.env.CLAMP_TRIGGER_POLL_MS = '20'
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test cache only' })
  const ecm = mockEcm({ right: 1, left: 1 })
  startClampTriggerMonitor(ecm)
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(ecm.writes.length, 0, 'must not close outside RUN')
  assert.deepEqual(getCachedClampTriggerState(), { rightTriggered: true, leftTriggered: true })
  stopClampTriggerMonitor()
})

test('getOpenClampsForReplaceOutputs matrix', () => {
  assert.equal(getOpenClampsForReplaceOutputs('off'), null)
  assert.deepEqual(getOpenClampsForReplaceOutputs('di10'), { clampRight: false })
  assert.deepEqual(getOpenClampsForReplaceOutputs('di9'), { clampLeft: false })
  assert.deepEqual(getOpenClampsForReplaceOutputs('both'), { clampRight: false, clampLeft: false })
})

test('openClampsForReplace di10 opens right and sets inhibit', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  const ecm = mockEcm()
  const r = await openClampsForReplace(ecm)
  assert.equal(r.wrote, true)
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0))
  assert.ok(!ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT))
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: false })
})

test('openClampsForReplace off is no-op', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'off'
  const ecm = mockEcm()
  const r = await openClampsForReplace(ecm)
  assert.equal(r.wrote, false)
  assert.equal(r.skipped, true)
  assert.equal(ecm.writes.length, 0)
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: false })
})

test('inhibit blocks live close until DI low then high (start from beginning)', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  const ecm = mockEcm()
  await openClampsForReplace(ecm, 'di10')
  ecm.writes.length = 0

  // Stale DI still high — must not re-close; canEnqueue blocked
  const blocked = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: false },
    'di10',
  )
  assert.equal(blocked.wrote, false)
  assert.equal(ecm.writes.length, 0)
  assert.match(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: false }, 'di10'),
    /right clamp/i,
  )
  assert.deepEqual(getEffectiveClampTriggerState({ rightTriggered: true, leftTriggered: false }), {
    rightTriggered: false,
    leftTriggered: false,
  })
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: false })

  // DI goes low — still awaiting re-place (canEnqueue stays false)
  setCachedClampTriggerState({ rightTriggered: false, leftTriggered: false })
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: false })
  assert.match(
    getClampTriggerStartBlockReason({ rightTriggered: false, leftTriggered: false }, 'di10'),
    /right clamp/i,
  )

  // DI high again — live close, then Start allowed
  const closed = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: false },
    'di10',
  )
  assert.equal(closed.wrote, true)
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: false })
  assert.equal(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: false }, 'di10'),
    null,
  )
})

test('openClampsForReplace both opens both and inhibits both', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  const ecm = mockEcm()
  await openClampsForReplace(ecm)
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0))
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 0))
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })
  assert.match(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    /clamps/i,
  )
})

test('both mode: partial DI low arms that side only; close on high clears awaiting', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  const ecm = mockEcm()
  await openClampsForReplace(ecm)
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })

  // Clear right only (saw low) — still awaiting until live close
  setCachedClampTriggerState({ rightTriggered: false, leftTriggered: true })
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })
  assert.match(getClampTriggerStartBlockReason({ rightTriggered: false, leftTriggered: true }, 'both'), /clamps/i)

  // Right DI high → close right only; left still awaiting
  ecm.writes.length = 0
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'both')
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.ok(!ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: true })

  setCachedClampTriggerState({ rightTriggered: true, leftTriggered: false })
  ecm.writes.length = 0
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'both')
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: false })
  assert.equal(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    null,
  )
})

test('stopClampTriggerMonitor clears inhibit latches', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di9'
  const ecm = mockEcm()
  await openClampsForReplace(ecm)
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: true })
  stopClampTriggerMonitor()
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: false })
})
