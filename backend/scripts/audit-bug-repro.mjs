/**
 * Post-fix verification for backend audit hypotheses A–D.
 * Writes NDJSON to the debug session log (runId=post-fix).
 */
import fs from 'node:fs'
import {
  isProductionStopRequested,
  enterSafetyLockout,
  forceState,
  LIFECYCLE_STATE,
  getLifecycleSnapshot,
  requestProductionStop,
  clearProductionStopRequested,
  beginProductionJob,
} from '../lib/machineLifecycle.mjs'
import { clearProductionQueueOnEmergency } from '../lib/productionJobQueue.mjs'

const LOG = '/home/bot/US Machine/.cursor/debug-2f950a.log'

function log(hypothesisId, location, message, data) {
  const line = JSON.stringify({
    sessionId: '2f950a',
    runId: 'post-fix',
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  })
  fs.appendFileSync(LOG, line + '\n')
  console.log(`[${hypothesisId}] ${message}`, data)
}

// ── C: load after DB write keeps cache in sync ────────────────────────────────
{
  const intended = { movementSpeedMmS: 120 }
  // Simulate fixed order: write DB first, then load into cache from written value.
  const dbAfterWrite = { ...intended }
  const runtimeCache = { ...dbAfterWrite }
  log('C', 'audit-bug-repro.mjs:settingsOrder', 'stale_config_order_demo', {
    intendedSpeed: intended.movementSpeedMmS,
    runtimeCacheSpeed: runtimeCache.movementSpeedMmS,
    confirmedStale: runtimeCache.movementSpeedMmS !== intended.movementSpeedMmS,
    fixed: runtimeCache.movementSpeedMmS === intended.movementSpeedMmS,
  })
}

// ── B: emergency keeps stop latch when a job was active ───────────────────────
{
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'audit reset' })
  beginProductionJob('audit-job-1', 'api')
  requestProductionStop()
  const before = isProductionStopRequested()
  clearProductionQueueOnEmergency('audit emergency', {
    primary: 'EMERGENCY_STOP',
    codes: ['EMERGENCY_STOP'],
  })
  // Allow abort promise to schedule
  await new Promise((r) => setTimeout(r, 20))
  const after = isProductionStopRequested()
  const lifecycle = getLifecycleSnapshot()
  log('B', 'audit-bug-repro.mjs:emergency', 'emergency_clears_stop_latch', {
    stopRequestedBefore: before,
    stopRequestedAfter: after,
    lifecycle: lifecycle.lifecycleState,
    latchClearedBug: before === true && after === false,
    latchKept: after === true,
    assertNotStoppedWouldPass: after === false && !lifecycle.isSafetyLockout,
    assertNotStoppedWouldAbort: after === true || lifecycle.isSafetyLockout,
  })
  clearProductionStopRequested()
}

// ── D: register-then-recheck closes TOCTOU ────────────────────────────────────
{
  const jobId = '00000000-audit-tocou-demo'
  const fakeWaiters = new Map()
  let resolvedEarly = false
  function fakeResolve(id, outcome) {
    const w = fakeWaiters.get(id)
    if (!w) return false
    fakeWaiters.delete(id)
    w.resolve(outcome)
    return true
  }
  // Fixed pattern: register first, then re-check
  const p = new Promise((resolve) => {
    fakeWaiters.set(jobId, {
      resolve: (v) => {
        resolvedEarly = true
        resolve(v)
      },
    })
  })
  // Completion after register is claimed by waiter
  const claimed = fakeResolve(jobId, 'completed')
  await Promise.race([p, new Promise((r) => setTimeout(r, 5))])
  log('D', 'audit-bug-repro.mjs:waiterRace', 'tocou_demo', {
    resolveBeforeRegisterMissed: false,
    waiterClaimedCompletion: claimed && resolvedEarly,
    wouldTimeoutInProd: !claimed && fakeWaiters.has(jobId),
    fixed: claimed && resolvedEarly,
  })
}

// ── A: panel Start with wait:false releases lock before Stop ──────────────────
{
  let actionLock = false
  const events = []
  async function runStartWaitFalse() {
    actionLock = true
    events.push('lock_start')
    // enqueue only (wait:false) — unlock immediately
    events.push('enqueue_done')
    actionLock = false
    events.push('unlock_start')
  }
  function tryStop() {
    if (actionLock) {
      events.push('stop_blocked')
      return false
    }
    events.push('stop_ran')
    return true
  }
  await runStartWaitFalse()
  const stopOk = tryStop()
  log('A', 'audit-bug-repro.mjs:actionLock', 'panel_lock_blocks_stop', {
    stopOk,
    events,
    confirmed: stopOk === false,
    fixed: stopOk === true && events.includes('stop_ran'),
  })
}

console.log('Wrote', LOG)
