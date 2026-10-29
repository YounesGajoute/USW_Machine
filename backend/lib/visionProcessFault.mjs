import { enterVisionProcessError, enterError, getLifecycleSnapshot, isProductionStopRequested } from './machineLifecycle.mjs'
import { VisionProductReject } from './visionProductReject.mjs'

const VISION_STEPS = new Set([
  'vision_welding_splice', 'vision_heat_shrink_tube', 'vision_realtime_v2',
])

/** Attribute faults at the Vision operation boundary, not by matching messages. */
export async function runVisionProcessOperation(run, state = {}, onProductReject = null) {
  try {
    return await run()
  } catch (error) {
    state.visionFault = true
    if (error instanceof VisionProductReject && onProductReject) {
      state.productRejected = true
      state.inspectionOutcome = 'FAIL'
      try {
        await onProductReject(error)
        state.productRejectReleased = true
      } catch (releaseError) {
        // Do not continue releasing valves after a failed write, Stop, or trip.
        // This is a separate pneumatic failure, not a Vision power exception.
        const snapshot = getLifecycleSnapshot()
        if (!isProductionStopRequested() &&
            !['ERROR', 'SAFETY_LOCKOUT', 'POWER_OFF'].includes(snapshot.lifecycleState)) {
          enterError(`Vision reject release failed: ${releaseError instanceof Error ? releaseError.message : releaseError}`,
            { source: 'product-release' })
        }
        throw releaseError
      }
      throw error
    }
    if (!isProductionStopRequested()) enterVisionProcessError(error)
    throw error
  }
}

/** Shared by automatic production and the maintenance stepper. */
export function withVisionProcessFaultPolicy(steps, state, onProductReject = null) {
  return steps.map(step => VISION_STEPS.has(step.name)
    ? { ...step, run: () => runVisionProcessOperation(() => step.run(), state, onProductReject) }
    : step)
}
