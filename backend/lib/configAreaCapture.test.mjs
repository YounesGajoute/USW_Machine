import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertConfigAreaPageAccess, captureConfigAreaFrame } from './configAreaCapture.mjs'
import { resolvePanelContext, PANEL_ACTION, PANEL_CONTEXT } from './panelModes.mjs'
import { CONFIG_AREA_FOCUS_LEASE_MS, clearPanelFocus, getPanelFocus, ownsConfigAreaFocus, resetPanelFocus, revokeConfigAreaFocus, setPanelFocus } from './panelFocus.mjs'
import { requestConfigAreaCaptureAbort } from './configAreaCaptureLock.mjs'
import { resetSettingsPagePresence, setSettingsPagePresence } from './hmiPageLease.mjs'

const timing = {
  delayAfterClampCloseMs: 11,
  delayAfterLeverUpMs: 12,
  delayAfterPpClampCloseMs: 13,
  delayAfterVisionCaptureMs: 17,
  delayAfterPickClampOpenMs: 14,
  delayAfterLeverDownMs: 15,
  delayAfterClampOpenMs: 16,
}

function fixture(overrides = {}) {
  const events = []
  const deps = {
    ecm: { isInitialized: true },
    timing,
    machineReady: () => {},
    safety: async () => {},
    inspectionReady: async () => {},
    referenceReady: async () => {},
    outputsReady: async () => {},
    startHeld: async () => true,
    write: async (_ecm, outputs) => { events.push(outputs) },
    pause: async ms => { events.push(ms) },
    camera: async () => { events.push('capture'); return { capture_id: 'NEW', image_url: '/image', archive_status: 'COMPLETE' } },
    ...overrides,
  }
  return { deps, events }
}

test('Config Area capture uses production delays and opens pneumatics in the requested order', async () => {
  const { deps, events } = fixture()
  assert.equal((await captureConfigAreaFrame(deps)).capture_id, 'NEW')
  assert.deepEqual(events, [
    { clampRight: true, clampLeft: true }, 11,
    { leverUp: true }, 12,
    { ppClamp: true }, 13,
    'capture',
    17,
    { ppClamp: false }, 14,
    { leverUp: false }, 15,
    { clampRight: false, clampLeft: false }, 16,
  ])
})

test('Start release before camera prevents capture and still releases valves', async () => {
  let reads = 0
  const { deps, events } = fixture({ startHeld: async () => ++reads < 5 })
  await assert.rejects(captureConfigAreaFrame(deps), /Keep holding/)
  assert.equal(events.includes('capture'), false)
  assert.deepEqual(events.slice(-1), [{ ppClamp: false, leverUp: false, clampRight: false, clampLeft: false }])
})

test('camera failure still releases all valves', async () => {
  const { deps, events } = fixture({ camera: async () => { throw new Error('Camera unavailable') } })
  await assert.rejects(captureConfigAreaFrame(deps), /Camera unavailable/)
  assert.deepEqual(events.slice(-1), [{ ppClamp: false, leverUp: false, clampRight: false, clampLeft: false }])
})

test('camera watchdog releases valves but keeps production gated until camera settles', async () => {
  let finishCamera
  const pending = new Promise(resolve => { finishCamera = resolve })
  const { deps, events } = fixture({ camera: async () => pending, cameraTimeoutMs: 5 })
  await assert.rejects(captureConfigAreaFrame(deps), /timed out/)
  assert.deepEqual(events.at(-1), { ppClamp: false, leverUp: false, clampRight: false, clampLeft: false })
  await assert.rejects(captureConfigAreaFrame(deps), /already running/)
  finishCamera({ capture_id: 'LATE', image_url: '/image', archive_status: 'COMPLETE' })
  await new Promise(resolve => setImmediate(resolve))
  const next = fixture()
  assert.equal((await captureConfigAreaFrame(next.deps)).capture_id, 'NEW')
})

test('safety loss before release triggers immediate safe output without production delays', async () => {
  let checks = 0
  const { deps, events } = fixture({ safety: async () => { if (++checks === 6) throw new Error('Door opened') } })
  await assert.rejects(captureConfigAreaFrame(deps), /Door opened/)
  assert.deepEqual(events.at(-1), { ppClamp: false, leverUp: false, clampRight: false, clampLeft: false })
  assert.equal(events.includes(14), false)
})

test('failed normal release attempts immediate safe output', async () => {
  const { deps, events } = fixture({ write: async (_ecm, outputs) => {
    events.push(outputs)
    if (outputs.ppClamp === false && Object.keys(outputs).length === 1) throw new Error('Valve write failed')
  } })
  await assert.rejects(captureConfigAreaFrame(deps), /Valve write failed/)
  assert.deepEqual(events.at(-1), { ppClamp: false, leverUp: false, clampRight: false, clampLeft: false })
})

