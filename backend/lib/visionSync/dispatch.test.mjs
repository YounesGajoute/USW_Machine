import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createVisionSyncRunStore } from './runStore.mjs'
import { dispatchVersionedRun, reconcileUnresolvedRuns } from './dispatch.mjs'

function rig(t) {
  const db = new Database(':memory:')
  t.after(() => db.close())
  const store = createVisionSyncRunStore(db)
  store.newRunId = () => 'run-1'
  let clock = 1_000
  const ticket = { binding: { referenceId: 'REF-1', localRevision: '2' },
    grantId: 'grant-1', ledgerId: 'ledger-1', localRevision: '2', expiresAt: 10_000 }
  return { store, ticket, now: () => clock, sleep: ms => { clock += ms } }
}

test('lost POST response is reconciled by exact identity without another POST', async t => {
  const r = rig(t)
  let posts = 0
  const slaveFeedback = {
    outcome: 'FAIL', capture_id: 'capture-42',
    welding_splice: { checks: [{ tool_name: 'length', result: 'NG', reason: 'below limit' }] },
    heat_shrink_tube: { checks: [] },
  }
  const result = await dispatchVersionedRun({ ...r,
    post: async () => { posts++; throw new Error('response lost') },
    get: async (runId, ledgerId) => ({ runId, ledgerId, request: r.store.get(runId).request,
      state: 'COMPLETED', result: slaveFeedback }),
  })
  assert.equal(posts, 1)
  assert.equal(result.runId, 'run-1')
  assert.deepEqual(result.result, slaveFeedback)
  assert.equal(r.store.get('run-1').state, 'COMPLETED')
  assert.deepEqual(r.store.get('run-1').result, slaveFeedback)
})

test('unknown outcome stays in history but a fresh granted run is allowed', async t => {
  const r = rig(t)
  await assert.rejects(() => dispatchVersionedRun({ ...r, timeoutMs: 1_000,
    post: async () => { throw new Error('lost') }, get: async () => { throw new Error('offline') },
  }), { code: 'RUN_OUTCOME_UNKNOWN' })
  assert.equal(r.store.unresolved().length, 1)
  assert.equal(r.store.get('run-1').state, 'UNKNOWN_OUTCOME')
  r.store.newRunId = () => 'run-2'
  let posts = 0
  const completed = await dispatchVersionedRun({ ...r,
    post: async request => {
      posts++
      assert.equal(request.runId, 'run-2')
      return { ...request, request, state: 'COMPLETED', result: { outcome: 'PASS' } }
    }, get: async () => { throw new Error('Completed response needs no lookup') } })
  assert.equal(posts, 1)
  assert.equal(completed.runId, 'run-2')
  assert.equal(r.store.get('run-1').state, 'UNKNOWN_OUTCOME')
  assert.equal(r.store.get('run-1').result, null)
  assert.equal(r.store.get('run-2').state, 'COMPLETED')
  await reconcileUnresolvedRuns({ store: r.store,
    get: async (runId, ledgerId) => ({ runId, ledgerId, request: r.store.get(runId).request,
      state: 'FAILED', error: 'camera unavailable' }) })
  assert.equal(r.store.unresolved().length, 0)
  assert.equal(r.store.get('run-1').state, 'FAILED')
  assert.deepEqual(r.store.get('run-2').result, { outcome: 'PASS' })
})

test('a new run still requires an unexpired grant and never reuses a run ID', async t => {
  const r = rig(t)
  let posts = 0
  const post = async request => { posts++; return { ...request, request, state: 'COMPLETED', result: { outcome: 'FAIL' } } }
  await assert.rejects(dispatchVersionedRun({ ...r, ticket: { ...r.ticket, expiresAt: 0 }, post }),
    { code: 'GRANT_EXPIRED' })
  assert.equal(posts, 0)
  await dispatchVersionedRun({ ...r, post })
  await assert.rejects(dispatchVersionedRun({ ...r, post }), { code: 'RUN_CONFLICT' })
  assert.equal(posts, 1)
})

test('a late result for another run cannot satisfy the new inspection', async t => {
  const r = rig(t)
  await assert.rejects(dispatchVersionedRun({ ...r, timeoutMs: 1000,
    post: async request => ({ ...request, request, runId: 'old-run', state: 'COMPLETED', result: { outcome: 'PASS' } }),
    get: async () => { throw new Error('Current result unavailable') },
  }), { code: 'RUN_OUTCOME_UNKNOWN' })
  assert.equal(r.store.get('run-1').state, 'UNKNOWN_OUTCOME')
  assert.equal(r.store.get('run-1').result, null)
})
