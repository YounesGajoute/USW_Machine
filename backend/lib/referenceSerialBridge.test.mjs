import { test } from 'node:test'
import assert from 'node:assert/strict'
import { broadcastReferenceToMachines } from './referenceSerialBridge.mjs'

test('missing configured weld adapter fails fast with its actual path', async () => {
  const original = process.env.REFERENCE_SERIAL_WELD_PATH
  const path = '/tmp/us-machine-test-missing-weld-adapter'
  process.env.REFERENCE_SERIAL_WELD_PATH = path
  try {
    const result = await broadcastReferenceToMachines('TEST', { shrink: false })
    assert.deepEqual(result.sentTo, [])
    assert.equal(result.skipped, false)
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].port, 'weld')
    assert.equal(result.failed[0].path, path)
    assert.match(result.failed[0].message, /USB serial adapter is missing/)
    assert.doesNotMatch(result.failed[0].message, /retried/)
  } finally {
    if (original === undefined) delete process.env.REFERENCE_SERIAL_WELD_PATH
    else process.env.REFERENCE_SERIAL_WELD_PATH = original
  }
})
