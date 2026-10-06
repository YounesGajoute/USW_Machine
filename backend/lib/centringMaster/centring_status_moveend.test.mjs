import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapFirmwareStatus,
  assertHomeMoveEnd,
  assertMotionMoveEnd,
  isForeignSessionStatus,
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

test('assertHomeMoveEnd rejects home_fail when the HOME switch was not reached', () => {
  const st = mapFirmwareStatus(
    BASE.replace('moveEnd=ok', 'moveEnd=home_fail').replace('uh=1', 'uh=0').replace('lh=1', 'lh=0'),
  )
  assert.throws(() => assertHomeMoveEnd(st), /HOME switch/)
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

const MOVE_AT_TARGET =
  'u=-14.9 l=35.0 h=37.1 busy=0 cal=1 calValid=1 lastCmd=MOVEBOTHMM accepted=1 reason=ok '
  + 'puMm=18.5 plMm=0.9 uh=0 ut=0 lh=0 lt=0 estop=0 targetH=37.1 moveEnd=ok'

test('assertMotionMoveEnd rejects moveEnd=limit even with h at the target', () => {
  const st = mapFirmwareStatus(MOVE_AT_TARGET.replace('moveEnd=ok', 'moveEnd=limit'))
  assert.equal(st.h, 37.1)
  assert.throws(() => assertMotionMoveEnd(st, 37.1, 'MOVEBOTHMM'), /ended early on a limit switch: moveEnd=limit/)
})

test('assertMotionMoveEnd rejects moveEnd=both_limits and reason=limit / both_limits', () => {
  const both = mapFirmwareStatus(MOVE_AT_TARGET.replace('moveEnd=ok', 'moveEnd=both_limits'))
  assert.throws(() => assertMotionMoveEnd(both, 37.1, 'MOVEBOTHMM'), /limit switch: moveEnd=both_limits/)
  for (const reason of ['limit', 'both_limits']) {
    const st = mapFirmwareStatus(MOVE_AT_TARGET.replace('reason=ok', `reason=${reason}`))
    assert.equal(st.moveEnd, 'ok')
    assert.throws(() => assertMotionMoveEnd(st, 37.1, 'MOVE_UPPERMM'), new RegExp(`reason=${reason}`))
  }
})

test('pressed switches are data: passed through, not an error on a completed move', () => {
  const st = mapFirmwareStatus(MOVE_AT_TARGET.replace('ut=0', 'ut=1').replace('lh=0', 'lh=1'))
  assert.deepEqual([st.uh, st.ut, st.lh, st.lt], [false, true, true, false])
  assert.doesNotThrow(() => assertMotionMoveEnd(st, 37.1, 'MOVEBOTHMM'))
})

test('isForeignSessionStatus skips keepalive during a move', () => {
  const ping = mapFirmwareStatus(BASE.replace('lastCmd=HOME', 'lastCmd=PING').replace('busy=0', 'busy=1'))
  const home = mapFirmwareStatus(BASE.replace('busy=0', 'busy=1'))
  assert.equal(isForeignSessionStatus(ping, 'HOME'), true)
  assert.equal(isForeignSessionStatus(home, 'HOME'), false)
  assert.equal(isForeignSessionStatus(ping, 'PING'), false)
})