test('Safe request cancels the next motion step and releases valves', async () => {
  const { deps, events } = fixture({ pause: async ms => {
    events.push(ms)
    if (ms === timing.delayAfterClampCloseMs) requestConfigAreaCaptureAbort('Safe requested')
  } })
  await assert.rejects(captureConfigAreaFrame(deps), /Safe requested/)
  assert.equal(events.some(event => event?.leverUp === true), false)
  assert.deepEqual(events.at(-1), { ppClamp: false, leverUp: false, clampRight: false, clampLeft: false })
})

test('changed background before camera stops capture and releases valves', async () => {
  let checks = 0
  const { deps, events } = fixture({ referenceReady: async () => {
    if (++checks === 2) throw new Error('Background changed')
  } })
  await assert.rejects(captureConfigAreaFrame(deps), /Background changed/)
  assert.equal(events.includes('capture'), false)
  assert.deepEqual(events.at(-1), { ppClamp: false, leverUp: false, clampRight: false, clampLeft: false })
})

test('missing empty-fixture reference stops before any pneumatic motion', async () => {
  const { deps, events } = fixture({ referenceReady: async () => { throw new Error('Save an empty-fixture background') } })
  await assert.rejects(captureConfigAreaFrame(deps), /empty-fixture background/)
  assert.deepEqual(events, [])
})

test('only one Config Area capture can own the machine at a time', async () => {
  let finishCamera
  const cameraPending = new Promise(resolve => { finishCamera = resolve })
  const { deps } = fixture({ camera: async () => cameraPending })
  const first = captureConfigAreaFrame(deps)
  await assert.rejects(captureConfigAreaFrame(deps), /already running/)
  finishCamera({ capture_id: 'NEW', image_url: '/image', archive_status: 'COMPLETE' })
  assert.equal((await first).capture_id, 'NEW')
})

test('Config Area focus reserves Start without dispatching a production action', () => {
  const result = resolvePanelContext({
    connected: true,
    lifecycle: { isProductionActive: false },
    initStatus: { referenceLoaded: true, initialized: true },
    maintenance: { active: false },
    focus: 'config-area',
    canEnqueue: true,
  })
  assert.equal(result.context, PANEL_CONTEXT.FOCUS)
  assert.equal(result.di1.action, PANEL_ACTION.NONE)
})

test('Config Area focus lease expires after HMI crash and stale cleanup cannot clear a newer owner', () => {
  const oldNow = Date.now
  let current = 1000
  Date.now = () => current
  try {
    resetPanelFocus()
    setPanelFocus('config-area', 'first-token-1234')
    assert.equal(ownsConfigAreaFocus('first-token-1234'), true)
    assert.throws(() => setPanelFocus('config-area', 'other-token-1234'), /already open/)
    clearPanelFocus('other-token-1234')
    assert.equal(getPanelFocus().focus, 'config-area')
    current += CONFIG_AREA_FOCUS_LEASE_MS + 1
    assert.equal(getPanelFocus().focus, null)
    setPanelFocus('config-area', 'other-token-1234')
    clearPanelFocus('first-token-1234')
    assert.equal(ownsConfigAreaFocus('other-token-1234'), true)
  } finally {
    Date.now = oldNow
    resetPanelFocus()
  }
})

test('leaving Settings revokes Config Area focus immediately', () => {
  resetPanelFocus()
  try {
    setPanelFocus('config-area', 'focus-owner-1234')
    assert.equal(ownsConfigAreaFocus('focus-owner-1234'), true)
    revokeConfigAreaFocus()
    assert.equal(ownsConfigAreaFocus('focus-owner-1234'), false)
  } finally {
    resetPanelFocus()
  }
})

test('Config Area capture requires both the Settings page and its exact focus owner', () => {
  resetPanelFocus()
  resetSettingsPagePresence()
  try {
    setPanelFocus('config-area', 'focus-owner-1234')
    assert.throws(() => assertConfigAreaPageAccess('focus-owner-1234'), /no longer on the Config Area page/)
    setSettingsPagePresence('settings-owner-1', true)
    assert.throws(() => assertConfigAreaPageAccess('wrong-focus-1234'), /no longer on the Config Area page/)
    assert.doesNotThrow(() => assertConfigAreaPageAccess('focus-owner-1234'))
    revokeConfigAreaFocus()
    assert.throws(() => assertConfigAreaPageAccess('focus-owner-1234'), /no longer on the Config Area page/)
  } finally {
    resetPanelFocus()
    resetSettingsPagePresence()
  }
})
