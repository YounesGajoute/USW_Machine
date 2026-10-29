import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createVisionSyncRunStore } from './runStore.mjs'

test('run identity survives restart and uncertain outcomes cannot be redispatched under a new request', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vision-master-runs-'))
  const file = join(dir, 'runs.db')
  let db = new Database(file)
  t.after(() => { db?.close(); rmSync(dir, { recursive: true, force: true }) })
  let store = createVisionSyncRunStore(db)
  const request = { runId: 'run-1', ledgerId: 'ledger-1',
    binding: { referenceId: 'REF-1' }, grantId: 'grant-1', purpose: 'production' }
  assert.equal(store.create(request).state, 'CREATED')
  store.mark('run-1', 'UNKNOWN_OUTCOME', { error: 'POST response lost' })
  db.close(); db = new Database(file); store = createVisionSyncRunStore(db)
  assert.equal(store.unresolved().length, 1)
  assert.equal(store.create(request).state, 'UNKNOWN_OUTCOME')
  assert.throws(() => store.create({ ...request, grantId: 'grant-2' }), { code: 'RUN_CONFLICT' })
  store.mark('run-1', 'COMPLETED', { result: { outcome: 'PASS' } })
  assert.equal(store.unresolved().length, 0)
  assert.deepEqual(store.get('run-1').result, { outcome: 'PASS' })
  assert.throws(() => store.mark('run-1', 'FAILED'), { code: 'RUN_TERMINAL' })
})
