import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeCentring, lastMoveFromStatus } from './initialize.mjs'
import { expectedReferencePoses, H_PRE, UNKNOWN, HOME } from './position.mjs'
import { validateCentringV2Recipe } from './recipeGate.mjs'

const CAL = Object.freeze({ calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })
const REF_BOTH = Object.freeze({ l_eff_mm: 50, h_pre_mm: 3, h_post_mm: 22, centring_axis: 'both' })
const REF_UPPER = Object.freeze({ l_eff_mm: 60, h_pre_mm: 40, h_post_mm: 50, centring_axis: 'upper' })
const SILENT = Object.freeze({ info() {}, warn() {} })

const AT_HOME = Object.freeze({
  busy: false, estop: false, cal: true, moveEnd: 'ok',
  uh: true, ut: false, lh: true, lt: false,
  u: -80, l: -80, pu: CAL.hu, pl: CAL.hl, puMm: 31.44, plMm: 31.44,
})

/** Completion STATUS whose pulse, angle and side height equal the expected h_pre pose. */
function statusAtHPre(reference) {
  const pose = expectedReferencePoses({ reference, slaveCal: CAL }).h_pre
  const st = { ...AT_HOME }
  if (pose.upper) Object.assign(st, { uh: false, u: pose.upper.angleDeg, pu: pose.upper.pulseUs, puMm: pose.upper.sideHeightMm })
  if (pose.lower) Object.assign(st, { lh: false, l: pose.lower.angleDeg, pl: pose.lower.pulseUs, plMm: pose.lower.sideHeightMm })
  return st
}

/**
 * Mock master. Records every command; `status()` returns the post-HOME STATUS
 * with the given cal bit; moves return `completion`.
 */
function mockMaster({ cal = true, completion = null, homeError = null, moveError = null } = {}) {
  const commands = []
  let calBit = cal
  const move = (cmd) => async (h) => {
    commands.push(`${cmd} ${h}`)
    if (moveError) throw moveError
    return { tag: cmd, status: { ...completion, cal: calBit } }
  }
  return {
    commands,
    async homeBoth() {
      commands.push('HOME')
      if (homeError) throw homeError
      return { tag: 'HOME', status: { ...AT_HOME, cal: calBit } }
    },
    async status() {
      commands.push('STATUS')
      return { ...AT_HOME, cal: calBit }
    },
    async setCal(c) {
      commands.push(`SETCAL ${c.calId}`)
      calBit = true
      return { ...AT_HOME, cal: true }
    },
    moveBoth: move('MOVEBOTHMM'),
    moveUpper: move('MOVE_UPPERMM'),
    moveLower: move('MOVE_LOWERMM'),
  }
}

function context(reference, extra = {}) {
  return {
    reference,
    recipeGate: reference ? validateCentringV2Recipe(reference, { slaveCal: CAL }) : null,
    slaveCal: CAL,
    mechOffsetMm: 0,
    log: SILENT,
    ...extra,
  }
}

function assertNoForbiddenCommands(commands, reference) {
  assert.ok(!commands.some((c) => c.startsWith('SEEK_TRAVEL')), 'no SEEK_TRAVEL')
  if (reference) {
    assert.ok(!commands.some((c) => c.endsWith(` ${reference.h_post_mm}`)), 'no move to h_post_mm')
  }
}

test('reference loaded, cal=1: HOME, STATUS, one MOVEBOTHMM to h_pre_mm, no SETCAL', async () => {
  const master = mockMaster({ completion: statusAtHPre(REF_BOTH) })
  const r = await initializeCentring(master, context(REF_BOTH))
  assert.deepEqual(master.commands, ['HOME', 'STATUS', 'MOVEBOTHMM 3'])
  assertNoForbiddenCommands(master.commands, REF_BOTH)
  assert.equal(r.ok, true)
  assert.equal(r.outcome, 'h_pre')
  assert.deepEqual(r.positions, { upper: H_PRE, lower: H_PRE })
})

test('cal=0 with a valid saved slaveCal: HOME, STATUS, SETCAL, then MOVEBOTHMM', async () => {
  const master = mockMaster({ cal: false, completion: statusAtHPre(REF_BOTH) })
  const r = await initializeCentring(master, context(REF_BOTH))
  assert.deepEqual(master.commands, ['HOME', 'STATUS', 'SETCAL T1', 'MOVEBOTHMM 3'])
  assert.equal(r.ok, true)
})

test('cal=0 with no saved slaveCal: HOME only, error names height calibration, no MOVE', async () => {
  for (const slaveCal of [null, { ...CAL, hu: 900, tu: 2200 }]) {
    const master = mockMaster({ cal: false })
    const r = await initializeCentring(master, context(REF_BOTH, { slaveCal }))
    assert.deepEqual(master.commands, ['HOME', 'STATUS'])
    assert.equal(r.ok, false)
    assert.equal(r.code, 'NO_CALIBRATION')
    assert.match(r.message, /Settings → Height calibration/)
    assert.match(r.message, /no height move/)
  }
})

