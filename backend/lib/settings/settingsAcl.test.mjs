/**
 * Contract tests for Settings GET/PUT ACL policy.
 * Mirrors `/api/settings/system` authorization without booting Express.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  KIOSK_DEVICE_SETTING_KEYS,
  PAGE_SETTING_TAB_KEYS,
  PUBLIC_SYSTEM_SETTING_KEYS,
  authorizeSystemSettingsPatch,
  pickPublicSystemSettings,
  flatKeysForDomainPatch,
  flatKeysForDomainReset,
} from './settingsAcl.mjs'

const ROLE_RANK = {
  NONE: 0,
  OPERATOR: 1,
  QUALITY: 2,
  MAINTENANCE: 3,
  ADMIN: 4,
  BYPASS: 5,
}

function rank(userRow) {
  if (!userRow) return 0
  return ROLE_RANK[userRow.role] ?? 0
}

function decide(keys, opts = {}) {
  const {
    userRow = null,
    isMachineOperationAllowed = false,
    tabs = [],
  } = opts
  return authorizeSystemSettingsPatch({
    keys,
    userRow,
    isMachineOperationAllowed,
    hasSettingsTabAccess: (tab) => tabs.includes(tab),
    rank,
  })
}

test('kiosk device keys theme/locale always authorize without session', () => {
  const r = decide(['theme', 'locale'], { isMachineOperationAllowed: false, userRow: null })
  assert.equal(r.ok, true)
  assert.ok(KIOSK_DEVICE_SETTING_KEYS.has('theme'))
  assert.ok(KIOSK_DEVICE_SETTING_KEYS.has('locale'))
})

test('page-governed key denied when machine operation not allowed (require_login)', () => {
  const r = decide(['pick_place_config'], {
    isMachineOperationAllowed: false,
    tabs: ['settings_pick_place'],
  })
  assert.equal(r.ok, false)
  assert.equal(r.status, 401)
  assert.match(r.message, /Not authenticated/)
})

test('page-governed key denied when matrix lacks the settings sub-tab', () => {
  const r = decide(['pick_place_config'], {
    isMachineOperationAllowed: true,
    userRow: { role: 'OPERATOR' },
    tabs: ['settings_general'],
  })
  assert.equal(r.ok, false)
  assert.equal(r.status, 403)
  assert.match(r.message, /Not authorized for this settings page/)
})

test('page-governed key allowed when machine op + matrix tab granted (NONE kiosk)', () => {
  const r = decide(['machine_model'], {
    isMachineOperationAllowed: true,
    userRow: null,
    tabs: ['settings_general'],
  })
  assert.equal(r.ok, true)
  assert.equal(PAGE_SETTING_TAB_KEYS.machine_model, 'settings_general')
})

test('admin-only key (require_login) rejected without session', () => {
  const r = decide(['require_login'], { isMachineOperationAllowed: true, userRow: null })
  assert.equal(r.ok, false)
  assert.equal(r.status, 401)
})

test('admin-only key rejected for OPERATOR', () => {
  const r = decide(['require_login'], {
    isMachineOperationAllowed: true,
    userRow: { role: 'OPERATOR' },
  })
  assert.equal(r.ok, false)
  assert.equal(r.status, 403)
  assert.match(r.message, /Admin access required/)
})

test('admin-only key allowed for ADMIN and BYPASS', () => {
  for (const role of ['ADMIN', 'BYPASS']) {
    const r = decide(['serial_number', 'quickpass'], {
      isMachineOperationAllowed: true,
      userRow: { role },
    })
    assert.equal(r.ok, true, `expected ok for ${role}`)
  }
})

test('mixed patch fails closed on first unauthorized admin-only key', () => {
  const r = decide(['theme', 'require_login'], {
    isMachineOperationAllowed: true,
    userRow: { role: 'OPERATOR' },
  })
  assert.equal(r.ok, false)
  assert.equal(r.status, 403)
})

test('mixed patch allows theme + page key when matrix grants page', () => {
  const r = decide(['theme', 'centring_config'], {
    isMachineOperationAllowed: true,
    userRow: null,
    tabs: ['settings_shrink_tubes'],
  })
  assert.equal(r.ok, true)
})

test('unauthenticated GET subset omits auth-only fields', () => {
  const full = {
    require_login: true,
    theme: 'dark',
    locale: 'fr',
    production_sections: { a: true },
    machine_model: 'STCS-CS19',
    test_mode: 'manual',
    centering_input_start_mm: 1,
    centering_input_offset_mm: 0,
    centring_config: { transport: 'tcp' },
    centring_frame_config: {},
    mechanism_positions_by_machine: {},
    pick_place_config: { movementSpeedMmS: 80 },
    production_sequence_config: {},
    vision_general_tool_template: { tools: [] },
    serial_number: 'SECRET-SN',
    quickpass: true,
    post_update_action: 'reboot',
    reference_serial: { baud: 9600 },
    role_tab_access: { ADMIN: {} },
    history_retention_days: 30,
  }
  const subset = pickPublicSystemSettings(full)
  assert.deepEqual(Object.keys(subset).sort(), [...PUBLIC_SYSTEM_SETTING_KEYS].sort())
  assert.equal(subset.theme, 'dark')
  assert.equal(subset.require_login, true)
  assert.equal(subset.machine_model, 'STCS-CS19')
  assert.equal(subset.serial_number, undefined)
  assert.equal(subset.quickpass, undefined)
  assert.equal(subset.post_update_action, undefined)
  assert.equal(subset.reference_serial, undefined)
  assert.equal(subset.role_tab_access, undefined)
  assert.equal(subset.history_retention_days, undefined)
  assert.equal(subset.pick_place_config, undefined)
  assert.equal(subset.centring_config, undefined)
  assert.equal(subset.vision_general_tool_template, undefined)
  assert.ok(!('serial_number' in subset))
  assert.ok(!('pick_place_config' in subset))
})

test('PAGE_SETTING_TAB_KEYS covers expected machine domains', () => {
  assert.equal(PAGE_SETTING_TAB_KEYS.pick_place_config, 'settings_pick_place')
  assert.equal(PAGE_SETTING_TAB_KEYS.production_sequence_config, 'settings_production_sequence')
  assert.equal(PAGE_SETTING_TAB_KEYS.vision_general_tool_template, 'settings_vision')
  assert.equal(PAGE_SETTING_TAB_KEYS.centring_config, 'settings_shrink_tubes')
})

test('flatKeysForDomainPatch maps general fields to flat keys', () => {
  assert.deepEqual(flatKeysForDomainPatch('general', { require_login: true, machine_model: 'STCS-CS19' }), [
    'require_login',
    'machine_model',
  ])
})

test('flatKeysForDomainPatch maps ui production_sections (admin-only flat key)', () => {
  assert.deepEqual(flatKeysForDomainPatch('ui', { production_sections: { general: false } }), [
    'production_sections',
  ])
})

test('flatKeysForDomainPatch maps pick_place nested doc to pick_place_config', () => {
  assert.deepEqual(flatKeysForDomainPatch('pick_place', { movementSpeedMmS: 80 }), ['pick_place_config'])
})

test('guest cannot authorize require_login via domain-mapped keys', () => {
  const r = decide(flatKeysForDomainPatch('general', { require_login: true }), {
    isMachineOperationAllowed: true,
    userRow: null,
    tabs: ['settings_general'],
  })
  assert.equal(r.ok, false)
  assert.equal(r.status, 401)
})

test('guest can authorize theme via ui domain keys', () => {
  const r = decide(flatKeysForDomainPatch('ui', { theme: 'dark' }), {
    isMachineOperationAllowed: false,
    userRow: null,
  })
  assert.equal(r.ok, true)
})

test('guest cannot authorize production_sections via ui domain keys', () => {
  const r = decide(flatKeysForDomainPatch('ui', { production_sections: {} }), {
    isMachineOperationAllowed: true,
    userRow: null,
    tabs: ['settings_general'],
  })
  assert.equal(r.ok, false)
  assert.equal(r.status, 401)
})

test('flatKeysForDomainReset covers all general blob keys', () => {
  assert.deepEqual(
    flatKeysForDomainReset('general', ['require_login', 'test_mode', 'history_retention_days', 'machine_model']),
    ['require_login', 'test_mode', 'history_retention_days', 'machine_model'],
  )
})
