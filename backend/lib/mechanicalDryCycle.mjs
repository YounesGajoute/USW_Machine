import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DO } from './ethercat.mjs'
import { readSafetyInputsSnapshot, areConfiguredDoorsClosed } from './doorInterlock.mjs'

export const DRY_CYCLE_SOURCE = 'mechanical-dry-cycle'
export const MECHANICAL_INSPECTION_SOURCE = 'mechanical-inspection-cycle'
const reports = new URL('../data/mechanical-dry-cycles/', import.meta.url)
const inspectionReports = new URL('../data/mechanical-inspection-cycles/', import.meta.url)

export function validateDryCycleRequest(body, snapshot) {
  if (body?.confirmEmpty !== true) throw new Error('Confirm an empty fixture before the mechanical dry cycle')
  if (!body.referenceId || body.referenceId !== snapshot.referenceId) throw new Error('Loaded reference changed')
  if (snapshot.initialized !== true) throw new Error('Initialize the loaded reference first')
  for (const flag of ['productionRunning', 'workerRunning', 'setupInProgress', 'recoveryInProgress']) {
    if (snapshot[flag] !== false) throw new Error('Machine must be idle for a mechanical dry cycle')
  }
  if (snapshot.queueDepth !== 0 || snapshot.maintenance?.active !== false || snapshot.activeFault) {
    throw new Error('Clear pending work, maintenance mode and active faults first')
  }
}

/** Mechanical motion plus camera inspection; material must be present. */
export function validateMechanicalInspectionRequest(body, snapshot) {
  if (body?.confirmMaterial !== true) throw new Error('Confirm material is loaded before the mechanical inspection cycle')
  if (!body.referenceId || body.referenceId !== snapshot.referenceId) throw new Error('Loaded reference changed')
  if (snapshot.initialized !== true) throw new Error('Initialize the loaded reference first')
  for (const flag of ['productionRunning', 'workerRunning', 'setupInProgress', 'recoveryInProgress']) {
    if (snapshot[flag] !== false) throw new Error('Machine must be idle for a mechanical inspection cycle')
  }
  if (snapshot.queueDepth !== 0 || snapshot.maintenance?.active !== false || snapshot.activeFault) {
    throw new Error('Clear pending work, maintenance mode and active faults first')
  }
}

/** Live reads only; never reset/release the safety relay to make a test pass. */
export async function assertDryCycleSafety(ecm) {
  if (!ecm?.isInitialized) throw new Error('Machine connection lost')
  const raw = await ecm.getAllInputs()
  if (raw?.status !== 'ok' || !Array.isArray(raw.inputs) || raw.inputs.length < 16) {
    throw new Error('Cannot verify dry-cycle safety inputs')
  }
  const safety = await readSafetyInputsSnapshot({ getAllInputs: async () => raw })
  if (!areConfiguredDoorsClosed(safety)) throw new Error('Close the machine doors')
  if (!safety.airPressureOk || !safety.emergencyOk || !safety.pnozConfirmed) {
    throw new Error('Air pressure, E-stop release and armed safety relay are required')
  }
}

/** Restrict this cycle's outputs, including any future sequence additions. */
export function mechanicalOutputsOnly(ecm) {
  // Camera lighting is part of the inspection path and is safe to toggle;
  // process triggers, puller and safety-relay outputs remain prohibited.
  const mechanical = new Set([DO.CLAMP_RIGHT, DO.CLAMP_LEFT, DO.LEVER_UP, DO.PP_CLAMP, DO.MAIN_AIR, DO.LIGHTING])
  const offOnly = new Set([DO.ARM_EVO500, DO.PULLER])
  function check(pin, value) {
    if (!mechanical.has(pin) && !(offOnly.has(pin) && (value === false || value === 0))) {
      throw new Error(`Output DO${pin} is prohibited in a mechanical dry cycle`)
    }
  }
  return new Proxy(ecm, {
    get(target, key) {
      if (key === 'setOutput') return async (pin, value) => {
        check(pin, value)
        return target.setOutput(pin, value)
      }
      if (key === 'setOutputs') return async updates => {
        for (const { pin, value } of updates) check(pin, value)
        return target.setOutputs(updates)
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function prepareDryCycleRecording() {
  fs.mkdirSync(reports, { recursive: true })
  fs.accessSync(reports, fs.constants.W_OK)
}

/** Separate test records: never increment product good/NG counts. */
export function recordDryCycle(job) {
  const inspection = job.opts?.mechanicalInspectionCycle === true
  const targetDir = inspection ? inspectionReports : reports
  fs.mkdirSync(targetDir, { recursive: true })
  fs.accessSync(targetDir, fs.constants.W_OK)
  const phases = job.result?.phases ?? []
  const report = {
    kind: inspection ? MECHANICAL_INSPECTION_SOURCE : DRY_CYCLE_SOURCE,
    jobId: job.id, referenceId: job.opts.dryCycleReferenceId,
    status: job.status, testResult: job.cycleResult,
    startedAt: job.startedAt, finishedAt: job.finishedAt,
    error: job.error, result: job.result,
    inspectionPerformed: inspection && phases.some((phase) => String(phase?.phase ?? '').startsWith('vision_')),
    externalProcessTriggered: false,
  }
  const target = new URL(`${job.id}.json`, targetDir)
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n')
  return fileURLToPath(target)
}
