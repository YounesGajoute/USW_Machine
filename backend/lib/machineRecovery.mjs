/**
 * @deprecated Use runMachineSetup — thin wrapper for backward compatibility.
 * Re-exports health helpers from machineSetupHealth for tests.
 */

export {
  evaluateSystemHealth,
  verifySubsystemHealth,
  canRecover,
  getRecoveryBlockReason,
  isRecoveryInProgress,
} from './machineSetupHealth.mjs'

import { runMachineSetup } from './machineSetup.mjs'

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ source?: 'panel'|'hmi'|'api', requireButton?: boolean }} [opts]
 */
export async function runMachineRecovery(ecm, opts = {}) {
  return runMachineSetup(ecm, opts)
}