test('no reference: HOME only, no MOVE, gate not needed', async () => {
  const master = mockMaster()
  const r = await initializeCentring(master, context(null))
  assert.deepEqual(master.commands, ['HOME', 'STATUS'])
  assert.deepEqual({ ok: r.ok, outcome: r.outcome }, { ok: true, outcome: 'home' })
})

test('no reference with cal=0 still restores calibration, then stops at HOME', async () => {
  const master = mockMaster({ cal: false })
  const r = await initializeCentring(master, context(null))
  assert.deepEqual(master.commands, ['HOME', 'STATUS', 'SETCAL T1'])
  assert.equal(r.outcome, 'home')
})

test('recipe gate failure, L_eff outside 40–100: HOME, no MOVE, error returned', async () => {
  const reference = { ...REF_BOTH, l_eff_mm: 39 }
  const master = mockMaster()
  const r = await initializeCentring(master, context(reference))
  assert.deepEqual(master.commands, ['HOME', 'STATUS'])
  assert.equal(r.code, 'RECIPE_REJECTED')
  assert.equal(r.recipeGate.code, 'LEFF_OUT_OF_RANGE')
  assert.match(r.message, /40–100 mm/)
})

test('recipe gate failure, single-axis h_pre below the gate, cal=0: HOME, SETCAL, no MOVE', async () => {
  const reference = { ...REF_UPPER, h_pre_mm: 20 }
  const master = mockMaster({ cal: false })
  const r = await initializeCentring(master, context(reference))
  assert.deepEqual(master.commands, ['HOME', 'STATUS', 'SETCAL T1'])
  assert.equal(r.code, 'RECIPE_REJECTED')
  assert.equal(r.recipeGate.code, 'H_PRE_BELOW_SINGLE_AXIS_MIN')
})

test('a reference without a recipe gate result is not moved', async () => {
  const master = mockMaster({ completion: statusAtHPre(REF_BOTH) })
  const r = await initializeCentring(master, context(REF_BOTH, { recipeGate: null }))
  assert.deepEqual(master.commands, ['HOME', 'STATUS'])
  assert.equal(r.code, 'RECIPE_REJECTED')
})

test('single-axis upper: MOVE_UPPERMM to h_pre_mm, only upper is judged, success is H_PRE', async () => {
  const master = mockMaster({ completion: statusAtHPre(REF_UPPER) })
  const r = await initializeCentring(master, context(REF_UPPER))
  assert.deepEqual(master.commands, ['HOME', 'STATUS', 'MOVE_UPPERMM 40'])
  assertNoForbiddenCommands(master.commands, REF_UPPER)
  assert.equal(r.ok, true)
  assert.deepEqual(r.positions, { upper: H_PRE })
})

test('completion that classifies as UNKNOWN fails and sends no extra move', async () => {
  const completion = { ...statusAtHPre(REF_BOTH), u: 0, pu: 1500, puMm: 4.68 }
  const master = mockMaster({ completion })
  const r = await initializeCentring(master, context(REF_BOTH))
  assert.deepEqual(master.commands, ['HOME', 'STATUS', 'MOVEBOTHMM 3'])
  assert.equal(r.ok, false)
  assert.equal(r.code, 'NOT_AT_H_PRE')
  assert.deepEqual(r.positions, { upper: UNKNOWN, lower: H_PRE })
  assert.match(r.message, /upper is UNKNOWN/)
  assert.ok(Number.isFinite(r.expected.upper.angleDeg))
})

test('completion with a limit switch pressed is HOME, not H_PRE, and fails', async () => {
  const completion = {
    ...statusAtHPre(REF_BOTH),
    lh: true, l: -80, pl: CAL.hl, plMm: 31.44,
  }
  const master = mockMaster({ completion })
  const r = await initializeCentring(master, context(REF_BOTH))
  assert.equal(r.code, 'NOT_AT_H_PRE')
  assert.equal(r.positions.lower, HOME)
  assert.equal(master.commands.length, 3)
})

test('HOME failure stops before STATUS and before any move', async () => {
  const master = mockMaster({ homeError: new Error('HOME home_fail') })
  const r = await initializeCentring(master, context(REF_BOTH))
  assert.deepEqual(master.commands, ['HOME'])
  assert.equal(r.code, 'HOME_FAILED')
  assert.match(r.message, /HOME home_fail/)
})

test('a rejected height move is reported, not retried', async () => {
  const master = mockMaster({ moveError: new Error('MOVEBOTHMM rejected') })
  const r = await initializeCentring(master, context(REF_BOTH))
  assert.deepEqual(master.commands, ['HOME', 'STATUS', 'MOVEBOTHMM 3'])
  assert.equal(r.code, 'MOVE_FAILED')
})

test('lastMoveFromStatus maps pu/u/puMm and pl/l/plMm', () => {
  const m = lastMoveFromStatus({ pu: 1000, u: 20, puMm: 1.5, pl: 950, l: 21, plMm: 1.4 }, 'MOVEBOTHMM')
  assert.deepEqual(m, {
    command: 'MOVEBOTHMM',
    upper: { pulseUs: 1000, angleDeg: 20, sideHeightMm: 1.5 },
    lower: { pulseUs: 950, angleDeg: 21, sideHeightMm: 1.4 },
  })
  assert.equal(lastMoveFromStatus(null, 'X'), null)
})
