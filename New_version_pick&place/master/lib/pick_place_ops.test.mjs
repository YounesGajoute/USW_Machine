import test from 'node:test'
import assert from 'node:assert/strict'
import {
  preparePickPlaceTcp,
  readPickPlaceStatus,
  clearPickPlaceFault,
  remediatePickPlace,
  ensurePickPlaceSession,
  __setPickPlaceOpsTestImpl,
  __clearPickPlaceOpsTestImpl,
} from './pick_place_ops.mjs'

function mockMaster(overrides = {}) {
  return {
    probeConnection: async () => ({ ok: true, target: '192.168.10.5:8177' }),
    setReachable: () => {},
    status: async () => ({
      fault: false,
      estop: false,
      homedA: true,
      homedB: true,
      positionA: 0.6,
    }),
    recover: async () => ({ ok: true }),
    connectWithRetry: async () => {
      throw new Error('connectWithRetry should not be called')
    },
    ...overrides,
  }
}

test('preparePickPlaceTcp uses probe only, not connectWithRetry', async () => {
  let probeCalls = 0
  let connectCalls = 0
  __setPickPlaceOpsTestImpl(
    mockMaster({
      probeConnection: async () => {
        probeCalls += 1
        return { ok: true, target: 't' }
      },
      connectWithRetry: async () => {
        connectCalls += 1
      },
    }),
  )
  try {
    await preparePickPlaceTcp()
    assert.equal(probeCalls, 1)
    assert.equal(connectCalls, 0)
  } finally {
    __clearPickPlaceOpsTestImpl()
  }
})

test('preparePickPlaceTcp throws when probe fails', async () => {
  __setPickPlaceOpsTestImpl(
    mockMaster({
      probeConnection: async () => ({ ok: false, target: 't', error: 'timeout' }),
    }),
  )
  try {
    await assert.rejects(preparePickPlaceTcp(), /TCP unreachable/)
  } finally {
    __clearPickPlaceOpsTestImpl()
  }
})

test('remediatePickPlace skips recover when no fault or estop', async () => {
  let recoverCalls = 0
  __setPickPlaceOpsTestImpl(
    mockMaster({
      recover: async () => {
        recoverCalls += 1
        return { ok: true }
      },
    }),
  )
  try {
    const r = await remediatePickPlace()
    assert.equal(recoverCalls, 0)
    assert.equal(r.cleared, false)
    assert.equal(r.status.fault, false)
  } finally {
    __clearPickPlaceOpsTestImpl()
  }
})

test('remediatePickPlace calls recover on fault then re-reads status', async () => {
  let statusCalls = 0
  let recoverCalls = 0
  __setPickPlaceOpsTestImpl(
    mockMaster({
      status: async () => {
        statusCalls += 1
        if (statusCalls === 1) {
          return { fault: true, estop: false, homedA: false, homedB: false }
        }
        return { fault: false, estop: false, homedA: true, homedB: true, positionA: 0.6 }
      },
      recover: async () => {
        recoverCalls += 1
        return { ok: true }
      },
    }),
  )
  try {
    const r = await remediatePickPlace()
    assert.equal(statusCalls, 2)
    assert.equal(recoverCalls, 1)
    assert.equal(r.cleared, true)
    assert.equal(r.status.fault, false)
  } finally {
    __clearPickPlaceOpsTestImpl()
  }
})

test('readPickPlaceStatus and clearPickPlaceFault delegate to master', async () => {
  let statusCalls = 0
  let recoverCalls = 0
  __setPickPlaceOpsTestImpl(
    mockMaster({
      status: async () => {
        statusCalls += 1
        return { fault: false }
      },
      recover: async () => {
        recoverCalls += 1
        return { cleared: true }
      },
    }),
  )
  try {
    await readPickPlaceStatus()
    await clearPickPlaceFault()
    assert.equal(statusCalls, 1)
    assert.equal(recoverCalls, 1)
  } finally {
    __clearPickPlaceOpsTestImpl()
  }
})

test('ensurePickPlaceSession skips connectWithRetry when preflight tcpOk', async () => {
  let connectCalls = 0
  __setPickPlaceOpsTestImpl(
    mockMaster({
      connectWithRetry: async () => {
        connectCalls += 1
      },
    }),
  )
  try {
    await ensurePickPlaceSession({ tcpOk: true })
    assert.equal(connectCalls, 0)
  } finally {
    __clearPickPlaceOpsTestImpl()
  }
})
