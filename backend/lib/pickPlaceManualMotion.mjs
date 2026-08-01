/**
 * Settings → Pick & Place → Manual move — production-step presets + P&P clamp.
 *
 * Targets match the production cycle:
 *   centering travel → active reference centering_output_mm
 *   move to pick     → Production Sequence pick mm by machine_model
 *   return backoff   → Config backoff of reference axis
 *   home             → initializePickPlace (HOMEA → HOMEB)
 *   pp clamp         → DO3 only
 */
import {
  getLifecycleSnapshot,
  isProductionStopRequested,
  LIFECYCLE_STATE,
} from './machineLifecycle.mjs'
import { getMachineInitStatus } from './machineInit.mjs'
import { validateReferenceShrinkTube, getSystemSettingsForProduction } from './productionContext.mjs'
import { getProductionSequenceConfig } from './productionSequence.mjs'
import {
  getPickPlaceConfig,
  moveAmmT2,
  initializePickPlace,
  validatePickPlaceCentringTargetMm,
  pickPlaceBackoffTargetMm,
  returnPickPlaceToHomePosition,
} from './pickPlace.mjs'
import { setPneumaticOutputs } from './pneumatics.mjs'

const EVO_MODEL = 'STCS-evo500'

/** @type {{
 *   getLifecycleSnapshot?: typeof getLifecycleSnapshot,
 *   isProductionStopRequested?: typeof isProductionStopRequested,
 *   getMachineInitStatus?: typeof getMachineInitStatus,
 *   validateReferenceShrinkTube?: typeof validateReferenceShrinkTube,
 *   getSystemSettingsForProduction?: typeof getSystemSettingsForProduction,
 *   getProductionSequenceConfig?: typeof getProductionSequenceConfig,
 *   getPickPlaceConfig?: typeof getPickPlaceConfig,
 *   moveAmmT2?: typeof moveAmmT2,
 *   initializePickPlace?: typeof initializePickPlace,
 *   validatePickPlaceCentringTargetMm?: typeof validatePickPlaceCentringTargetMm,
 *   pickPlaceBackoffTargetMm?: typeof pickPlaceBackoffTargetMm,
 *   returnPickPlaceToHomePosition?: typeof returnPickPlaceToHomePosition,
 *   setPneumaticOutputs?: typeof setPneumaticOutputs,
 * }|null} */
let _testDeps = null

/** Test seam only. */
export function __setPickPlaceManualMotionTestDeps(deps) {
  _testDeps = deps
}
export function __clearPickPlaceManualMotionTestDeps() {
  _testDeps = null
}

function d() {
  return {
    getLifecycleSnapshot,
    isProductionStopRequested,
    getMachineInitStatus,
    validateReferenceShrinkTube,
    getSystemSettingsForProduction,
    getProductionSequenceConfig,
    getPickPlaceConfig,
    moveAmmT2,
    initializePickPlace,
    validatePickPlaceCentringTargetMm,
    pickPlaceBackoffTargetMm,
    returnPickPlaceToHomePosition,
    setPneumaticOutputs,
    ...(_testDeps || {}),
  }
}

function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

/**
 * Block manual motion while a production job is active, lockout, error, or soft-stop latched.
 */
export function assertManualPickPlaceAllowed() {
  const deps = d()
  const snap = deps.getLifecycleSnapshot()
  if (deps.isProductionStopRequested()) {
    throw httpError(409, 'Cannot move Pick & Place while production stop is latched')
  }
  if (snap.isSafetyLockout || snap.lifecycleState === LIFECYCLE_STATE.SAFETY_LOCKOUT) {
    throw httpError(409, 'Cannot move Pick & Place during safety lockout')
  }
  if (snap.isError || snap.lifecycleState === LIFECYCLE_STATE.ERROR) {
    throw httpError(409, 'Cannot move Pick & Place while machine is in ERROR — run Setup first')
  }
  const blocked = new Set([
    LIFECYCLE_STATE.PRECHECK,
    LIFECYCLE_STATE.CYCLE_START,
    LIFECYCLE_STATE.COMPLETE,
    LIFECYCLE_STATE.UNLOAD,
    LIFECYCLE_STATE.RESET,
  ])
  if (blocked.has(snap.lifecycleState) || snap.isProductionActive) {
    throw httpError(409, 'Cannot move Pick & Place while production cycle is running')
  }
}

/**
 * Resolve HMI targets for Manual move production presets.
 * @param {{ speedMmS?: number }} [opts]
 */
