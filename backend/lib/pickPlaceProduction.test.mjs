import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validatePickPlaceCentringTargetMm,
  ensurePickPlaceReadyForProduction,
  returnPickPlaceToHomePosition,
  pickPlaceBackoffTargetMm,
  __setPickPlaceProductionTestDeps,
  __clearPickPlaceProductionTestDeps,
} from './pickPlaceProduction.mjs'

const DEFAULT_CFG = {
  backoffMmA: 0.5,
  backoffMmB: 0.8,
  maxPositionMm: 470,
  movementSpeedMmS: 80,
  referenceAxis: 'a',
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

test('ensurePickPlaceReadyForProduction auto-returns to backoff when off rest', async () => {
  let remediateN = 0
  let moved = 0
  __setPickPlaceProductionTestDeps({
    preparePickPlaceTcp: async () => {},
    remediatePickPlace: async () => {
      remediateN += 1
      return {
        status: {
          fault: false,
          estop: false,
          homedA: true,
          homedB: true,
          positionA: remediateN <= 2 ? 1.5 : 0.5,
          positionB: 0.8,
        },
        cleared: false,
      }
    },
    moveAmmT2: async () => {
      moved += 1
      return { command: 'MOVEAMMT2', positionA: 0.5, positionB: 0.8 }
    },
    moveCommandAT2: () => 'MOVEAMMT2 0.5 80',
    INIT_BACKOFF_TOLERANCE_MM: 0.2,
    getPickPlaceConfig: () => ({ ...DEFAULT_CFG }),
  })
  try {
    const r = await ensurePickPlaceReadyForProduction()
    assert.equal(moved, 1)
    assert.equal(r.returnPositionMm, 0.5)
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('ensurePickPlaceReadyForProduction falls back to initializePickPlace when return hits HOME limit', async () => {
  let remediateN = 0
  let inited = 0
  __setPickPlaceProductionTestDeps({
    preparePickPlaceTcp: async () => {},
    remediatePickPlace: async () => {
      remediateN += 1
      return {
        status: {
          fault: false,
          estop: false,
          homedA: true,
          homedB: true,
          positionA: remediateN === 1 ? 1.5 : 0.5,
          positionB: 0.8,
        },
        cleared: false,
      }
    },
    moveAmmT2: async () => {
      throw new Error('ERR MOVEAMMT2 0xF3 (0xF3: axis A HOME limit hit during negative move (0xF3))')
    },
    moveCommandAT2: () => 'MOVEAMMT2 0.5 80',
    initializePickPlace: async () => {
      inited += 1
    },
    INIT_BACKOFF_TOLERANCE_MM: 0.2,
    getPickPlaceConfig: () => ({ ...DEFAULT_CFG }),
  })
  try {
    const r = await ensurePickPlaceReadyForProduction()
    assert.equal(inited, 1)
    assert.equal(r.returnPositionMm, 0.5)
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('pickPlaceBackoffTargetMm uses Backoff A when reference axis is A', () => {
  assert.deepEqual(
    pickPlaceBackoffTargetMm({ ...DEFAULT_CFG, referenceAxis: 'a' }),
    { referenceAxis: 'a', targetMm: 0.5 },
  )
})

test('pickPlaceBackoffTargetMm uses Backoff B when reference axis is B', () => {
  assert.deepEqual(
    pickPlaceBackoffTargetMm({ ...DEFAULT_CFG, referenceAxis: 'b' }),
    { referenceAxis: 'b', targetMm: 0.8 },
  )
})

function mockMoveReturnDeps(overrides = {}) {
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
      getPickPlaceConfig: () => ({ ...DEFAULT_CFG }),
      moveCommandAT2: (pos, speed) => `MOVEAMMT2 ${pos} ${speed}`,
      moveAmmT2: async (pos, speed, ref) => {
        order.push(`moveAmmT2:${pos}:${speed}:${ref}`)
        return {
          command: `MOVEAMMT2 ${pos} ${speed}`,
          positionA: pos,
          positionB: pos,
          position: pos,
          referenceAxis: ref,
        }
      },
      homeA: async () => {
        throw new Error('HOMEA must not run — return uses MOVEAMMT2')
      },
      homeB: async () => {
        throw new Error('HOMEB must not run — return uses MOVEAMMT2')
      },
      initializePickPlace: async () => {
        throw new Error('initializePickPlace must not run — pick return uses MOVEAMMT2')
      },
      ...overrides,
    },
    order,
  }
}

test('returnPickPlaceToHomePosition uses MOVEAMMT2 to Backoff A when reference axis is A', async () => {
  const phases = []
  const { deps, order } = mockMoveReturnDeps()
  __setPickPlaceProductionTestDeps(deps)
  try {
    const r = await returnPickPlaceToHomePosition(undefined, {
      onPhase: (name, cmd) => phases.push(`${name}:${cmd}`),
    })
    assert.deepEqual(order, ['moveAmmT2:0.5:80:a'])
    assert.equal(r.alreadyHomed, true)
    assert.equal(r.command, 'MOVEAMMT2 0.5 80')
    assert.equal(r.referenceAxis, 'a')
    assert.equal(r.targetMm, 0.5)
    assert.equal(r.positionA, 0.5)
    assert.deepEqual(phases, ['return_to_backoff_move:MOVEAMMT2 0.5 80'])
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('returnPickPlaceToHomePosition uses MOVEAMMT2 to Backoff B when reference axis is B', async () => {
  const phases = []
  const moveCalls = []
  const { deps } = mockMoveReturnDeps({
    getPickPlaceConfig: () => ({ ...DEFAULT_CFG, referenceAxis: 'b' }),
    moveAmmT2: async (pos, speed, ref) => {
      moveCalls.push(`moveAmmT2:${pos}:${speed}:${ref}`)
      return {
        command: `MOVEAMMT2 ${pos} ${speed}`,
        positionA: 0.5,
        positionB: pos,
        position: pos,
        referenceAxis: ref,
      }
    },
  })
  __setPickPlaceProductionTestDeps(deps)
  try {
    const r = await returnPickPlaceToHomePosition(undefined, {
      onPhase: (name, cmd) => phases.push(`${name}:${cmd}`),
    })
    assert.deepEqual(moveCalls, ['moveAmmT2:0.8:80:b'])
    assert.equal(r.command, 'MOVEAMMT2 0.8 80')
    assert.equal(r.referenceAxis, 'b')
    assert.equal(r.targetMm, 0.8)
    assert.equal(r.positionB, 0.8)
    assert.deepEqual(phases, ['return_to_backoff_move:MOVEAMMT2 0.8 80'])
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('returnPickPlaceToHomePosition uses MOVEAMMT2 even when already at backoff', async () => {
  const { deps, order } = mockMoveReturnDeps({
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
    const r = await returnPickPlaceToHomePosition(undefined, {})
    assert.deepEqual(order, ['moveAmmT2:0.5:80:a'])
    assert.equal(r.command, 'MOVEAMMT2 0.5 80')
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('returnPickPlaceToHomePosition rejects when axis A is unhomed', async () => {
  const { deps, order } = mockMoveReturnDeps({
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
    await assert.rejects(
      returnPickPlaceToHomePosition(undefined, {}),
      /axis A not homed/,
    )
    assert.deepEqual(order, [])
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('returnPickPlaceToHomePosition accepts production move-speed override', async () => {
  const { deps, order } = mockMoveReturnDeps()
  __setPickPlaceProductionTestDeps(deps)
  try {
    const r = await returnPickPlaceToHomePosition(120, {})
    assert.deepEqual(order, ['moveAmmT2:0.5:120:a'])
    assert.equal(r.command, 'MOVEAMMT2 0.5 120')
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})

test('returnPickPlaceToHomePosition falls back to initializePickPlace on 0xF3 HOME limit', async () => {
  let inited = 0
  const phases = []
  __setPickPlaceProductionTestDeps({
    preparePickPlaceTcp: async () => {},
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
    moveAmmT2: async () => {
      throw new Error('ERR MOVEAMMT2 0xF3 (0xF3: axis A HOME limit hit during negative move (0xF3))')
    },
    moveCommandAT2: () => 'MOVEAMMT2 0.5 80',
    initializePickPlace: async () => {
      inited += 1
    },
    disconnect: () => {},
    setPickPlaceProductionTcpHold: () => {},
    INIT_BACKOFF_TOLERANCE_MM: 0.2,
    getPickPlaceConfig: () => ({ ...DEFAULT_CFG }),
  })
  try {
    const r = await returnPickPlaceToHomePosition(undefined, {
      onPhase: (name, cmd) => phases.push(`${name}:${cmd}`),
    })
    assert.equal(inited, 1)
    assert.equal(r.via, 'initialize')
    assert.equal(r.command, 'initializePickPlace')
    assert.equal(r.positionA, 0.5)
    assert.ok(phases.some((p) => p.startsWith('return_to_backoff_move:')))
    assert.ok(phases.some((p) => p.startsWith('return_to_backoff_home_fallback:')))
  } finally {
    __clearPickPlaceProductionTestDeps()
  }
})
