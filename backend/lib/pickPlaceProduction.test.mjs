import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validatePickPlaceCentringTargetMm,
  ensurePickPlaceReadyForProduction,
  returnPickPlaceToHomePosition,
  __setPickPlaceProductionTestDeps,
  __clearPickPlaceProductionTestDeps,
} from './pickPlaceProduction.mjs'

const DEFAULT_CFG = {
  backoffMmA: 0.5,
  backoffMmB: 0.8,
  maxPositionMm: 470,
  movementSpeedMmS: 80,
}

test('validatePickPlaceCentringTargetMm rejects unconfigured centering input at zero', () => {
  __setPickPlaceProductionTestDeps({
    getPickPlaceConfig: () => ({ ...DEFAULT_CFG }),
  })
  try {
    assert.throws(
      () => validatePickPlaceCentringTargetMm(0, 'centering input'),
      /centering_input_start_mm not configured/,
    )
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('validatePickPlaceCentringTargetMm accepts input above backoff', () => {
  __setPickPlaceProductionTestDeps({
    getPickPlaceConfig: () => ({ ...DEFAULT_CFG }),
  })
  try {
    assert.equal(validatePickPlaceCentringTargetMm(120, 'centering input'), 120)
    assert.equal(validatePickPlaceCentringTargetMm(200, 'centering output'), 200)
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('validatePickPlaceCentringTargetMm rejects target above max travel', () => {
  __setPickPlaceProductionTestDeps({
    getPickPlaceConfig: () => ({ ...DEFAULT_CFG }),
  })
  try {
    assert.throws(
      () => validatePickPlaceCentringTargetMm(500, 'centering output'),
      /outside travel window/,
    )
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('ensurePickPlaceReadyForProduction uses remediate when fault latched', async () => {
  let prepareCalls = 0
  let remediateCalls = 0
  __setPickPlaceProductionTestDeps({
    preparePickPlaceTcp: async () => {
      prepareCalls += 1
    },
    remediatePickPlace: async () => {
      remediateCalls += 1
      return {
        status: { fault: false, estop: false, homedA: true, homedB: true, positionA: 0.6 },
        cleared: true,
      }
    },
    INIT_BACKOFF_TOLERANCE_MM: 0.2,
    getPickPlaceConfig: () => ({ ...DEFAULT_CFG }),
  })
  try {
    const r = await ensurePickPlaceReadyForProduction()
    assert.equal(prepareCalls, 1)
    assert.equal(remediateCalls, 1)
    assert.equal(r.returnPositionMm, 0.6)
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('ensurePickPlaceReadyForProduction rejects unhomed axis B', async () => {
  __setPickPlaceProductionTestDeps({
    preparePickPlaceTcp: async () => {},
    remediatePickPlace: async () => ({
      status: {
        fault: false,
        estop: false,
        homedA: true,
        homedB: false,
        positionA: 0.6,
      },
      cleared: false,
    }),
    INIT_BACKOFF_TOLERANCE_MM: 0.2,
    getPickPlaceConfig: () => ({ ...DEFAULT_CFG }),
  })
  try {
    await assert.rejects(
      ensurePickPlaceReadyForProduction(),
      /axis B not homed/,
    )
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('ensurePickPlaceReadyForProduction returns actual positionA as return mm', async () => {
  __setPickPlaceProductionTestDeps({
    preparePickPlaceTcp: async () => {},
    remediatePickPlace: async () => ({
      status: {
        fault: false,
        estop: false,
        homedA: true,
        homedB: true,
        positionA: 0.6,
      },
      cleared: false,
    }),
    INIT_BACKOFF_TOLERANCE_MM: 0.2,
    getPickPlaceConfig: () => ({ ...DEFAULT_CFG }),
  })
  try {
    const r = await ensurePickPlaceReadyForProduction()
    assert.equal(r.returnPositionMm, 0.6)
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

function mockHomeReturnDeps(overrides = {}) {
  const order = []
  return {
    deps: {
      preparePickPlaceTcp: async () => {},
      remediatePickPlace: async () => ({
        status: {
          fault: false,
          estop: false,
          homedA: true,
          homedB: true,
          positionA: 159.6,
          positionB: 159.6,
        },
        cleared: false,
      }),
      INIT_BACKOFF_TOLERANCE_MM: 0.2,
      getPickPlaceConfig: () => ({ ...DEFAULT_CFG, homingSpeedMmS: 80 }),
      homeCommand: (tag, axis, backoff, speed) => `${tag} ${backoff} ${speed}`,
      homeA: async (backoff, speed) => {
        order.push(`homeA:${backoff}:${speed}`)
        return { homedA: true, positionA: 0.5, command: `HOMEA ${backoff} ${speed}` }
      },
      homeB: async (backoff, speed) => {
        order.push(`homeB:${backoff}:${speed}`)
        return { homedB: true, positionB: 0.8, command: `HOMEB ${backoff} ${speed}` }
      },
      moveAmmT2: async () => {
        throw new Error('MOVEAMMT2 must not run — return uses HOMEA then HOMEB')
      },
      initializePickPlace: async () => {
        throw new Error('initializePickPlace must not run — pick return calls HOMEA/HOMEB directly')
      },
      ...overrides,
    },
    order,
  }
}

test('returnPickPlaceToHomePosition always homes A then B even when already at backoff', async () => {
  const phases = []
  const { deps, order } = mockHomeReturnDeps({
    remediatePickPlace: async () => ({
      status: {
        fault: false,
        estop: false,
        homedA: true,
        homedB: true,
        positionA: 0.5,
        positionB: 0.8,
      },
      cleared: false,
    }),
  })
  __setPickPlaceProductionTestDeps(deps)
  try {
    const r = await returnPickPlaceToHomePosition(undefined, {
      onPhase: (name, cmd) => phases.push(`${name}:${cmd}`),
    })
    assert.deepEqual(order, ['homeA:0.5:80', 'homeB:0.8:80'])
    assert.equal(r.alreadyHomed, false)
    assert.equal(r.command, 'HOMEA 0.5 80 ; HOMEB 0.8 80')
    assert.deepEqual(phases, [
      'return_to_backoff_home_a:HOMEA 0.5 80',
      'return_to_backoff_home_b:HOMEB 0.8 80',
    ])
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('returnPickPlaceToHomePosition homes A then B when off rest (even if already homed)', async () => {
  const phases = []
  const { deps, order } = mockHomeReturnDeps()
  __setPickPlaceProductionTestDeps(deps)
  try {
    const r = await returnPickPlaceToHomePosition(undefined, {
      onPhase: (name, cmd) => phases.push(`${name}:${cmd}`),
    })
    assert.deepEqual(order, ['homeA:0.5:80', 'homeB:0.8:80'])
    assert.equal(r.alreadyHomed, false)
    assert.equal(r.command, 'HOMEA 0.5 80 ; HOMEB 0.8 80')
    assert.equal(r.positionA, 0.5)
    assert.deepEqual(phases, [
      'return_to_backoff_home_a:HOMEA 0.5 80',
      'return_to_backoff_home_b:HOMEB 0.8 80',
    ])
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('returnPickPlaceToHomePosition homes A then B when unhomed', async () => {
  const phases = []
  const { deps, order } = mockHomeReturnDeps({
    remediatePickPlace: async () => ({
      status: {
        fault: false,
        estop: false,
        homedA: false,
        homedB: false,
        positionA: 10,
        positionB: 10,
      },
      cleared: false,
    }),
  })
  __setPickPlaceProductionTestDeps(deps)
  try {
    const r = await returnPickPlaceToHomePosition(undefined, {
      onPhase: (name) => phases.push(name),
    })
    assert.deepEqual(order, ['homeA:0.5:80', 'homeB:0.8:80'])
    assert.equal(r.command, 'HOMEA 0.5 80 ; HOMEB 0.8 80')
    assert.deepEqual(phases, ['return_to_backoff_home_a', 'return_to_backoff_home_b'])
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})
