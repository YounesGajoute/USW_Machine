import test from 'node:test'
import assert from 'node:assert/strict'
import { DO, DI } from './ethercat.mjs'
import { initDoorInterlock } from './doorInterlock.mjs'
import {
  validateDryCycleRequest,
  validateMechanicalInspectionRequest,
  assertDryCycleSafety,
  mechanicalOutputsOnly,
} from './mechanicalDryCycle.mjs'

const idle = { referenceId: 'R', initialized: true, productionRunning: false,
  workerRunning: false, setupInProgress: false, recoveryInProgress: false,
  queueDepth: 0, maintenance: { active: false }, activeFault: null }
const request = { referenceId: 'R', confirmEmpty: true }

test('empty-cycle request requires explicit confirmation, same initialized reference, and idle machine', () => {
  validateDryCycleRequest(request, idle)
  for (const body of [{ referenceId: 'R' }, { ...request, confirmEmpty: 'true' }, { ...request, referenceId: 'OTHER' }]) {
    assert.throws(() => validateDryCycleRequest(body, idle))
  }
  for (const patch of [{ initialized: false }, { workerRunning: true }, { queueDepth: 1 },
    { setupInProgress: true }, { recoveryInProgress: true }, { maintenance: { active: true } }, { activeFault: {} }]) {
    assert.throws(() => validateDryCycleRequest(request, { ...idle, ...patch }))
  }
})

test('mechanical inspection cycle requires explicit material confirmation and keeps the same idle gates', () => {
  const body = { referenceId: 'R', confirmMaterial: true }
  validateMechanicalInspectionRequest(body, idle)
  for (const requestBody of [
    { referenceId: 'R' },
    { ...body, confirmMaterial: 'true' },
    { ...body, referenceId: 'OTHER' },
  ]) {
    assert.throws(() => validateMechanicalInspectionRequest(requestBody, idle))
  }
  assert.throws(() => validateMechanicalInspectionRequest(body, { ...idle, initialized: false }))
  assert.throws(() => validateMechanicalInspectionRequest(body, { ...idle, activeFault: { code: 'TEST' } }))
})

test('dry-cycle output guard denies external triggers, puller, and safety relay writes atomically', async () => {
  const writes = []
  class Manager {
    #connected = true
    get isInitialized() { return this.#connected }
    async setOutput(pin, value) { writes.push({ pin, value }); return { status: 'ok' } }
    async setOutputs(values) { writes.push(...values); return { status: 'ok' } }
    async getOutput() { return { status: 'ok', value: this.#connected } }
  }
  const ecm = mechanicalOutputsOnly(new Manager())
  assert.equal(ecm.isInitialized, true)
  assert.equal((await ecm.getOutput()).value, true)
  await ecm.setOutput(DO.ARM_EVO500, 0)
  await ecm.setOutput(DO.LIGHTING, 1)
  await ecm.setOutputs([{ pin: DO.CLAMP_RIGHT, value: true }, { pin: DO.CLAMP_LEFT, value: true }])
  for (const pin of [DO.ARM_EVO500, DO.PULLER, DO.ESTOP_CH2, DO.PNOZ_RESET]) {
    await assert.rejects(ecm.setOutput(pin, 1), /prohibited/)
  }
  const count = writes.length
  await assert.rejects(ecm.setOutputs([{ pin: DO.LEVER_UP, value: true }, { pin: DO.ARM_EVO500, value: true }]), /prohibited/)
  assert.equal(writes.length, count)
})

test('live dry-cycle safety rejects open doors, E-stop, low air, and unreadable inputs', async () => {
  initDoorInterlock({ readSystemSettings: () => ({ machine_model: 'STCS-evo500' }) })
  const inputs = Array(16).fill(0)
  inputs[DI.PNOZ_FEEDBACK] = inputs[DI.AIR_PRESSURE] = inputs[DI.ESTOP_BUTTON] = 1
  const ecm = { isInitialized: true, getAllInputs: async () => ({ status: 'ok', inputs }) }
  await assertDryCycleSafety(ecm)
  for (const pin of [DI.DOOR_RIGHT_1, DI.DOOR_RIGHT_2, DI.DOOR_BACK, DI.PNOZ_FEEDBACK, DI.AIR_PRESSURE, DI.ESTOP_BUTTON]) {
    inputs[pin] ^= 1
    await assert.rejects(assertDryCycleSafety(ecm))
    inputs[pin] ^= 1
  }
  await assert.rejects(assertDryCycleSafety({ ...ecm, getAllInputs: async () => ({ status: 'ok', inputs: [] }) }))
  await assert.rejects(assertDryCycleSafety({ ...ecm, isInitialized: false }))
})

