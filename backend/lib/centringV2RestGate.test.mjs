/**
 * Version 2 rest gate, live wiring (phase 5): machine setup "already ready",
 * the production Start gate, the production screen lines, and the class A
 * notice / initialization failure text. Recipe from an in-memory reference,
 * STATUS from the STATUS cache or a mocked master.
 */
import { test, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { heightFromSigned, S_MAX } from './centringMaster/centring_height_model.js'
import { registerCentringConfigStore, loadCentringConfig } from './centring.mjs'
import { initProductionContext } from './productionContext.mjs'
import { __setCachedCentringStatusForTest, getCachedCentringStatus } from './tcpSubsystemHealth.mjs'
import { clearAdvancedHPreReady, getAdvancedHPreReady, noteAdvancedHPreReady } from './centringAdvancedGap.mjs'
import { expectedReferencePoses } from './centringV2/position.mjs'
import { CLASS_A_UNKNOWN_NOTICE } from './centringV2/positionText.mjs'
import {
  __setCentringV2MasterForTest,
  clearCentringV2OperatorText,
  getCentringV2ScreenStatus,
  getCentringV2StartBlockReason,
  isCentringV2SetupReady,
  runCentringV2Step,
} from './centringV2Production.mjs'

const REF_ID = 'REF-V2-REST'
const TUBE_ID = 'TUBE-V2-REST'
const CAL = Object.freeze({ calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })
const RECIPE = Object.freeze({ l_eff_mm: 50, h_pre_mm: 3, h_post_mm: 22, centring_axis: 'both' })

const BASE = Object.freeze({ busy: false, estop: false, cal: true, moveEnd: 'ok', uh: false, ut: false, lh: false, lt: false, ...CAL })
const POSES = expectedReferencePoses({ reference: RECIPE, slaveCal: CAL })
const AT_H_PRE = {
  ...BASE,
  u: POSES.h_pre.upper.angleDeg, pu: POSES.h_pre.upper.pulseUs, puMm: POSES.h_pre.upper.sideHeightMm,
  l: POSES.h_pre.lower.angleDeg, pl: POSES.h_pre.lower.pulseUs, plMm: POSES.h_pre.lower.sideHeightMm,
}
const AT_TRAVEL = {
  ...BASE,
  u: S_MAX, pu: CAL.tu, puMm: heightFromSigned(S_MAX), ut: true,
  l: S_MAX, pl: CAL.tl, plMm: heightFromSigned(S_MAX), lt: true,
}
const OFF_POSE = { ...AT_H_PRE, pu: AT_H_PRE.pu + 60, pl: AT_H_PRE.pl + 60 }

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE product_references (id TEXT PRIMARY KEY, shrink_tube_id TEXT);
    CREATE TABLE shrink_tubes (
      id TEXT PRIMARY KEY, name TEXT, diameter_mm REAL, length_mm REAL,
      centring_mechanism TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      h_pre_mm REAL, h_post_mm REAL, l_eff_mm REAL, centering_travel_mm REAL,
      centering_input_mm REAL, centering_output_mm REAL, centering_move_travel_mm REAL,
      centring_axis TEXT, centring_derived_updated_at TEXT
    );
  `)
  db.prepare(`INSERT INTO shrink_tubes VALUES (?, 'tube', 5, 50, 'both', 1, 3, 22, 50, 40, 140, 180, 40, 'both', NULL)`).run(TUBE_ID)
  db.prepare('INSERT INTO product_references VALUES (?, ?)').run(REF_ID, TUBE_ID)
  return db
}

before(() => {
  initProductionContext(createDb(), () => ({ centring_frame_config: {}, centering_input_start_mm: 140, centering_input_offset_mm: 0 }))
  registerCentringConfigStore({ load: () => ({ slaveCal: { ...CAL }, mechOffsetMm: 0 }), save: () => {}, path: () => ':memory:' })
  loadCentringConfig()
})

beforeEach(() => {
  delete process.env.PRODUCTION_SKIP_CENTRING
  clearAdvancedHPreReady()
  clearCentringV2OperatorText()
})

afterEach(() => {
  __setCentringV2MasterForTest(null)
  clearAdvancedHPreReady()
})

test('setup is ready when both axes are H_PRE', () => {
  const r = isCentringV2SetupReady(REF_ID, AT_H_PRE)
  assert.equal(r.ready, true)
  assert.equal(r.reason, null)
})

test('setup is not ready when both axes are at TRAVEL (closed idle)', () => {
  const r = isCentringV2SetupReady(REF_ID, AT_TRAVEL)
  assert.equal(r.ready, false)
  assert.match(r.reason, /Centring not at the reference closing height \(upper TRAVEL, lower TRAVEL\)/)
})

test('setup is not ready without STATUS, with E-stop, or for a reference without a recipe', () => {
  assert.equal(isCentringV2SetupReady(REF_ID, null).ready, false)
  assert.equal(isCentringV2SetupReady(REF_ID, { ...AT_H_PRE, estop: true }).ready, false)
  const missing = isCentringV2SetupReady('NO-SUCH-REF', AT_H_PRE)
  assert.equal(missing.ready, false)
  assert.match(missing.reason, /Centring recipe missing/)
})

test('Start is not blocked solely because the advanced-gap latch is clear, when the axes are H_PRE', () => {
  assert.equal(getAdvancedHPreReady(), null)
  __setCachedCentringStatusForTest(AT_H_PRE)
  assert.equal(getCentringV2StartBlockReason(REF_ID), null)
})

test('Start is blocked at TRAVEL, and the latch does not open it', () => {
  __setCachedCentringStatusForTest(AT_TRAVEL)
  assert.match(getCentringV2StartBlockReason(REF_ID), /^Centring not at the reference closing height/)
  noteAdvancedHPreReady(REF_ID, 3)
  assert.match(getCentringV2StartBlockReason(REF_ID), /^Centring not at the reference closing height/)
})

test('Start gate is skipped with PRODUCTION_SKIP_CENTRING=1', () => {
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  __setCachedCentringStatusForTest(AT_TRAVEL)
  assert.equal(getCentringV2StartBlockReason(REF_ID), null)
  assert.equal(getCentringV2ScreenStatus(REF_ID), null)
})

test('production screen: one line per axis from the cached STATUS', () => {
  __setCachedCentringStatusForTest(AT_H_PRE)
  assert.deepEqual(getCentringV2ScreenStatus(REF_ID).lines.map((l) => l.line), [
    'Upper axis: At the reference closing height.',
    'Lower axis: At the reference closing height.',
  ])
  __setCachedCentringStatusForTest({ ...AT_TRAVEL, uh: true })
  assert.deepEqual(getCentringV2ScreenStatus(REF_ID).lines.map((l) => l.position), ['WIRING', 'TRAVEL'])
  __setCachedCentringStatusForTest(OFF_POSE)
  const s = getCentringV2ScreenStatus(REF_ID)
  assert.match(s.lines[0].line, /^Upper axis: Error\. The centring axis is between the limits/)
  assert.equal(s.notice, null)
})

const carriage = { async moveAmmT2() { throw new Error('Class A must not move the carriage') } }
const reference = { ...RECIPE, centering_output_mm: 180, referenceId: REF_ID }

test('class A UNKNOWN: notice shown while initialization runs; failure shows "Initialization failed." + the cycle message', async () => {
  let duringInit = null
  __setCentringV2MasterForTest({
    async status() { return { ...OFF_POSE } },
    async homeBoth() {
      duringInit = getCentringV2ScreenStatus(REF_ID)
      throw new Error('HOME timeout')
    },
  })
  await assert.rejects(runCentringV2Step(reference, { carriage }), (err) => err.code === 'HOME_FAILED')
  assert.equal(duringInit.notice, CLASS_A_UNKNOWN_NOTICE)
  assert.equal(duringInit.message, null)
  const after = getCentringV2ScreenStatus(REF_ID)
  assert.equal(after.notice, CLASS_A_UNKNOWN_NOTICE)
  assert.match(after.message, /^Initialization failed\. HOME did not finish: HOME timeout\./)
  assert.match(after.message, /Check the HOME switches/)
})

test('class A UNKNOWN: initialization succeeds → notice cleared, H_PRE STATUS published to the Start gate', async () => {
  let state = { ...OFF_POSE }
  __setCentringV2MasterForTest({
    async status() { return { ...state } },
    async homeBoth() { state = { ...AT_TRAVEL, ut: false, lt: false, uh: true, lh: true }; return { status: { ...state } } },
    async setCal() { throw new Error('unexpected SETCAL') },
    async moveBoth() { state = { ...AT_H_PRE }; return { status: { ...state } } },
  })
  __setCachedCentringStatusForTest(OFF_POSE)
  const r = await runCentringV2Step(reference, { carriage })
  assert.equal(r.outcome, 'initialized')
  assert.equal(getCentringV2ScreenStatus(REF_ID).notice, null)
  assert.deepEqual(getCachedCentringStatus(), AT_H_PRE)
  assert.equal(getCentringV2StartBlockReason(REF_ID), null)
})

test('acceptance: no advanced-gap import in the live wiring, no closed-idle check in setup', () => {
  const live = fs.readFileSync(new URL('./centringV2Production.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(live, /centringAdvancedGap/)
  const setup = fs.readFileSync(new URL('./machineSetup.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(setup, /isCentringInitIdleReady/)
  const ready = fs.readFileSync(new URL('./referenceProductionReady.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(ready, /getCentringProductionBlockReason/)
})
