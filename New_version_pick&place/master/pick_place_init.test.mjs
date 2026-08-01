import test from 'node:test'
import assert from 'node:assert/strict'
import {
  __setPickPlaceOpsTestImpl,
  __clearPickPlaceOpsTestImpl,
} from './lib/pick_place_ops.mjs'
import {
  initializePickPlace,
  isRecoverablePickPlaceInitHomeError,
  __setPickPlaceInitTestHoming,
  __clearPickPlaceInitTestHoming,
} from './pick_place_master.js'

test('initializePickPlace runs status → clrfault → HOMEA → HOMEB', async () => {
  const sequence = []
  let statusCalls = 0

  __setPickPlaceOpsTestImpl({
    connect: async () => {
      sequence.push('connect')
    },
    probeConnection: async () => {
      sequence.push('probe')
      return { ok: true, target: 't' }
    },
    setReachable: () => {},
    status: async () => {
      statusCalls += 1
      sequence.push(`status:${statusCalls}`)
      if (statusCalls === 1) {
        return { fault: true, estop: false, homedA: false, homedB: false }
      }
      // Post-CLRFAULT: fault cleared but still unhomed → init proceeds to HOMEA/HOMEB.
      return { fault: false, estop: false, homedA: false, homedB: false, positionA: 0.6, positionB: 0.9 }
    },
    clearError: async () => {
      sequence.push('clrfault')
      return { ok: true, cleared: true }
    },
    getPickPlaceConfig: () => ({
      backoffMmA: 0.5,
      backoffMmB: 0.8,
      homingSpeedMmS: 80,
    }),
  })

  __setPickPlaceInitTestHoming({
    homeA: async (backoff, speed) => {
      sequence.push(`homeA:${backoff}`)
      return { homedA: true, positionA: 0.6, command: 'HOMEA' }
    },
    homeB: async (backoff, speed) => {
      sequence.push(`homeB:${backoff}`)
      return { homedB: true, positionB: 0.9, command: 'HOMEB' }
    },
    status: async () => {
      sequence.push('status:final')
      return { homedA: true, homedB: true, positionA: 0.6, positionB: 0.9 }
    },
  })

  try {
    const r = await initializePickPlace()
    assert.deepEqual(sequence, [
      'connect',
      'status:1',
      'clrfault',
      'status:2',
      'homeA:0.5',
      'homeB:0.8',
      'status:final',
    ])
    assert.equal(r.ok, true)
    assert.equal(r.alreadyHomed, false)
    assert.equal(r.restPositionMmA, 0.6)
    assert.equal(r.homedA, true)
    assert.equal(r.homedB, true)
    assert.match(r.procedure, /HOMEA/)
    assert.match(r.procedure, /HOMEB/)
  } finally {
    __clearPickPlaceOpsTestImpl()
    __clearPickPlaceInitTestHoming()
  }
})

test('initializePickPlace always homes A then B even when already at backoff', async () => {
  const sequence = []

  __setPickPlaceOpsTestImpl({
    connect: async () => {
      sequence.push('connect')
    },
    probeConnection: async () => {
      sequence.push('probe')
      return { ok: true, target: 't' }
    },
    setReachable: () => {},
    status: async () => {
      sequence.push('status')
      return {
        fault: false,
        estop: false,
        homedA: true,
        homedB: true,
        positionA: 0.5,
        positionB: 0.8,
      }
    },
    clearError: async () => {
      sequence.push('clrfault')
      return { ok: true, cleared: true }
    },
    getPickPlaceConfig: () => ({ backoffMmA: 0.5, backoffMmB: 0.8, homingSpeedMmS: 80 }),
  })

  __setPickPlaceInitTestHoming({
    homeA: async (backoff) => {
      sequence.push(`homeA:${backoff}`)
      return { homedA: true, positionA: 0.5, command: 'HOMEA' }
    },
    homeB: async (backoff) => {
      sequence.push(`homeB:${backoff}`)
      return { homedB: true, positionB: 0.8, command: 'HOMEB' }
    },
    status: async () => {
      sequence.push('status:final')
      return { homedA: true, homedB: true, positionA: 0.5, positionB: 0.8 }
    },
  })

  try {
    const r = await initializePickPlace()
    assert.equal(r.ok, true)
    assert.equal(r.alreadyHomed, false)
    assert.deepEqual(sequence, [
      'connect',
      'status',
      'homeA:0.5',
      'homeB:0.8',
      'status:final',
    ])
    assert.ok(r.homeA)
    assert.ok(r.homeB)
    assert.equal(r.procedure, 'HOMEA → backoff A, then HOMEB → backoff B')
  } finally {
    __clearPickPlaceOpsTestImpl()
    __clearPickPlaceInitTestHoming()
  }
})

