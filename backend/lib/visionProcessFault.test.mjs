import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  forceState, beginInit, completeInit, beginProductionJob, finishProductionJob,
  enterError, enterVisionProcessError, enterSafetyLockout, onEtherCATConnected,
  onEtherCATDisconnected, getLifecycleSnapshot, canAcceptProductionJobs,
  shouldRetainDrivePowerForVisionFault, setProductionPhase,
} from './machineLifecycle.mjs'
import { runVisionProcessOperation, withVisionProcessFaultPolicy } from './visionProcessFault.mjs'
import {
  initDoorInterlock, startDoorMonitor, stopDoorMonitor, getDoorSnapshot,
} from './doorInterlock.mjs'
import { DI, DO } from './ethercat.mjs'

function ready() {
  forceState('ERROR')
  beginInit()
  completeInit()
  beginProductionJob('vision-policy-test', 'hmi')
}

afterEach(() => {
  stopDoorMonitor()
  finishProductionJob({ cancelled: true })
  forceState('ERROR')
})

for (const message of ['Inspection FAIL: outside tolerance', 'Camera unreachable',
  'Inspection outcome unknown for run 123', 'Vision recipe revision mismatch']) {
  test(`${message}: blocked ERROR retains power through queue completion`, async () => {
    ready()
    const state = {}
    const failure = new Error(message)
    await assert.rejects(runVisionProcessOperation(() => { throw failure }, state), error => error === failure)
    setProductionPhase('error')
    finishProductionJob({ failed: true, error: message, cycleResult: 'FAIL' })
    const snapshot = getLifecycleSnapshot()
    assert.equal(snapshot.lifecycleState, 'ERROR')
    assert.equal(snapshot.errorDrivePowerPolicy, 'retain')
    assert.equal(snapshot.machineInitialized, false)
    assert.equal(snapshot.lastJob.cycleResult, 'FAIL')
    assert.equal(canAcceptProductionJobs(), false)
    assert.equal(state.visionFault, true)
  })
}

test('only explicit Vision steps retain power; a motion error mentioning Vision does not', async () => {
  for (const name of ['vision_welding_splice', 'vision_heat_shrink_tube', 'vision_realtime_v2']) {
    ready()
    const state = {}
    const [step] = withVisionProcessFaultPolicy([{ name, run() { throw new Error('failure') } }], state)
    await assert.rejects(step.run(), /failure/)
    assert.equal(shouldRetainDrivePowerForVisionFault(), true)
    assert.equal(state.visionFault, true)
  }
  ready()
  const state = {}
  const [step] = withVisionProcessFaultPolicy([
    { name: 'move_to_pick', run() { throw new Error('Motion failed after Vision') } },
  ], state)
  assert.throws(() => step.run(), /Motion failed/)
  setProductionPhase('error')
  assert.equal(shouldRetainDrivePowerForVisionFault(), false)
  assert.equal(state.visionFault, undefined)
})

test('independent errors, lockout, reconnect, and new Initialization clear the exception', () => {
  for (const override of [
    () => enterError('Centring stop timed out', { source: 'production-abort' }),
    () => enterSafetyLockout('Emergency stop'),
    () => onEtherCATDisconnected(),
    () => onEtherCATConnected(),
    () => beginInit(),
  ]) {
    ready()
    enterVisionProcessError(new Error('Camera failed'))
    override()
    assert.equal(shouldRetainDrivePowerForVisionFault(), false)
  }
})

test('late Vision errors cannot override an existing inhibit or lockout', () => {
  for (const prior of ['ERROR', 'POWER_OFF', 'SAFETY_LOCKOUT']) {
    forceState(prior)
    enterVisionProcessError(new Error('Late Vision failure'))
    assert.equal(getLifecycleSnapshot().lifecycleState, prior)
    assert.equal(shouldRetainDrivePowerForVisionFault(), false)
  }
})

const settle = () => new Promise(resolve => setTimeout(resolve, 90))
function monitorFixture() {
  process.env.DOOR_INTERLOCK_DISABLE = '0'
  process.env.DOOR_INTERLOCK_POLL_MS = '10'
  initDoorInterlock({ readSystemSettings: () => ({ machine_model: 'STCS-evo500' }) })
  const inputs = Array(16).fill(0)
  inputs[DI.PNOZ_FEEDBACK] = 1
  inputs[DI.ESTOP_BUTTON] = 1
  inputs[DI.AIR_PRESSURE] = 1
  const writes = []
  const ecm = {
    isInitialized: true,
    async getAllInputs() { return { status: 'ok', inputs } },
    async setOutput(pin, value) { writes.push({ pin, value }); return { status: 'ok' } },
  }
  return { inputs, writes, ecm }
}

test('Vision failure makes no DO6 write; subsequent motion fault asserts DO6', async () => {
  ready()
  const { writes, ecm } = monitorFixture()
  startDoorMonitor(ecm)
  await settle()
  writes.length = 0
  enterVisionProcessError(new Error('Vision timeout'))
  await settle()
  assert.equal(getDoorSnapshot().do6Asserted, false)
  assert.deepEqual(writes.filter(w => w.pin === DO.ESTOP_CH2), [])
  enterError('Centring abort timed out', { source: 'production-abort' })
  await settle()
  assert.equal(getDoorSnapshot().do6Asserted, true)
  assert.ok(writes.some(w => w.pin === DO.ESTOP_CH2 && w.value === 1))
})

for (const trip of ['back-door', 'hardware-feedback']) {
  test(`Vision ERROR does not mask ${trip} safety trip`, async () => {
    ready()
    const { inputs, ecm } = monitorFixture()
    startDoorMonitor(ecm)
    await settle()
    enterVisionProcessError(new Error('Inspection failed'))
    if (trip === 'back-door') inputs[DI.DOOR_BACK] = 1
    else {
      inputs[DI.ESTOP_BUTTON] = 0
      inputs[DI.PNOZ_FEEDBACK] = 0
    }
    await settle()
    assert.equal(getLifecycleSnapshot().lifecycleState, 'SAFETY_LOCKOUT')
    assert.equal(getDoorSnapshot().do6Asserted, true)
    assert.equal(shouldRetainDrivePowerForVisionFault(), false)
  })
}

test('starting a monitor during Vision ERROR cannot release an existing inhibit', async () => {
  ready()
  enterVisionProcessError(new Error('Camera disconnected'))
  const { ecm, writes } = monitorFixture()
  startDoorMonitor(ecm)
  await settle()
  assert.deepEqual(writes.filter(w => w.pin === DO.ESTOP_CH2), [])
})
