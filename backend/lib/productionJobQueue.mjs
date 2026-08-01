/**
 * Production job queue — serializes production cycles with explicit job records.
 *
 * One worker processes jobs FIFO. While busy, new requests are queued (bounded depth).
 * Panel / HMI / API all enqueue through requestProductionStart().
 */
import { randomUUID } from 'crypto'
import {
  canAcceptProductionJobs,
  beginProductionJob,
  finishProductionJob,
  requestProductionStop,
  isProductionStopRequested,
  enterSafetyLockout,
  resetLifecycleProductionFlags,
  getLifecycleSnapshot,
  getLastJobOutcome,
  LIFECYCLE_STATE,
} from './machineLifecycle.mjs'
import { executeProductionSequence, getProductionEnqueueBlockReason, refreshClampTriggerEnqueueGate } from './productionSequence.mjs'
import { abortProductionMotionBestEffort } from './productionAbort.mjs'
import { getEtherCATManager } from './ethercat.mjs'
import { deriveCycleResultFromJob } from './productionCycleResult.mjs'
import { getMachineInitStatus } from './machineInit.mjs'
import { recordProductionRun, recordError, summarizeVisionPhases } from './historyStore.mjs'
import { classifyActiveFault } from './faultClassifier.mjs'
import { getMachineOperationAccess } from './machineOperationAccess.mjs'

/** Last EtherCAT manager used by the queue worker (for stop abort without requiring ecm arg). */
let _lastEcm = null

/** @typedef {'panel'|'hmi'|'api'} ProductionJobSource */

/**
 * @typedef {Object} ProductionJob
 * @property {string} id
 * @property {ProductionJobSource} source
 * @property {object} opts
 * @property {'pending'|'running'|'completed'|'failed'|'cancelled'} status
 * @property {number} enqueuedAt
 * @property {number|null} startedAt
 * @property {number|null} finishedAt
 * @property {string|null} error
 * @property {object|null} result
 */

/** @type {ProductionJob[]} */
const _queue = []
/** @type {ProductionJob[]} */
const _history = []
let _workerRunning = false
let _stopRequested = false
let _maxDepth = 8
let _maxHistory = 20

/** @type {Map<string, { resolve: Function, reject: Function }>} */
const _waiters = new Map()

function maxQueueDepth() {
  const n = Number(process.env.PRODUCTION_QUEUE_MAX_DEPTH)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : _maxDepth
}

function trimHistory() {
  while (_history.length > _maxHistory) _history.shift()
}

function pushHistory(job) {
  _history.push({ ...job })
  trimHistory()
}

/** Derive a severity + phase for an error log entry from a failed/cancelled job. */
function classifyJobError(job, { emergency = false } = {}) {
  if (emergency) return { severity: 'critical', code: 'EMERGENCY_STOP' }
  if (job.status === 'cancelled') return { severity: 'medium', code: 'JOB_CANCELLED' }
  // Plain failure: derive a granular production code (VISION_FAIL, PNEUMATIC_FAULT, …)
  // from the job error so the Error History matches the live-fault taxonomy.
  // CYCLE_START is the running-cycle state (non-INIT) — classifies as PRODUCTION.
  const fault = classifyActiveFault({ lastError: job.error, lifecycleState: 'CYCLE_START', connected: true })
  return { severity: 'high', code: fault?.primary ?? 'PRODUCTION_GENERIC' }
}

function lastPhaseOf(job) {
  const phases = job?.result?.phases
  if (Array.isArray(phases) && phases.length) {
    const last = phases[phases.length - 1]
    if (last && typeof last.phase === 'string') return last.phase
  }
  return null
}

/** Persist a finished job (any terminal status) to durable production history + error log. */
function persistJobOutcome(job, { emergency = false } = {}) {
  let referenceId = null
  try {
    referenceId = getMachineInitStatus().referenceId ?? null
  } catch {
    referenceId = null
  }
  const succeeded = job.status === 'completed'
  const durationMs =
    job.startedAt != null && job.finishedAt != null ? job.finishedAt - job.startedAt : null

  let operatorId = job.operatorId
  if (!operatorId) {
    try {
      operatorId = getMachineOperationAccess().getKioskOperatorUserId() ?? null
    } catch {
      operatorId = null
    }
  }

  const cycleResult =
    job.cycleResult ??
    deriveCycleResultFromJob({ status: job.status })

  recordProductionRun({
    jobId: job.id,
    source: job.source,
    referenceId,
    operatorId,
    operatorName: job.operatorName,
    result: cycleResult === 'PASS',
    durationMs,
    visionSummary: summarizeVisionPhases(job?.result?.phases),
    errorMessage: succeeded ? null : job.error,
    details: succeeded
      ? { ...job.result, cycleResult }
      : { status: job.status, error: job.error, cycleResult },
  })

  if (!succeeded) {
    const { severity, code } = classifyJobError(job, { emergency })
    recordError({
      errorCode: code,
      errorMessage: job.error ?? `Job ${job.status}`,
      severity,
      phase: lastPhaseOf(job) ?? (emergency ? 'emergency_stop' : 'production'),
      jobId: job.id,
      referenceId,
      operatorId,
      context: { source: job.source, status: job.status },
    })
  }
}