test('initializePickPlace homes A then B when only B is off backoff', async () => {
  const sequence = []

  __setPickPlaceOpsTestImpl({
    connect: async () => {},
    probeConnection: async () => ({ ok: true, target: 't' }),
    setReachable: () => {},
    status: async () => ({
      fault: false,
      estop: false,
      homedA: true,
      homedB: true,
      positionA: 0.5,
      positionB: 120,
    }),
    clearError: async () => ({ ok: true, cleared: true }),
    getPickPlaceConfig: () => ({ backoffMmA: 0.5, backoffMmB: 0.8, homingSpeedMmS: 80 }),
  })

  __setPickPlaceInitTestHoming({
    homeA: async (backoff) => {
      sequence.push(`homeA:${backoff}`)
      return { homedA: true, positionA: 0.5, command: 'HOMEA' }
    },
    homeB: async (backoff) => {
      sequence.push(`homeB:${backoff}`)
      return { homedB: true, positionB: 0.8, command: 'HOMEB' }
    },
    status: async () => ({ homedA: true, homedB: true, positionA: 0.5, positionB: 0.8 }),
  })

  try {
    const r = await initializePickPlace()
    assert.equal(r.ok, true)
    assert.deepEqual(sequence, ['homeA:0.5', 'homeB:0.8'])
    assert.ok(r.homeA)
    assert.ok(r.homeB)
  } finally {
    __clearPickPlaceOpsTestImpl()
    __clearPickPlaceInitTestHoming()
  }
})

test('initializePickPlace homes A then B when A is off backoff', async () => {
  const sequence = []

  __setPickPlaceOpsTestImpl({
    connect: async () => {
      sequence.push('connect')
    },
    probeConnection: async () => {
      sequence.push('probe')
      return { ok: true, target: 't' }
    },
    setReachable: () => {},
    status: async () => {
      sequence.push('status')
      return {
        fault: false,
        estop: false,
        homedA: true,
        homedB: true,
        positionA: 159.6,
        positionB: 0.8,
      }
    },
    clearError: async () => {
      sequence.push('clrfault')
      return { ok: true, cleared: true }
    },
    getPickPlaceConfig: () => ({ backoffMmA: 0.5, backoffMmB: 0.8, homingSpeedMmS: 80 }),
  })

  __setPickPlaceInitTestHoming({
    homeA: async (backoff) => {
      sequence.push(`homeA:${backoff}`)
      return { homedA: true, positionA: 0.5, command: 'HOMEA' }
    },
    homeB: async (backoff) => {
      sequence.push(`homeB:${backoff}`)
      return { homedB: true, positionB: 0.8, command: 'HOMEB' }
    },
    status: async () => {
      sequence.push('status:final')
      return { homedA: true, homedB: true, positionA: 0.5, positionB: 0.8 }
    },
  })

  try {
    const r = await initializePickPlace()
    assert.equal(r.ok, true)
    assert.equal(r.alreadyHomed, false)
    assert.deepEqual(sequence, [
      'connect',
      'status',
      'homeA:0.5',
      'homeB:0.8',
      'status:final',
    ])
    assert.ok(r.homeA)
    assert.ok(r.homeB)
  } finally {
    __clearPickPlaceOpsTestImpl()
    __clearPickPlaceInitTestHoming()
  }
})

