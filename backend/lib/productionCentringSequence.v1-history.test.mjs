/**
 * VERSION 1 HISTORY — productionCentringSequence.mjs (L_eff < 55 short rule,
 * holdHPreEntireCycle). That module is no longer on the production path; the
 * Version 2 contract is locked by centringV2/productionWire.test.mjs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  runCentringCycle,
  validateCentringGapMm,
  __setProductionCentringTestDeps,
  __clearProductionCentringTestDeps,
} from './productionCentringSequence.mjs'
import { computeDerivedForTube } from './centringDerivedRecipe.mjs'

const SAMPLE_SETTINGS = {
  centering_input_start_mm: 50,
  centering_input_offset_mm: 2,
  centring_frame_config: {
    sideA_guide_spacing_mm: 300,
    sideB_guide_spacing_mm: 55,
    module_length_mm: 200,
  },
}

const SAMPLE_TUBE_INPUTS = {
  diameter_mm: 4,
  length_mm: 100,
  diameter_closing_gap_mm: 12,
  diameter_opening_gap_mm: 25,
  centring_length_tolerance_mm: 0,
  centring_mechanism: 'upper',
}

/** Tube row with persisted derived geometry (production load-only path). */
const SAMPLE_TUBE = {
  ...SAMPLE_TUBE_INPUTS,
  ...computeDerivedForTube(SAMPLE_TUBE_INPUTS, SAMPLE_SETTINGS).columns,
}

function tubeWithMechanism(mechanism) {
  const inputs = { ...SAMPLE_TUBE_INPUTS, centring_mechanism: mechanism }
  return { ...inputs, ...computeDerivedForTube(inputs, SAMPLE_SETTINGS).columns }
}

function centringStatus(overrides = {}) {
  return {
    u: -50,
    l: 35,
    h: 12,
    cal: true,
    calValid: true,
    fault: false,
    estop: false,
    busy: false,
    homing: false,
    asyncCmd: 0,
    ...overrides,
  }
}

function mockDeps() {
  const ppMoves = []
  const gapCalls = []
  let connected = false
  let centringH = 12
  let centringPreflightCalls = 0
  let ppPreflightCalls = 0
  return {
    ppMoves,
    gapCalls,
    get centringPreflightCalls() {
      return centringPreflightCalls
    },
    get ppPreflightCalls() {
      return ppPreflightCalls
    },
    deps: {
      connectWithRetry: async () => {
        connected = true
      },
      ensureCentringReadyForProduction: async (axis, { hPreMm }) => {
        centringPreflightCalls += 1
        return {
          status: centringStatus({ h: 12 }),
          atClosedIdle: false,
          atProductionPosture: false,
          atHPre: true,
          axis,
          hPreMm,
        }
      },
      ensurePickPlaceReadyForProduction: async () => {
        ppPreflightCalls += 1
        return {
          status: { positionA: 0.5, homedA: true, homedB: true },
          returnPositionMm: 0.5,
        }
      },
      centringStatus: async () => centringStatus({ h: centringH }),
      readCentringStatusAfterMove: async (phase, gapMm, knownStatus) => {
        if (knownStatus && !knownStatus.busy) {
          centringH = knownStatus.h ?? gapMm
          return knownStatus
        }
        centringH = gapMm
        return centringStatus({ h: gapMm, u: -40, l: 35 })
      },
      pickPlaceStatus: async () => ({ positionA: 0.5 }),
      moveAmmT2: async (mm, speed) => {
        ppMoves.push({ mm, speed })
        return { command: 'MOVEAMMT2', positionA: mm }
      },
      applyShrinkTubeGapPhase: async (opts) => {
        gapCalls.push(opts)
        const h = opts.phase === 'pre' ? 12 : 25
        return {
          phase: opts.phase,
          moveCommand: opts.axis === 'both' ? 'MOVEBOTHMM' : `MOVE_${String(opts.axis).toUpperCase()}MM`,
          done: { h },
          status: centringStatus({ h, u: -40, l: 35, busy: false, moveEnd: 'ok' }),
        }
      },
      restoreCentringTravelIdle: async (axis) => ({
        ok: true,
        centring_axis: axis,
        status: centringStatus({ u: 35, l: 35, h: 1.2 }),
      }),
    },
    get connected() {
      return connected
    },
  }
}

