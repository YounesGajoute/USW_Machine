/**
 * Production step list → Version 2 centring (phase 4). Runs the real
 * buildProductionSteps centring and pick-tail steps with a mocked centring
 * master and carriage; one command list records both.
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { heightFromSigned, S_MIN } from './centringMaster/centring_height_model.js'
import { registerCentringConfigStore, loadCentringConfig } from './centring.mjs'
import {
  buildProductionSteps,
  __setTestMoveAmmT2,
  __clearTestMoveAmmT2,
  __setTestReturnPickPlaceToHome,
  __clearTestReturnPickPlaceToHome,
} from './productionSequence.mjs'
import { __setCentringV2MasterForTest, prepareCentringV2StartPulse } from './centringV2Production.mjs'
import { runStartWithPulse } from './centringV2/startPulse.mjs'
import { __setCachedCentringStatusForTest, getCachedCentringStatus } from './tcpSubsystemHealth.mjs'
import { expectedReferencePoses } from './centringV2/position.mjs'

const CAL = Object.freeze({ calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })
const REF_ID = 'REF-V2-WIRE'
const REF_A = Object.freeze({ l_eff_mm: 50, h_pre_mm: 3, h_post_mm: 22, centring_axis: 'both', centering_output_mm: 180, referenceId: REF_ID })
const REF_B = Object.freeze({ ...REF_A, l_eff_mm: 66.5 })
const PICK_MM = 250

const BASE = Object.freeze({ busy: false, estop: false, cal: true, moveEnd: 'ok', uh: false, ut: false, lh: false, lt: false, calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })
const axisAt = (axis, p, sw = {}) => (axis === 'upper'
  ? { u: p.angleDeg, pu: p.pulseUs, puMm: p.sideHeightMm, uh: false, ut: false, ...sw }
  : { l: p.angleDeg, pl: p.pulseUs, plMm: p.sideHeightMm, lh: false, lt: false, ...sw })
const POSES = expectedReferencePoses({ reference: REF_A, slaveCal: CAL })
const bothAt = (poses) => ({ ...BASE, ...axisAt('upper', poses.upper), ...axisAt('lower', poses.lower) })
const AT_H_PRE = bothAt(POSES.h_pre)
const AT_H_POST = bothAt(POSES.h_post)
const HOME_SW = {
  ...axisAt('upper', { angleDeg: S_MIN, pulseUs: CAL.hu, sideHeightMm: heightFromSigned(S_MIN) }, { uh: true }),
  ...axisAt('lower', { angleDeg: S_MIN, pulseUs: CAL.hl, sideHeightMm: heightFromSigned(S_MIN) }, { lh: true }),
}

let commands
let state

function installRig(initial) {
  commands = []
  state = { ...initial }
  const moves = { 'MOVEBOTHMM 22': AT_H_POST, 'MOVEBOTHMM 3': AT_H_PRE }
  const move = (cmd) => async (h) => {
    const key = `${cmd} ${h}`
    commands.push(key)
    if (!moves[key]) throw new Error(`unexpected ${key}`)
    state = { ...moves[key] }
    return { status: { ...state } }
  }
  __setCentringV2MasterForTest({
    async status() { return { ...state } },
    async homeBoth() { commands.push('HOME'); state = { ...state, ...HOME_SW }; return { status: { ...state } } },
    async homeByAxis(axis) { commands.push(`HOME ${axis}`); state = { ...state, ...HOME_SW }; return { status: { ...state } } },
    async seekTravelByAxis(axis) { commands.push(`SEEK_TRAVEL ${axis}`); return { status: { ...state } } },
    async setCal(c) { commands.push(`SETCAL ${c.calId}`); return { ...state } },
    moveBoth: move('MOVEBOTHMM'),
    moveUpper: move('MOVE_UPPERMM'),
    moveLower: move('MOVE_LOWERMM'),
  })
  __setTestMoveAmmT2(async (mm) => { commands.push(`MOVEAMMT2 ${mm}`); return { command: 'MOVEAMMT2', positionA: mm } })
  __setTestReturnPickPlaceToHome(async () => { commands.push('RETURN_TO_BACKOFF'); return { command: 'MOVEAMMT2' } })
}

const ecm = {
  isInitialized: true,
  async setOutput() { return { status: 'ok' } },
  async setOutputs() { return { status: 'ok' } },
  async getOutput() { return { status: 'ok', value: 1 } },
  async getInput() { return { status: 'ok', value: 0 } },
}

function runCtx(reference, extra = {}) {
  return {
    timing: { moveSpeedMmS: 100, movePositionMm: PICK_MM, movePositionEvoMm: PICK_MM, delayAfterPickClampOpenMs: 0 },
    skipPickTail: false,
    skipCentringPickPlace: false,
    skipCentring: false,
    skipVision: true,
    init: { referenceId: REF_ID },
    centringContext: null,
    centringReference: reference,
    visionChecks: { welding_splice: { enabled: false }, heat_shrink_tube: { enabled: false } },
    ...extra,
  }
}

async function runCentringSteps(ctx) {
  const phases = []
  const st = { centring: null, moveToPick: null, moveToBackoff: null }
  const steps = buildProductionSteps(ecm, ctx, phases, st)
  const wanted = steps.filter((s) => ['centring_v2', 'pick_place_tail', 'centring_v2_return'].includes(s.name))
  for (const step of wanted) await step.run()
  return { steps: steps.map((s) => s.name), phases, state: st }
}

const quietLog = { info() {}, warn() {}, error() {} }

/** Start path: prepareCentringV2StartPulse on the Start STATUS, then the runner over the real steps. */
async function runStartCentringSteps(ctx, startStatus) {
  const phases = []
  const st = { centring: null, moveToPick: null, moveToBackoff: null }
  const steps = buildProductionSteps(ecm, ctx, phases, st)
    .filter((s) => ['centring_v2', 'pick_place_tail', 'centring_v2_return'].includes(s.name))
  const { plan, master } = prepareCentringV2StartPulse({
    reference: ctx.centringReference, status: startStatus, skipCentring: ctx.skipCentring,
  })
  const { pulse } = await runStartWithPulse({ steps, master, plan, log: quietLog })
  await pulse.done
  return { plan, pulse }
}

