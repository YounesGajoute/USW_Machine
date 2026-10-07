import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  manualSnapshotFromStatus,
  parseNudgeBody,
  buildNudgeCommand,
} from './centringHeightCalibrationManual.mjs'
import {
  nudgeManualMove,
  getManualMoveSnapshot,
  __setHeightCalibrationDepsForTest,
  __resetHeightCalibrationDepsForTest,
} from './centringHeightCalibrationService.mjs'

const BASE_STATUS = Object.freeze({
  busy: false,
  estop: false,
  cal: false,
  h: NaN,
  u: -10,
  l: -10,
  pu: 1200,
  pl: 1200,
  uh: 0,
  ut: 0,
  lh: 0,
  lt: 0,
  moveEnd: 'ok',
  lastCmd: 'STATUS',
  accepted: true,
  reason: 'ok',
})

afterEach(() => {
  __resetHeightCalibrationDepsForTest()
})

function fakeMaster({ status, nudge, productionHold = false }) {
  const nudgeCalls = []
  const master = {
    nudgeCalls,
    connectWithRetry: async () => {},
    getCentringConfig: () => ({ slaveCal: null }),
    getCentringTcpSessionInfo: () => ({ connected: true, handshaken: true }),
    requestSessionRestore: () => {},
    getCentringProductionTcpHold: () => productionHold,
    status: status ?? (async () => ({ ...BASE_STATUS })),
    nudge: nudge ?? (async (cmd) => {
      nudgeCalls.push(cmd)
      return { ...BASE_STATUS, pu: 1220, pl: 1200, accepted: true, reason: 'ok' }
    }),
    moveTo: async (...args) => {
      throw new Error('moveTo must not be called')
    },
  }
  const lifecycle = {
    isProductionActive: () => false,
    isInitInProgress: () => false,
  }
  return { master, lifecycle }
}

test('buildNudgeCommand relative and absolute', () => {
  assert.equal(
    buildNudgeCommand(parseNudgeBody({ mode: 'relative', axis: 'upper', direction: 'open', stepUs: 20 })),
    'NUDGE U +20',
  )
  assert.equal(
    buildNudgeCommand(parseNudgeBody({ mode: 'absolute', axis: 'upper', pulseUs: 1800 })),
    'NUDGE U 1800',
  )
})

test('parseNudgeBody rejects invalid step, axis, and absolute range', () => {
  assert.throws(() => parseNudgeBody({ mode: 'relative', axis: 'left', direction: 'up', stepUs: 3 }), (e) => e.code === 'INVALID_NUDGE')
  assert.throws(() => parseNudgeBody({ mode: 'absolute', axis: 'both', pulseUs: 1800 }), (e) => e.code === 'INVALID_NUDGE')
  assert.throws(() => parseNudgeBody({ mode: 'absolute', axis: 'upper', pulseUs: 249 }), (e) => e.code === 'INVALID_NUDGE')
  assert.throws(() => parseNudgeBody({ mode: 'absolute', axis: 'upper', pulseUs: 2401 }), (e) => e.code === 'INVALID_NUDGE')
})

test('missing status returns connected false and null switches', () => {
  const snap = manualSnapshotFromStatus(null)
  assert.equal(snap.connected, false)
  assert.equal(snap.switches.upperHome, null)
})

test('no handshaken session returns a disconnected snapshot without STATUS', async () => {
  let statusCalls = 0
  let restores = 0
  const { master, lifecycle } = fakeMaster({
    status: async () => { statusCalls += 1; return { ...BASE_STATUS } },
  })
  master.getCentringTcpSessionInfo = () => ({ connected: false, handshaken: false })
  master.requestSessionRestore = () => { restores += 1 }
  __setHeightCalibrationDepsForTest({ master, lifecycle })
  const snap = await getManualMoveSnapshot()
  assert.equal(snap.connected, false)
  assert.equal(snap.switches.upperHome, null)
  assert.equal(statusCalls, 0)
  assert.equal(restores, 1)
})

test('getManualMoveSnapshot does not call nudge', async () => {
  const { master, lifecycle } = fakeMaster({ status: async () => ({ ...BASE_STATUS, uh: 1 }) })
  __setHeightCalibrationDepsForTest({ master, lifecycle })
  const snap = await getManualMoveSnapshot()
  assert.equal(snap.switches.upperHome, true)
  assert.equal(master.nudgeCalls.length, 0)
})

test('open upper by 20 µs sends NUDGE U +20 and does not call moveTo', async () => {
  const { master, lifecycle } = fakeMaster({})
  __setHeightCalibrationDepsForTest({ master, lifecycle })
  const result = await nudgeManualMove({ mode: 'relative', axis: 'upper', direction: 'open', stepUs: 20 }, { username: 'bypass' })
  assert.deepEqual(master.nudgeCalls, ['NUDGE U +20'])
  assert.equal(result.command, 'NUDGE U +20')
})

test('close lower by 4 µs sends NUDGE L -4', async () => {
  const { master, lifecycle } = fakeMaster({})
  __setHeightCalibrationDepsForTest({ master, lifecycle })
  await nudgeManualMove({ mode: 'relative', axis: 'lower', direction: 'close', stepUs: 4 }, { username: 'bypass' })
  assert.deepEqual(master.nudgeCalls, ['NUDGE L -4'])
})

test('both open by 100 µs sends NUDGE BOTH +100', async () => {
  const { master, lifecycle } = fakeMaster({})
  __setHeightCalibrationDepsForTest({ master, lifecycle })
  await nudgeManualMove({ mode: 'relative', axis: 'both', direction: 'open', stepUs: 100 }, { username: 'bypass' })
  assert.deepEqual(master.nudgeCalls, ['NUDGE BOTH +100'])
})

test('absolute upper 1800 sends NUDGE U 1800', async () => {
  const { master, lifecycle } = fakeMaster({})
  __setHeightCalibrationDepsForTest({ master, lifecycle })
  await nudgeManualMove({ mode: 'absolute', axis: 'upper', pulseUs: 1800 }, { username: 'bypass' })
  assert.deepEqual(master.nudgeCalls, ['NUDGE U 1800'])
})

test('cal 0 still sends nudge', async () => {
  const { master, lifecycle } = fakeMaster({ status: async () => ({ ...BASE_STATUS, cal: 0 }) })
  __setHeightCalibrationDepsForTest({ master, lifecycle })
  await nudgeManualMove({ mode: 'relative', axis: 'upper', direction: 'open', stepUs: 20 }, { username: 'bypass' })
  assert.equal(master.nudgeCalls.length, 1)
})

test('estop, busy, and assertJawsFree failure do not send', async () => {
  for (const st of [
    { ...BASE_STATUS, estop: 1 },
    { ...BASE_STATUS, busy: 1 },
  ]) {
    const { master, lifecycle } = fakeMaster({ status: async () => st })
    __setHeightCalibrationDepsForTest({ master, lifecycle })
    await assert.rejects(
      () => nudgeManualMove({ mode: 'relative', axis: 'upper', direction: 'open', stepUs: 20 }, { username: 'bypass' }),
    )
    assert.equal(master.nudgeCalls.length, 0)
  }
  const { master, lifecycle } = fakeMaster({ productionHold: true })
  __setHeightCalibrationDepsForTest({ master, lifecycle })
  await assert.rejects(
    () => nudgeManualMove({ mode: 'relative', axis: 'upper', direction: 'open', stepUs: 20 }, { username: 'bypass' }),
  )
  assert.equal(master.nudgeCalls.length, 0)
})
