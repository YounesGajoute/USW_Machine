import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertManualPickPlaceAllowed,
  resolveManualTargets,
  runCenteringTravel,
  runMoveToPick,
  runReturnToBackoff,
  runHome,
  setPpClamp,
  __setPickPlaceManualMotionTestDeps,
  __clearPickPlaceManualMotionTestDeps,
} from './pickPlaceManualMotion.mjs'
import { LIFECYCLE_STATE } from './machineLifecycle.mjs'

const BASE_CFG = {
  movementSpeedMmS: 80,
  homingSpeedMmS: 60,
  backoffMmA: 0.5,
  backoffMmB: 0.8,
  maxPositionMm: 470,
  referenceAxis: 'a',
}

const BASE_SEQ = {
  movePositionMm: 320,
  movePositionEvoMm: 400,
}

function baseDeps(overrides = {}) {
  return {
    getLifecycleSnapshot: () => ({
      lifecycleState: LIFECYCLE_STATE.RUN,
      isProductionActive: false,
      isSafetyLockout: false,
      isError: false,
    }),
    isProductionStopRequested: () => false,
    getMachineInitStatus: () => ({ referenceId: 'REF1' }),
    validateReferenceShrinkTube: () => ({
      ok: true,
      centringContext: {
        resolved: { centering_output_mm: 180 },
      },
    }),
    getSystemSettingsForProduction: () => ({ machine_model: 'STCS-CS19' }),
    getProductionSequenceConfig: () => ({ ...BASE_SEQ }),
    getPickPlaceConfig: () => ({ ...BASE_CFG }),
    validatePickPlaceCentringTargetMm: (mm) => Number(mm),
    pickPlaceBackoffTargetMm: (cfg) => ({
      referenceAxis: cfg.referenceAxis === 'b' ? 'b' : 'a',
      targetMm: cfg.referenceAxis === 'b' ? cfg.backoffMmB : cfg.backoffMmA,
    }),
    moveAmmT2: async (pos, speed) => ({
      command: `MOVEAMMT2 ${pos} ${speed}`,
      positionA: pos,
      positionB: pos,
    }),
    returnPickPlaceToHomePosition: async (speed) => ({
      command: `MOVEAMMT2 0.5 ${speed}`,
      targetMm: 0.5,
      referenceAxis: 'a',
      positionA: 0.5,
      positionB: 0.8,
      via: 'return',
    }),
    initializePickPlace: async () => ({ ok: true, via: 'initialize' }),
    setPneumaticOutputs: async () => {},
    ...overrides,
  }
}

test.afterEach(() => {
  __clearPickPlaceManualMotionTestDeps()
})

test('assertManualPickPlaceAllowed blocks CYCLE_START', () => {
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      getLifecycleSnapshot: () => ({
        lifecycleState: LIFECYCLE_STATE.CYCLE_START,
        isProductionActive: true,
        isSafetyLockout: false,
        isError: false,
      }),
    }),
  )
  assert.throws(() => assertManualPickPlaceAllowed(), /production cycle is running/)
})

test('assertManualPickPlaceAllowed blocks SAFETY_LOCKOUT', () => {
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      getLifecycleSnapshot: () => ({
        lifecycleState: LIFECYCLE_STATE.SAFETY_LOCKOUT,
        isProductionActive: false,
        isSafetyLockout: true,
        isError: false,
      }),
    }),
  )
  assert.throws(() => assertManualPickPlaceAllowed(), /safety lockout/)
})

test('assertManualPickPlaceAllowed blocks ERROR', () => {
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      getLifecycleSnapshot: () => ({
        lifecycleState: LIFECYCLE_STATE.ERROR,
        isProductionActive: false,
        isSafetyLockout: false,
        isError: true,
      }),
    }),
  )
  assert.throws(() => assertManualPickPlaceAllowed(), /ERROR/)
})

test('assertManualPickPlaceAllowed allows RUN', () => {
  __setPickPlaceManualMotionTestDeps(baseDeps())
  assert.doesNotThrow(() => assertManualPickPlaceAllowed())
})

test('resolveManualTargets: CS19 uses movePositionMm', () => {
  __setPickPlaceManualMotionTestDeps(baseDeps())
  const t = resolveManualTargets()
  assert.equal(t.pickPositionMm, 320)
  assert.equal(t.centeringOutputMm, 180)
  assert.equal(t.backoffMm, 0.5)
  assert.equal(t.referenceAxis, 'a')
  assert.equal(t.machineModel, 'STCS-CS19')
  assert.equal(t.centeringError, null)
})