beforeEach(() => {
  registerCentringConfigStore({ load: () => ({ slaveCal: { ...CAL }, mechOffsetMm: 0 }), save: () => {}, path: () => ':memory:' })
  loadCentringConfig()
  __setCachedCentringStatusForTest(null)
})

afterEach(() => {
  __setCentringV2MasterForTest(null)
  __clearTestMoveAmmT2()
  __clearTestReturnPickPlaceToHome()
})

test('Class A: no MOVEAMMT2 to centering output, no h_post, no return step after the pick tail', async () => {
  installRig(AT_H_PRE)
  const r = await runCentringSteps(runCtx(REF_A))
  assert.ok(r.steps.includes('centring_v2'))
  assert.ok(!r.steps.includes('centring_v2_return'))
  assert.deepEqual(commands, [`MOVEAMMT2 ${PICK_MM}`, 'RETURN_TO_BACKOFF'])
  assert.equal(r.state.centring.lengthClass, 'A')
  assert.equal(r.phases.find((p) => p.phase === 'centring_v2')?.outcome, 'h_pre')
  // The Start gate classifies this STATUS; no h_pre marker is kept.
  assert.deepEqual(getCachedCentringStatus(), AT_H_PRE)
})

test('Class B: MOVEAMMT2 output → h_post, pick tail, then centring_v2_return to h_pre', async () => {
  installRig(AT_H_PRE)
  const r = await runCentringSteps(runCtx(REF_B))
  const order = r.steps.filter((n) => ['centring_v2', 'pick_place_tail', 'centring_v2_return'].includes(n))
  assert.deepEqual(order, ['centring_v2', 'pick_place_tail', 'centring_v2_return'])
  assert.deepEqual(commands, [
    'MOVEAMMT2 180',
    'MOVEBOTHMM 22',
    `MOVEAMMT2 ${PICK_MM}`,
    'RETURN_TO_BACKOFF',
    'HOME both',
    'MOVEBOTHMM 3',
  ])
  assert.equal(r.phases.find((p) => p.phase === 'centring_v2_return')?.outcome, 'h_pre')
  assert.deepEqual(getCachedCentringStatus(), AT_H_PRE)
})

