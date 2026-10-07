import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heightFromSigned, S_MAX, S_MIN } from '../centringMaster/centring_height_model.js'
import {
  runClassACentring,
  runClassBCentringStep,
  returnClassBToHPre,
  runCentringStep,
  UNKNOWN_NOTICE,
} from './cycle.mjs'
import { classifyAxisPosition, expectedReferencePoses, H_PRE, H_POST, TRAVEL, HOME } from './position.mjs'
import { lastMoveFromStatus } from './initialize.mjs'
import { validateCentringV2Recipe } from './recipeGate.mjs'

const CAL = Object.freeze({ calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })
const CAL_CUSTOM = Object.freeze({ ...CAL, A: 5.2, B: -0.19, C: 0.0021, sHome: -80, sTravel: 35 })
const SILENT = Object.freeze({ info() {}, warn() {} })

const REF_A = Object.freeze({ l_eff_mm: 50, h_pre_mm: 3, h_post_mm: 22, centring_axis: 'both', centering_output_mm: 180 })
const REF_B = Object.freeze({ ...REF_A, l_eff_mm: 66.5 })
// h_pre reachable with the lower jaw at TRAVEL (upper side ≈ 19.1 mm).
const REF_A_UPPER = Object.freeze({ l_eff_mm: 50, h_pre_mm: 20, h_post_mm: 25, centring_axis: 'upper', centering_output_mm: 180 })
// Passes V2-REQ-043 (partner at HOME) but cannot be reached with the partner at TRAVEL.
const REF_UPPER_HIGH = Object.freeze({ l_eff_mm: 60, h_pre_mm: 40, h_post_mm: 50, centring_axis: 'upper', centering_output_mm: 180 })

const BASE = Object.freeze({ busy: false, estop: false, cal: true, moveEnd: 'ok', uh: false, ut: false, lh: false, lt: false })

function axisAt(axis, pose, sw = {}) {
  return axis === 'upper'
    ? { u: pose.angleDeg, pu: pose.pulseUs, puMm: pose.sideHeightMm, uh: false, ut: false, ...sw }
    : { l: pose.angleDeg, pl: pose.pulseUs, plMm: pose.sideHeightMm, lh: false, lt: false, ...sw }
}

const HOME_POSE = { upper: { angleDeg: S_MIN, pulseUs: CAL.hu, sideHeightMm: heightFromSigned(S_MIN) },
  lower: { angleDeg: S_MIN, pulseUs: CAL.hl, sideHeightMm: heightFromSigned(S_MIN) } }
const TRAVEL_POSE = { upper: { angleDeg: S_MAX, pulseUs: CAL.tu, sideHeightMm: heightFromSigned(S_MAX) },
  lower: { angleDeg: S_MAX, pulseUs: CAL.tl, sideHeightMm: heightFromSigned(S_MAX) } }

const AT_HOME = Object.freeze({ ...BASE, ...axisAt('upper', HOME_POSE.upper, { uh: true }), ...axisAt('lower', HOME_POSE.lower, { lh: true }) })

function bothAt(poses) {
  return { ...BASE, ...axisAt('upper', poses.upper), ...axisAt('lower', poses.lower) }
}

const POSES_BOTH = expectedReferencePoses({ reference: REF_A, slaveCal: CAL })
const AT_H_PRE = Object.freeze(bothAt(POSES_BOTH.h_pre))
const AT_H_POST = Object.freeze(bothAt(POSES_BOTH.h_post))
const AT_UNKNOWN = Object.freeze({ ...AT_H_PRE, u: 0, pu: 1500, puMm: heightFromSigned(0) })

/**
 * Stateful mock master + carriage. `commands` records motion and calibration
 * commands only (STATUS reads are not commands). `moves` maps 'CMD h' → STATUS after it.
 */
