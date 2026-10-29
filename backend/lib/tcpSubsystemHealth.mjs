/**
 * Periodic health probes for eth0 TCP subsystems — imports firmware masters only.
 */
import { visionBaseFromEnv, visionRemoteKeyFromEnv } from './visionConfig.mjs'
import { getRealtimeInspectionBaseUrl } from './realtimeInspectionClient.mjs'
import { isSetupInProgress } from './machineSetupHealth.mjs'
import { healthProbePickPlace, setReachable as setPickPlaceReachable } from './pickPlace.mjs'
import {
  healthProbeCentring,
  setReachable as setCentringReachable,
  status as centringStatus,
} from './centring.mjs'

const VISION_TIMEOUT_MS = Number(process.env.VISION_HEALTH_TIMEOUT_MS || 5000)

function subsystemState() {
  return { reachable: false, lastOk: null, lastError: null, consecutiveFailures: 0, reconnecting: false }
}

const _state = {
  vision: subsystemState(),
  pickPlace: subsystemState(),
  centring: subsystemState(),
}

/** @type {Awaited<ReturnType<typeof centringStatus>> | null} */
let _lastCentringStatus = null
let _lastCentringStatusAt = 0
// Allow three normal polls; an old idle pose must not keep Start enabled.
const CENTRING_STATUS_MAX_AGE_MS = Math.max(15000, (Number(process.env.COMM_HEALTH_INTERVAL_MS) || 5000) * 3)

/** Last centring STATUS from health poll (best-effort, may be null). */
export function getCachedCentringStatus() {
  return _lastCentringStatus && Date.now() - _lastCentringStatusAt <= CENTRING_STATUS_MAX_AGE_MS
    ? { ..._lastCentringStatus } : null
}

/**
 * Publish a fresh centring STATUS into the enqueue-gate cache.
 * Call after setup/homing/restore so Start is not blocked on a stale park posture.
 * A successful STATUS also marks the TCP health row reachable.
 * @param {Awaited<ReturnType<typeof centringStatus>> | null | undefined} status
 */
export function setCachedCentringStatus(status) {
  _lastCentringStatus = status ? { ...status } : null
  _lastCentringStatusAt = status ? Date.now() : 0
  if (status) {
    const s = _state.centring
    s.reachable = true
    s.lastOk = Date.now()
    s.lastError = null
    s.consecutiveFailures = 0
    s.reconnecting = false
  }
}

/** @internal test helper — seed centring STATUS for sync production gates */
export function __setCachedCentringStatusForTest(status) {
  setCachedCentringStatus(status)
}

/**
 * @internal test helper — seed Pick & Place TCP health for sync production gates.
 * @param {{ reachable?: boolean, lastError?: string|null }} [patch]
 */
export function __setPickPlaceHealthForTest({ reachable = true, lastError = null } = {}) {
  const s = _state.pickPlace
  s.reachable = !!reachable
  s.lastError = lastError
  s.reconnecting = false
  if (reachable) {
    s.lastOk = Date.now()
    s.consecutiveFailures = 0
  } else {
    s.consecutiveFailures = Math.max(s.consecutiveFailures, 1)
  }
}

