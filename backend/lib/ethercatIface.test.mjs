import { test } from 'node:test'
import assert from 'node:assert/strict'
import { __ethercatIfaceTest as iface } from './ethercat.mjs'

test('isOnboardLanInterface rejects macb and end*', () => {
  assert.equal(iface.isOnboardLanInterface('eth0', 'macb'), true)
  assert.equal(iface.isOnboardLanInterface('end0', 'macb'), true)
  assert.equal(iface.isOnboardLanInterface('end0', ''), true)
  assert.equal(iface.isOnboardLanInterface('enx00e04c680a90', 'r8152'), false)
})

test('transient ethN names are excluded from auto-detect (udev rename window)', () => {
  assert.equal(iface.isTransientKernelUsbName('eth0'), true)
  assert.equal(iface.isTransientKernelUsbName('eth1'), true)
  assert.equal(iface.isTransientKernelUsbName('enx00e04c680a90'), false)
  assert.equal(iface.isTransientKernelUsbName('end0'), false)
  const detected = iface.autoDetectEtherCATInterface()
  if (detected != null) {
    assert.equal(iface.isTransientKernelUsbName(detected), false)
    assert.ok(detected.startsWith('enx'))
    assert.equal(iface.isStableEtherCATAutoName(detected), true)
  }
})

test('pickEtherCATInterface prefers persisted/enx* over missing eth1', () => {
  const picked = iface.pickEtherCATInterface('eth1')
  assert.notEqual(picked, 'eth1')
  if (picked != null) {
    assert.equal(iface.isEtherCATCapableInterface(picked), true)
    assert.equal(iface.isOnboardLanInterface(picked), false)
  }
})

test('resolveEtherCATInterface does not fall back to unsuitable requested NIC', () => {
  // When the requested name is absent/unusable, resolve must not return that stale name.
  // On a machine with a live r8152 (or persisted enx*), it may return that capable NIC instead.
  const resolved = iface.resolveEtherCATInterface('eth1-does-not-exist-zzzz')
  assert.notEqual(resolved, 'eth1-does-not-exist-zzzz')
  if (resolved != null) {
    assert.equal(iface.isEtherCATCapableInterface(resolved), true)
  }
})

test('waitForEtherCATInterface returns promptly when NIC already present', async () => {
  const t0 = Date.now()
  const waited = await iface.waitForEtherCATInterface('')
  const elapsed = Date.now() - t0
  // With enx* already up, must not burn the full enum wait budget.
  assert.ok(elapsed < 2000, `expected fast resolve, took ${elapsed}ms`)
  if (waited != null) {
    assert.equal(iface.isEtherCATCapableInterface(waited), true)
    assert.equal(iface.isTransientKernelUsbName(waited), false)
  }
})

test('getStatus exposes runtime, configured, and persisted interface fields', async () => {
  const { getEtherCATManager } = await import('./ethercat.mjs')
  const status = getEtherCATManager().getStatus()
  assert.ok(status.config)
  assert.ok(
    typeof status.config.interface === 'string' || status.config.interface == null,
  )
  assert.ok(
    typeof status.config.configuredInterface === 'string' ||
      status.config.configuredInterface == null ||
      status.config.configuredInterface === '',
  )
  // null when no successful connect has persisted a NIC yet; string when present
  assert.ok(
    status.config.persistedInterface === null ||
      typeof status.config.persistedInterface === 'string',
  )
  const persisted = iface.loadPersistedEtherCATInterface()
  assert.equal(status.config.persistedInterface, persisted)
})
