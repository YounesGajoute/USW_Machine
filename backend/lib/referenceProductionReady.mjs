/**
 * Reconcile per-reference production readiness with physical machine state.
 *
 * After a reference scan/change the lifecycle may settle to RUN (machine still homed)
 * while `_initializedReferenceId` was cleared — leaving `canStartProduction` false
 * even though shrink tube, centring, vision, and clamp gates would pass.
 *
 * This module re-applies the same production enqueue gates (except the per-reference
 * init flag) and marks the reference ready when the machine is physically initialized.
 */

import { isMachineInitialized, canAcceptProductionJobs, isInitInProgress } from './machineLifecycle.mjs'
import {
  isProductionShrinkTubeRequired,
  validateReferenceShrinkTube,
} from './productionContext.mjs'
import { getCentringProductionBlockReason } from './centringIdle.mjs'
import { getPickPlaceProductionBlockReason } from './pickPlaceIdle.mjs'
import {
  isReferenceVisionActive,
  getVisionChecksConfigForReference,
  getVisionChecksBlockReason,
} from './productionVisionInspection.mjs'
import { isAnyVisionCheckEnabled } from './visionChecksConfigStore.mjs'
import {
  getClampTriggerStartBlockReason,
  getCachedClampTriggerState,
} from './clampTriggerMode.mjs'
import { isClampTriggerProductionGateActive } from './productionPanelConfig.mjs'

/**
 * Production enqueue gates for a reference, excluding the per-reference init flag.
 * @param {string|null|undefined} referenceId
 * @returns {string|null}
 */
export function getReferenceProductionReadyBlockReason(referenceId) {
  if (!referenceId) {
    return 'No reference loaded — scan a reference first'
  }
  if (isInitInProgress()) {
    return 'Initialization in progress'
  }
  if (!canAcceptProductionJobs()) {
    return 'Machine cannot accept production jobs in current lifecycle state'
  }
  if (isProductionShrinkTubeRequired()) {
    const tubeCheck = validateReferenceShrinkTube(referenceId)
    if (!tubeCheck.ok) {
      return tubeCheck.error
    }
    const centringBlock = getCentringProductionBlockReason()
    if (centringBlock) return centringBlock
  }
  const pickPlaceBlock = getPickPlaceProductionBlockReason()
  if (pickPlaceBlock) return pickPlaceBlock
  if (isReferenceVisionActive(referenceId)) {
    const visionChecks = getVisionChecksConfigForReference(referenceId)
    if (isAnyVisionCheckEnabled(visionChecks)) {
      const visionBlock = getVisionChecksBlockReason(referenceId, visionChecks)
      if (visionBlock) return visionBlock
    }
  }
  if (isClampTriggerProductionGateActive()) {
    const clampBlock = getClampTriggerStartBlockReason(getCachedClampTriggerState())
    if (clampBlock) return clampBlock
  }
  return null
}

/**
 * True when a full setup is likely to clear the only remaining block (centring posture).
 * @param {string|null|undefined} blockReason
 */
export function isCentringSetupRecoverableBlock(blockReason) {
  if (!blockReason) return false
  return /centring/i.test(blockReason)
}

/**
 * Mark the loaded reference production-ready when the machine is homed and all
 * runtime gates pass. Idempotent when already marked for the current reference.
 *
 * @param {{
 *   referenceId?: string|null,
 *   markReferenceInitialized?: (id: string) => void,
 *   syncIdleInitFromReference?: (ctx: object) => void,
 *   getMachineInitStatus?: () => { referenceLoaded: boolean, referenceId: string|null, initialized: boolean },
 * }} [deps]
 * @returns {{ marked: boolean, blockReason: string|null }}
 */
export function reconcileReferenceProductionReady(deps = {}) {
  const getStatus = deps.getMachineInitStatus
  const markInit = deps.markReferenceInitialized
  const syncIdle = deps.syncIdleInitFromReference

  if (!getStatus || !markInit || !syncIdle) {
    return { marked: false, blockReason: 'reconcile dependencies not wired' }
  }

  const status = getStatus()
  const referenceId = deps.referenceId ?? status.referenceId
  if (!referenceId || status.referenceId !== referenceId) {
    return { marked: false, blockReason: 'No reference loaded — scan a reference first' }
  }
  if (status.initialized) {
    return { marked: false, blockReason: null }
  }
  if (!isMachineInitialized()) {
    return { marked: false, blockReason: 'Machine not initialized — press Initialization first' }
  }

  const blockReason = getReferenceProductionReadyBlockReason(referenceId)
  if (blockReason) {
    return { marked: false, blockReason }
  }

  markInit(referenceId)
  syncIdle(getStatus())
  return { marked: true, blockReason: null }
}
