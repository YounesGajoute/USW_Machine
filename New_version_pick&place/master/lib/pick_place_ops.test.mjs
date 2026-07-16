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
    connect: async () => {},
    setReachable: () => {},
    status: async () => ({
      fault: false,
      estop: false,
      homedA: true,
      homedB: true,
      positionA: 0.6,
    }),
    recover: async () => ({ ok: true }),
    clearError: async () => ({ ok: true, cleared: true }),
    connectWithRetry: async () => {
      throw new Error('connectWithRetry should not be called')
    },
    ...overrides,
  }
}

test('preparePickPlaceTcp opens persistent connect(), not connectWithRetry', async () => {
  let probeCalls = 0
  let connectCalls = 0
  __setPickPlaceOpsTestImpl(
    mockMaster({
      probeConnection: async () => {
        probeCalls += 1
        return { ok: true, target: 't' }
      },
      connect: async () => {
        connectCalls += 1
      },
      connectWithRetry: async () => {
        throw new Error('connectWithRetry should not be called')
      },
    }),
  )
  try {
    const r = await preparePickPlaceTcp()
    assert.equal(connectCalls, 1)
    assert.equal(probeCalls, 0)
    assert.equal(r.persistent, true)
  } finally {
    __clearPickPlaceOpsTestImpl()
  }
})

test('preparePickPlaceTcp throws when connect fails', async () => {
  __setPickPlaceOpsTestImpl(
    mockMaster({
      connect: async () => {
        throw new Error('connect timeout')
      },
    }),
  )
  try {
    await assert.rejects(preparePickPlaceTcp(), /TCP unreachable/)
  } finally {
    __clearPickPlaceOpsTestImpl()
  }
})

test('remediatePickPlace skips clearError when no fault or estop', async () => {
  let clearCalls = 0
  __setPickPlaceOpsTestImpl(
    mockMaster({
      clearError: async () => {
        clearCalls += 1
        return { ok: true, cleared: true }
      },
    }),
  )
  try {
    const r = await remediatePickPlace()
    assert.equal(clearCalls, 0)
    assert.equal(r.cleared, false)
    assert.equal(r.status.fault, false)
  } finally {
    __clearPickPlaceOpsTestImpl()
  }
})

test('remediatePickPlace calls clearError on fault then re-reads status', async () => {
  let statusCalls = 0
  let clearCalls = 0
  __setPickPlaceOpsTestImpl(
    mockMaster({
      status: async () => {
        statusCalls += 1
        if (statusCalls === 1) {
          return { fault: true, estop: false, homedA: false, homedB: false }
        }
        return { fault: false, estop: false, homedA: true, homedB: true, positionA: 0.6 }
      },
      clearError: async () => {
        clearCalls += 1
        return { ok: true, cleared: true }
      },
    }),
  )
  try {
    const r = await remediatePickPlace()
    assert.equal(statusCalls, 2)
    assert.equal(clearCalls, 1)
    assert.equal(r.cleared, true)
    assert.equal(r.status.fault, false)
  } finally {
    __clearPickPlaceOpsTestImpl()
  }
})

test('readPickPlaceStatus and clearPickPlaceFault delegate to master', async () => {
  let statusCalls = 0
  let clearCalls = 0
  __setPickPlaceOpsTestImpl(
    mockMaster({
      status: async () => {
        statusCalls += 1
        return { fault: false }
      },
      clearError: async () => {
        clearCalls += 1
        return { cleared: true }
      },
    }),
  )
  try {
    await readPickPlaceStatus()
    await clearPickPlaceFault()
    assert.equal(statusCalls, 1)
    assert.equal(clearCalls, 1)
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
