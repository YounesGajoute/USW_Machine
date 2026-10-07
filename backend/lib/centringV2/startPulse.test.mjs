/**
 * Start pulse (§7.3): the h_pre move is fired alongside the production steps,
 * never as a step, and the 1.5 s release belongs to the Nano (kIdleDetachMs).
 */
import { test, mock, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { heightFromSigned, S_MAX } from '../centringMaster/centring_height_model.js'
import { expectedReferencePoses } from './position.mjs'
import { REST_BLOCK } from './restGate.mjs'
import { startPulsePlan, fireStartPulse, runStartWithPulse, isLinkOrEstopFailure } from './startPulse.mjs'

const CAL = Object.freeze({ calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })
const REF_A = Object.freeze({ l_eff_mm: 50, h_pre_mm: 3, h_post_mm: 22, centring_axis: 'both' })
const REF_B = Object.freeze({ ...REF_A, l_eff_mm: 66.5 })
const BASE = Object.freeze({ busy: false, estop: false, cal: true, moveEnd: 'ok', uh: false, ut: false, lh: false, lt: false })
const POSES = expectedReferencePoses({ reference: REF_A, slaveCal: CAL })
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

const quietLog = { info() {}, warn() {}, error() {} }
const plan = (reference, status, extra = {}) => startPulsePlan({ reference, status, slaveCal: CAL, ...extra })

/** Master whose move reply stays pending until released (the Nano still owns it). */
function mockMaster(events) {
  const pending = []
  const move = (cmd) => (h) => {
    events.push(`${cmd} ${h}`)
    return new Promise((resolve, reject) => pending.push({ resolve, reject }))
  }
  return {
    pending,
    moveBoth: move('MOVEBOTHMM'),
    moveUpper: move('MOVE_UPPERMM'),
    moveLower: move('MOVE_LOWERMM'),
  }
}

const steps = (events, names = ['centring_v2', 'pick_place_tail', 'return_home']) =>
  names.map((name) => ({ name, run: async () => { events.push(`step ${name} t=${Date.now()}`) } }))

let armed
let realSetTimeout

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 })
  armed = []
  realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms, ...args) => { armed.push(ms); return realSetTimeout(fn, ms, ...args) }
})

afterEach(() => {
  globalThis.setTimeout = realSetTimeout
  mock.timers.reset()
})

test('Class A and Class B at H_PRE: plan sends MOVEBOTHMM h_pre_mm', () => {
  for (const ref of [REF_A, REF_B]) {
    assert.deepEqual(plan(ref, AT_H_PRE), { send: true, command: 'MOVEBOTHMM', method: 'moveBoth', hMm: 3 })
  }
})

test('Start runner (fake clock): steps begin before any 1500 ms timer and the h_pre MOVE was sent', async () => {
  const events = []
  const master = mockMaster(events)
  const { pulse } = await runStartWithPulse({
    steps: steps(events), master, plan: plan(REF_A, AT_H_PRE), log: quietLog,
  })
  assert.deepEqual(events, [
    'MOVEBOTHMM 3',
    'step centring_v2 t=0',
    'step pick_place_tail t=0',
    'step return_home t=0',
  ])
  // Every step ran with the clock never advanced and the move reply still pending:
  // the steps did not wait for the reply, and the host armed no 1.5 s timer.
  assert.deepEqual(armed, [])
  assert.equal(pulse.sent, true)
  assert.equal(pulse.settled, false)
  assert.equal(master.pending.length, 1)
  master.pending[0].resolve({ status: AT_H_PRE })
  await pulse.done
  assert.equal(pulse.fault, null)
})

test('Class B: same steps, same order, plus the one h_pre MOVE before them', async () => {
  const events = []
  const names = ['centring_v2', 'pick_place_tail', 'centring_v2_return']
  await runStartWithPulse({ steps: steps(events, names), master: mockMaster(events), plan: plan(REF_B, AT_H_PRE), log: quietLog })
  assert.deepEqual(events, ['MOVEBOTHMM 3', ...names.map((n) => `step ${n} t=0`)])
})

test('no MOVE when the axes are not H_PRE', async () => {
  for (const [status, code] of [
    [AT_TRAVEL, REST_BLOCK.NOT_AT_H_PRE],
    [{ ...AT_H_PRE, pl: AT_H_PRE.pl + 40 }, REST_BLOCK.NOT_AT_H_PRE],
    [{ ...AT_H_PRE, busy: true }, REST_BLOCK.BUSY],
    [{ ...AT_H_PRE, estop: true }, REST_BLOCK.ESTOP_LATCHED],
    [null, REST_BLOCK.STATUS_UNAVAILABLE],
  ]) {
    const events = []
    const p = plan(REF_A, status)
    assert.deepEqual(p, { send: false, reason: code })
    const { pulse } = await runStartWithPulse({ steps: steps(events), master: mockMaster(events), plan: p, log: quietLog })
    assert.equal(pulse.sent, false)
    assert.ok(events.every((e) => e.startsWith('step ')), `no MOVE for ${code}: ${events}`)
    assert.equal(events.length, 3)
  }
})

