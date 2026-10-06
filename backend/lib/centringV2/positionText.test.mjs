import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HOME,
  TRAVEL,
  H_PRE,
  H_POST,
  UNKNOWN,
  IN_MOTION,
  NOT_AVAILABLE,
  WIRING,
} from './position.mjs'
import {
  POSITION_TEXT,
  CLASS_A_UNKNOWN_NOTICE,
  INITIALIZATION_FAILED,
  positionText,
  axisPositionLines,
  cycleOperatorText,
} from './positionText.mjs'

test('one sentence per position name (requirements §11.1)', () => {
  assert.equal(positionText(HOME), 'Open-end limit.')
  assert.equal(positionText(TRAVEL), 'Close-end limit.')
  assert.equal(positionText(H_PRE), 'At the reference closing height.')
  assert.equal(positionText(H_POST), 'At the reference opening height.')
  assert.equal(
    positionText(UNKNOWN),
    'Error. The centring axis is between the limits and is not at HOME, H_PRE, H_POST, or TRAVEL.',
  )
  assert.equal(positionText(IN_MOTION), 'Jaw is moving.')
  assert.equal(positionText(NOT_AVAILABLE), 'Link lost. Wait for the next status.')
  assert.equal(
    positionText(WIRING),
    'Both switches are pressed on this axis. Check the wiring. Motion is not blocked.',
  )
  assert.equal(Object.keys(POSITION_TEXT).length, 8)
})

test('a name that is not a position has no text', () => {
  assert.equal(positionText('CLOSED_IDLE'), null)
  assert.equal(positionText(undefined), null)
  assert.equal(positionText('toString'), null)
})

test('one line per axis, upper first', () => {
  const lines = axisPositionLines({ lower: TRAVEL, upper: H_PRE })
  assert.deepEqual(lines.map((l) => l.axis), ['upper', 'lower'])
  assert.equal(lines[0].line, 'Upper axis: At the reference closing height.')
  assert.equal(lines[1].line, 'Lower axis: Close-end limit.')
  assert.equal(lines[1].position, TRAVEL)
})

test('axis lines skip a missing axis and never invent a name', () => {
  assert.deepEqual(axisPositionLines(null), [])
  const [only] = axisPositionLines({ upper: WIRING })
  assert.equal(only.text, POSITION_TEXT[WIRING])
  assert.equal(axisPositionLines({ upper: HOME }).length, 1)
})

test('class A notice is the cycle notice text', () => {
  assert.equal(
    CLASS_A_UNKNOWN_NOTICE,
    'Error. Centring axis is in an unknown position. Running initialization.',
  )
})

test('cycleOperatorText: no notice → nothing to show', () => {
  assert.equal(cycleOperatorText({ ok: true, outcome: 'h_pre' }), null)
  assert.equal(cycleOperatorText({ ok: false, code: 'MOVE_FAILED', message: 'x' }), null)
  assert.equal(cycleOperatorText(null), null)
})

test('cycleOperatorText: initialization ran and succeeded → notice only', () => {
  const t = cycleOperatorText({ ok: true, outcome: 'initialized', notice: CLASS_A_UNKNOWN_NOTICE })
  assert.deepEqual(t, { notice: CLASS_A_UNKNOWN_NOTICE, message: null })
})

test('cycleOperatorText: initialization failed → the cycle message, starting "Initialization failed."', () => {
  const failed = 'Initialization failed. HOME did not finish: timeout. Check the HOME switches and that nothing blocks the jaws, then clear the E-stop again.'
  const t = cycleOperatorText({ ok: false, code: 'HOME_FAILED', message: failed, notice: CLASS_A_UNKNOWN_NOTICE })
  assert.equal(t.notice, CLASS_A_UNKNOWN_NOTICE)
  assert.equal(t.message, failed)
})

test('cycleOperatorText: a stop at HOME is reported as an initialization failure, message kept whole', () => {
  const stopped = 'Initialization stopped at HOME. The saved calibration was not accepted: nack. Re-run height calibration.'
  const t = cycleOperatorText({ ok: false, code: 'CAL_APPLY_FAILED', message: stopped, notice: CLASS_A_UNKNOWN_NOTICE })
  assert.equal(t.message, `${INITIALIZATION_FAILED} ${stopped}`)
})