test('runCentringCycle: assert h_pre only — no mid-cycle MOVE/park, then P&P travel + h_post', async () => {
  const { deps, ppMoves, gapCalls } = mockDeps()
  const phases = []
  __setProductionCentringTestDeps(deps)
  try {
    const result = await runCentringCycle({
      shrinkTube: SAMPLE_TUBE,
      systemSettings: SAMPLE_SETTINGS,
      moveSpeedMmS: 80,
      onPhase: (name) => phases.push(name),
    })
    assert.deepEqual(phases, [
      'centring_h_pre',
      'move_centering_travel',
      'centring_h_post',
    ])
    assert.equal(ppMoves.length, 1)
    assert.equal(ppMoves[0].mm, result.resolved.centering_output_mm)
    assert.equal(gapCalls.length, 1)
    assert.equal(gapCalls[0].phase, 'post')
    assert.equal(gapCalls[0].connect, false)
    assert.equal(result.centring_axis, 'upper')
    const pre = result.phases.find((p) => p.name === 'centring_h_pre')
    assert.equal(pre?.skipped, true)
    assert.equal(pre?.reason, 'assert_only_mid_cycle')
    assert.equal(pre?.beforePpTravel, true)
    assert.ok(Math.abs(pre?.resultH - 12) < 0.05)
    assert.equal(result.phases.find((p) => p.name === 'centring_park_inactive'), undefined)
    assert.equal(result.phases.find((p) => p.name === 'move_centering_travel')?.noStopAtInput, true)
    assert.equal(
      result.phases.find((p) => p.name === 'move_centering_travel')?.positionA,
      result.resolved.centering_output_mm,
    )
    assert.equal(result.phases.find((p) => p.name === 'move_to_centering_input'), undefined)
  } finally {
    __clearProductionCentringTestDeps()
  }
})

test('runCentringCycle fails mid-cycle when jaws are not at h_pre', async () => {
  const mock = mockDeps()
  mock.deps.centringStatus = async () => centringStatus({ h: 37.1, u: -80, l: 35 })
  mock.deps.ensureCentringReadyForProduction = async (axis, opts) => ({
    status: centringStatus({ h: 37.1 }),
    atClosedIdle: false,
    atProductionPosture: true,
    atHPre: false,
    axis,
    ...opts,
  })
  __setProductionCentringTestDeps(mock.deps)
  try {
    await assert.rejects(
      () =>
        runCentringCycle({
          shrinkTube: SAMPLE_TUBE,
          systemSettings: SAMPLE_SETTINGS,
        }),
      /expected gap 12 mm before travel/,
    )
    assert.equal(mock.gapCalls.length, 0)
    assert.equal(mock.ppMoves.length, 0)
  } finally {
    __clearProductionCentringTestDeps()
  }
})

test('runCentringCycle connects and runs live preflight', async () => {
  const mock = mockDeps()
  __setProductionCentringTestDeps(mock.deps)
  try {
    const result = await runCentringCycle({
      shrinkTube: SAMPLE_TUBE,
      systemSettings: SAMPLE_SETTINGS,
    })
    assert.equal(mock.connected, true)
    assert.equal(mock.centringPreflightCalls, 1)
    assert.equal(mock.ppPreflightCalls, 1)
    assert.ok(result.centringReady)
    assert.ok(result.pickPlaceReady)
  } finally {
    __clearProductionCentringTestDeps()
  }
})

test('runCentringCycle reuses prepare posture but still reconnects TCP before motion', async () => {
  const mock = mockDeps()
  __setProductionCentringTestDeps(mock.deps)
  try {
    const preparedCentring = {
      status: centringStatus({ h: 12 }),
      atClosedIdle: false,
      atProductionPosture: false,
      atHPre: true,
    }
    const preparedPp = {
      status: { positionA: 0.5, homedA: true, homedB: true },
      returnPositionMm: 0.5,
    }
    const result = await runCentringCycle({
      shrinkTube: SAMPLE_TUBE,
      systemSettings: SAMPLE_SETTINGS,
      centringReady: preparedCentring,
      pickPlaceReady: preparedPp,
    })
    assert.equal(mock.connected, true)
    assert.equal(mock.centringPreflightCalls, 0)
    assert.equal(mock.ppPreflightCalls, 0)
    assert.ok(result.centringReady)
    assert.equal(result.pickPlaceReady, preparedPp)
  } finally {
    __clearProductionCentringTestDeps()
  }
})

