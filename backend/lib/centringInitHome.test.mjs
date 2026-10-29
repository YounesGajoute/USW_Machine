import test from 'node:test'
import assert from 'node:assert/strict'
import { homeUnconfirmedCentringAxes, centringNeedsHome, isRecoverableCentringInitError } from './centringHoming.mjs'
import { initializeCentringUnconfirmedHome, initializeCentringReferenceHome, isCentringSetupPoseReady } from './centringIdle.mjs'
import { runSubsystemHomingSequence } from './machineSetupSequence.mjs'

const middle = { cal: true, busy: false, estop: false, accepted: true, u: 0, l: 0,
  uh: false, ut: false, lh: false, lt: false, moveEnd: 'ok' }
const home = { ...middle, u: -80, l: -80, uh: true, lh: true }

test('Initialization routes short and long references through HOME then target, and propagates failures', async () => {
  const keys = ['PICK_PLACE_SKIP_INIT', 'CENTRING_SKIP_INIT', 'PRODUCTION_SKIP_CENTRING']
  const previous = keys.map(key => process.env[key])
  process.env.PICK_PLACE_SKIP_INIT = '1'
  delete process.env.CENTRING_SKIP_INIT
  delete process.env.PRODUCTION_SKIP_CENTRING
  try {
    for (const length of [50, 100]) {
      for (const axis of ['both', 'upper', 'lower']) {
        const calls = []
        let st = { ...middle, u: 33.35, l: 35, lh: true }
        const inactive = axis === 'upper' ? 'lower' : axis === 'lower' ? 'upper' : null
        const deps = {
          resolveCentringAxisForReference: () => axis,
          resolveAdvancedGapRecipe: () => ({ resolved: { L_eff_mm: length, h_pre_mm: 3 } }),
          initializeCentringReferenceHome: selected => initializeCentringReferenceHome(selected, {
            setHold: () => {}, connect: async () => {}, ensureReady: async () => {}, cacheStatus: () => {},
            status: async () => st, waitIdle: async () => st,
            homeByAxis: async selectedHome => { calls.push(`HOME:${selectedHome}`); st = home; return { status: st } },
            seekTravelByAxis: async selectedPark => {
              calls.push(`PARK:${selectedPark}`)
              st = selectedPark === 'lower'
                ? { ...home, l: 35, lh: false, lt: true }
                : { ...home, u: 35, uh: false, ut: true }
              return { status: st }
            },
          }),
          applyHPreAfterCentringHoming: async () => { calls.push('TARGET:3'); return { ok: true, h_pre_mm: 3 } },
        }
        const result = await runSubsystemHomingSequence({ referenceId: 'TEST-ONLY' }, deps)
        assert.equal(result.advancedHPre.ok, true)
        assert.deepEqual(calls, ['HOME:both', ...(inactive ? [`PARK:${inactive}`] : []), 'TARGET:3'])
        deps.applyHPreAfterCentringHoming = async () => ({ ok: false, error: 'target unconfirmed' })
        await assert.rejects(runSubsystemHomingSequence({ referenceId: 'TEST-ONLY' }, deps), /target unconfirmed/)
        deps.initializeCentringReferenceHome = async () => { throw new Error('HOME unconfirmed') }
        deps.applyHPreAfterCentringHoming = async () => assert.fail('Target must not follow failed HOME')
        await assert.rejects(runSubsystemHomingSequence({ referenceId: 'TEST-ONLY' }, deps), /HOME unconfirmed/)
      }
    }
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key]
      else process.env[key] = previous[i]
    })
  }
})

test('explicit Initialization homes from confirmed TRAVEL rather than accepting closed idle', async () => {
  let st = { ...middle, u: 35, l: 35, ut: true, lt: true }
  let homes = 0
  assert.equal(isCentringSetupPoseReady(st, 'REF'), false)
  assert.equal(isCentringSetupPoseReady(st, null), false)
  const result = await initializeCentringUnconfirmedHome({
    setHold: () => {}, connect: async () => {}, ensureReady: async () => {}, cacheStatus: () => {},
    status: async () => st,
    homeByAxis: async axis => { assert.equal(axis, 'both'); homes++; st = home; return { status: st } },
  })
  assert.equal(result.didHome, true)
  assert.equal(homes, 1)
})

test('HOME completion with persistent software/switch disagreement cannot authorize the target', async () => {
  const stale = { ...home, l: 35 }
  let homes = 0
  await assert.rejects(initializeCentringReferenceHome('both', {
    setHold: () => {}, connect: async () => {}, ensureReady: async () => {},
    status: async () => stale,
    homeByAxis: async () => { homes++; return { status: stale } },
    cacheStatus: () => assert.fail('Do not accept a failed recovery'),
  }), { code: 'CENTRING_FEEDBACK_MISMATCH' })
  assert.equal(homes, 1)
})

