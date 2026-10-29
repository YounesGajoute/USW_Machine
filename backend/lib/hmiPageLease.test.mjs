import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getProductionEnqueueBlockReason } from './productionSequence.mjs'
import { isSettingsPageActive, resetSettingsPagePresence, setSettingsPagePresence } from './hmiPageLease.mjs'
import { resolvePanelContext, PANEL_ACTION, PANEL_CONTEXT } from './panelModes.mjs'
import { advanceStep } from './productionStepper.mjs'
import { runMaintenanceCentringCycle } from './centringMaintenance.mjs'

test('Settings page blocks all production enqueue paths until its owner exits', () => {
  resetSettingsPagePresence()
  try {
    setSettingsPagePresence('settings-owner-1', true)
    setSettingsPagePresence('settings-owner-2', true)
    assert.equal(isSettingsPageActive(), true)
    assert.match(getProductionEnqueueBlockReason(), /HMI is on Settings/)
    assert.match(getProductionEnqueueBlockReason({ mechanicalDryCycle: true }), /HMI is on Settings/)
    setSettingsPagePresence('settings-owner-1', false)
    assert.equal(isSettingsPageActive(), true)
    setSettingsPagePresence('settings-owner-2', false)
    assert.equal(isSettingsPageActive(), false)
  } finally {
    resetSettingsPagePresence()
  }
})

test('Settings focus leaves both physical buttons without a production action', () => {
  const result = resolvePanelContext({
    connected: true,
    lifecycle: { isProductionActive: false },
    initStatus: { referenceLoaded: true, initialized: true },
    maintenance: { active: false },
    focus: 'settings',
    canEnqueue: true,
  })
  assert.equal(result.context, PANEL_CONTEXT.FOCUS)
  assert.equal(result.di0.action, PANEL_ACTION.NONE)
  assert.equal(result.di1.action, PANEL_ACTION.NONE)
})

test('an existing maintenance production step cannot advance from Settings', async () => {
  resetSettingsPagePresence()
  try {
    setSettingsPagePresence('settings-owner-1', true)
    await assert.rejects(advanceStep(null), /cannot advance while the HMI is on Settings/)
  } finally {
    resetSettingsPagePresence()
  }
})

test('maintenance centring production cycle cannot start from Settings', async () => {
  resetSettingsPagePresence()
  try {
    setSettingsPagePresence('settings-owner-1', true)
    await assert.rejects(runMaintenanceCentringCycle({ referenceId: 'REF' }), /cannot start while the HMI is on Settings/)
  } finally {
    resetSettingsPagePresence()
  }
})
