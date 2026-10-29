import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visionSettingsSaveFeedback, visionSettingsSyncFeedback } from './visionSettingsSaveFeedback.mjs'

test('pull pending is informative, not a Slave rejection or confirmed application', () => {
  const result = visionSettingsSaveFeedback({ synced: false, sync_state: 'awaiting_slave' })
  assert.equal(result.tone, 'info')
  assert.match(result.message, /Awaiting/)
  assert.match(result.message, /production inspection remains disabled/)
  assert.doesNotMatch(result.message, /did not accept/)
})
test('unconfigured synchronization clearly says that Slave changes are not applied', () => {
  const result = visionSettingsSaveFeedback({ synced: false, sync_state: 'not_configured' })
  assert.equal(result.tone, 'warning')
  assert.match(result.message, /not configured/)
  assert.match(result.message, /have not been applied/)
})
test('only confirmed sync is shown as success', () => {
  assert.equal(visionSettingsSaveFeedback({ synced: true }).tone, 'success')
  assert.equal(visionSettingsSaveFeedback({ synced: false }).tone, 'warning')
  assert.equal(visionSettingsSaveFeedback({ synced: true, sync_state: 'awaiting_slave' }).tone, 'info')
})
test('older failed-save responses preserve diagnostics without guessing rejection', () => {
  const result = visionSettingsSaveFeedback({ synced: false, sync_error: 'Invalid realtime check configuration' })
  assert.match(result.message, /could not be confirmed/)
  assert.match(result.message, /Invalid realtime check configuration/)
  assert.doesNotMatch(result.message, /did not accept/)
})
test('accepted ready acknowledgement distinguishes configuration sync from a production grant', () => {
  const result = visionSettingsSyncFeedback({ state: 'synchronized', desiredMode: 'enabled', issues: [] })
  assert.equal(result.tone, 'success')
  assert.match(result.message, /confirmed/)
  assert.match(result.message, /grant is still pending/)
  const authorized = visionSettingsSyncFeedback({ state: 'synchronized', desiredMode: 'enabled', productionAuthorized: true, issues: [] })
  assert.match(authorized.message, /grant installed/)
})
test('disconnected and blocked states remain explicit', () => {
  assert.equal(visionSettingsSyncFeedback({ state: 'disconnected', desiredMode: null, issues: [] }).tone, 'warning')
  const blocked = visionSettingsSyncFeedback({ state: 'blocked', desiredMode: 'hold', issues: ['INVALID_RECIPE'] })
  assert.match(blocked.message, /INVALID_RECIPE/)
})