test('no-reference setup executes HOME-only initialization and never applies a recipe gap', async () => {
  const keys = ['PICK_PLACE_SKIP_INIT', 'CENTRING_SKIP_INIT', 'PRODUCTION_SKIP_CENTRING']
  const previous = keys.map(key => process.env[key])
  process.env.PICK_PLACE_SKIP_INIT = '1'
  delete process.env.CENTRING_SKIP_INIT
  delete process.env.PRODUCTION_SKIP_CENTRING
  try {
    for (const referenceId of [null, '', '   ']) {
      const calls = []
      let st = middle
      const result = await runSubsystemHomingSequence({ referenceId }, {
        initializeCentringUnconfirmedHome: () => initializeCentringUnconfirmedHome({
          setHold: value => calls.push(`hold:${value}`),
          connect: async () => calls.push('connect'),
          ensureReady: async () => calls.push('ready'),
          status: async () => st,
          homeByAxis: async axis => { calls.push(`HOME:${axis}`); st = home; return { status: st } },
          cacheStatus: value => assert.deepEqual(value, home),
        }),
      })
      assert.equal(result.centring.homeOnly, true)
      assert.equal(result.centring.didHome, true)
      assert.equal(result.advancedHPre, null)
      assert.deepEqual(calls, ['hold:true', 'connect', 'ready', 'HOME:both', 'hold:false'])
    }
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key]
      else process.env[key] = previous[i]
    })
  }
})

test('no-reference setup cannot skip between-limit or invalid feedback', () => {
  assert.equal(isCentringSetupPoseReady(home, null), true)
  for (const st of [middle, { ...middle, u: 35, l: 35 }, { ...home, ut: true },
    { ...home, l: 35 }, { ...home, busy: true }, { ...home, estop: true },
    { ...home, accepted: false }, { ...home, lt: undefined }]) {
    assert.equal(isCentringSetupPoseReady(st, null), false)
  }
})

test('no-reference initialization releases session hold on failure without retrying HOME', async () => {
  const holds = []
  await assert.rejects(initializeCentringUnconfirmedHome({
    setHold: value => holds.push(value), connect: async () => {}, ensureReady: async () => {},
    status: async () => ({ ...middle, uh: undefined }),
    homeByAxis: async () => assert.fail('Must not move on missing feedback'),
    cacheStatus: () => assert.fail('Must not cache successful initialization'),
  }), { code: 'CENTRING_FEEDBACK_MISMATCH' })
  assert.deepEqual(holds, [true, false])
})

for (const [label, initial, expectedAxis] of [
  ['both between', middle, 'both'],
  ['upper between, lower HOME', { ...middle, l: -80, lh: true }, 'upper'],
  ['lower between, upper HOME', { ...middle, u: -80, uh: true }, 'lower'],
  ['upper between, lower TRAVEL', { ...middle, l: 35, lt: true }, 'both'],
  ['software says closed but neither endpoint is active', { ...middle, u: 35, l: 35 }, 'both'],
  ['software says HOME but neither endpoint is active', { ...middle, u: -80, l: -80 }, 'both'],
  ['actual reported fault: upper between, lower HOME but software closed', { ...middle, u: 33.35, l: 35, lh: true }, 'both'],
  ['both HOME switches with stale software closed position', { ...home, u: 35, l: 35 }, 'both'],
]) {
  test(`Initialization HOME first: ${label}`, async () => {
    const commands = []
    let st = initial
    assert.equal(centringNeedsHome(st), true)
    const result = await homeUnconfirmedCentringAxes({
      status: async () => st,
      homeByAxis: async axis => { commands.push(`HOME_${axis}`); st = home; return { status: st } },
    })
    assert.deepEqual(commands, [`HOME_${expectedAxis}`])
    assert.equal(result.didHome, true)
    assert.equal(result.homeAxis, expectedAxis)
    assert.equal(result.status.uh, true)
    assert.equal(result.status.lh, true)
  })
}

test('confirmed endpoints do not trigger the between-limits recovery', async () => {
  for (const initial of [home, { ...middle, u: 35, l: 35, ut: true, lt: true }]) {
    const result = await homeUnconfirmedCentringAxes({ initial,
      homeByAxis: async () => assert.fail('Unexpected HOME'),
    })
    assert.equal(result.didHome, false)
  }
})

test('missing switches, contradictions and E-stop are not treated as between limits', async () => {
  for (const initial of [
    { ...middle, ut: undefined },
    { ...middle, uh: true, ut: true },
    { ...middle, estop: true },
    { ...middle, busy: true },
  ]) {
    let calls = 0
    await assert.rejects(homeUnconfirmedCentringAxes({ initial,
      homeByAxis: async () => { calls++; return { status: home } },
    }))
    assert.equal(calls, 0)
  }
})

test('unconfirmed HOME cannot continue, clear faults, or trigger an outer initialization retry', async () => {
  let calls = 0
  let clears = 0
  await assert.rejects(homeUnconfirmedCentringAxes({ initial: middle,
    status: async () => middle,
    homeByAxis: async () => { calls++; return { status: { ...middle, moveEnd: 'home_fail' } } },
    clearFault: async () => { clears++ },
  }), err => {
    assert.equal(isRecoverableCentringInitError(err), false)
    return err.code === 'CENTRING_FEEDBACK_MISMATCH'
  })
  assert.equal(calls, 1)
  assert.equal(clears, 0)
})