function resolveWaiter(jobId, outcome, payload) {
  const waiter = _waiters.get(jobId)
  if (!waiter) return
  _waiters.delete(jobId)
  if (outcome === 'completed') waiter.resolve(payload)
  else waiter.reject(new Error(payload?.error ?? `Job ${outcome}`))
}

/**
 * @param {ProductionJobSource} source
 * @param {object} opts
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function enqueueProductionJob(source, opts, ecm) {
  // Live DI sample before the sync gate — do not rely on the monitor cache alone.
  await refreshClampTriggerEnqueueGate(ecm)

  const blockReason = getProductionEnqueueBlockReason()
  // #region agent log
  {
    const snap = getLifecycleSnapshot()
    const init = getMachineInitStatus()
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'671579'},body:JSON.stringify({sessionId:'671579',runId:'pre-fix',hypothesisId:'A',location:'productionJobQueue.mjs:enqueueProductionJob',message:'production start enqueue gate',data:{source,blockReason:blockReason||null,lifecycle:snap.lifecycleState,initialized:!!init.initialized,referenceId:init.referenceId||null,referenceLoaded:!!init.referenceLoaded},timestamp:Date.now()})}).catch(()=>{})
  }
  // #endregion
  if (blockReason) {
    throw new Error(blockReason)
  }

  const pendingCount = _queue.filter(j => j.status === 'pending').length
  if (pendingCount >= maxQueueDepth()) {
    throw new Error(`Production queue full (${maxQueueDepth()} pending jobs)`)
  }

  if (ecm) _lastEcm = ecm

  const job = {
    id: randomUUID(),
    source,
    opts: { ...opts },
    operatorId: opts.operatorId != null ? String(opts.operatorId) : null,
    operatorName: opts.operatorName != null ? String(opts.operatorName) : null,
    status: 'pending',
    enqueuedAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null,
    cycleResult: null,
  }
  _queue.push(job)
  console.log(
    `[JobQueue] Enqueued ${job.id.slice(0, 8)} (${source}) — depth ${_queue.filter(j => j.status === 'pending').length}`,
  )
  void drainQueue(ecm)
  return job
}

export function waitForProductionJob(jobId, timeoutMs = 600_000) {
  return new Promise((resolve, reject) => {
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            _waiters.delete(jobId)
            reject(new Error('Production job wait timed out'))
          }, timeoutMs)
        : null

    const settle = (fn, value) => {
      if (timer) clearTimeout(timer)
      _waiters.delete(jobId)
      fn(value)
    }

    _waiters.set(jobId, {
      resolve: (v) => settle(resolve, v),
      reject: (e) => settle(reject, e),
    })

    // Re-check after registering to close the TOCTOU window where the job
    // finishes between the initial status read and _waiters.set.
    const existing = _queue.find(j => j.id === jobId) ?? _history.find(j => j.id === jobId)
    // Only settle from the re-check if resolveWaiter has not already claimed us.
    if (!_waiters.has(jobId)) return
    if (existing?.status === 'completed') {
      settle(resolve, existing.result)
      return
    }
    if (existing?.status === 'failed' || existing?.status === 'cancelled') {
      settle(reject, new Error(existing.error ?? `Job ${existing.status}`))
    }
  })
}

async function drainQueue(ecm) {
  if (_workerRunning) return
  _workerRunning = true
  if (ecm) _lastEcm = ecm

  try {
    while (true) {
      if (_stopRequested) {
        for (const job of _queue) {
          if (job.status === 'pending') {
            job.status = 'cancelled'
            job.finishedAt = Date.now()
            job.error = 'Stop requested — job cancelled'
            job.cycleResult = 'FAIL'
            pushHistory(job)
            resolveWaiter(job.id, 'cancelled', { error: job.error })
            persistJobOutcome(job)
          }
        }
        // Keep the running job in the queue for the worker to finish/cancel.
        for (let i = _queue.length - 1; i >= 0; i--) {
          if (_queue[i].status === 'pending' || _queue[i].status === 'cancelled') {
            _queue.splice(i, 1)
          }
        }
        if (!_queue.some(j => j.status === 'running')) {
          _stopRequested = false
          break
        }
      }

      const job = _queue.find(j => j.status === 'pending')
      if (!job) break
      if (!canAcceptProductionJobs()) {
        console.warn('[JobQueue] Worker paused — lifecycle cannot accept jobs')
        // Cancel orphaned pending jobs — they cannot run until Recover/Setup, and the
        // next Start must not silently drain a pre-fault backlog (ghost cycles).
        for (const job of _queue) {
          if (job.status === 'pending') {
            job.status = 'cancelled'
            job.finishedAt = Date.now()
            job.error = 'Lifecycle cannot accept jobs — pending cancelled'
            job.cycleResult = 'FAIL'
            pushHistory(job)
            resolveWaiter(job.id, 'cancelled', { error: job.error })
            persistJobOutcome(job)
          }
        }
        for (let i = _queue.length - 1; i >= 0; i--) {
          if (_queue[i].status === 'pending' || _queue[i].status === 'cancelled') {
            _queue.splice(i, 1)
          }
        }
        break
      }

      job.status = 'running'
      job.startedAt = Date.now()
      beginProductionJob(job.id, job.source)

      try {
        const result = await executeProductionSequence(ecm, job.opts)
        // Emergency/soft-stop may have cancelled the job while the sequence was still returning.
        const lifeSnap = getLifecycleSnapshot()
        if (
          job.status === 'cancelled' ||
          lifeSnap.isSafetyLockout ||
          lifeSnap.lifecycleState === LIFECYCLE_STATE.ERROR ||
          lifeSnap.lifecycleState === LIFECYCLE_STATE.POWER_OFF ||
          isProductionStopRequested()
        ) {
          throw new Error(job.error || 'Stop requested — cycle aborted')
        }
        job.status = 'completed'
        job.result = result
        job.cycleResult = 'PASS'
        job.finishedAt = Date.now()
        finishProductionJob({
          failed: false,
          cycleResult: 'PASS',
          jobId: job.id,
          source: job.source,
        })
        resolveWaiter(job.id, 'completed', { ...result, cycleResult: 'PASS' })
        console.log(`[JobQueue] Completed ${job.id.slice(0, 8)} (${job.source})`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const stopped =
          isProductionStopRequested() ||
          getLifecycleSnapshot().isSafetyLockout ||
          msg.includes('Stop requested') ||
          msg.includes('Emergency stop')
        job.status = stopped ? 'cancelled' : 'failed'
        job.error = msg
        job.cycleResult = 'FAIL'
        job.finishedAt = Date.now()
        finishProductionJob({
          failed: !stopped,
          cancelled: stopped,
          error: msg,
          cycleResult: 'FAIL',
          jobId: job.id,
          source: job.source,
        })
        resolveWaiter(job.id, job.status, { error: msg, cycleResult: 'FAIL' })
        console.warn(`[JobQueue] ${stopped ? 'Cancelled' : 'Failed'} ${job.id.slice(0, 8)}: ${msg}`)
      } finally {
        const idx = _queue.indexOf(job)
        if (idx >= 0) _queue.splice(idx, 1)
        pushHistory(job)
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          persistJobOutcome(job)
        }
        _stopRequested = false
      }
    }
  } finally {
    _workerRunning = false
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ requireButton?: boolean, source?: ProductionJobSource, centringContext?: object, wait?: boolean }} opts
 */
