import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  inactiveCentringAxis,
  productionPostureSigned,
  assertProductionPosture,
  isCentringInitIdleReady,
  isCentringTravelIdleStatus,
  getCentringProductionBlockReason,
} from './centringIdle.mjs'
import {
  centringHomingBlockReason,
  centringNeedsHome,
  parseCentringSwitches,
  isRecoverableCentringInitError,
  runCentringHomingSequence,
} from './centringHoming.mjs'
import {
  gapMmToMoveTarget,
  heightFromSigned,
  H_TOTAL_MIN,
  H_TOTAL_MAX,
  S_MIN,
  S_MAX,
  isCentringClosedIdle,
} from './centringMaster/centring_height_model.js'

test('height model — HOME=S_MIN open, TRAVEL=S_MAX closed (Double_Actuator)', () => {
  assert.ok(Math.abs(heightFromSigned(S_MIN) - 31.437) < 0.05)
  assert.ok(Math.abs(heightFromSigned(S_MAX) - 0.9) < 0.05)
  assert.ok(H_TOTAL_MAX > 62.7 && H_TOTAL_MAX < 63.1)
  assert.ok(H_TOTAL_MIN > 1.7 && H_TOTAL_MIN < 1.9)
})

test('productionPostureSigned — upper active@HOME open, inactive@TRAVEL closed', () => {
  assert.deepEqual(productionPostureSigned('upper'), { u: S_MIN, l: S_MAX })
  assert.deepEqual(productionPostureSigned('lower'), { u: S_MAX, l: S_MIN })
  assert.deepEqual(productionPostureSigned('both'), { u: S_MAX, l: S_MAX })
})

test('inactiveCentringAxis maps mechanism axis', () => {
  assert.equal(inactiveCentringAxis('upper'), 'lower')
  assert.equal(inactiveCentringAxis('lower'), 'upper')
  assert.equal(inactiveCentringAxis('both'), null)
})

test('assertProductionPosture rejects wrong upper posture', () => {
  assert.throws(
    () => assertProductionPosture({ u: S_MAX, l: S_MIN }, 'upper'),
    /production posture invalid/i,
  )
})

test('assertProductionPosture accepts upper open/closed and mid gap reachable', () => {
  const st = { u: S_MIN, l: S_MAX }
  const gap = 20
  assertProductionPosture(st, 'upper', gap)
  const target = gapMmToMoveTarget({
    gapMm: gap,
    moveCommand: 'MOVE_UPPERMM',
    uNow: st.u,
    lNow: st.l,
  })
  assert.ok(Math.abs(target.expectedH - gap) < 0.5)
})

test('production posture targets HOME on active axis (not a gap MOVE)', () => {
  assert.ok(isCentringClosedIdle(S_MAX, S_MAX))
  assert.deepEqual(productionPostureSigned('upper'), { u: S_MIN, l: S_MAX })
  // Tube h_pre (recipe height) is reachable from that posture — independent of park H.
  const hPre = 4.5
  const t = gapMmToMoveTarget({
    gapMm: hPre,
    moveCommand: 'MOVE_UPPERMM',
    uNow: S_MIN,
    lNow: S_MAX,
  })
  assert.ok(Math.abs(t.expectedH - hPre) < 0.05)
})

test('h_pre unreachable when inactive axis already open (wrong posture)', () => {
  assert.throws(
    () =>
      gapMmToMoveTarget({
        gapMm: 10,
        moveCommand: 'MOVE_UPPERMM',
        uNow: S_MAX,
        lNow: S_MIN,
      }),
    /unreachable|no valid/i,
  )
})

