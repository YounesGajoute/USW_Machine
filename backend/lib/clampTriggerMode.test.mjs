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
  getClampTriggerSatisfiedState,
  readClampTriggerState,
  applyClampTriggerLiveClose,
  canClampTriggerLiveClose,
  getCachedClampTriggerState,
  setCachedClampTriggerState,
  startClampTriggerMonitor,
  stopClampTriggerMonitor,
  isClampTriggerMonitorRunning,
  setClampTriggerCloseDelays,
  getClampTriggerCloseDelays,
  getClampTriggerSyncCloseDelayMs,
  armClampTriggerRearmAfterExternalOpen,
  armClampTriggerRearmAfterBothValvesOpen,
} from './clampTriggerMode.mjs'
import { DI, DO } from './ethercat.mjs'
import {
  forceState,
  getLifecycleState,
  isProductionActive,
  LIFECYCLE_STATE,
  onEtherCATConnected,
} from './machineLifecycle.mjs'

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

test('DI pin map: CLAMP_LEFT=DI9, CLAMP_RIGHT=DI10, ESTOP=DI15', () => {
  // Regression: ESTOP must not share DI9 with left clamp (init was treating DI9 as emergency).
  assert.equal(DI.CLAMP_LEFT_TRIGGER, 9)
  assert.equal(DI.CLAMP_RIGHT_TRIGGER, 10)
  assert.equal(DI.ESTOP_BUTTON, 15)
  assert.equal(DI.AIR_PRESSURE, 8)
})

beforeEach(() => {
  delete process.env.CLAMP_TRIGGER_MODE
  delete process.env.CLAMP_TRIGGER_POLL_MS
  setClampTriggerCloseDelays({ rightMs: 0, leftMs: 0 })
  stopClampTriggerMonitor()
  onEtherCATConnected()
  forceState(LIFECYCLE_STATE.RUN, { reason: 'test ready' })
})

afterEach(() => {
  delete process.env.CLAMP_TRIGGER_MODE
  delete process.env.CLAMP_TRIGGER_POLL_MS
  setClampTriggerCloseDelays({ rightMs: 0, leftMs: 0 })
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

test('getClampTriggerStartBlockReason per mode', async () => {
  assert.equal(getClampTriggerStartBlockReason(null, 'off'), null)
  assert.match(getClampTriggerStartBlockReason(null, 'di10'), /right clamp/i)
  assert.match(getClampTriggerStartBlockReason({ rightTriggered: false, leftTriggered: true }, 'di10'), /right clamp/i)
  // DI high alone is not enough — live close must complete (_satisfied).
  assert.match(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: false }, 'di10'),
    /Waiting for the right clamp/i,
  )
  const ecm = mockEcm()
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: false }, 'di10')
  assert.equal(getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: false }, 'di10'), null)
  assert.match(getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: false }, 'di9'), /left clamp/i)
  assert.match(getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: false }, 'both'), /clamps/i)
  assert.match(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    /Waiting for clamps/i,
  )
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'both')
  assert.equal(getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'), null)
  // close_clamps TOCTOU path: DI only
  assert.equal(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both', {
      requireClosed: false,
    }),
    null,
  )
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

test('both Pre-Start: live close keeps lifecycle RUN and does not start production', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  assert.equal(isProductionActive(), false)

  const ecm = mockEcm()
  const result = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
  )
  assert.equal(result.wrote, true)
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))

  // Pre-Start must not leave RUN or enter a production cycle.
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  assert.equal(isProductionActive(), false)
  assert.equal(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    null,
  )
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
  assert.match(getClampTriggerStartBlockReason(getCachedClampTriggerState(), 'di10'), /Waiting for the right clamp/i)
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: false }, 'di10')
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