test('resolveManualTargets: evo500 uses movePositionEvoMm', () => {
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      getSystemSettingsForProduction: () => ({ machine_model: 'STCS-evo500' }),
    }),
  )
  const t = resolveManualTargets()
  assert.equal(t.pickPositionMm, 400)
  assert.equal(t.machineModel, 'STCS-evo500')
})

test('resolveManualTargets: no reference → centeringError', () => {
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      getMachineInitStatus: () => ({ referenceId: null }),
    }),
  )
  const t = resolveManualTargets()
  assert.equal(t.centeringOutputMm, null)
  assert.match(t.centeringError, /No reference loaded/)
})

test('runCenteringTravel calls MOVEAMMT2 to centering_output_mm', async () => {
  const moves = []
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      moveAmmT2: async (pos, speed) => {
        moves.push({ pos, speed })
        return { command: `MOVEAMMT2 ${pos} ${speed}`, positionA: pos }
      },
    }),
  )
  const r = await runCenteringTravel({ speedMmS: 90 })
  assert.equal(r.ok, true)
  assert.equal(r.action, 'centering_travel')
  assert.equal(r.targetMm, 180)
  assert.deepEqual(moves, [{ pos: 180, speed: 90 }])
})

test('runCenteringTravel fails without reference', async () => {
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      getMachineInitStatus: () => ({ referenceId: null }),
    }),
  )
  await assert.rejects(() => runCenteringTravel(), /No reference loaded/)
})

test('runMoveToPick uses CS19 pick mm', async () => {
  const moves = []
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      moveAmmT2: async (pos, speed) => {
        moves.push({ pos, speed })
        return { command: `MOVEAMMT2 ${pos} ${speed}`, positionA: pos }
      },
    }),
  )
  const r = await runMoveToPick()
  assert.equal(r.targetMm, 320)
  assert.deepEqual(moves, [{ pos: 320, speed: 80 }])
})

test('runMoveToPick uses evo500 pick mm', async () => {
  const moves = []
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      getSystemSettingsForProduction: () => ({ machine_model: 'STCS-evo500' }),
      getPickPlaceConfig: () => ({ ...BASE_CFG, maxPositionMm: 500 }),
      moveAmmT2: async (pos, speed) => {
        moves.push({ pos, speed })
        return { command: `MOVEAMMT2 ${pos} ${speed}`, positionA: pos }
      },
    }),
  )
  const r = await runMoveToPick()
  assert.equal(r.targetMm, 400)
  assert.deepEqual(moves, [{ pos: 400, speed: 80 }])
})

test('runReturnToBackoff delegates to returnPickPlaceToHomePosition', async () => {
  let calledWith
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      returnPickPlaceToHomePosition: async (speed) => {
        calledWith = speed
        return {
          command: 'MOVEAMMT2 0.5 80',
          targetMm: 0.5,
          referenceAxis: 'a',
          positionA: 0.5,
          via: 'return',
        }
      },
    }),
  )
  const r = await runReturnToBackoff({ speedMmS: 70 })
  assert.equal(calledWith, 70)
  assert.equal(r.action, 'return_to_backoff')
  assert.equal(r.targetMm, 0.5)
})

test('runHome calls initializePickPlace', async () => {
  let called = false
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      initializePickPlace: async (opts) => {
        called = true
        assert.equal(opts.homingSpeed, 60)
        return { ok: true }
      },
    }),
  )
  const r = await runHome()
  assert.equal(called, true)
  assert.equal(r.action, 'home')
})

test('setPpClamp writes only ppClamp', async () => {
  const writes = []
  const ecm = { isInitialized: true }
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      setPneumaticOutputs: async (_ecm, state) => {
        writes.push(state)
      },
    }),
  )
  const r = await setPpClamp(ecm, true)
  assert.equal(r.closed, true)
  assert.deepEqual(writes, [{ ppClamp: true }])
})

test('setPpClamp blocked during production', async () => {
  __setPickPlaceManualMotionTestDeps(
    baseDeps({
      getLifecycleSnapshot: () => ({
        lifecycleState: LIFECYCLE_STATE.CYCLE_START,
        isProductionActive: true,
        isSafetyLockout: false,
        isError: false,
      }),
    }),
  )
  await assert.rejects(
    () => setPpClamp({ isInitialized: true }, false),
    /production cycle is running/,
  )
})