test('isCentringInitIdleReady — cal=1 and both at TRAVEL', () => {
  const ready = { cal: true, estop: false, busy: false }
  assert.equal(isCentringInitIdleReady({ u: S_MAX, l: S_MAX, ...ready }), true)
  assert.equal(isCentringInitIdleReady({ u: S_MIN, l: S_MIN, ...ready }), false)
  assert.equal(isCentringInitIdleReady({ u: S_MAX, l: S_MAX, cal: false, estop: false, busy: false }), false)
  assert.equal(isCentringInitIdleReady({ u: S_MAX, l: S_MAX, cal: true, estop: true, busy: false }), false)
})

test('isCentringTravelIdleStatus — UT+LT authority when soft drifts (init SEEK settle)', () => {
  // Runtime: SEEK ok then soft 33.42/33.45 or 35/33.45 failed old ±1.5 soft-only gate.
  assert.equal(
    isCentringTravelIdleStatus({
      u: 33.42, l: 33.45, ut: true, lt: true, raw: { uh: '0', ut: '1', lh: '0', lt: '1' },
    }),
    true,
  )
  assert.equal(
    isCentringTravelIdleStatus({
      u: 35, l: 33.45, ut: true, lt: true, raw: { uh: '0', ut: '1', lh: '0', lt: '1' },
    }),
    true,
  )
  assert.equal(
    isCentringTravelIdleStatus({
      u: 31.98, l: 35, ut: true, lt: true, raw: { uh: '0', ut: '1', lh: '0', lt: '1' },
    }),
    true,
  )
  // Soft-only fallback within ±3° when switches absent
  assert.equal(isCentringTravelIdleStatus({ u: 33.42, l: 33.45 }), true)
  assert.equal(isCentringTravelIdleStatus({ u: 31.98, l: 35 }), false)
  assert.equal(
    isCentringInitIdleReady({
      u: 33.42, l: 33.45, cal: true, estop: false, busy: false,
      ut: true, lt: true, raw: { ut: '1', lt: '1', uh: '0', lh: '0' },
    }),
    true,
  )
})

test('centringNeedsHome — false at closed idle; true mid-pose', () => {
  assert.equal(centringNeedsHome({ u: S_MAX, l: S_MAX, uh: false, lh: false, moveEnd: 'ok' }), false)
  assert.equal(
    centringNeedsHome({ u: S_MIN, l: S_MIN, uh: true, lh: true, moveEnd: 'ok' }),
    false,
  )
  assert.equal(centringNeedsHome({ u: 0, l: 0, uh: false, lh: false, moveEnd: 'ok' }), true)
  assert.equal(centringNeedsHome({ u: S_MAX, l: S_MAX, moveEnd: 'link_lost' }), true)
})

test('centringHomingBlockReason — UH active alone is OK; estop blocks', () => {
  assert.equal(centringHomingBlockReason({ raw: { uh: '1', ut: '0', lh: '0', lt: '0' } }), null)
  assert.match(centringHomingBlockReason({ estop: true }) ?? '', /estop/)
})

test('centringHomingBlockReason — UH+UT both active blocks', () => {
  const reason = centringHomingBlockReason({
    raw: { uh: '1', ut: '1', lh: '0', lt: '0' },
  })
  assert.match(reason ?? '', /UH\+UT/)
})

test('parseCentringSwitches from STATUS raw', () => {
  assert.deepEqual(
    parseCentringSwitches({ raw: { uh: '1', ut: '0', lh: '0', lt: '1' } }),
    { uh: true, ut: false, lh: false, lt: true },
  )
})

test('runCentringHomingSequence — skip when at open idle with HOME switches', async () => {
  const { runCentringHomingSequence } = await import('./centringHoming.mjs')
  let homeCalls = 0
  const result = await runCentringHomingSequence({
    status: async () => ({
      u: S_MIN, l: S_MIN, busy: false, accepted: true, cal: true, estop: false,
      uh: true, lh: true, moveEnd: 'ok',
      raw: { uh: '1', ut: '0', lh: '1', lt: '0' },
    }),
    homeByAxis: async () => {
      homeCalls += 1
      return {}
    },
    initial: {
      u: S_MIN, l: S_MIN, busy: false, accepted: true, cal: true, estop: false,
      uh: true, lh: true, moveEnd: 'ok',
      raw: { uh: '1', ut: '0', lh: '1', lt: '0' },
    },
  })
  assert.equal(result.didHome, false)
  assert.equal(homeCalls, 0)
})

