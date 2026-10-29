import { test } from 'node:test'
import assert from 'node:assert/strict'
import { releaseVisionRejectedProduct } from './visionRejectRelease.mjs'
import { runVisionProcessOperation } from './visionProcessFault.mjs'
import { VisionProductReject } from './visionProductReject.mjs'
import { requirePassingRealtimeInspection } from './productionSequence.mjs'
import { forceState, beginInit, completeInit, beginProductionJob, getLifecycleSnapshot,
  enterSafetyLockout, requestProductionStop, finishProductionJob } from './machineLifecycle.mjs'

function ready(t) {
  forceState('ERROR')
  beginInit()
  completeInit()
  beginProductionJob('reject-test', 'hmi')
  t.after(() => { finishProductionJob({ cancelled: true }); forceState('ERROR') })
}

function fixture(overrides = {}) {
  const writes = [], waits = [], phases = []
  let rearmed = false
  const opts = {
    timing: { delayAfterPickClampOpenMs: 11, delayAfterLeverDownMs: 22, delayAfterClampOpenMs: 33 },
    phases, assertCanRelease: () => {}, publishPhase: async () => {},
    write: async (_ecm, outputs) => { writes.push(outputs) },
    wait: async ms => { waits.push(ms) }, rearmClamps: () => { rearmed = true },
    ...overrides,
  }
  return { opts, writes, waits, phases, isRearmed: () => rearmed }
}

test('release writes P&P open, lever down, clamps open, with configured settling delays', async () => {
  const f = fixture()
  await releaseVisionRejectedProduct({}, f.opts)
  assert.deepEqual(f.writes, [{ ppClamp: false }, { leverUp: false }, { clampRight: false, clampLeft: false }])
  assert.deepEqual(f.waits, [11, 22, 33])
  assert.equal(f.isRearmed(), true)
})

for (const failAt of [0, 1, 2]) {
  test(`release failure at step ${failAt + 1} prevents all later valve writes`, async t => {
    ready(t)
    let calls = 0
    const f = fixture({ write: async () => { if (calls++ === failAt) throw new Error('valve write failed') } })
    const state = {}
    await assert.rejects(runVisionProcessOperation(() => { throw new VisionProductReject('NG') }, state,
      () => releaseVisionRejectedProduct({}, f.opts)), /valve write failed/)
    assert.equal(calls, failAt + 1)
    assert.equal(f.isRearmed(), false)
    assert.equal(state.productRejectReleased, undefined)
    assert.equal(getLifecycleSnapshot().errorDrivePowerPolicy, 'inhibit')
  })
}

test('safety/Stop check after phase publication prevents the next valve write', async () => {
  let stopped = false
  const f = fixture({
    publishPhase: async phase => { if (phase === 'vision_reject_lever_down') stopped = true },
    assertCanRelease: () => { if (stopped) throw new Error('Stop requested') },
  })
  await assert.rejects(releaseVisionRejectedProduct({}, f.opts), /Stop requested/)
  assert.deepEqual(f.writes, [{ ppClamp: false }])
  assert.equal(f.isRearmed(), false)
})

for (const outcome of ['NG', 'FAIL']) {
  test(`realtime ${outcome} uses reject release and never enters machine ERROR`, async t => {
    ready(t)
    const f = fixture(), state = {}
    await assert.rejects(runVisionProcessOperation(
      () => requirePassingRealtimeInspection({ result: { outcome } }, f.phases, state), state,
      () => releaseVisionRejectedProduct({}, f.opts)), VisionProductReject)
    assert.equal(state.productRejectReleased, true)
    assert.equal(state.inspectionOutcome, 'FAIL')
    assert.equal(getLifecycleSnapshot().isError, false)
    assert.equal(getLifecycleSnapshot().machineInitialized, true)
  })
}

test('unknown result and transport failures do not run the product-release sequence', async t => {
  for (const run of [
    () => requirePassingRealtimeInspection({ result: { outcome: 'UNKNOWN' } }, [], {}),
    () => { throw new Error('Vision connection lost') },
  ]) {
    ready(t)
    let releases = 0
    await assert.rejects(runVisionProcessOperation(run, {}, () => { releases++ }))
    assert.equal(releases, 0)
    assert.equal(getLifecycleSnapshot().errorDrivePowerPolicy, 'retain')
  }
})

for (const stop of ['safety', 'operator']) {
  test(`${stop} stop during release is not overwritten by an ERROR`, async t => {
    ready(t)
    await assert.rejects(runVisionProcessOperation(() => { throw new VisionProductReject('NG') }, {}, async () => {
      if (stop === 'safety') enterSafetyLockout('Emergency stop')
      else requestProductionStop()
      throw new Error('Stop requested')
    }), /Stop requested/)
    assert.equal(getLifecycleSnapshot().isError, false)
    if (stop === 'safety') assert.equal(getLifecycleSnapshot().isSafetyLockout, true)
  })
}