test('isRecoverablePickPlaceInitHomeError classifies HOMEB release and hard faults', () => {
  assert.equal(isRecoverablePickPlaceInitHomeError(new Error('ERR HOMEB release')), true)
  assert.equal(isRecoverablePickPlaceInitHomeError(new Error('ERR HOMEA timeout')), true)
  assert.equal(
    isRecoverablePickPlaceInitHomeError(
      new Error('Pick & Place init failed: fault latched after CLRFAULT — check hardware'),
    ),
    false,
  )
  assert.equal(
    isRecoverablePickPlaceInitHomeError(
      new Error('Pick & Place init failed: e-stop latched — clear and retry Initialization'),
    ),
    false,
  )
})

test('initializePickPlace retries HOMEB after ERR HOMEB release then succeeds', async () => {
  const sequence = []
  let homeBCalls = 0
  let statusCalls = 0
  let faultLatched = false

  __setPickPlaceOpsTestImpl({
    connect: async () => {
      sequence.push('connect')
    },
    probeConnection: async () => ({ ok: true, target: 't' }),
    setReachable: () => {},
    status: async () => {
      statusCalls += 1
      sequence.push(`status:${statusCalls}`)
      if (faultLatched) {
        return { fault: true, estop: false, homedA: true, homedB: false, positionA: 0.5, positionB: 0 }
      }
      return {
        fault: false,
        estop: false,
        homedA: homeBCalls > 0,
        homedB: homeBCalls >= 2,
        positionA: 0.5,
        positionB: homeBCalls >= 2 ? 0.8 : 0,
      }
    },
    clearError: async () => {
      sequence.push('clrfault')
      faultLatched = false
      return { ok: true, cleared: true }
    },
    getPickPlaceConfig: () => ({ backoffMmA: 0.5, backoffMmB: 0.8, homingSpeedMmS: 80 }),
  })

  __setPickPlaceInitTestHoming({
    homeA: async (backoff) => {
      sequence.push(`homeA:${backoff}`)
      return { homedA: true, positionA: 0.5, command: 'HOMEA' }
    },
    homeB: async (backoff) => {
      homeBCalls += 1
      sequence.push(`homeB:${homeBCalls}`)
      if (homeBCalls === 1) {
        faultLatched = true
        throw new Error('ERR HOMEB release')
      }
      return { homedB: true, positionB: 0.8, command: `HOMEB ${backoff}` }
    },
    status: async () => {
      sequence.push('status:final')
      return { homedA: true, homedB: true, positionA: 0.5, positionB: 0.8, fault: false, estop: false }
    },
  })

  try {
    const r = await initializePickPlace({ homeAttempts: 3, retrySettleMs: 0 })
    assert.equal(r.ok, true)
    assert.equal(r.homedB, true)
    assert.equal(homeBCalls, 2)
    assert.ok(sequence.includes('clrfault'), 'CLRFAULT between HOMEB attempts')
    assert.deepEqual(
      sequence.filter((s) => s.startsWith('home')),
      ['homeA:0.5', 'homeB:1', 'homeB:2'],
    )
  } finally {
    __clearPickPlaceOpsTestImpl()
    __clearPickPlaceInitTestHoming()
  }
})

test('initializePickPlace does not retry non-recoverable e-stop latch', async () => {
  __setPickPlaceOpsTestImpl({
    connect: async () => {},
    probeConnection: async () => ({ ok: true, target: 't' }),
    setReachable: () => {},
    status: async () => ({ fault: false, estop: false, homedA: false, homedB: false }),
    clearError: async () => ({ ok: true, cleared: true }),
    getPickPlaceConfig: () => ({ backoffMmA: 0.5, backoffMmB: 0.8, homingSpeedMmS: 80 }),
  })

  let homeBCalls = 0
  __setPickPlaceInitTestHoming({
    homeA: async () => ({ homedA: true, positionA: 0.5, command: 'HOMEA' }),
    homeB: async () => {
      homeBCalls += 1
      throw new Error('Pick & Place init failed: e-stop latched — clear and retry Initialization')
    },
    status: async () => ({ homedA: true, homedB: false }),
  })

  try {
    await assert.rejects(
      () => initializePickPlace({ homeAttempts: 3, retrySettleMs: 0 }),
      /e-stop latched/,
    )
    assert.equal(homeBCalls, 1, 'non-recoverable errors must not retry')
  } finally {
    __clearPickPlaceOpsTestImpl()
    __clearPickPlaceInitTestHoming()
  }
})
