/**
 * Shared Pick & Place session ops — CLI + backend init/production.
 * Uses probe-only TCP prep (no connectWithRetry loop).
 */
let _masterPromise = null

function loadMaster() {
  if (!_masterPromise) {
    _masterPromise = import('../pick_place_master.js')
  }
  return _masterPromise
}

let _testImpl = null
/** @param {object|null} impl */
export function __setPickPlaceOpsTestImpl(impl) {
  _testImpl = impl
}
export function __clearPickPlaceOpsTestImpl() {
  _testImpl = null
}

async function impl() {
  if (_testImpl) return _testImpl
  return loadMaster()
}

/**
 * Single TCP probe — fast path used by CLI and backend (no connectWithRetry).
 */
export async function preparePickPlaceTcp() {
  const m = await impl()
  // Prefer long-lived session for production; probe-only if transient mode.
  if (Number(process.env.PICK_PLACE_TRANSIENT_TCP || 0) === 1) {
    const probe = await m.probeConnection()
    if (!probe.ok) {
      m.setReachable(false)
      const err = probe.error || 'TCP probe failed'
      throw new Error(`Pick & Place TCP unreachable (${probe.target}): ${err}`)
    }
    m.setReachable(true)
    return probe
  }
  try {
    await m.connect()
    return { ok: true, target: `${process.env.PICK_PLACE_HOST || '192.168.10.5'}:${process.env.PICK_PLACE_PORT || 8177}`, persistent: true }
  } catch (e) {
    m.setReachable(false)
    throw new Error(`Pick & Place TCP unreachable: ${e.message}`)
  }
}

/** STATUS — same wire as `node scripts/send_command.mjs status`. */
export async function readPickPlaceStatus() {
  const m = await impl()
  return m.status()
}

/** CLRFAULT only — drops fault/e-stop latch WITHOUT homing (recover() now re-homes). */
export async function clearPickPlaceFault() {
  const m = await impl()
  return m.clearError()
}

/**
 * STATUS → CLRFAULT if fault/estop → STATUS.
 * @returns {Promise<{ status: object|null, cleared: boolean, recoverResult?: object }>}
 */
export async function remediatePickPlace() {
  let st = await readPickPlaceStatus()
  if (!st) {
    throw new Error('Pick & Place STATUS unavailable')
  }
  if (!st.fault && !st.estop) {
    return { status: st, cleared: false }
  }
  const recoverResult = await clearPickPlaceFault()
  st = await readPickPlaceStatus()
  if (!st) {
    throw new Error('Pick & Place STATUS unavailable after CLRFAULT')
  }
  return {
    status: st,
    cleared: true,
    recoverResult,
  }
}

/**
 * CLI preflight: subnet + TCP probe (optional full diagnose report).
 * @returns {Promise<{ subnetOk: boolean, tcpOk: boolean, localIp?: string, target: string, report?: string }|null>}
 */
export async function diagnosePickPlacePreflight() {
  if (process.env.PICK_PLACE_SKIP_PREFLIGHT === '1') return null
  const m = await impl()
  const diag = await m.diagnoseConnection()
  return diag
}

/** After preflight, skip connectWithRetry when TCP already verified. */
export async function ensurePickPlaceSession(preflightDiag = null) {
  if (preflightDiag?.tcpOk || process.env.PICK_PLACE_SKIP_CONNECT === '1') return
  const m = await impl()
  await m.connectWithRetry()
}
