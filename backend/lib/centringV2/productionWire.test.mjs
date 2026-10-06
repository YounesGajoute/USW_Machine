/**
 * Version 2 production wiring contract (phase 4): command lists the production
 * adapter sends for Class A, Class B (+ return after the pick tail), single-axis
 * refusal, and the saved-calibration re-sync before classification.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heightFromSigned, S_MIN } from '../centringMaster/centring_height_model.js'
import {
  calRelationDiff,
  initializeForReference,
  returnProductionCentringToHPre,
  runProductionCentringStep,
  singleAxisRefusal,
  syncSlaveCal,
  SINGLE_AXIS_UNDECIDED,
} from './production.mjs'
import { expectedReferencePoses, H_POST, H_PRE } from './position.mjs'

const CAL = Object.freeze({ calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })
const CAL_CURVE = Object.freeze({ ...CAL, A: 4.67687625, B: -0.176873, C: 0.00197035, sHome: -80, sTravel: 35 })
const SILENT = Object.freeze({ info() {}, warn() {} })

const REF_A = Object.freeze({ l_eff_mm: 50, h_pre_mm: 3, h_post_mm: 22, centring_axis: 'both', centering_output_mm: 180 })
const REF_B = Object.freeze({ ...REF_A, l_eff_mm: 66.5 })

const LIVE_CAL = Object.freeze({ calId: CAL.calId, hu: CAL.hu, tu: CAL.tu, hl: CAL.hl, tl: CAL.tl })
const BASE = Object.freeze({ busy: false, estop: false, cal: true, moveEnd: 'ok', uh: false, ut: false, lh: false, lt: false, ...LIVE_CAL })

function axisAt(axis, pose, sw = {}) {
  return axis === 'upper'
    ? { u: pose.angleDeg, pu: pose.pulseUs, puMm: pose.sideHeightMm, uh: false, ut: false, ...sw }
    : { l: pose.angleDeg, pl: pose.pulseUs, plMm: pose.sideHeightMm, lh: false, lt: false, ...sw }
}

const HOME_POSE = {
  upper: { angleDeg: S_MIN, pulseUs: CAL.hu, sideHeightMm: heightFromSigned(S_MIN) },
  lower: { angleDeg: S_MIN, pulseUs: CAL.hl, sideHeightMm: heightFromSigned(S_MIN) },
}
const POSES = expectedReferencePoses({ reference: REF_A, slaveCal: CAL })
const bothAt = (poses) => ({ ...BASE, ...axisAt('upper', poses.upper), ...axisAt('lower', poses.lower) })
const AT_H_PRE = Object.freeze(bothAt(POSES.h_pre))
const AT_H_POST = Object.freeze(bothAt(POSES.h_post))
const AT_UNKNOWN = Object.freeze({ ...AT_H_PRE, u: 0, pu: 1500, puMm: heightFromSigned(0) })

/**
 * Mock master + carriage. `commands` records motion and calibration commands in
 * order (STATUS reads are not commands). `moves` maps 'CMD h' → STATUS after it.
 */
function mockRig({ initial, moves = {} }) {
  const commands = []
  let state = { ...initial }
  const move = (cmd) => async (h) => {
    const key = `${cmd} ${h}`
    commands.push(key)
    if (!moves[key]) throw new Error(`unexpected ${key}`)
    state = { ...moves[key] }
    return { status: { ...state } }
  }
  const master = {
    async status() { return { ...state } },
    async homeBoth() {
      commands.push('HOME')
      state = { ...state, ...axisAt('upper', HOME_POSE.upper, { uh: true }), ...axisAt('lower', HOME_POSE.lower, { lh: true }) }
      return { status: { ...state } }
    },
    async homeByAxis(axis) {
      if (axis === 'both') return master.homeBoth()
      throw new Error(`unexpected HOME_${axis}`)
    },
    async seekTravelByAxis(axis) {
      commands.push(`SEEK_TRAVEL ${axis}`)
      return { status: { ...state } }
    },
    async setCal(c) {
      commands.push(`SETCAL ${c.calId}`)
      state = { ...state, cal: true, calId: c.calId, hu: c.hu, tu: c.tu, hl: c.hl, tl: c.tl }
      return { ...state }
    },
    moveBoth: move('MOVEBOTHMM'),
    moveUpper: move('MOVE_UPPERMM'),
    moveLower: move('MOVE_LOWERMM'),
  }
  const carriage = {
    async moveAmmT2(mm) { commands.push(`MOVEAMMT2 ${mm}`); return { command: `MOVEAMMT2 ${mm}` } },
  }
  return { master, carriage, commands }
}

const ctx = (reference, extra = {}) => ({ reference, slaveCal: CAL, mechOffsetMm: 0, log: SILENT, ...extra })
const isHPost = (c) => c === `MOVEBOTHMM ${REF_A.h_post_mm}`

