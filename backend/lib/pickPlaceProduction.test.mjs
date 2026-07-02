import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validatePickPlaceCentringTargetMm,
  ensurePickPlaceReadyForProduction,
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
