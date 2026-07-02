import test from 'node:test'
import assert from 'node:assert/strict'
import { runTcpHealthPoll } from './tcpSubsystemHealth.mjs'
import { setSetupActive } from './machineSetupHealth.mjs'

test('runTcpHealthPoll skips pick-place and centring while setup in progress', async () => {
  setSetupActive(true)
  try {
    const edges = await runTcpHealthPoll()
    assert.ok(Array.isArray(edges))
    assert.equal(edges.some((e) => e.key === 'pickPlace'), false)
    assert.equal(edges.some((e) => e.key === 'centring'), false)
  } finally {
    setSetupActive(false)
  }
})
