import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createMachineOperationAccess } from './machineOperationAccess.mjs'

function makeAccess(requireLogin = true, users = {}) {
  return createMachineOperationAccess({
    readSystemSettings: () => ({ require_login: requireLogin }),
    getUserById: id => users[id] ?? null,
  })
}

test('setup is locked for unsigned requests when require_login is enabled', () => {
  const access = makeAccess(true)
  assert.equal(access.isSetupOperationAllowed({ session: {} }), false)
  // No kiosk operator registered → the physical panel setup stays locked too.
  assert.equal(access.allowPanelSetup(), false)
})

test('setup is allowed for signed-in requests / operators when require_login is enabled', () => {
  const access = makeAccess(true, { u1: { id: 'u1', is_active: 1 } })
  assert.equal(access.isSetupOperationAllowed({ session: { userId: 'u1' } }), true)
  access.registerKioskOperator('u1')
  assert.equal(access.allowPanelSetup(), true)
})

test('setup is always allowed when require_login is disabled', () => {
  const access = makeAccess(false)
  assert.equal(access.isSetupOperationAllowed({ session: {} }), true)
  assert.equal(access.allowPanelSetup(), true)
})

test('isMachineOperationAllowed is false for unsigned requests when require_login is enabled', () => {
  const access = makeAccess(true)
  assert.equal(access.isMachineOperationAllowed({ session: {} }), false)
  assert.match(access.denialReason({ session: {} }) ?? '', /Login required/)
})

test('isMachineOperationAllowed passes when require_login is disabled', () => {
  const access = makeAccess(false)
  assert.equal(access.isMachineOperationAllowed({ session: {} }), true)
})