test('runCentringHomingSequence — mid-pose uses HOME both once', async () => {
  const { runCentringHomingSequence } = await import('./centringHoming.mjs')
  const axes = []
  let st = {
    u: 0, l: 0, busy: false, accepted: true, cal: true, estop: false,
    uh: false, lh: false, moveEnd: 'none',
    raw: { uh: '0', ut: '0', lh: '0', lt: '0' },
  }
  const result = await runCentringHomingSequence({
    status: async () => st,
    homeByAxis: async (axis) => {
      axes.push(axis)
      st = {
        ...st,
        u: S_MIN,
        l: S_MIN,
        uh: true,
        lh: true,
        accepted: true,
        busy: false,
        moveEnd: 'ok',
        lastCmd: 'HOME',
      }
      return { tag: 'HOME', status: st, u: S_MIN, l: S_MIN, moveEnd: 'ok' }
    },
    initial: { ...st },
  })
  assert.deepEqual(axes, ['both'])
  assert.equal(result.didHome, true)
  assert.equal(result.status.moveEnd, 'ok')
})

test('runCentringHomingSequence — waitIdle when busy before HOME', async () => {
  const { runCentringHomingSequence } = await import('./centringHoming.mjs')
  const axes = []
  let st = {
    u: 0, l: 0, busy: true, accepted: true, cal: true, estop: false,
    uh: false, lh: false, moveEnd: 'none', raw: {},
  }
  const result = await runCentringHomingSequence({
    status: async () => st,
    waitIdle: async () => {
      st = { ...st, busy: false }
      return st
    },
    homeByAxis: async (axis) => {
      axes.push(axis)
      st = {
        ...st,
        u: S_MIN,
        l: S_MIN,
        uh: true,
        lh: true,
        busy: false,
        accepted: true,
        moveEnd: 'ok',
        lastCmd: 'HOME',
      }
      return { tag: 'HOME', status: st, moveEnd: 'ok' }
    },
    initial: { ...st },
  })
  assert.deepEqual(axes, ['both'])
  assert.equal(result.didHome, true)
})

test('isRecoverableCentringInitError classifies home_fail vs wiring/SETCAL', () => {
  assert.equal(
    isRecoverableCentringInitError(new Error('Centring homing failed: moveEnd=home_fail — do not MOVE')),
    true,
  )
  assert.equal(
    isRecoverableCentringInitError(
      new Error('Centring init failed: expected closed idle (UT+LT) after SEEK_TRAVEL'),
    ),
    true,
  )
  assert.equal(
    isRecoverableCentringInitError(new Error('Centring homing failed: UH+UT both active — check wiring')),
    false,
  )
  assert.equal(
    isRecoverableCentringInitError(new Error('Centring init failed: cal=0 after init — SETCAL required')),
    false,
  )
})

test('runCentringHomingSequence — home_fail retries then fails', async () => {
  let homeCalls = 0
  let clearCalls = 0
  await assert.rejects(
    () =>
      runCentringHomingSequence({
        status: async () => ({
          u: 0, l: 0, busy: false, accepted: true, cal: true, estop: false, moveEnd: 'none',
        }),
        homeByAxis: async () => {
          homeCalls += 1
          return {
            tag: 'HOME',
            status: {
              u: 0, l: 0, busy: false, accepted: true,
              moveEnd: 'home_fail', lastCmd: 'HOME',
            },
            moveEnd: 'home_fail',
          }
        },
        clearFault: async () => {
          clearCalls += 1
          return { ok: true }
        },
        homeAttempts: 3,
        retrySettleMs: 0,
        initial: {
          u: 0, l: 0, busy: false, accepted: true, cal: true, estop: false, moveEnd: 'none',
        },
      }),
    /home_fail/,
  )
  assert.equal(homeCalls, 3)
  assert.equal(clearCalls, 2, 'CLR/CLEARESTOP between attempts')
})