function mockRig({ initial, moves = {} }) {
  const commands = []
  let state = { ...initial }
  const move = (cmd) => async (h) => {
    const key = `${cmd} ${h}`
    commands.push(key)
    if (!moves[key]) throw new Error(`unexpected ${key}`)
    state = { ...moves[key] }
    return { tag: cmd, status: { ...state } }
  }
  const master = {
    async status() { return { ...state } },
    async homeBoth() {
      commands.push('HOME')
      state = { ...state, ...axisAt('upper', HOME_POSE.upper, { uh: true }), ...axisAt('lower', HOME_POSE.lower, { lh: true }) }
      return { tag: 'HOME', status: { ...state } }
    },
    async homeByAxis(axis) {
      if (axis === 'both') return master.homeBoth()
      commands.push(axis === 'upper' ? 'HOME_UPPER' : 'HOME_LOWER')
      state = { ...state, ...axisAt(axis, HOME_POSE[axis], { [axis === 'upper' ? 'uh' : 'lh']: true }) }
      return { status: { ...state } }
    },
    async seekTravelByAxis(axis) {
      commands.push(axis === 'both' ? 'SEEK_TRAVEL' : `SEEK_TRAVEL_${axis.toUpperCase()}`)
      state = { ...state, ...axisAt(axis, TRAVEL_POSE[axis], { [axis === 'upper' ? 'ut' : 'lt']: true }) }
      return { status: { ...state } }
    },
    async setCal(c) {
      commands.push(`SETCAL ${c.calId}`)
      state = { ...state, cal: true }
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

function ctx(reference, extra = {}) {
  return {
    reference,
    recipeGate: validateCentringV2Recipe(reference, { slaveCal: extra.slaveCal ?? CAL }),
    slaveCal: CAL,
    mechOffsetMm: 0,
    log: SILENT,
    ...extra,
  }
}

const noSeekTravel = (cmds) => assert.ok(!cmds.some((c) => c.startsWith('SEEK_TRAVEL')), `no SEEK_TRAVEL in ${cmds}`)

// ── Class A ─────────────────────────────────────────────────────────────────

test('Class A, both axes already H_PRE: no MOVE, no SEEK_TRAVEL, no MOVEAMMT2', async () => {
  const rig = mockRig({ initial: AT_H_PRE })
  const r = await runClassACentring(rig.master, ctx(REF_A))
  assert.deepEqual(rig.commands, [])
  assert.deepEqual({ ok: r.ok, outcome: r.outcome }, { ok: true, outcome: 'h_pre' })
  assert.deepEqual(r.positions, { upper: H_PRE, lower: H_PRE })
})

test('Class A, UNKNOWN: only the initialization command list, stops at h_pre', async () => {
  const rig = mockRig({ initial: AT_UNKNOWN, moves: { 'MOVEBOTHMM 3': AT_H_PRE } })
  const r = await runClassACentring(rig.master, ctx(REF_A))
  assert.deepEqual(rig.commands, ['HOME', 'MOVEBOTHMM 3'])
  assert.equal(r.ok, true)
  assert.equal(r.outcome, 'initialized')
  assert.equal(r.notice, UNKNOWN_NOTICE)
  assert.deepEqual(r.positions, { upper: H_PRE, lower: H_PRE })
})

test('Class A, UNKNOWN and initialization fails: failure returned, no further move', async () => {
  const rig = mockRig({ initial: AT_UNKNOWN, moves: { 'MOVEBOTHMM 3': AT_UNKNOWN } })
  const r = await runClassACentring(rig.master, ctx(REF_A))
  assert.deepEqual(rig.commands, ['HOME', 'MOVEBOTHMM 3'])
  assert.equal(r.ok, false)
  assert.equal(r.code, 'NOT_AT_H_PRE')
  assert.match(r.message, /^Initialization failed/)
  assert.equal(r.notice, UNKNOWN_NOTICE)
})

test('Class A, centring axis at TRAVEL: error names TRAVEL, command list empty', async () => {
  const rig = mockRig({ initial: { ...AT_H_PRE, ...axisAt('upper', TRAVEL_POSE.upper, { ut: true }) } })
  const r = await runClassACentring(rig.master, ctx(REF_A))
  assert.deepEqual(rig.commands, [])
  assert.equal(r.code, 'POSITION_NOT_H_PRE')
  assert.equal(r.position, TRAVEL)
  assert.match(r.message, /upper axis is at TRAVEL/)
})

test('Class A, H_POST or HOME on a centring axis stops without a move', async () => {
  for (const [initial, name] of [[AT_H_POST, H_POST], [AT_HOME, HOME]]) {
    const rig = mockRig({ initial })
    const r = await runClassACentring(rig.master, ctx(REF_A))
    assert.deepEqual(rig.commands, [])
    assert.equal(r.position, name)
  }
})

test('Class A, motion or link loss waits; nothing is sent', async () => {
  const rig = mockRig({ initial: { ...AT_H_PRE, busy: true } })
  assert.equal((await runClassACentring(rig.master, ctx(REF_A))).code, 'AXIS_NOT_READY')
  const lost = mockRig({ initial: AT_H_PRE })
  lost.master.status = async () => null
  assert.equal((await runClassACentring(lost.master, ctx(REF_A))).code, 'AXIS_NOT_READY')
  assert.deepEqual([...rig.commands, ...lost.commands], [])
})

test('Class A, centring_axis upper, lower not at TRAVEL: SEEK_TRAVEL_LOWER only, no h_post', async () => {
  const pose = expectedReferencePoses({ reference: REF_A_UPPER, slaveCal: CAL, partnerAngleDeg: S_MAX }).h_pre.upper
  const initial = { ...BASE, ...axisAt('upper', pose), ...axisAt('lower', HOME_POSE.lower, { lh: true }) }
  const rig = mockRig({ initial })
  const r = await runClassACentring(rig.master, ctx(REF_A_UPPER))
  assert.deepEqual(rig.commands, ['SEEK_TRAVEL_LOWER'])
  assert.equal(r.ok, true)
  assert.deepEqual(r.positions, { upper: H_PRE })
})

test('Class A, centring_axis upper with lower already at TRAVEL: no command', async () => {
  const pose = expectedReferencePoses({ reference: REF_A_UPPER, slaveCal: CAL, partnerAngleDeg: S_MAX }).h_pre.upper
  const rig = mockRig({ initial: { ...BASE, ...axisAt('upper', pose), ...axisAt('lower', TRAVEL_POSE.lower, { lt: true }) } })
  const r = await runClassACentring(rig.master, ctx(REF_A_UPPER))
  assert.deepEqual(rig.commands, [])
  assert.equal(r.ok, true)
})

test('single-axis h_pre unreachable with the partner at TRAVEL: named error, no MOVE', async () => {
  const rig = mockRig({ initial: AT_HOME })
  const a = await runClassACentring(rig.master, ctx(REF_UPPER_HIGH))
  const b = await runClassBCentringStep(rig.master, rig.carriage, ctx(REF_UPPER_HIGH))
  for (const r of [a, b]) {
    assert.equal(r.code, 'OPENING_UNREACHABLE_WITH_PARK')
    assert.match(r.message, /lower jaw is parked at TRAVEL/)
  }
  assert.deepEqual(rig.commands, [])
})

// ── Class B ─────────────────────────────────────────────────────────────────

test('Class B, both at H_PRE: MOVEAMMT2 then MOVEBOTHMM to h_post_mm, no SEEK_TRAVEL', async () => {
  const rig = mockRig({ initial: AT_H_PRE, moves: { 'MOVEBOTHMM 22': AT_H_POST } })
  const r = await runClassBCentringStep(rig.master, rig.carriage, ctx(REF_B))
  assert.deepEqual(rig.commands, ['MOVEAMMT2 180', 'MOVEBOTHMM 22'])
  noSeekTravel(rig.commands)
  assert.equal(r.ok, true)
  assert.deepEqual(r.positions, { upper: H_POST, lower: H_POST })
})

test('Class B, UNKNOWN: initialization commands, then MOVEAMMT2, then MOVE to h_post_mm', async () => {
  const rig = mockRig({ initial: AT_UNKNOWN, moves: { 'MOVEBOTHMM 3': AT_H_PRE, 'MOVEBOTHMM 22': AT_H_POST } })
  const r = await runClassBCentringStep(rig.master, rig.carriage, ctx(REF_B))
  assert.deepEqual(rig.commands, ['HOME', 'MOVEBOTHMM 3', 'MOVEAMMT2 180', 'MOVEBOTHMM 22'])
  assert.equal(r.ok, true)
  assert.equal(r.notice, UNKNOWN_NOTICE)
})

test('Class B, UNKNOWN and initialization fails: no carriage, no h_post', async () => {
  const rig = mockRig({ initial: AT_UNKNOWN, moves: { 'MOVEBOTHMM 3': AT_UNKNOWN } })
  const r = await runClassBCentringStep(rig.master, rig.carriage, ctx(REF_B))
  assert.deepEqual(rig.commands, ['HOME', 'MOVEBOTHMM 3'])
  assert.equal(r.ok, false)
})

test('Class B, HOME or TRAVEL at the centring step: stop and name the limit, no move', async () => {
  const atTravel = { ...AT_H_PRE, ...axisAt('lower', TRAVEL_POSE.lower, { lt: true }) }
  for (const [initial, name] of [[AT_HOME, HOME], [atTravel, TRAVEL]]) {
    const rig = mockRig({ initial })
    const r = await runClassBCentringStep(rig.master, rig.carriage, ctx(REF_B))
    assert.deepEqual(rig.commands, [])
    assert.equal(r.code, 'POSITION_NOT_H_PRE')
    assert.equal(r.position, name)
  }
})

test('Class B, H_PRE pose with limit switches pressed still runs the step', async () => {
  const rig = mockRig({
    initial: { ...AT_H_PRE, uh: true, ut: true, lh: true, lt: true },
    moves: { 'MOVEBOTHMM 22': AT_H_POST },
  })
  const r = await runClassBCentringStep(rig.master, rig.carriage, ctx(REF_B))
  assert.deepEqual(rig.commands, ['MOVEAMMT2 180', 'MOVEBOTHMM 22'])
  assert.equal(r.ok, true)
  assert.equal(r.outcome, 'h_post')
})

test('Class B, h_post move that does not classify as H_POST fails', async () => {
  const rig = mockRig({ initial: AT_H_PRE, moves: { 'MOVEBOTHMM 22': AT_UNKNOWN } })
  const r = await runClassBCentringStep(rig.master, rig.carriage, ctx(REF_B))
  assert.deepEqual(rig.commands, ['MOVEAMMT2 180', 'MOVEBOTHMM 22'])
  assert.equal(r.code, 'NOT_AT_H_POST')
})

test('Class B, single-axis: park the unused axis before the carriage', async () => {
  const ref = { ...REF_A_UPPER, l_eff_mm: 70 }
  const poses = expectedReferencePoses({ reference: ref, slaveCal: CAL, partnerAngleDeg: S_MAX })
  const lowerTravel = axisAt('lower', TRAVEL_POSE.lower, { lt: true })
  const rig = mockRig({
    initial: { ...BASE, ...axisAt('upper', poses.h_pre.upper), ...axisAt('lower', HOME_POSE.lower, { lh: true }) },
    moves: { 'MOVE_UPPERMM 25': { ...BASE, ...axisAt('upper', poses.h_post.upper), ...lowerTravel } },
  })
  const r = await runClassBCentringStep(rig.master, rig.carriage, ctx(ref))
  assert.deepEqual(rig.commands, ['SEEK_TRAVEL_LOWER', 'MOVEAMMT2 180', 'MOVE_UPPERMM 25'])
  assert.deepEqual(r.positions, { upper: H_POST })
})

test('Class B, missing centering_output_mm: named error before any command', async () => {
  const rig = mockRig({ initial: AT_H_PRE })
  const r = await runClassBCentringStep(rig.master, rig.carriage, ctx({ ...REF_B, centering_output_mm: null }))
  assert.equal(r.code, 'CARRIAGE_TARGET_MISSING')
  assert.deepEqual(rig.commands, [])
})

test('Class B return from H_POST: HOME then MOVEBOTHMM to h_pre_mm, result H_PRE', async () => {
  const rig = mockRig({ initial: AT_H_POST, moves: { 'MOVEBOTHMM 3': AT_H_PRE } })
  const r = await returnClassBToHPre(rig.master, ctx(REF_B))
  assert.deepEqual(rig.commands, ['HOME', 'MOVEBOTHMM 3'])
  noSeekTravel(rig.commands)
  assert.deepEqual({ ok: r.ok, positions: r.positions }, { ok: true, positions: { upper: H_PRE, lower: H_PRE } })
})

test('Class B return already at HOME: no HOME, only the move to h_pre_mm', async () => {
  const rig = mockRig({ initial: AT_HOME, moves: { 'MOVEBOTHMM 3': AT_H_PRE } })
  const r = await returnClassBToHPre(rig.master, ctx(REF_B))
  assert.deepEqual(rig.commands, ['MOVEBOTHMM 3'])
  assert.equal(r.ok, true)
})

test('Class B return, single-axis: HOME_UPPER only, the parked lower axis is not moved', async () => {
  const ref = { ...REF_A_UPPER, l_eff_mm: 70 }
  const poses = expectedReferencePoses({ reference: ref, slaveCal: CAL, partnerAngleDeg: S_MAX })
  const lowerTravel = axisAt('lower', TRAVEL_POSE.lower, { lt: true })
  const rig = mockRig({
    initial: { ...BASE, ...axisAt('upper', poses.h_post.upper), ...lowerTravel },
    moves: { 'MOVE_UPPERMM 20': { ...BASE, ...axisAt('upper', poses.h_pre.upper), ...lowerTravel } },
  })
  const r = await returnClassBToHPre(rig.master, ctx(ref))
  assert.deepEqual(rig.commands, ['HOME_UPPER', 'MOVE_UPPERMM 20'])
  assert.deepEqual(r.positions, { upper: H_PRE })
})

test('Class B return that does not end at H_PRE fails', async () => {
  const rig = mockRig({ initial: AT_HOME, moves: { 'MOVEBOTHMM 3': AT_UNKNOWN } })
  assert.equal((await returnClassBToHPre(rig.master, ctx(REF_B))).code, 'NOT_AT_H_PRE')
})

// ── Curve and dispatch ──────────────────────────────────────────────────────

test('custom saved curve: STATUS from that curve is H_PRE; the same STATUS on the default curve is not', () => {
  const poses = expectedReferencePoses({ reference: REF_A, slaveCal: CAL_CUSTOM }).h_pre
  assert.ok(Math.abs(poses.upper.sideHeightMm - 1.5) < 1e-6)
  const st = bothAt(poses)
  const lastCompletedMove = lastMoveFromStatus(st, 'MOVEBOTHMM')
  const judge = (slaveCal) => classifyAxisPosition({ axis: 'upper', status: st, lastCompletedMove, reference: REF_A, slaveCal })
  assert.equal(judge(CAL_CUSTOM), H_PRE)
  assert.notEqual(judge(CAL), H_PRE)
})

test('custom saved curve: Class A at that H_PRE sends nothing', async () => {
  const st = bothAt(expectedReferencePoses({ reference: REF_A, slaveCal: CAL_CUSTOM }).h_pre)
  const rig = mockRig({ initial: st })
  const r = await runClassACentring(rig.master, ctx(REF_A, { slaveCal: CAL_CUSTOM }))
  assert.equal(r.ok, true)
  assert.deepEqual(rig.commands, [])
})

test('runCentringStep picks Class A or Class B from L_eff and rejects out-of-range L_eff', async () => {
  const a = mockRig({ initial: AT_H_PRE })
  assert.equal((await runCentringStep(a.master, a.carriage, ctx(REF_A))).outcome, 'h_pre')
  assert.deepEqual(a.commands, [])

  const b = mockRig({ initial: AT_H_PRE, moves: { 'MOVEBOTHMM 22': AT_H_POST } })
  assert.equal((await runCentringStep(b.master, b.carriage, ctx(REF_B))).outcome, 'h_post')
  assert.deepEqual(b.commands, ['MOVEAMMT2 180', 'MOVEBOTHMM 22'])

  const bad = mockRig({ initial: AT_H_PRE })
  assert.equal((await runCentringStep(bad.master, bad.carriage, ctx({ ...REF_A, l_eff_mm: 120 }))).code, 'LEFF_OUT_OF_RANGE')
  assert.deepEqual(bad.commands, [])
})