test('runCentringCycle both mechanism: assert h_pre, travel, h_post only', async () => {
  const { deps, gapCalls } = mockDeps()
  __setProductionCentringTestDeps(deps)
  try {
    const phases = []
    await runCentringCycle({
      shrinkTube: tubeWithMechanism('upper_and_lower'),
      systemSettings: SAMPLE_SETTINGS,
      onPhase: (name) => phases.push(name),
    })
    assert.deepEqual(phases, [
      'centring_h_pre',
      'move_centering_travel',
      'centring_h_post',
    ])
    assert.equal(gapCalls.length, 1)
    assert.equal(gapCalls[0].phase, 'post')
  } finally {
    __clearProductionCentringTestDeps()
  }
})

test('runCentringCycle skipCentringPickPlace skips P&P but keeps h_post', async () => {
  const { deps, ppMoves, gapCalls } = mockDeps()
  __setProductionCentringTestDeps(deps)
  try {
    await runCentringCycle({
      shrinkTube: SAMPLE_TUBE,
      systemSettings: SAMPLE_SETTINGS,
      skipCentringPickPlace: true,
    })
    assert.equal(ppMoves.length, 0)
    assert.equal(gapCalls.length, 1)
    assert.equal(gapCalls[0].phase, 'post')
  } finally {
    __clearProductionCentringTestDeps()
  }
})

test('runCentringCycle L_eff < 55 skips travel and holds h_pre (no h_post)', async () => {
  const mock = mockDeps()
  __setProductionCentringTestDeps(mock.deps)
  // Frame Wb=40 so L_eff=50 still resolves; threshold for travel skip is fixed 55.
  const shortSettings = {
    ...SAMPLE_SETTINGS,
    centring_frame_config: {
      sideA_guide_spacing_mm: 300,
      sideB_guide_spacing_mm: 40,
      module_length_mm: 200,
    },
  }
  const shortInputs = {
    ...SAMPLE_TUBE_INPUTS,
    length_mm: 50,
    centring_length_tolerance_mm: 0,
  }
  const shortTube = {
    ...shortInputs,
    ...computeDerivedForTube(shortInputs, shortSettings).columns,
  }
  assert.equal(shortTube.l_eff_mm, 50)
  try {
    const phases = []
    const result = await runCentringCycle({
      shrinkTube: shortTube,
      systemSettings: shortSettings,
      gapStrategy: 'advanced',
      onPhase: (name) => phases.push(name),
    })
    assert.equal(mock.ppMoves.length, 0)
    assert.equal(mock.ppPreflightCalls, 0)
    assert.equal(mock.gapCalls.length, 0, 'short L_eff must not command gap moves in centring cycle')
    const skipped = result.phases.find((p) => p.name === 'move_centering_travel_skipped')
    assert.ok(skipped, 'must record move_centering_travel_skipped')
    assert.equal(skipped.reason, 'L_eff_below_min')
    assert.equal(skipped.L_eff_mm, 50)
    assert.equal(skipped.minMm, 55)
    assert.equal(result.phases.find((p) => p.name === 'move_centering_travel'), undefined)
    assert.equal(result.phases.find((p) => p.name === 'centring_h_post_deferred'), undefined)
    assert.equal(result.deferGapsToPickTail, false)
    assert.equal(result.holdHPreEntireCycle, true)
    assert.equal(result.phases.find((p) => p.name === 'centring_h_post'), undefined)
    const prePhases = result.phases.filter((p) => p.name === 'centring_h_pre')
    assert.equal(prePhases.length, 1)
    assert.equal(prePhases[0].reason, 'assert_only_mid_cycle')
    assert.deepEqual(phases, ['centring_h_pre', 'move_centering_travel_skipped'])
  } finally {
    __clearProductionCentringTestDeps()
  }
})

