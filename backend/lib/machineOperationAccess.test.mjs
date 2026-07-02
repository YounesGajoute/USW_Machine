import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createMachineOperationAccess } from './machineOperationAccess.mjs'

function makeAccess(requireLogin = true) {
  return createMachineOperationAccess({
    readSystemSettings: () => ({ require_login: requireLogin }),
    getUserById: () => null,
  })
}

test('isSetupOperationAllowed is always true when require_login is enabled', () => {
  const access = makeAccess(true)
  assert.equal(access.isSetupOperationAllowed(), true)
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