test('both mode: never closes one side alone; both DIs then sync close', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  const ecm = mockEcm()
  await openClampsForReplace(ecm)
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })

  // Clear right only (saw low) — left still awaiting
  setCachedClampTriggerState({ rightTriggered: false, leftTriggered: true })
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })
  assert.match(getClampTriggerStartBlockReason({ rightTriggered: false, leftTriggered: true }, 'both'), /clamps/i)

  // Right re-placed but left still inhibited — must NOT close right alone
  ecm.writes.length = 0
  const partial = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
  )
  assert.equal(partial.wrote, false)
  assert.equal(ecm.writes.length, 0)
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })

  // Clear left too, then both high → close both together
  setCachedClampTriggerState({ rightTriggered: false, leftTriggered: false })
  ecm.writes.length = 0
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'both')
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: false })
  assert.equal(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    null,
  )
})

test('both mode: holding only DI9 then DI10 waits sync delay then closes both', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  setClampTriggerCloseDelays({ rightMs: 300, leftMs: 300 })
  const ecm = mockEcm()
  const t0 = 6_000_000

  // Left held alone — no close, no timer start that would close left early
  let r = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: false, leftTriggered: true },
    'both',
    { now: t0 },
  )
  assert.equal(r.wrote, false)
  assert.equal(ecm.writes.length, 0)

  // Right joins — sync delay starts now (not when left alone was held)
  r = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0 + 50 },
  )
  assert.equal(r.wrote, false)
  assert.equal(ecm.writes.length, 0)
  assert.match(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    /Waiting for clamps/i,
  )

  // Before sync delay from both-high — still open
  r = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0 + 300 },
  )
  assert.equal(r.wrote, false)

  // After sync delay from both-high (t0+50+300) — both close together
  r = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0 + 50 + 300 },
  )
  assert.equal(r.wrote, true)
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))
})

test('both mode: Start blocked during close delay until satisfied', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  setClampTriggerCloseDelays({ rightMs: 200, leftMs: 200 })
  const ecm = mockEcm()
  const t0 = 3_000_000

  await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0 },
  )
  assert.match(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    /Waiting for clamps/i,
  )
  assert.deepEqual(getClampTriggerSatisfiedState(), { right: false, left: false })

  await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0 + 200 },
  )
  assert.equal(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    null,
  )
  assert.deepEqual(getClampTriggerSatisfiedState(), { right: true, left: true })
})

test('both mode: DI low after close keeps satisfied so Start stays armed', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  setClampTriggerCloseDelays({ rightMs: 300, leftMs: 300 })
  const ecm = mockEcm()
  const t0 = 4_000_000

  await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0, immediate: true },
  )
  assert.deepEqual(getClampTriggerSatisfiedState(), { right: true, left: true })
  assert.equal(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    null,
  )

  // Sensors often drop after valves close — must NOT clear satisfied / Start.
  setCachedClampTriggerState({ rightTriggered: false, leftTriggered: false })
  assert.deepEqual(getClampTriggerSatisfiedState(), { right: true, left: true })
  assert.equal(
    getClampTriggerStartBlockReason({ rightTriggered: false, leftTriggered: false }, 'both'),
    null,
  )
})

test('armClampTriggerRearmAfterExternalOpen blocks Start until re-place', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  const ecm = mockEcm()
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'both')
  assert.equal(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    null,
  )

  const armed = armClampTriggerRearmAfterExternalOpen('both')
  assert.equal(armed.armed, true)
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })
  assert.deepEqual(getClampTriggerSatisfiedState(), { right: false, left: false })
  assert.match(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    /clamps/i,
  )
  // Must not snap-shut while inhibit active
  ecm.writes.length = 0
  const blocked = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
  )
  assert.equal(blocked.wrote, false)
})

test('armClampTriggerRearmAfterBothValvesOpen always arms both sides and clears satisfied', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  const ecm = mockEcm()
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: true }, 'both')
  assert.deepEqual(getClampTriggerSatisfiedState(), { right: true, left: true })

  const armed = armClampTriggerRearmAfterBothValvesOpen()
  assert.equal(armed.armed, true)
  assert.deepEqual(armed.sides, { right: true, left: true })
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })
  assert.deepEqual(getClampTriggerSatisfiedState(), { right: false, left: false })
  assert.match(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: true }, 'both'),
    /clamps/i,
  )
})

