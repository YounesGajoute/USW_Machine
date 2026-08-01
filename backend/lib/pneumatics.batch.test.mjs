import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setPneumaticOutputs } from './pneumatics.mjs'
import { DO } from './ethercat.mjs'

test('setPneumaticOutputs opens both clamps in one setOutputs batch', async () => {
  const batches = []
  const singles = []
  const ecm = {
    async setOutputs(outputs) {
      batches.push(outputs)
      return { status: 'ok', outputs }
    },
    async setOutput(pin, value) {
      singles.push({ pin, value })
      return { status: 'ok', pin, value }
    },
  }

  await setPneumaticOutputs(ecm, { clampRight: false, clampLeft: false })

  assert.equal(batches.length, 1, 'both clamps must share one PDO write')
  assert.deepEqual(
    batches[0].map(({ pin, value }) => ({ pin, value: value ? 1 : 0 })).sort((a, b) => a.pin - b.pin),
    [
      { pin: DO.CLAMP_RIGHT, value: 0 },
      { pin: DO.CLAMP_LEFT, value: 0 },
    ].sort((a, b) => a.pin - b.pin),
  )
  // Only main-air re-assert may use single setOutput
  assert.ok(singles.every((w) => w.pin === DO.MAIN_AIR))
  assert.ok(!singles.some((w) => w.pin === DO.CLAMP_RIGHT || w.pin === DO.CLAMP_LEFT))
})

test('setPneumaticOutputs falls back to sequential setOutput when batch API missing', async () => {
  const writes = []
  const ecm = {
    async setOutput(pin, value) {
      writes.push({ pin, value: value ? 1 : 0 })
      return { status: 'ok' }
    },
  }

  await setPneumaticOutputs(ecm, { clampRight: false, clampLeft: false })

  assert.ok(writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0))
  assert.ok(writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 0))
})

test('setPneumaticOutputs closes both clamps in one setOutputs batch', async () => {
  const batches = []
  const ecm = {
    async setOutputs(outputs) {
      batches.push(outputs)
      return { status: 'ok', outputs }
    },
    async setOutput(pin, value) {
      return { status: 'ok', pin, value }
    },
  }

  await setPneumaticOutputs(ecm, { clampRight: true, clampLeft: true })

  assert.equal(batches.length, 1)
  const pins = batches[0].map((o) => o.pin).sort((a, b) => a - b)
  assert.deepEqual(pins, [DO.CLAMP_RIGHT, DO.CLAMP_LEFT].sort((a, b) => a - b))
  assert.ok(batches[0].every((o) => !!o.value))
})
