import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createManualVisionRun } from './manualVisionRun.mjs'

test('Master camera run stays active until the exact dispatch settles', async () => {
  let finish
  const runner = createManualVisionRun(() => new Promise(resolve => { finish = resolve }))
  const first = runner.run('REF-1')
  assert.equal(runner.isActive(), true)
  await assert.rejects(runner.run('REF-1'), { status: 409 })
  finish({ result: { outcome: 'PASS' }, runId: 'run-1' })
  assert.deepEqual(await first, { result: { outcome: 'PASS' }, runId: 'run-1' })
  assert.equal(runner.isActive(), false)
})

test('failed camera dispatch releases the manual-run lock', async () => {
  const runner = createManualVisionRun(async () => { throw new Error('camera unavailable') })
  await assert.rejects(runner.run('REF-1'), /camera unavailable/)
  assert.equal(runner.isActive(), false)
})