test('runCentringCycle L_eff >= 55 still runs move_centering_travel', async () => {
  const mock = mockDeps()
  __setProductionCentringTestDeps(mock.deps)
  try {
    const result = await runCentringCycle({
      shrinkTube: SAMPLE_TUBE,
      systemSettings: SAMPLE_SETTINGS,
      gapStrategy: 'advanced',
    })
    assert.ok(Number(SAMPLE_TUBE.l_eff_mm) >= 55)
    assert.equal(mock.ppMoves.length, 1)
    assert.ok(result.phases.some((p) => p.name === 'move_centering_travel'))
    assert.equal(result.phases.find((p) => p.name === 'move_centering_travel_skipped'), undefined)
  } finally {
    __clearProductionCentringTestDeps()
  }
})

test('shouldSkipCenteringTravel threshold is strictly below 55', async () => {
  const { shouldSkipCenteringTravel, CENTERING_TRAVEL_MIN_L_EFF_MM } = await import(
    './productionCentringSequence.mjs'
  )
  assert.equal(CENTERING_TRAVEL_MIN_L_EFF_MM, 55)
  assert.equal(shouldSkipCenteringTravel(50), true)
  assert.equal(shouldSkipCenteringTravel(54.9), true)
  assert.equal(shouldSkipCenteringTravel(55), false)
  assert.equal(shouldSkipCenteringTravel(100), false)
  assert.equal(shouldSkipCenteringTravel(NaN), false)
})

test('runCentringCycle advanced: assert h_pre, MOVE→output then h_post', async () => {
  const mock = mockDeps()
  __setProductionCentringTestDeps(mock.deps)
  try {
    const phases = []
    const result = await runCentringCycle({
      shrinkTube: SAMPLE_TUBE,
      systemSettings: SAMPLE_SETTINGS,
      gapStrategy: 'advanced',
      moveSpeedMmS: 80,
      onPhase: (name) => phases.push(name),
    })
    assert.equal(result.gapStrategy, 'advanced')
    assert.equal(mock.gapCalls.length, 1)
    assert.equal(mock.gapCalls[0].phase, 'post')
    assert.equal(mock.ppMoves.length, 1)
    assert.equal(mock.ppMoves[0].mm, result.resolved.centering_output_mm)
    assert.deepEqual(phases, [
      'centring_h_pre',
      'move_centering_travel',
      'centring_h_post',
    ])
    const pre = result.phases.find((p) => p.name === 'centring_h_pre')
    assert.equal(pre?.skipped, true)
    assert.equal(pre?.reason, 'assert_only_mid_cycle')
    assert.equal(result.phases.find((p) => p.name === 'move_to_centering_input'), undefined)
    assert.equal(result.phases.find((p) => p.name === 'move_centering_travel')?.noStopAtInput, true)
  } finally {
    __clearProductionCentringTestDeps()
  }
})

test('runCentringCycle restoreIdleAfter adds restore phase', async () => {
  const { deps } = mockDeps()
  let restored = false
  deps.restoreCentringTravelIdle = async (axis) => {
    restored = true
    return { ok: true, centring_axis: axis, status: centringStatus({ u: 35, l: 35 }) }
  }
  __setProductionCentringTestDeps(deps)
  try {
    const result = await runCentringCycle({
      shrinkTube: SAMPLE_TUBE,
      systemSettings: SAMPLE_SETTINGS,
      restoreIdleAfter: true,
    })
    assert.equal(restored, true)
    assert.ok(result.phases.some((p) => p.name === 'centring_restore_idle'))
  } finally {
    __clearProductionCentringTestDeps()
  }
})

test('validateCentringGapMm rejects non-positive gap', () => {
  assert.throws(() => validateCentringGapMm(0, 'pre', centringStatus(), 'upper'), /invalid gap/)
})

test('validateCentringGapMm accepts reachable upper gap at production posture', () => {
  assert.doesNotThrow(() =>
    validateCentringGapMm(12, 'pre', centringStatus({ u: -80, l: 35 }), 'upper'),
  )
})
