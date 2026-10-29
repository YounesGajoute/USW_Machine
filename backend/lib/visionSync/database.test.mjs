import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db.mjs'
import { createVisionSyncStore } from './store.mjs'
import { createVisionSyncService } from './service.mjs'
import { fixture } from './fixtures/helpers.mjs'

// Use the real initializer with an explicit isolated path, never getDbPath() or
// index.mjs (which starts station services). This exercises migrations as well
// as SQLite persistence; machine selection is deliberately injected.
test('real database schema, revision triggers and sticky ledger survive reopening', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vision-sync-database-'))
  let db
  t.after(() => { db?.close(); rmSync(dir, { recursive: true, force: true }) })
  const file = join(dir, 'test.db')
  db = openDatabase(file)
  const f = fixture()
  t.after(() => f.db.close())
  const row = f.db.prepare('SELECT * FROM product_references WHERE id = ?').get('reference-A')
  db.prepare(`INSERT INTO shrink_tubes (id, name, length_mm, diameter_mm, created_at, updated_at)
    VALUES ('tube', 'test tube', 50, 10, '', '')`).run()
  const insert = db.prepare(`INSERT INTO product_references
    (id, name, vision_inspection_enabled, vision_checks_json, shrink_tube_id, realtime_v2_config_json, created_at, updated_at)
    VALUES (@id, @name, @vision_inspection_enabled, @vision_checks_json, @shrink_tube_id, @realtime_v2_config_json, '', '')`)
  insert.run(row)
  let store = createVisionSyncStore(db)
  assert.equal(store.readDesired(row.id).desiredMode, 'enabled')
  const revision = () => db.prepare('SELECT CAST(revision AS TEXT) AS revision FROM vision_sync_reference_revisions WHERE reference_id = ?').get(row.id).revision
  assert.equal(revision(), '1') // existing rows are backfilled
  const run = sql => db.exec(sql)
  run("UPDATE product_references SET name = 'Renamed' WHERE id = 'reference-A'")
  assert.equal(revision(), '1')
  run('UPDATE shrink_tubes SET length_mm = 60')
  assert.equal(revision(), '2')
  assert.deepEqual(store.readDesired(row.id).issues, ['RECIPE_REVALIDATION_REQUIRED'])
  assert.throws(() => db.transaction(() => {
    run('UPDATE shrink_tubes SET diameter_mm = 11')
    throw new Error('rollback')
  })())
  assert.equal(revision(), '2')
  run('UPDATE shrink_tubes SET length_mm = 50')
  run("DELETE FROM shrink_tubes WHERE id = 'tube'")
  assert.equal(revision(), '4')
  assert.equal(store.readDesired(row.id).desiredMode, 'hold')
  run("INSERT INTO shrink_tubes (id, name, length_mm, diameter_mm, created_at, updated_at) VALUES ('tube', 'test tube', 50, 10, '', '')")
  assert.equal(revision(), '5')
  run("DELETE FROM product_references WHERE id = 'reference-A'")
  assert.equal(revision(), '6') // tombstone remains
  insert.run(row)
  assert.equal(revision(), '7') // recreated ID cannot reuse a revision
  assert.equal(store.observeLedger('slave-example', 'ledger-original'), false)
  assert.equal(store.observeLedger('slave-example', 'ledger-replaced'), true)

  db.close(); db = undefined
  db = openDatabase(file)
  store = createVisionSyncStore(db)
  assert.equal(revision(), '7')
  assert.equal(store.readDesired(row.id).desiredMode, 'enabled')
  assert.equal(store.observeLedger('slave-example', 'ledger-replaced'), true)
  const service = createVisionSyncService({ store, deviceId: 'slave-example', bootId: 'restarted',
    getSelection: () => ({ referenceId: null, selectionRevision: '0' }) })
  const registration = service.register({ ...f.registration, ledgerId: 'ledger-replaced' }).response
  assert.equal(registration.masterBootId, 'restarted')
  const state = service.state(f.stateRequest(registration))
  assert.equal(state.desiredMode, 'hold')
  assert.equal(state.binding, null)
  assert.deepEqual(state.issues, ['LEDGER_DISCONTINUITY_REVIEW_REQUIRED'])

  const cleanService = createVisionSyncService({ store, deviceId: 'new-device',
    getSelection: () => ({ referenceId: null, selectionRevision: '0' }) })
  const cleanRegistration = cleanService.register({ ...f.registration, deviceId: 'new-device' }).response
  const cleanState = cleanService.state(f.stateRequest(cleanRegistration))
  assert.equal(cleanState.desiredMode, 'disabled')
  assert.equal(cleanState.binding.referenceId, null) // persisted recipe is not selection
})
