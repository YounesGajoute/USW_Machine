import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getProductionPanelConfig, isClampTriggerProductionGateActive } from './productionPanelConfig.mjs'

beforeEach(() => {
  delete process.env.PANEL_TWO_HAND_MODE
  delete process.env.PANEL_TWO_HAND_DISABLE
  delete process.env.CLAMP_TRIGGER_MODE
})

afterEach(() => {
  delete process.env.PANEL_TWO_HAND_MODE
  delete process.env.PANEL_TWO_HAND_DISABLE
  delete process.env.CLAMP_TRIGGER_MODE
})

test('getProductionPanelConfig reads PANEL_TWO_HAND_MODE=single from env', () => {
  process.env.PANEL_TWO_HAND_MODE = 'single'
  const cfg = getProductionPanelConfig()
  assert.equal(cfg.panelTwoHandMode, 'single')
  assert.equal(cfg.twoHandGatesProduction, false)
})

test('PANEL_TWO_HAND_DISABLE=1 forces single and does not gate production', () => {
  process.env.PANEL_TWO_HAND_DISABLE = '1'
  process.env.PANEL_TWO_HAND_MODE = 'sequential'
  const cfg = getProductionPanelConfig()
  assert.equal(cfg.panelTwoHandMode, 'single')
  assert.equal(cfg.twoHandGatesProduction, false)
})

test('CLAMP_TRIGGER_MODE=off disables clamp production gate', () => {
  process.env.CLAMP_TRIGGER_MODE = 'off'
  assert.equal(isClampTriggerProductionGateActive(), false)
  const cfg = getProductionPanelConfig()
  assert.equal(cfg.clampGatesProduction, false)
})

test('CLAMP_TRIGGER_MODE=di10 enables clamp production gate', () => {
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  assert.equal(isClampTriggerProductionGateActive(), true)
  assert.equal(getProductionPanelConfig().clampGatesProduction, true)
})