export async function probeVisionHealth() {
  const legacy = process.env.PRODUCTION_VISION_ENGINE === 'legacy'
  // The production fault must probe the service production actually uses. The V2
  // identity endpoint is fast and camera-independent; a camera readiness failure
  // must not be reported as a lost network connection.
  const url = legacy
    ? `${visionBaseFromEnv()}/api/remote/info`
    : `${getRealtimeInspectionBaseUrl()}/app/identity`
  const headers = legacy ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' }
  if (legacy) {
    const remoteKey = visionRemoteKeyFromEnv()
    if (remoteKey) headers['X-Vision-Remote-Key'] = remoteKey
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    if (legacy) {
      // Preserve the legacy endpoint's auth behavior: any response below 500
      // confirms the Flask server is reachable.
      if (res.status >= 500) return { ok: false, error: `HTTP ${res.status}` }
      return { ok: true }
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const identity = await res.json()
    if (identity?.app !== 'realtime-inspection-app') {
      return { ok: false, error: 'Unexpected inspection service identity' }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

async function probeTcpSubsystem(probeFn, pingFn, setReachableFn) {
  const probe = await probeFn()
  if (!probe.ok) {
    setReachableFn(false)
    return { ok: false, error: probe.error || 'TCP probe failed' }
  }
  try {
    const pong = await pingFn()
    if (!pong) {
      setReachableFn(false)
      return { ok: false, error: 'PING/STATUS failed' }
    }
    setReachableFn(true)
    return { ok: true }
  } catch (e) {
    setReachableFn(false)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Centring slave is one-client (Double_Actuator TCP_MASTER_SLAVE.md).
 * Health uses healthProbeCentring — skips app PING while productionTcpHold is on.
 */
async function probeCentringHealth() {
  return healthProbeCentring()
}

function applyResult(key, result) {
  const s = _state[key]
  const now = Date.now()
  const wasReachable = s.reachable
  if (result.ok) {
    s.reachable = true
    s.lastOk = now
    s.lastError = null
    s.consecutiveFailures = 0
    s.reconnecting = false
    return { edge: !wasReachable ? 'up' : null }
  }
  s.consecutiveFailures += 1
  s.lastError = result.error || 'unreachable'
  const threshold = Number(process.env.COMM_FAILURE_THRESHOLD || 3)
  if (s.consecutiveFailures >= threshold) {
    s.reachable = false
  }
  return { edge: wasReachable && !s.reachable ? 'down' : null }
}

export function getTcpHealthSnapshot() {
  return {
    vision: { ..._state.vision },
    pickPlace: { ..._state.pickPlace },
    centring: { ..._state.centring },
  }
}

/** @returns {Promise<Array<{ key: string, edge: 'up'|'down' }>>} */
let pendingPoll = null

export function runTcpHealthPoll() {
  // Connect/retry can take longer than the supervisor interval. Share that
  // poll instead of accumulating probes and applying stale results later.
  if (pendingPoll) return pendingPoll
  pendingPoll = pollTcpHealth().finally(() => { pendingPoll = null })
  return pendingPoll
}

async function pollTcpHealth() {
  const edges = []
  const visionRes = await probeVisionHealth()
  const vEdge = applyResult('vision', visionRes)
  if (vEdge.edge) edges.push({ key: 'vision', edge: vEdge.edge, error: _state.vision.lastError })

  if (!isSetupInProgress()) {
    // The poll may have started while setup was idle, then spent several
    // seconds probing vision. Re-check before touching either one-client
    // motion controller so setup cannot be entered between this block's
    // initial guard and a centring HOME/SEEK command.
    if (isSetupInProgress()) return edges
    // Pick & Place Nano is one-client (same as centring) — never open a second
    // TCP connect for health while production holds the long-lived session.
    const ppRes = await healthProbePickPlace()
    const ppEdge = applyResult('pickPlace', ppRes)
    if (ppEdge.edge) edges.push({ key: 'pickPlace', edge: ppEdge.edge, error: _state.pickPlace.lastError })
    if (ppRes.ok) setPickPlaceReachable(true)

    // Setup may begin while the pick-place probe is in flight. Do not let the
    // slower centring probe open/reuse the shared socket after that transition.
    if (isSetupInProgress()) return edges
    const ceRes = await probeCentringHealth()
    // #region agent log
    fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',hypothesisId:'E',location:'tcpSubsystemHealth.mjs:runTcpHealthPoll',message:'centring health poll result',data:{ok:ceRes.ok,error:ceRes.error||null,skipped:ceRes.skipped||false,reason:ceRes.reason||null,consecutive:_state.centring.consecutiveFailures,reachable:_state.centring.reachable},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    // #region agent log
    if (!ceRes.ok) {
      fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ee2fa'},body:JSON.stringify({sessionId:'1ee2fa',runId:'init-55',hypothesisId:'A',location:'tcpSubsystemHealth.mjs:runTcpHealthPoll',message:'centring health poll FAIL',data:{ok:false,error:ceRes.error||null,skipped:ceRes.skipped||false,consecutive:_state.centring.consecutiveFailures,reachable:_state.centring.reachable,target:'192.168.10.55:8177'},timestamp:Date.now()})}).catch(()=>{})
    }
    // #endregion
    const ceEdge = applyResult('centring', ceRes)
    if (ceEdge.edge) edges.push({ key: 'centring', edge: ceEdge.edge, error: _state.centring.lastError })
    if (ceRes.ok && !ceRes.skipped) {
      try {
        const st = await centringStatus()
        // A failed fresh read invalidates the old posture, even while health
        // debounce still considers the TCP connection reachable.
        setCachedCentringStatus(st)
      } catch {
        setCachedCentringStatus(null)
      }
    } else {
      // A moving controller or a failed probe cannot confirm an old idle pose.
      setCachedCentringStatus(null)
    }
  }

  return edges
}
