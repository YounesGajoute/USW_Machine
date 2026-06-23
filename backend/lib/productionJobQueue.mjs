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
  enterSafetyLockout,
  resetLifecycleProductionFlags,
  getLifecycleSnapshot,
} from './machineLifecycle.mjs'
import { executeProductionSequence, getProductionEnqueueBlockReason } from './productionSequence.mjs'

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
export function enqueueProductionJob(source, opts, ecm) {
  const blockReason = getProductionEnqueueBlockReason()
  if (blockReason) {
    throw new Error(blockReason)
  }

  const pendingCount = _queue.filter(j => j.status === 'pending').length
  if (pendingCount >= maxQueueDepth()) {
    throw new Error(`Production queue full (${maxQueueDepth()} pending jobs)`)
  }

  const job = {
    id: randomUUID(),
    source,
    opts: { ...opts },
    status: 'pending',
    enqueuedAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null,
  }
  _queue.push(job)
  console.log(
    `[JobQueue] Enqueued ${job.id.slice(0, 8)} (${source}) — depth ${_queue.filter(j => j.status === 'pending').length}`,
  )
  void drainQueue(ecm)
  return job
}

export function waitForProductionJob(jobId, timeoutMs = 600_000) {
  const existing = _queue.find(j => j.id === jobId) ?? _history.find(j => j.id === jobId)
  if (existing?.status === 'completed') return Promise.resolve(existing.result)
  if (existing?.status === 'failed' || existing?.status === 'cancelled') {
    return Promise.reject(new Error(existing.error ?? `Job ${existing.status}`))
  }

  return new Promise((resolve, reject) => {
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            _waiters.delete(jobId)
            reject(new Error('Production job wait timed out'))
          }, timeoutMs)
        : null

    _waiters.set(jobId, {
      resolve: (v) => {
        if (timer) clearTimeout(timer)
        resolve(v)
      },
      reject: (e) => {
        if (timer) clearTimeout(timer)
        reject(e)
      },
    })
  })
}

async function drainQueue(ecm) {
  if (_workerRunning) return
  _workerRunning = true

  try {
    while (true) {
      if (_stopRequested) {
        for (const job of _queue) {
          if (job.status === 'pending') {
            job.status = 'cancelled'
            job.finishedAt = Date.now()
            job.error = 'Stop requested — job cancelled'
            pushHistory(job)
            resolveWaiter(job.id, 'cancelled', { error: job.error })
          }
        }
        _queue.splice(0, _queue.length)
        _stopRequested = false
        break
      }

      const job = _queue.find(j => j.status === 'pending')
      if (!job) break
      if (!canAcceptProductionJobs()) {
        console.warn('[JobQueue] Worker paused — lifecycle cannot accept jobs')
        break
      }

      job.status = 'running'
      job.startedAt = Date.now()
      beginProductionJob(job.id, job.source)

      try {
        const result = await executeProductionSequence(ecm, job.opts)
        job.status = 'completed'
        job.result = result
        job.finishedAt = Date.now()
        finishProductionJob({ failed: false })
        resolveWaiter(job.id, 'completed', result)
        console.log(`[JobQueue] Completed ${job.id.slice(0, 8)} (${job.source})`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        job.status = 'failed'
        job.error = msg
        job.finishedAt = Date.now()
        finishProductionJob({ failed: true, error: msg })
        resolveWaiter(job.id, 'failed', { error: msg })
        console.warn(`[JobQueue] Failed ${job.id.slice(0, 8)}: ${msg}`)
      } finally {
        const idx = _queue.indexOf(job)
        if (idx >= 0) _queue.splice(idx, 1)
        pushHistory(job)
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
  const job = enqueueProductionJob(source, opts, ecm)
  if (opts.wait === false) {
    return {
      ok: true,
      queued: true,
      jobId: job.id,
      queuePosition: _queue.filter(j => j.status === 'pending').length,
    }
  }
  const result = await waitForProductionJob(job.id)
  return { ok: true, jobId: job.id, ...result }
}

export function stopProductionQueue() {
  _stopRequested = true
  for (const job of _queue) {
    if (job.status === 'pending') {
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      job.error = 'Stop requested — job cancelled'
      pushHistory(job)
      resolveWaiter(job.id, 'cancelled', { error: job.error })
    }
  }
  _queue.splice(0, _queue.length)
  _stopRequested = false
  const lifecycleNote = requestProductionStop()
  return {
    ok: true,
    ...lifecycleNote,
    queueCleared: true,
  }
}

export function clearProductionQueueOnEmergency() {
  _stopRequested = true
  for (const job of _queue) {
    if (job.status === 'pending' || job.status === 'running') {
      job.status = 'cancelled'
      job.error = 'Emergency stop'
      job.finishedAt = Date.now()
      resolveWaiter(job.id, 'cancelled', { error: job.error })
      pushHistory(job)
    }
  }
  _queue.splice(0, _queue.length)
  _stopRequested = false
  enterSafetyLockout('emergency stop')
}

export function resetProductionQueue() {
  _stopRequested = false
  for (const job of _queue) {
    if (job.status === 'pending') {
      job.status = 'cancelled'
      job.error = 'Queue reset'
      job.finishedAt = Date.now()
      resolveWaiter(job.id, 'cancelled', { error: job.error })
      pushHistory(job)
    }
  }
  _queue.splice(0, _queue.length)
  resetLifecycleProductionFlags()
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
      enqueuedAt: j.enqueuedAt,
      finishedAt: j.finishedAt,
      error: j.error,
    })),
    ...getLifecycleSnapshot(),
  }
}