// ── Class A ─────────────────────────────────────────────────────────────────

test('Class A at H_PRE: no MOVEAMMT2, no h_post, no command at all', async () => {
  const rig = mockRig({ initial: AT_H_PRE })
  const r = await runProductionCentringStep(rig.master, rig.carriage, ctx(REF_A))
  assert.equal(r.ok, true)
  assert.equal(r.lengthClass, 'A')
  assert.equal(r.outcome, 'h_pre')
  assert.deepEqual(rig.commands, [])
  assert.equal(r.calSync.applied, false)
})

test('Class A at UNKNOWN: initialization only (HOME, h_pre) — never MOVEAMMT2 or h_post', async () => {
  const rig = mockRig({ initial: AT_UNKNOWN, moves: { 'MOVEBOTHMM 3': AT_H_PRE } })
  const r = await runProductionCentringStep(rig.master, rig.carriage, ctx(REF_A))
  assert.equal(r.ok, true)
  assert.equal(r.outcome, 'initialized')
  assert.deepEqual(rig.commands, ['HOME', 'MOVEBOTHMM 3'])
  assert.ok(!rig.commands.some((c) => c.startsWith('MOVEAMMT2') || isHPost(c)))
})

// ── Class B ─────────────────────────────────────────────────────────────────

test('Class B: MOVEAMMT2 to centering_output_mm then h_post; return after the tail is h_pre', async () => {
  const rig = mockRig({ initial: AT_H_PRE, moves: { 'MOVEBOTHMM 22': AT_H_POST, 'MOVEBOTHMM 3': AT_H_PRE } })
  const step = await runProductionCentringStep(rig.master, rig.carriage, ctx(REF_B))
  assert.equal(step.ok, true)
  assert.equal(step.lengthClass, 'B')
  assert.equal(step.outcome, 'h_post')
  assert.deepEqual(step.positions, { upper: H_POST, lower: H_POST })
  assert.deepEqual(rig.commands, ['MOVEAMMT2 180', 'MOVEBOTHMM 22'])

  const back = await returnProductionCentringToHPre(rig.master, ctx(REF_B))
  assert.equal(back.ok, true)
  assert.equal(back.outcome, 'h_pre')
  assert.deepEqual(back.positions, { upper: H_PRE, lower: H_PRE })
  assert.deepEqual(rig.commands, ['MOVEAMMT2 180', 'MOVEBOTHMM 22', 'HOME', 'MOVEBOTHMM 3'])
  assert.ok(!rig.commands.some((c) => c.startsWith('SEEK_TRAVEL')))
})

test('Class B failing at h_post returns the cycle error and sends nothing more', async () => {
  const rig = mockRig({ initial: AT_H_PRE, moves: { 'MOVEBOTHMM 22': AT_UNKNOWN } })
  const r = await runProductionCentringStep(rig.master, rig.carriage, ctx(REF_B))
  assert.equal(r.ok, false)
  assert.equal(r.code, 'NOT_AT_H_POST')
  assert.deepEqual(rig.commands, ['MOVEAMMT2 180', 'MOVEBOTHMM 22'])
})

// ── Single axis ─────────────────────────────────────────────────────────────

for (const axis of ['upper', 'lower']) {
  test(`centring_axis ${axis}: SINGLE_AXIS_UNDECIDED, no motion, no STATUS-driven SETCAL`, async () => {
    const ref = { ...REF_A, centring_axis: axis }
    const rig = mockRig({ initial: { ...AT_H_PRE, cal: false } })
    const step = await runProductionCentringStep(rig.master, rig.carriage, ctx(ref))
    assert.equal(step.ok, false)
    assert.equal(step.code, SINGLE_AXIS_UNDECIDED)
    const back = await returnProductionCentringToHPre(rig.master, ctx({ ...ref, l_eff_mm: 66.5 }))
    assert.equal(back.code, SINGLE_AXIS_UNDECIDED)
    const init = await initializeForReference(rig.master, ctx(ref))
    assert.equal(init.code, SINGLE_AXIS_UNDECIDED)
    assert.deepEqual(rig.commands, [])
  })
}

test('singleAxisRefusal: null for both and for an invalid axis (the recipe gate names it)', () => {
  assert.equal(singleAxisRefusal(REF_A), null)
  assert.equal(singleAxisRefusal({ ...REF_A, centring_axis: 'diagonal' }), null)
  assert.equal(singleAxisRefusal({ ...REF_A, centring_axis: 'UPPER' }).code, SINGLE_AXIS_UNDECIDED)
})

// ── Recipe gate before motion ───────────────────────────────────────────────

test('L_eff outside 40–100: RECIPE_REJECTED, no command', async () => {
  const rig = mockRig({ initial: AT_H_PRE })
  const r = await runProductionCentringStep(rig.master, rig.carriage, ctx({ ...REF_A, l_eff_mm: 101 }))
  assert.equal(r.code, 'RECIPE_REJECTED')
  assert.deepEqual(rig.commands, [])
})