test('armClampTriggerRearmAfterBothValvesOpen arms both sides even in di10 (both valves opened)', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  const ecm = mockEcm()
  await applyClampTriggerLiveClose(ecm, { rightTriggered: true, leftTriggered: false }, 'di10')
  assert.equal(getClampTriggerSatisfiedState().right, true)

  const armed = armClampTriggerRearmAfterBothValvesOpen()
  assert.equal(armed.armed, true)
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: true })
  assert.deepEqual(getClampTriggerSatisfiedState(), { right: false, left: false })
})

test('armClampTriggerRearmAfterBothValvesOpen is no-op when mode off', () => {
  process.env.CLAMP_TRIGGER_MODE = 'off'
  const armed = armClampTriggerRearmAfterBothValvesOpen()
  assert.equal(armed.armed, false)
  assert.equal(armed.reason, 'mode_off')
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: false })
})

test('stopClampTriggerMonitor clears inhibit latches', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di9'
  const ecm = mockEcm()
  await openClampsForReplace(ecm)
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: true })
  stopClampTriggerMonitor()
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: false })
})

test('both mode: sync delay waits for both DIs then closes together', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  setClampTriggerCloseDelays({ rightMs: 200, leftMs: 400 })
  assert.equal(getClampTriggerSyncCloseDelayMs(), 400)

  const ecm = mockEcm()
  const t0 = 1_000_000

  const early = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0 },
  )
  assert.equal(early.wrote, false)
  assert.equal(ecm.writes.length, 0)

  // At 200ms (old right-only delay) — still waiting for sync max=400
  const mid = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0 + 200 },
  )
  assert.equal(mid.wrote, false)
  assert.equal(ecm.writes.length, 0)

  const late = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0 + 400 },
  )
  assert.equal(late.wrote, true)
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))
})

test('both mode: DI drop during sync delay cancels pending close', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  setClampTriggerCloseDelays({ rightMs: 300, leftMs: 300 })
  const ecm = mockEcm()
  const t0 = 2_000_000

  await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0 },
  )
  assert.equal(ecm.writes.length, 0)

  // Drop one DI before delay elapses — pending must clear; no single-side close
  await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: false },
    'both',
    { now: t0 + 150 },
  )
  assert.equal(ecm.writes.length, 0)

  // Re-assert both — new sync wait from this sample
  await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0 + 300 },
  )
  assert.equal(ecm.writes.length, 0, 'new episode must re-arm sync delay from this sample')

  await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0 + 600 },
  )
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))
})

test('both mode: apply with one DI low keeps satisfied (Start stays armed)', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  setClampTriggerCloseDelays({ rightMs: 200, leftMs: 200 })
  const ecm = mockEcm()
  const t0 = 7_000_000

  await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { now: t0, immediate: true },
  )
  assert.deepEqual(getClampTriggerSatisfiedState(), { right: true, left: true })

  // Drop via apply only (no setCached) — cancel pending, keep satisfied
  await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: false },
    'both',
    { now: t0 + 100 },
  )
  assert.deepEqual(getClampTriggerSatisfiedState(), { right: true, left: true })
  assert.equal(
    getClampTriggerStartBlockReason({ rightTriggered: true, leftTriggered: false }, 'both'),
    null,
  )
})

test('both mode: production re-assert skips close delay', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'both'
  setClampTriggerCloseDelays({ rightMs: 5000, leftMs: 5000 })
  const ecm = mockEcm()
  const r = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'both',
    { requireReady: false },
  )
  assert.equal(r.wrote, true)
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 1))
})

test('di10 mode ignores close delay settings', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  setClampTriggerCloseDelays({ rightMs: 5000, leftMs: 5000 })
  const ecm = mockEcm()
  const r = await applyClampTriggerLiveClose(
    ecm,
    { rightTriggered: true, leftTriggered: true },
    'di10',
    { now: 0 },
  )
  assert.equal(r.wrote, true)
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 1))
})
