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
      return { fault: false, estop: false, homedA: true, homedB: true, positionA: 0.6, positionB: 0.9 }
    },
    recover: async () => {
      sequence.push('clrfault')
      return { ok: true }
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
      'probe',
      'status:1',
      'clrfault',
      'status:2',
      'homeA:0.5',
      'homeB:0.8',
      'status:final',
    ])
    assert.equal(r.ok, true)
    assert.equal(r.restPositionMmA, 0.6)
    assert.equal(r.homedA, true)
    assert.equal(r.homedB, true)
  } finally {
    __clearPickPlaceOpsTestImpl()
    __clearPickPlaceInitTestHoming()
  }
})
