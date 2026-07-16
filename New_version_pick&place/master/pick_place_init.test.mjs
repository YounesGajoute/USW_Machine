import test from 'node:test'
import assert from 'node:assert/strict'
import {
  __setPickPlaceOpsTestImpl,
  __clearPickPlaceOpsTestImpl,
} from './lib/pick_place_ops.mjs'
import {
  initializePickPlace,
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
