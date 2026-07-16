/**
 * Maintenance / bench centring production cycle — runs inside the backend process
 * (shares the Double_Actuator TCP session with the live master).
 */
import { runCentringCycle } from './productionCentringSequence.mjs'
import { validateReferenceShrinkTube } from './productionContext.mjs'

/**
 * @param {{
 *   referenceId: string,
 *   skipPickPlace?: boolean,
 *   restoreIdle?: boolean,
 *   onPhase?: (name: string) => void | Promise<void>,
 * }} opts
 */
export async function runMaintenanceCentringCycle({
  referenceId,
  skipPickPlace = true,
  restoreIdle = true,
  onPhase,
} = {}) {
  if (!referenceId) throw new Error('referenceId required for maintenance centring cycle')
  const tubeCheck = validateReferenceShrinkTube(referenceId)
  if (!tubeCheck.ok) throw new Error(tubeCheck.error)
  const ctx = tubeCheck.centringContext
  return runCentringCycle({
    shrinkTube: ctx.shrinkTube,
    systemSettings: ctx.systemSettings,
    skipCentringPickPlace: skipPickPlace,
    skipCentring: false,
    restoreIdleAfter: restoreIdle,
    onPhase,
  })
}