test('runCentringHomingSequence — home_fail then succeeds on retry', async () => {
  let homeCalls = 0
  const result = await runCentringHomingSequence({
    status: async () => ({
      u: homeCalls >= 2 ? S_MIN : 0,
      l: homeCalls >= 2 ? S_MIN : 0,
      busy: false,
      accepted: true,
      cal: true,
      estop: false,
      uh: homeCalls >= 2,
      lh: homeCalls >= 2,
      moveEnd: homeCalls >= 2 ? 'ok' : 'none',
    }),
    homeByAxis: async () => {
      homeCalls += 1
      if (homeCalls === 1) {
        return {
          tag: 'HOME',
          status: {
            u: 0, l: 0, busy: false, accepted: true,
            moveEnd: 'home_fail', lastCmd: 'HOME',
          },
          moveEnd: 'home_fail',
        }
      }
      return {
        tag: 'HOME',
        status: {
          u: S_MIN, l: S_MIN, busy: false, accepted: true,
          uh: true, lh: true, moveEnd: 'ok', lastCmd: 'HOME',
        },
        moveEnd: 'ok',
      }
    },
    clearFault: async () => ({ ok: true }),
    homeAttempts: 3,
    retrySettleMs: 0,
    initial: {
      u: 0, l: 0, busy: false, accepted: true, cal: true, estop: false, moveEnd: 'none',
    },
  })
  assert.equal(result.didHome, true)
  assert.equal(result.homeAttemptsUsed, 2)
  assert.equal(homeCalls, 2)
  assert.equal(result.status.moveEnd, 'ok')
})

test('getCentringProductionBlockReason skipped when PRODUCTION_SKIP_CENTRING=1', () => {
  const prev = process.env.PRODUCTION_SKIP_CENTRING
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  try {
    assert.equal(getCentringProductionBlockReason(), null)
  } finally {
    if (prev === undefined) delete process.env.PRODUCTION_SKIP_CENTRING
    else process.env.PRODUCTION_SKIP_CENTRING = prev
  }
})

test('getCentringProductionBlockReason blocks when STATUS cache is null', async () => {
  const prev = process.env.PRODUCTION_SKIP_CENTRING
  delete process.env.PRODUCTION_SKIP_CENTRING
  const { __setCachedCentringStatusForTest } = await import('./tcpSubsystemHealth.mjs')
  __setCachedCentringStatusForTest({
    u: 35, l: 35, h: 1.8, busy: false, cal: true, estop: false, ut: true, lt: true,
  })
  __setCachedCentringStatusForTest(null)
  const reason = getCentringProductionBlockReason()
  assert.match(reason ?? '', /STATUS unavailable/i)
  if (prev === undefined) delete process.env.PRODUCTION_SKIP_CENTRING
  else process.env.PRODUCTION_SKIP_CENTRING = prev
})

test('assertMotionMoveEnd requires finite h', async () => {
  const { assertMotionMoveEnd, mapFirmwareStatus } = await import(
    './centringMaster/centring_master.js'
  )
  const st = mapFirmwareStatus(
    'u=35 l=35 h=nan busy=0 cal=0 calValid=0 lastCmd=MOVEBOTHMM accepted=1 reason=ok '
    + 'hmin=1.80 hmax=62.87 mechOff=0 calId=x hu=1 tu=1 hl=1 tl=1 '
    + 'puMm=nan plMm=nan uh=0 ut=1 lh=0 lt=1 estop=0 targetH=40 moveEnd=ok',
  )
  assert.throws(() => assertMotionMoveEnd(st, 40, 'MOVEBOTHMM'), /finite h|missing finite h/i)
})