export function resolveManualTargets(opts = {}) {
  const deps = d()
  const cfg = deps.getPickPlaceConfig()
  const seq = deps.getProductionSequenceConfig()
  let machineModel = null
  try {
    machineModel = deps.getSystemSettingsForProduction()?.machine_model ?? null
  } catch {
    machineModel = null
  }
  const isEvo = machineModel === EVO_MODEL
  const pickPositionMm = Number(isEvo ? seq.movePositionEvoMm : seq.movePositionMm)
  const { referenceAxis, targetMm: backoffMm } = deps.pickPlaceBackoffTargetMm(cfg)

  const speedFromOpts = Number(opts.speedMmS)
  const speedMmS =
    Number.isFinite(speedFromOpts) && speedFromOpts > 0
      ? speedFromOpts
      : Number(cfg.movementSpeedMmS) || 80

  const init = deps.getMachineInitStatus()
  const referenceId = init?.referenceId ?? null
  let centeringOutputMm = null
  let centeringError = null
  if (!referenceId) {
    centeringError = 'No reference loaded — scan a reference first'
  } else {
    const tubeCheck = deps.validateReferenceShrinkTube(referenceId)
    if (!tubeCheck.ok) {
      centeringError = tubeCheck.error
    } else {
      const raw = Number(tubeCheck.centringContext?.resolved?.centering_output_mm)
      if (!Number.isFinite(raw)) {
        centeringError = 'Reference recipe has no centering_output_mm'
      } else {
        try {
          centeringOutputMm = deps.validatePickPlaceCentringTargetMm(raw, 'centering output')
        } catch (err) {
          centeringError = err instanceof Error ? err.message : String(err)
        }
      }
    }
  }

  return {
    ok: true,
    referenceId,
    machineModel,
    speedMmS,
    centeringOutputMm,
    centeringError,
    pickPositionMm: Number.isFinite(pickPositionMm) ? pickPositionMm : null,
    backoffMm: Number.isFinite(backoffMm) ? backoffMm : null,
    referenceAxis,
    maxPositionMm: Number(cfg.maxPositionMm),
  }
}

function resolveSpeed(opts = {}) {
  const targets = resolveManualTargets(opts)
  return targets.speedMmS
}

/**
 * MOVEAMMT2 → centering_output_mm (production move_centering_travel).
 * @param {{ speedMmS?: number }} [opts]
 */
export async function runCenteringTravel(opts = {}) {
  assertManualPickPlaceAllowed()
  const deps = d()
  const targets = resolveManualTargets(opts)
  if (targets.centeringOutputMm == null) {
    throw httpError(400, targets.centeringError || 'Centering travel target unavailable')
  }
  const speed = resolveSpeed(opts)
  const move = await deps.moveAmmT2(targets.centeringOutputMm, speed)
  return {
    ok: true,
    action: 'centering_travel',
    targetMm: targets.centeringOutputMm,
    speedMmS: speed,
    command: move?.command ?? `MOVEAMMT2 ${targets.centeringOutputMm} ${speed}`,
    positionA: move?.positionA ?? move?.position ?? null,
    positionB: move?.positionB ?? null,
  }
}

/**
 * MOVEAMMT2 → production pick position (production move_to_pick).
 * @param {{ speedMmS?: number }} [opts]
 */
export async function runMoveToPick(opts = {}) {
  assertManualPickPlaceAllowed()
  const deps = d()
  const targets = resolveManualTargets(opts)
  if (targets.pickPositionMm == null) {
    throw httpError(400, 'Pick position unavailable — check Production Sequence settings')
  }
  const cfg = deps.getPickPlaceConfig()
  const t = Number(targets.pickPositionMm)
  if (t < Number(cfg.backoffMmA) || t > Number(cfg.maxPositionMm)) {
    throw httpError(
      400,
      `Pick position ${t} mm outside travel window [${cfg.backoffMmA}, ${cfg.maxPositionMm}] mm`,
    )
  }
  const speed = resolveSpeed(opts)
  const move = await deps.moveAmmT2(t, speed)
  return {
    ok: true,
    action: 'move_to_pick',
    targetMm: t,
    speedMmS: speed,
    machineModel: targets.machineModel,
    command: move?.command ?? `MOVEAMMT2 ${t} ${speed}`,
    positionA: move?.positionA ?? move?.position ?? null,
    positionB: move?.positionB ?? null,
  }
}

/**
 * MOVEAMMT2 → configured backoff (production return_to_backoff).
 * @param {{ speedMmS?: number }} [opts]
 */
export async function runReturnToBackoff(opts = {}) {
  assertManualPickPlaceAllowed()
  const deps = d()
  const speed = resolveSpeed(opts)
  const result = await deps.returnPickPlaceToHomePosition(speed)
  return {
    ok: true,
    action: 'return_to_backoff',
    targetMm: result.targetMm,
    speedMmS: speed,
    referenceAxis: result.referenceAxis,
    command: result.command,
    positionA: result.positionA ?? null,
    positionB: result.positionB ?? null,
    via: result.via,
  }
}

/**
 * HOMEA → HOMEB (same as Setup pick-place initialize).
 * @param {{ homingSpeedMmS?: number }} [opts]
 */
export async function runHome(opts = {}) {
  assertManualPickPlaceAllowed()
  const deps = d()
  const cfg = deps.getPickPlaceConfig()
  const homingSpeed = Number(opts.homingSpeedMmS)
  const result = await deps.initializePickPlace({
    homingSpeed:
      Number.isFinite(homingSpeed) && homingSpeed > 0 ? homingSpeed : cfg.homingSpeedMmS,
  })
  return {
    ok: true,
    action: 'home',
    ...result,
  }
}

/**
 * Write DO3 PP_CLAMP only.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {boolean} closed
 */
export async function setPpClamp(ecm, closed) {
  assertManualPickPlaceAllowed()
  if (!ecm?.isInitialized) {
    throw httpError(503, 'EtherCAT not connected')
  }
  const deps = d()
  await deps.setPneumaticOutputs(ecm, { ppClamp: !!closed })
  return {
    ok: true,
    action: 'pp_clamp',
    closed: !!closed,
    outputs: { ppClamp: !!closed },
  }
}