export async function requestProductionStart(ecm, opts = {}) {
  const source = opts.source ?? 'api'
  const job = await enqueueProductionJob(source, opts, ecm)
  if (opts.wait === false) {
    return {
      ok: true,
      queued: true,
      jobId: job.id,
      queuePosition: _queue.filter(j => j.status === 'pending').length,
    }
  }
  try {
    const result = await waitForProductionJob(job.id)
    return { ok: true, jobId: job.id, ...result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const last = getLastJobOutcome()
    const wrapped = new Error(msg)
    wrapped.jobId = job.id
    wrapped.cycleResult = last?.cycleResult ?? 'FAIL'
    wrapped.status = last?.status ?? 'failed'
    wrapped.cause = err instanceof Error ? err : undefined
    throw wrapped
  }
}

/**
 * Soft stop: cancel pending jobs, best-effort abort motion/pneumatics, signal worker.
 * @param {import('./ethercat.mjs').EtherCATManager|null} [ecm]
 */
export async function stopProductionQueue(ecm = null) {
  _stopRequested = true
  const manager = ecm ?? _lastEcm
  // Latch lifecycle stop BEFORE hardware abort. Centring "stop" is waitIdle (no
  // STOP wire cmd) and previously blocked here up to ~70s while the cycle kept running.
  const lifecycleNote = requestProductionStop()

  for (const job of _queue) {
    if (job.status === 'pending') {
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      job.error = 'Stop requested — job cancelled'
      job.cycleResult = 'FAIL'
      pushHistory(job)
      resolveWaiter(job.id, 'cancelled', { error: job.error })
      persistJobOutcome(job)
    }
  }
  // Remove pending/cancelled; leave running job for the worker.
  for (let i = _queue.length - 1; i >= 0; i--) {
    if (_queue[i].status !== 'running') _queue.splice(i, 1)
  }

  const abort = await abortProductionMotionBestEffort(manager)

  // No running job — clear stop latch now.
  if (!_queue.some(j => j.status === 'running')) {
    _stopRequested = false
  }

  return {
    ok: true,
    ...lifecycleNote,
    queueCleared: true,
    abort,
  }
}

export function clearProductionQueueOnEmergency(reason = 'emergency stop', rootCause = null) {
  _stopRequested = true
  // Boot/door trips can fire before any production job set _lastEcm — use the live singleton.
  const manager = _lastEcm ?? getEtherCATManager()

  // Mirror soft stop: cancel pending now; leave the running job for the worker
  // so assertNotStopped / lockout can abort the sequence without marking PASS.
  for (const job of _queue) {
    if (job.status === 'pending') {
      job.status = 'cancelled'
      job.error = 'Emergency stop'
      job.finishedAt = Date.now()
      job.cycleResult = 'FAIL'
      resolveWaiter(job.id, 'cancelled', { error: job.error })
      pushHistory(job)
      persistJobOutcome(job)
    } else if (job.status === 'running') {
      job.error = 'Emergency stop'
    }
  }
  for (let i = _queue.length - 1; i >= 0; i--) {
    if (_queue[i].status !== 'running') _queue.splice(i, 1)
  }

  void abortProductionMotionBestEffort(manager).catch((err) => {
    console.warn(
      `[JobQueue] Emergency abort failed: ${err instanceof Error ? err.message : err}`,
    )
  })

  enterSafetyLockout(reason, rootCause)

  if (!_queue.some(j => j.status === 'running')) {
    _stopRequested = false
  }
}

export function resetProductionQueue() {
  // Mid-cycle reference scan must not splice the worker-owned running job (desync).
  // When no cycle is active, clear everything including any stale running stub.
  const snapBefore = getLifecycleSnapshot()
  const preserveRunning = snapBefore.isProductionActive || _workerRunning

  for (const job of _queue) {
    const shouldCancel =
      job.status === 'pending' || (!preserveRunning && job.status === 'running')
    if (!shouldCancel) continue
    job.status = 'cancelled'
    job.error = 'Queue reset'
    job.finishedAt = Date.now()
    job.cycleResult = 'FAIL'
    resolveWaiter(job.id, 'cancelled', { error: job.error })
    pushHistory(job)
    persistJobOutcome(job)
  }
  if (preserveRunning) {
    for (let i = _queue.length - 1; i >= 0; i--) {
      if (_queue[i].status !== 'running') _queue.splice(i, 1)
    }
    if (!_queue.some((j) => j.status === 'running')) {
      _stopRequested = false
    }
  } else {
    _queue.splice(0, _queue.length)
    _stopRequested = false
  }
  resetLifecycleProductionFlags()
}

/** @internal Test-only — seed queue jobs without going through enqueue gates. */
export function __seedQueueForTest(jobs = []) {
  _queue.splice(0, _queue.length, ...jobs)
}

/** @internal Test-only — run one drain pass. */
export async function __drainQueueForTest(ecm = null) {
  return drainQueue(ecm)
}

export function isQueueWorkerRunning() {
  return _workerRunning
}

export function isProductionBusy() {
  return _workerRunning || _queue.some(j => j.status === 'running' || j.status === 'pending')
}

export function getProductionQueueSnapshot() {
  const pending = _queue.filter(j => j.status === 'pending')
  const running = _queue.find(j => j.status === 'running') ?? null
  return {
    queueDepth: pending.length,
    queueMaxDepth: maxQueueDepth(),
    workerRunning: _workerRunning,
    stopRequested: _stopRequested,
    pendingJobs: pending.map(j => ({
      id: j.id,
      source: j.source,
      enqueuedAt: j.enqueuedAt,
    })),
    runningJob: running
      ? {
          id: running.id,
          source: running.source,
          startedAt: running.startedAt,
        }
      : null,
    recentJobs: _history.slice(-5).map(j => ({
      id: j.id,
      source: j.source,
      status: j.status,
      cycleResult: j.cycleResult ?? null,
      enqueuedAt: j.enqueuedAt,
      finishedAt: j.finishedAt,
      error: j.error,
    })),
    ...getLifecycleSnapshot(),
  }
}
