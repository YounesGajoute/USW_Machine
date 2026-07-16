import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapFirmwareStatus,
  assertHomeMoveEnd,
  assertMotionMoveEnd,
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

test('assertMotionMoveEnd rejects limit/stall/timeout/link_lost', () => {
  for (const mend of ['limit', 'stall', 'timeout', 'link_lost', 'estop']) {
    const st = mapFirmwareStatus(
      BASE.replace('moveEnd=ok', `moveEnd=${mend}`).replace('lastCmd=HOME', 'lastCmd=MOVEBOTHMM'),
    )
    st.h = 37.1
    st.targetH = 37.1
    assert.throws(() => assertMotionMoveEnd(st, 37.1, 'MOVEBOTHMM'), /ended early/)
  }
})
