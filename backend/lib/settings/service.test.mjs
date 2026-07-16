/**
 * SettingsService domain persistence + facade smoke tests (temp DB).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openDatabase } from '../db.mjs'
import { initSettingsService } from './index.mjs'
import { SettingsError } from './errors.mjs'

let tmpDir
let db
let svc

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-svc-'))
  const dbPath = path.join(tmpDir, 'test.db')
  process.env.MAIN_DATA_DB_PATH = dbPath
  db = openDatabase(dbPath)
  svc = initSettingsService({
    db,
    runtime: {
      loadPickPlaceConfig: () => {},
      loadCentringConfig: () => {},
      closeSerialSession: () => {},
      reloadProductionSequenceConfig: () => {},
      setReferenceSerialFromSettings: () => {},
    },
  })
})

after(() => {
  try {
    db?.close()
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

test('catalog lists all domains', () => {
  const cat = svc.catalogForCaller({ canSeeHigh: true, canSeeAdmin: true })
  const ids = cat.map((d) => d.id)
  assert.ok(ids.includes('ui'))
  assert.ok(ids.includes('pick_place'))
  assert.ok(ids.includes('access'))
})

test('patch ui theme validates and audits', () => {
  const beforeCount = svc.queryAudit({ domain: 'ui', limit: 100 }).length
  const result = svc.patchDomain('ui', { theme: 'versigent' }, { actorUsername: 'tester' })
  assert.equal(result.data.theme, 'versigent')
  assert.ok(result.etag)
  const afterCount = svc.queryAudit({ domain: 'ui', limit: 100 }).length
  assert.ok(afterCount > beforeCount)
})

test('invalid theme returns 422 SettingsError', () => {
  assert.throws(
    () => svc.patchDomain('ui', { theme: 'neon-purple' }, { actorUsername: 'tester' }),
    (err) => err instanceof SettingsError && err.status === 422,
  )
})

test('flat facade patch updates pick_place domain', () => {
  const next = svc.patchSystemFlat(
    { pick_place_config: { movementSpeedMmS: 42 } },
    { actorUsername: 'tester' },
  )
  assert.equal(next.pick_place_config.movementSpeedMmS, 42)
  assert.equal(svc.getDomainDocument('pick_place').data.movementSpeedMmS, 42)
})

test('etag conflict yields 409', () => {
  const doc = svc.getDomainDocument('ui')
  assert.throws(
    () =>
      svc.patchDomain('ui', { locale: 'en' }, { actorUsername: 'tester', ifMatch: '"deadbeef"' }),
    (err) => err instanceof SettingsError && err.status === 409,
  )
  const ok = svc.patchDomain('ui', { locale: 'en' }, { actorUsername: 'tester', ifMatch: doc.etag })
  assert.equal(ok.data.locale, 'en')
})

test('export / import dry-run / reset domain', () => {
  const pkg = svc.exportPackage()
  assert.equal(pkg.packageVersion, 1)
  assert.ok(pkg.domains.pick_place)
  const dry = svc.importPackage(pkg, { dryRun: true })
  assert.equal(dry.dryRun, true)
  const reset = svc.resetDomain('ui', { actorUsername: 'tester' })
  assert.ok(reset.backupPath)
  assert.equal(reset.data.theme, 'versigent')
})

test('public view keys match PUBLIC_SYSTEM_SETTING_KEYS allowlist', async () => {
  const { PUBLIC_SYSTEM_SETTING_KEYS } = await import('./settingsAcl.mjs')
  svc.patchSystemFlat({ serial_number: 'SN-TEST' }, { actorUsername: 'admin' })
  const pub = svc.getPublicSystemView()
  assert.deepEqual(Object.keys(pub).sort(), [...PUBLIC_SYSTEM_SETTING_KEYS].sort())
  assert.equal(pub.serial_number, undefined)
  assert.equal(pub.pick_place_config, undefined)
  assert.ok('theme' in pub)
})

test('theme persists across hydrateRegistry reload', () => {
  const flat = svc.patchSystemFlat({ theme: 'dark' }, { actorUsername: 'kiosk' })
  assert.equal(flat.theme, 'dark')
  assert.equal(svc.getDomainDocument('ui').data.theme, 'dark')
  assert.equal(svc.getAssembledSystemView().theme, 'dark')
  assert.equal(svc.getPublicSystemView().theme, 'dark')

  svc.hydrateRegistry()
  assert.equal(svc.getDomainDocument('ui').data.theme, 'dark')
  assert.equal(svc.getAssembledSystemView().theme, 'dark')
  assert.equal(svc.getPublicSystemView().theme, 'dark')
})

test('pick_place config survives hydrateRegistry reload', () => {
  svc.patchSystemFlat(
    { pick_place_config: { movementSpeedMmS: 77 } },
    { actorUsername: 'tester' },
  )
  assert.equal(svc.getAssembledSystemView().pick_place_config.movementSpeedMmS, 77)
  svc.hydrateRegistry()
  assert.equal(svc.getAssembledSystemView().pick_place_config.movementSpeedMmS, 77)
})

test('machine_model patch applies and persists pick_place + production_sequence profile', () => {
  const next = svc.patchSystemFlat({ machine_model: 'STCS-evo500' }, { actorUsername: 'tester' })
  assert.equal(next.machine_model, 'STCS-evo500')
  assert.equal(next.pick_place_config.maxPositionMm, 500)
  assert.equal(next.production_sequence_config.movePositionEvoMm, 400)

  svc.hydrateRegistry()
  const reloaded = svc.getAssembledSystemView()
  assert.equal(reloaded.machine_model, 'STCS-evo500')
  assert.equal(reloaded.pick_place_config.maxPositionMm, 500)
  assert.equal(reloaded.production_sequence_config.movePositionEvoMm, 400)

  const cs19 = svc.patchSystemFlat({ machine_model: 'STCS-CS19' }, { actorUsername: 'tester' })
  assert.equal(cs19.pick_place_config.maxPositionMm, 470)
  assert.equal(cs19.production_sequence_config.movePositionEvoMm, 320)
})

test('explicit pick_place_config with machine_model is not overwritten by profile pack', () => {
  const next = svc.patchSystemFlat(
    {
      machine_model: 'STCS-evo500',
      pick_place_config: { movementSpeedMmS: 55, maxPositionMm: 480 },
    },
    { actorUsername: 'tester' },
  )
  assert.equal(next.machine_model, 'STCS-evo500')
  assert.equal(next.pick_place_config.movementSpeedMmS, 55)
  assert.equal(next.pick_place_config.maxPositionMm, 480)
  // Sequence pack still applied when not explicitly provided
  assert.equal(next.production_sequence_config.movePositionEvoMm, 400)
})

test('post_update_action nothing and restart-service persist across hydrate', () => {
  const nothing = svc.patchSystemFlat({ post_update_action: 'nothing' }, { actorUsername: 'admin' })
  assert.equal(nothing.post_update_action, 'nothing')
  svc.hydrateRegistry()
  assert.equal(svc.getAssembledSystemView().post_update_action, 'nothing')

  const restart = svc.patchSystemFlat(
    { post_update_action: 'restart-service' },
    { actorUsername: 'admin' },
  )
  assert.equal(restart.post_update_action, 'restart-service')
  svc.hydrateRegistry()
  assert.equal(svc.getAssembledSystemView().post_update_action, 'restart-service')
})

test('invalid post_update_action returns 422', () => {
  assert.throws(
    () => svc.patchSystemFlat({ post_update_action: 'halt-and-catch-fire' }, { actorUsername: 'admin' }),
    (err) => err instanceof SettingsError && err.status === 422,
  )
})

test('legacy post_update_action none hydrates as nothing', () => {
  // Simulate pre-fix DB row that still stores legacy "none".
  const legacy = {
    serial_number: null,
    quickpass: false,
    post_update_action: 'none',
  }
  db.prepare(
    `UPDATE settings_domain SET json = ?, checksum = NULL, updated_at = ? WHERE domain = 'system'`,
  ).run(JSON.stringify(legacy), new Date().toISOString())
  svc.hydrateRegistry()
  assert.equal(svc.getDomainDocument('system').data.post_update_action, 'nothing')
  assert.equal(svc.getAssembledSystemView().post_update_action, 'nothing')
})

test('production_cycle_variant is always advanced; legacy values coerce', () => {
  assert.equal(svc.getAssembledSystemView().production_cycle_variant, 'advanced')
  const next = svc.patchSystemFlat(
    { production_cycle_variant: 'advanced' },
    { actorUsername: 'admin' },
  )
  assert.equal(next.production_cycle_variant, 'advanced')
  svc.hydrateRegistry()
  assert.equal(svc.getAssembledSystemView().production_cycle_variant, 'advanced')
  assert.throws(
    () =>
      svc.patchSystemFlat({ production_cycle_variant: 'pneumatics-only' }, { actorUsername: 'admin' }),
    (err) => err instanceof SettingsError && err.status === 422,
  )
  const legacyFull = svc.patchSystemFlat(
    { production_cycle_variant: 'full' },
    { actorUsername: 'admin' },
  )
  assert.equal(legacyFull.production_cycle_variant, 'advanced')
  const legacyCentring = svc.patchSystemFlat(
    { production_cycle_variant: 'centring' },
    { actorUsername: 'admin' },
  )
  assert.equal(legacyCentring.production_cycle_variant, 'advanced')
})

test('same machine_model PUT does not reclobber customized pick_place', () => {
  svc.patchSystemFlat({ machine_model: 'STCS-evo500' }, { actorUsername: 'tester' })
  svc.patchSystemFlat(
    { pick_place_config: { movementSpeedMmS: 66 } },
    { actorUsername: 'tester' },
  )
  assert.equal(svc.getAssembledSystemView().pick_place_config.movementSpeedMmS, 66)

  const same = svc.patchSystemFlat({ machine_model: 'STCS-evo500' }, { actorUsername: 'tester' })
  assert.equal(same.pick_place_config.movementSpeedMmS, 66)

  const switched = svc.patchSystemFlat({ machine_model: 'STCS-CS19' }, { actorUsername: 'tester' })
  assert.equal(switched.pick_place_config.maxPositionMm, 470)
  assert.notEqual(switched.pick_place_config.movementSpeedMmS, 66)
})
