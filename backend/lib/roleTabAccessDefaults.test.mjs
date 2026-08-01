import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TAB_ACCESS_EXCLUDED_KEYS,
  DEFAULT_AVAILABLE_TABS,
  getDefaultRoleTabAccessMap,
  mergeRoleTabAccess,
  stripBypassOnlyTabKeys,
} from './roleTabAccessDefaults.mjs'

test('Tab Access matrix never includes System', () => {
  assert.equal(DEFAULT_AVAILABLE_TABS.includes('settings_system'), false)
  assert.deepEqual([...TAB_ACCESS_EXCLUDED_KEYS], ['settings_system'])
  assert.equal(DEFAULT_AVAILABLE_TABS.includes('settings_maintenance'), true)
})

test('ADMIN default tabs include settings_maintenance and exclude System', () => {
  const map = getDefaultRoleTabAccessMap()
  assert.equal(map.ADMIN.tabs.includes('settings_maintenance'), true)
  assert.equal(map.ADMIN.available_tabs.includes('settings_maintenance'), true)
  assert.equal(map.ADMIN.tabs.includes('settings_system'), false)
  assert.equal(map.ADMIN.available_tabs.includes('settings_system'), false)
})

test('mergeRoleTabAccess strips legacy settings_system from tabs and available_tabs', () => {
  const merged = mergeRoleTabAccess({
    ADMIN: {
      level: 4,
      tabs: [
        'login',
        'main',
        'settings',
        'settings_maintenance',
        'settings_system',
        'settings_general',
      ],
      available_tabs: [...DEFAULT_AVAILABLE_TABS, 'settings_system'],
    },
  })
  assert.equal(merged.ADMIN.tabs.includes('settings_maintenance'), true)
  assert.equal(merged.ADMIN.tabs.includes('settings_system'), false)
  assert.equal(merged.ADMIN.available_tabs.includes('settings_system'), false)
  assert.deepEqual(
    stripBypassOnlyTabKeys(['settings_system', 'settings_maintenance']),
    ['settings_maintenance'],
  )
})

test('mergeRoleTabAccess does not auto-heal settings_maintenance onto ADMIN when revoked', () => {
  const merged = mergeRoleTabAccess({
    ADMIN: {
      level: 4,
      tabs: ['login', 'main', 'settings', 'settings_general'],
      available_tabs: [...DEFAULT_AVAILABLE_TABS],
    },
  })
  assert.equal(merged.ADMIN.tabs.includes('settings_maintenance'), false)
})
