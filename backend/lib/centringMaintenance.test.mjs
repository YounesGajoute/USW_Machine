import test from 'node:test'
import assert from 'node:assert/strict'
import {
  runMaintenanceCentringCycle,
  __setCentringMaintenanceTestDeps,
  __clearCentringMaintenanceTestDeps,
} from './centringMaintenance.mjs'

const REF = 'REF-SHORT'
const H_PRE = 8

function resolvedFor(lEff) {
  return {
    from_db: true,
    h_pre_mm: H_PRE,
    h_post_mm: 20,
    L_eff_mm: lEff,
    centring_axis: 'upper',
    centring_mechanism: 'upper',
    centering_output_mm: 10,
    centering_input_mm: 0,
    centering_travel_mm: 10,
  }
}

function ctx(lEff) {
  return {
    ok: true,
    centringContext: {
      shrinkTube: { id: 'T1' },
      systemSettings: {},
      resolved: resolvedFor(lEff),
    },
  }
}

test('maintenance short tube establishes SEEK→HOME→MOVE then holds h_pre', async () => {
  const calls = []
  __setCentringMaintenanceTestDeps({
    validateReferenceShrinkTube: () => ctx(40),
    getAdvancedHPreReady: () => null,
    initializeCentringShortTubeEstablish: async (axis, opts) => {
      calls.push(['establish', axis, opts.L_eff_mm, opts.h_pre_mm])
      return { ok: true }
    },
    applyHPreAfterCentringHoming: async (id) => {
      calls.push(['move_h_pre', id])
      return { ok: true, h_pre_mm: H_PRE }
    },
    runCentringCycle: async (opts) => {
      calls.push(['cycle', opts.restoreIdleAfter, opts.resolved.L_eff_mm])
      return { holdHPreEntireCycle: true, phases: [], centring_axis: 'upper' }
    },
  })
  try {
    const result = await runMaintenanceCentringCycle({
      referenceId: REF,
      restoreIdle: true,
    })
    assert.equal(result.shortTubeEstablish.mode, 'seek_home_move')
    assert.deepEqual(calls, [
      ['establish', 'upper', 40, H_PRE],
      ['move_h_pre', REF],
      ['cycle', false, 40],
    ])
  } finally {
    __clearCentringMaintenanceTestDeps()
  }
})

test('maintenance short tube already at latched h_pre asserts only', async () => {
  const calls = []
  __setCentringMaintenanceTestDeps({
    validateReferenceShrinkTube: () => ctx(50),
    getAdvancedHPreReady: () => ({ referenceId: REF, hPreMm: H_PRE }),
    connectWithRetry: async () => { calls.push('connect') },
    centringStatus: async () => ({ h: H_PRE, cal: true, estop: false, busy: false }),
    isCentringAtGapMm: (st, gap) => st.h === gap,
    initializeCentringShortTubeEstablish: async () => {
      calls.push('establish')
      return { ok: true }
    },
    runCentringCycle: async (opts) => {
      calls.push(['cycle', opts.restoreIdleAfter])
      return { holdHPreEntireCycle: true, phases: [] }
    },
  })
  try {
    const result = await runMaintenanceCentringCycle({ referenceId: REF })
    assert.equal(result.shortTubeEstablish.mode, 'assert_only')
    assert.deepEqual(calls, ['connect', ['cycle', false]])
  } finally {
    __clearCentringMaintenanceTestDeps()
  }
})

test('maintenance long tube does not establish and still restores idle', async () => {
  const calls = []
  __setCentringMaintenanceTestDeps({
    validateReferenceShrinkTube: () => ctx(100),
    initializeCentringShortTubeEstablish: async () => {
      calls.push('establish')
      return { ok: true }
    },
    runCentringCycle: async (opts) => {
      calls.push(['cycle', opts.restoreIdleAfter, opts.resolved.L_eff_mm])
      return { holdHPreEntireCycle: false, phases: [] }
    },
  })
  try {
    const result = await runMaintenanceCentringCycle({
      referenceId: REF,
      restoreIdle: true,
    })
    assert.equal(result.shortTubeEstablish, null)
    assert.deepEqual(calls, [['cycle', true, 100]])
  } finally {
    __clearCentringMaintenanceTestDeps()
  }
})

test('maintenance short establish failure does not run the cycle', async () => {
  let cycled = false
  __setCentringMaintenanceTestDeps({
    validateReferenceShrinkTube: () => ctx(40),
    getAdvancedHPreReady: () => null,
    initializeCentringShortTubeEstablish: async () => ({ ok: false, error: 'HOME failed' }),
    runCentringCycle: async () => { cycled = true },
  })
  try {
    await assert.rejects(
      () => runMaintenanceCentringCycle({ referenceId: REF }),
      /HOME failed/,
    )
    assert.equal(cycled, false)
  } finally {
    __clearCentringMaintenanceTestDeps()
  }
})
