import type { VisionResult } from '@/types/vision.types'

/**
 * Derive operator Good/NG from a finished production job.
 * Mirrors backend/lib/productionCycleResult.mjs.
 */
export function deriveCycleResultFromJob(opts: {
  status?: string | null
  cycleResult?: 'PASS' | 'FAIL' | null
  activeFault?: boolean
}): VisionResult | null {
  if (opts.cycleResult === 'PASS' || opts.cycleResult === 'FAIL') {
    return opts.cycleResult
  }
  const status = opts.status != null ? String(opts.status) : null
  if (status === 'completed') {
    return opts.activeFault ? 'FAIL' : 'PASS'
  }
  if (status === 'failed' || status === 'cancelled') {
    return 'FAIL'
  }
  return null
}