test('no MOVE when centring is skipped', async () => {
  const events = []
  const p = plan(REF_A, AT_H_PRE, { skipCentring: true })
  assert.deepEqual(p, { send: false, reason: 'CENTRING_SKIPPED' })
  await runStartWithPulse({ steps: steps(events), master: mockMaster(events), plan: p, log: quietLog })
  assert.ok(events.every((e) => e.startsWith('step ')))
})

test('upper and lower mechanisms send MOVE_UPPERMM and MOVE_LOWERMM at the closing gap', () => {
  const upper = plan({ ...REF_A, centring_mechanism: 'upper', centring_axis: 'upper', diameter_closing_gap_mm: 40 }, AT_H_PRE)
  const lower = plan({ ...REF_A, centring_mechanism: 'lower', centring_axis: 'lower', diameter_closing_gap_mm: 40 }, AT_H_PRE)
  if (upper.send) assert.equal(upper.command, 'MOVE_UPPERMM')
  if (lower.send) assert.equal(lower.command, 'MOVE_LOWERMM')
})

test('no MOVE for an L_eff outside Class A / Class B', () => {
  assert.deepEqual(plan({ ...REF_A, l_eff_mm: 120 }, AT_H_PRE), { send: false, reason: 'LENGTH_CLASS_INVALID' })
})

test('a non-link failure of the reply after the steps moved on is ignored', async () => {
  const events = []
  const master = mockMaster(events)
  let release
  const gate = new Promise((r) => { release = r })
  const run = runStartWithPulse({
    steps: [
      { name: 'one', run: async () => { events.push('one'); await gate } },
      { name: 'two', run: async () => { events.push('two') } },
    ],
    master, plan: plan(REF_A, AT_H_PRE), log: quietLog,
  })
  await Promise.resolve()
  master.pending[0].reject(new Error('moveEnd=timeout'))
  release()
  const { pulse } = await run
  assert.deepEqual(events, ['MOVEBOTHMM 3', 'one', 'two'])
  assert.equal(pulse.fault, null)
})

test('a link or E-stop failure surfaces at the next step boundary, even after the steps moved on', async () => {
  for (const msg of ['E-stop active', 'Centring link lost (TCP closed)']) {
    const events = []
    const master = mockMaster(events)
    let release
    const gate = new Promise((r) => { release = r })
    const run = runStartWithPulse({
      steps: [
        { name: 'one', run: async () => { events.push('one'); await gate } },
        { name: 'two', run: async () => { events.push('two') } },
      ],
      master, plan: plan(REF_A, AT_H_PRE), log: quietLog,
    })
    await Promise.resolve()
    master.pending[0].reject(new Error(msg))
    await Promise.resolve()
    release()
    await assert.rejects(run, (err) => err.code === 'START_PULSE_FAILED' && err.message.includes('MOVEBOTHMM 3 mm') && err.message.includes(msg))
    assert.deepEqual(events, ['MOVEBOTHMM 3', 'one'], msg)
  }
})

test('a link or E-stop failure after the steps ended goes to onLateFault', async () => {
  const events = []
  const master = mockMaster(events)
  const late = []
  const { pulse } = await runStartWithPulse({
    steps: steps(events), master, plan: plan(REF_A, AT_H_PRE), log: quietLog, onLateFault: (e) => late.push(e.message),
  })
  master.pending[0].reject(new Error('ECONNRESET'))
  await pulse.done
  assert.equal(late.length, 1)
  assert.match(late[0], /^Centring Start pulse \(MOVEBOTHMM 3 mm\) failed: ECONNRESET$/)
})

test('a synchronous throw from the master never escapes as an unhandled rejection', async () => {
  const handle = fireStartPulse({ moveBoth() { throw new Error('boom') } }, plan(REF_A, AT_H_PRE), { log: quietLog })
  await handle.done
  assert.equal(handle.fault?.code, 'START_PULSE_FAILED')
})

test('isLinkOrEstopFailure', () => {
  for (const m of ['estop latched', 'E-STOP', 'link lost', 'TCP closed', 'ECONNREFUSED 1.2.3.4', 'connect timeout']) {
    assert.equal(isLinkOrEstopFailure(new Error(m)), true, m)
  }
  for (const m of ['moveEnd=timeout', 'busy', 'range']) assert.equal(isLinkOrEstopFailure(new Error(m)), false, m)
})

test('firmware: the already-on-target branch attaches and states the 1.5 s release is kIdleDetachMs', () => {
  const src = readFileSync(new URL('../../../Double_Actuator_Centring_Slave_Firmware/src/actuators.cpp', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('StartReject startMoveMm('))
  const branch = fn.slice(fn.indexOf('if (!active[U] && !active[L]) {'), fn.indexOf('return StartReject::Ok;') + 1)
  assert.match(branch, /1\.5 s[^\n]*\n[^\n]*kIdleDetachMs|1\.5 s[^\n]*kIdleDetachMs/)
  const ensure = branch.indexOf('ensureAttached();')
  const write = branch.indexOf('writePulses();')
  const finish = branch.indexOf('finish(MoveEnd::Ok')
  assert.ok(ensure > 0 && write > ensure && finish > write, 'attach, write the pulse, then finish moveEnd=ok')
  const board = readFileSync(new URL('../../../Double_Actuator_Centring_Slave_Firmware/include/board_config.h', import.meta.url), 'utf8')
  assert.match(board, /kIdleDetachMs\s*=\s*1500/)
})
