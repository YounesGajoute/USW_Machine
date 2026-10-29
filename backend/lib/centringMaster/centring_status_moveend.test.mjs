import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapFirmwareStatus,
  assertHomeMoveEnd,
  assertMotionMoveEnd,
  assertSeekTravelMoveEnd,
  MOVE_END,
} from './centring_master.js'

/** Double_Actuator STATUS (MASTER_CONTROL §5.1) — no homed*. */
const BASE =
  'u=-80.00 l=-80.00 h=62.87 busy=0 cal=1 calValid=1 lastCmd=HOME accepted=1 reason=ok '
  + 'hmin=1.80 hmax=62.87 mechOff=0.00 calId=unit_01 hu=1950 tu=1100 hl=1501 tl=731 '
  + 'puMm=31.44 plMm=31.44 uh=1 ut=0 lh=1 lt=0 estop=0 targetH=0.00 moveEnd=ok'

test('mapFirmwareStatus parses cal / reason / estop / moveEnd', () => {
  const st = mapFirmwareStatus(BASE)
  assert.equal(st.moveEnd, MOVE_END.OK)
  assert.equal(st.targetH, 0)
  assert.equal(st.cal, true)
  assert.equal(st.estop, false)
  assert.equal(st.reason, 'ok')
  assert.equal(st.hu, 1950)
  assert.equal(st.ready, true)
})

test('mapFirmwareStatus treats h=nan when cal=0', () => {
  const line =
    'u=20.66 l=-80.00 h=nan busy=0 cal=0 calValid=0 lastCmd=PING accepted=1 reason=ok '
    + 'hmin=1.80 hmax=62.87 mechOff=0.00 calId=placeholder hu=1950 tu=1100 hl=1501 tl=731 '
    + 'puMm=nan plMm=nan uh=0 ut=0 lh=1 lt=0 estop=0 targetH=0.00 moveEnd=none'
  const st = mapFirmwareStatus(line)
  assert.equal(st.cal, false)
  assert.ok(Number.isNaN(st.h))
  assert.equal(st.ready, false)
})

test('HOME switches report open without disguising stale boot pulse telemetry', () => {
  const st = mapFirmwareStatus(BASE.replace('u=-80.00', 'u=35.00')
    .replace('hu=1950', 'hu=2102').replace('hl=1501', 'hl=1538')
    + ' pu=1206 pl=1641')
  assert.equal(st.positionFeedback.upper, 'home_open')
  assert.equal(st.positionFeedback.lower, 'home_open')
  assert.equal(st.positionFeedback.referenceMismatch, true)
  assert.equal(st.positionFeedback.switchConflict, false)
  assert.equal(st.ready, false)
  assert.equal(st.u, 35)
  assert.equal(st.pu, 1206)
  assert.equal(st.pl, 1641)
})

test('aligned HOME references are ready; clamped HOME angles alone are not proof', () => {
  const aligned = mapFirmwareStatus(BASE + ' pu=1950 pl=1501')
  assert.equal(aligned.positionFeedback.referenceMismatch, false)
  assert.equal(aligned.ready, true)
  const staleLower = mapFirmwareStatus(BASE + ' pu=1950 pl=1641')
  assert.equal(staleLower.l, -80)
  assert.equal(staleLower.positionFeedback.referenceMismatch, true)
  assert.equal(staleLower.ready, false)
})

test('position feedback distinguishes TRAVEL, both-limits, mid-stroke, and missing bits', () => {
  const closed = mapFirmwareStatus(BASE.replace('u=-80.00', 'u=35')
    .replace('l=-80.00', 'l=35').replace('uh=1 ut=0 lh=1 lt=0', 'uh=0 ut=1 lh=0 lt=1'))
  assert.equal(closed.positionFeedback.upper, 'travel_closed')
  assert.equal(closed.positionFeedback.lower, 'travel_closed')
  assert.equal(closed.ready, true)
  const opposite = mapFirmwareStatus(BASE.replace('uh=1 ut=0', 'uh=0 ut=1'))
  assert.equal(opposite.positionFeedback.referenceMismatch, true)
  assert.equal(opposite.ready, false)
  const conflict = mapFirmwareStatus(BASE.replace('ut=0', 'ut=1'))
  assert.equal(conflict.positionFeedback.upper, 'conflict')
  assert.equal(conflict.ready, false)
  const mid = mapFirmwareStatus(BASE.replace('uh=1', 'uh=0'))
  assert.equal(mid.positionFeedback.upper, 'between_limits')
  const unknown = mapFirmwareStatus(BASE.replace('ut=0 ', ''))
  assert.equal(unknown.positionFeedback.upper, 'unknown')
  assert.equal(unknown.positionFeedback.referenceMismatch, false)
})

test('assertHomeMoveEnd rejects home_fail', () => {
  const st = mapFirmwareStatus(BASE.replace('moveEnd=ok', 'moveEnd=home_fail'))
  assert.throws(() => assertHomeMoveEnd(st), /home_fail/)
})

test('assertHomeMoveEnd accepts success moveEnd=ok', () => {
  const st = mapFirmwareStatus(BASE)
  assert.doesNotThrow(() => assertHomeMoveEnd(st))
})

