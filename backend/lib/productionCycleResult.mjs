/**
 * Derive operator Good/NG from a finished production job.
 * Job completed → PASS; failed/cancelled → FAIL.
 *
 * @param {{ status?: string|null, cycleResult?: 'PASS'|'FAIL'|null, activeFault?: boolean }} opts
 * @returns {'PASS'|'FAIL'|null}
 */
export function deriveCycleResultFromJob(opts = {}) {
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
