import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createRealtimeInspectionRouter } from './realtimeInspectionRoutes.mjs'
import { initMachineOperationAccess } from './machineOperationAccess.mjs'

test('Master Run inspection dispatches one versioned Slave run and returns its feedback', async t => {
  const previousMode = process.env.VISION_SYNC_MODE
  process.env.VISION_SYNC_MODE = 'production'
  t.after(() => {
    if (previousMode === undefined) delete process.env.VISION_SYNC_MODE
    else process.env.VISION_SYNC_MODE = previousMode
  })
  initMachineOperationAccess({ readSystemSettings: () => ({ require_login: false }), getUserById: () => null })
  let busy = false
  let authorized = true
  const calls = []
  const app = express()
  app.use('/api/realtime-v2', createRealtimeInspectionRouter({
    db: {}, getLoadedReferenceId: () => 'REF-1',
    getVisionSyncStatus: () => ({ productionAuthorized: authorized, referenceId: 'REF-1',
      desiredMode: 'enabled', issues: [] }),
    isMachineBusy: () => busy,
    runVersionedInspection: async referenceId => {
      calls.push(referenceId)
      return { runId: 'run-1', ledgerId: 'ledger-1', result: { outcome: 'FAIL', capture_id: 'capture-1' } }
    },
    requireAuth: (_req, _res, next) => next(),
  }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const post = () => fetch(`http://127.0.0.1:${server.address().port}/api/realtime-v2/run`, { method: 'POST' })

  const response = await post()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    runId: 'run-1', ledgerId: 'ledger-1', result: { outcome: 'FAIL', capture_id: 'capture-1' },
  })
  assert.deepEqual(calls, ['REF-1'])

  authorized = false
  assert.equal((await post()).status, 409)
  busy = true
  authorized = true
  assert.equal((await post()).status, 409)
  assert.deepEqual(calls, ['REF-1'])
})