// ── Initialization for reference load / setup ───────────────────────────────

test('initializeForReference: HOME then h_pre, no SEEK_TRAVEL, no SETCAL when cal=1', async () => {
  const rig = mockRig({ initial: AT_UNKNOWN, moves: { 'MOVEBOTHMM 3': AT_H_PRE } })
  const r = await initializeForReference(rig.master, ctx(REF_B))
  assert.equal(r.ok, true)
  assert.equal(r.outcome, 'h_pre')
  assert.deepEqual(rig.commands, ['HOME', 'MOVEBOTHMM 3'])
})

test('initializeForReference without a reference: HOME only, no height move', async () => {
  const rig = mockRig({ initial: AT_UNKNOWN })
  const r = await initializeForReference(rig.master, ctx(null))
  assert.equal(r.ok, true)
  assert.equal(r.outcome, 'home')
  assert.deepEqual(rig.commands, ['HOME'])
})

// ── Saved calibration re-sync before classification ─────────────────────────

test('live pulse ends differ from slaveCal: SETCAL, STATUS again, then classify', async () => {
  const rig = mockRig({ initial: { ...AT_H_PRE, hu: 2100 } })
  const r = await runProductionCentringStep(rig.master, rig.carriage, ctx(REF_A))
  assert.equal(r.ok, true)
  assert.equal(r.outcome, 'h_pre')
  assert.equal(r.calSync.applied, true)
  assert.deepEqual(r.calSync.fields, ['hu'])
  assert.deepEqual(rig.commands, ['SETCAL T1'])
})

test('live calId differs: SETCAL before the Class B step', async () => {
  const rig = mockRig({ initial: { ...AT_H_PRE, calId: 'OLD' }, moves: { 'MOVEBOTHMM 22': AT_H_POST } })
  const r = await runProductionCentringStep(rig.master, rig.carriage, ctx(REF_B))
  assert.equal(r.ok, true)
  assert.deepEqual(rig.commands, ['SETCAL T1', 'MOVEAMMT2 180', 'MOVEBOTHMM 22'])
})

test('no saved slaveCal: no SETCAL', async () => {
  const rig = mockRig({ initial: { ...AT_H_PRE, hu: 1 } })
  const s = await syncSlaveCal(rig.master, { slaveCal: null, log: SILENT })
  assert.equal(s.ok, true)
  assert.equal(s.applied, false)
  assert.deepEqual(rig.commands, [])
})

test('SETCAL rejected: CAL_APPLY_FAILED, no motion', async () => {
  const rig = mockRig({ initial: { ...AT_H_PRE, hu: 2100 } })
  rig.master.setCal = async () => { throw new Error('SETCAL failed: accepted=0') }
  const r = await runProductionCentringStep(rig.master, rig.carriage, ctx(REF_A))
  assert.equal(r.code, 'CAL_APPLY_FAILED')
  assert.deepEqual(rig.commands, [])
})

test('calRelationDiff: curve unknown to STATUS counts as different until this host applied it', () => {
  const live = { ...BASE }
  assert.deepEqual(calRelationDiff(CAL, live), [])
  assert.deepEqual(calRelationDiff(CAL_CURVE, live), ['A', 'B', 'C', 'sHome', 'sTravel'])
  assert.deepEqual(calRelationDiff(CAL_CURVE, live, CAL_CURVE), [])
  assert.deepEqual(calRelationDiff(CAL_CURVE, live, { ...CAL_CURVE, B: -0.18 }), ['B'])
  assert.deepEqual(
    calRelationDiff(CAL_CURVE, { ...live, calId: 'OTHER' }, CAL_CURVE),
    ['calId', 'A', 'B', 'C', 'sHome', 'sTravel'],
  )
  assert.deepEqual(calRelationDiff(CAL_CURVE, { ...live, raw: { A: '4.67687625', B: '-0.176873', C: '0.00197035', sHome: '-80', sTravel: '35' } }), [])
  assert.deepEqual(calRelationDiff(CAL, { ...live, cal: false }), ['cal'])
  assert.deepEqual(calRelationDiff(CAL, null), ['status'])
})

test('saved curve not on the controller: SETCAL once, then the applied relation matches', async () => {
  const rig = mockRig({ initial: AT_H_PRE })
  const first = await syncSlaveCal(rig.master, { slaveCal: CAL_CURVE, log: SILENT })
  assert.equal(first.applied, true)
  const second = await syncSlaveCal(rig.master, { slaveCal: CAL_CURVE, appliedCal: first.appliedCal, log: SILENT })
  assert.equal(second.applied, false)
  assert.deepEqual(rig.commands, ['SETCAL T1'])
})