test('single-axis reference: centring step throws SINGLE_AXIS_UNDECIDED and records no motion', async () => {
  installRig(AT_H_PRE)
  await assert.rejects(
    () => runCentringSteps(runCtx({ ...REF_A, centring_axis: 'upper' })),
    (err) => err.code === 'SINGLE_AXIS_UNDECIDED',
  )
  assert.deepEqual(commands, [])
})

test('Start pulse, Class A: one MOVEBOTHMM h_pre fired first, then the unchanged Class A steps', async () => {
  installRig(AT_H_PRE)
  const { plan, pulse } = await runStartCentringSteps(runCtx(REF_A), AT_H_PRE)
  assert.equal(plan.send, true)
  assert.equal(pulse.fault, null)
  assert.deepEqual(commands, ['MOVEBOTHMM 3', `MOVEAMMT2 ${PICK_MM}`, 'RETURN_TO_BACKOFF'])
})

test('Start pulse, Class B: one MOVEBOTHMM h_pre fired first, then the unchanged Class B steps', async () => {
  installRig(AT_H_PRE)
  await runStartCentringSteps(runCtx(REF_B), AT_H_PRE)
  assert.deepEqual(commands, [
    'MOVEBOTHMM 3',
    'MOVEAMMT2 180',
    'MOVEBOTHMM 22',
    `MOVEAMMT2 ${PICK_MM}`,
    'RETURN_TO_BACKOFF',
    'HOME both',
    'MOVEBOTHMM 3',
  ])
})

test('Start pulse: not sent when the Start STATUS is not H_PRE or centring is skipped', async () => {
  installRig(AT_H_PRE)
  const notHPre = { ...AT_H_PRE, pl: AT_H_PRE.pl + 40 }
  const r1 = prepareCentringV2StartPulse({ reference: REF_A, status: notHPre, skipCentring: false })
  assert.equal(r1.plan.send, false)
  const r2 = prepareCentringV2StartPulse({ reference: null, status: AT_H_PRE, skipCentring: true })
  assert.deepEqual(r2.plan, { send: false, reason: 'CENTRING_SKIPPED' })
  assert.deepEqual(commands, [])
})

test('Start pulse, single-axis: not sent; the centring step still refuses', async () => {
  installRig(AT_H_PRE)
  await assert.rejects(
    () => runStartCentringSteps(runCtx({ ...REF_A, centring_axis: 'lower' }), AT_H_PRE),
    (err) => err.code === 'SINGLE_AXIS_UNDECIDED',
  )
  assert.deepEqual(commands, [])
})

test('Class B h_post failure: the cycle error propagates, no restore move is invented', async () => {
  installRig(AT_H_PRE)
  state = { ...AT_H_PRE }
  __setCentringV2MasterForTest({
    async status() { return { ...state } },
    async setCal() { throw new Error('unexpected SETCAL') },
    async moveBoth(h) { commands.push(`MOVEBOTHMM ${h}`); throw new Error('MOVEBOTHMM timeout') },
  })
  await assert.rejects(() => runCentringSteps(runCtx(REF_B)), (err) => err.code === 'MOVE_FAILED')
  assert.deepEqual(commands, ['MOVEAMMT2 180', 'MOVEBOTHMM 22'])
})