test('assertMotionMoveEnd accepts moveEnd=ok within tolerance', () => {
  const line =
    'u=-14.9 l=35.0 h=37.1 busy=0 cal=1 calValid=1 lastCmd=MOVEBOTHMM accepted=1 reason=ok '
    + 'hmin=1.80 hmax=62.87 mechOff=0.00 calId=unit_01 hu=1950 tu=1100 hl=1501 tl=731 '
    + 'puMm=18.5 plMm=0.9 uh=0 ut=0 lh=0 lt=1 estop=0 targetH=37.1 moveEnd=ok'
  const st = mapFirmwareStatus(line)
  assert.doesNotThrow(() => assertMotionMoveEnd(st, 37.1, 'MOVEBOTHMM'))
})

test('assertMotionMoveEnd rejects nocal on accepted=0', () => {
  const st = mapFirmwareStatus(
    BASE.replace('cal=1', 'cal=0')
      .replace('calValid=1', 'calValid=0')
      .replace('accepted=1', 'accepted=0')
      .replace('reason=ok', 'reason=nocal')
      .replace('lastCmd=HOME', 'lastCmd=MOVEBOTHMM')
      .replace('moveEnd=ok', 'moveEnd=none'),
  )
  assert.throws(() => assertMotionMoveEnd(st, 40, 'MOVEBOTHMM'), /nocal/)
})

test('assertMotionMoveEnd rejects stall/timeout/link_lost/estop', () => {
  for (const mend of ['stall', 'timeout', 'link_lost', 'estop']) {
    const st = mapFirmwareStatus(
      BASE.replace('moveEnd=ok', `moveEnd=${mend}`).replace('lastCmd=HOME', 'lastCmd=MOVEBOTHMM'),
    )
    st.h = 37.1
    st.targetH = 37.1
    assert.throws(() => assertMotionMoveEnd(st, 37.1, 'MOVEBOTHMM'), /ended early/)
  }
})

test('assertMotionMoveEnd accepts a switch limit only at the target height', () => {
  const st = mapFirmwareStatus(
    BASE.replace('moveEnd=ok', 'moveEnd=limit').replace('lastCmd=HOME', 'lastCmd=MOVEBOTHMM'),
  )
  st.h = 37.1
  st.targetH = 37.1
  assert.doesNotThrow(() => assertMotionMoveEnd(st, 37.1, 'MOVEBOTHMM'))
  assert.throws(() => assertMotionMoveEnd(st, 40, 'MOVEBOTHMM'), /ended early/)
})

test('live lower-HOME / closed-angle failure cannot pass a successful gap reply', () => {
  const st = mapFirmwareStatus(BASE.replace('u=-80.00', 'u=33.35')
    .replace('l=-80.00', 'l=35').replace('h=62.87', 'h=1.93')
    .replace('uh=1', 'uh=0').replace('lastCmd=HOME', 'lastCmd=MOVEBOTHMM'))
  assert.throws(() => assertMotionMoveEnd(st, 2, 'MOVEBOTHMM'), { code: 'CENTRING_FEEDBACK_MISMATCH' })
})

test('HOME requires target switches and respects the selected axis', () => {
  const missingHome = mapFirmwareStatus(BASE.replace('lh=1', 'lh=0'))
  assert.throws(() => assertHomeMoveEnd(missingHome), /lower did not confirm HOME/)
  assert.doesNotThrow(() => assertHomeMoveEnd(missingHome, { needUpper: true, needLower: false }))
  const unknown = mapFirmwareStatus(BASE.replace('lt=0 ', ''))
  assert.throws(() => assertHomeMoveEnd(unknown), /lower did not confirm HOME/)
})

test('TRAVEL never succeeds from angle alone or only one jaw at its switch', () => {
  const closed = mapFirmwareStatus(BASE.replace('u=-80.00', 'u=35')
    .replace('l=-80.00', 'l=35').replace('uh=1 ut=0 lh=1 lt=0', 'uh=0 ut=1 lh=0 lt=1'))
  assert.doesNotThrow(() => assertSeekTravelMoveEnd(closed))
  for (const moveEnd of ['ok', 'none', 'limit']) {
    const split = { ...closed, moveEnd, raw: { uh: '0', ut: '1', lh: '0', lt: '0' } }
    assert.throws(() => assertSeekTravelMoveEnd(split), /lower did not confirm TRAVEL/)
    assert.doesNotThrow(() => assertSeekTravelMoveEnd(split, 'upper', 'SEEK_TRAVEL_UPPER'))
  }
  for (const moveEnd of ['both_limits', 'cal_fail', 'range', 'timeout', 'stall']) {
    assert.throws(() => assertSeekTravelMoveEnd({ ...closed, moveEnd }), /ended early/)
  }
})

test('V1 HOME mismatch is detected at intermediate commanded angles without pu/pl', () => {
  const st = mapFirmwareStatus(BASE.replace('l=-80.00', 'l=-40.00'))
  assert.equal(st.pu, null)
  assert.equal(st.positionFeedback.referenceMismatch, true)
  assert.equal(st.ready, false)
})
