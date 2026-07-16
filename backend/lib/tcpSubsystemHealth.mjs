/**
 * Periodic health probes for eth0 TCP subsystems — imports firmware masters only.
 */
import { visionBaseFromEnv, visionRemoteKeyFromEnv } from './visionConfig.mjs'
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

/** Last centring STATUS from health poll (best-effort, may be null). */
export function getCachedCentringStatus() {
  return _lastCentringStatus ? { ..._lastCentringStatus } : null
}

/**
 * Publish a fresh centring STATUS into the enqueue-gate cache.
 * Call after setup/homing/restore so Start is not blocked on a stale park posture.
 * A successful STATUS also marks the TCP health row reachable.
 * @param {Awaited<ReturnType<typeof centringStatus>> | null | undefined} status
 */
export function setCachedCentringStatus(status) {
  _lastCentringStatus = status ? { ...status } : null
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

async function probeVision() {
  // Reachability probe hits /api/remote/info, not /api/health: on the vision Pi the
  // /api/health handler can block (camera-bound) and hang the probe, while /remote/info
  // is a fast, canonical connectivity + remote-auth endpoint. Any HTTP response < 500
  // means the Flask server is up and reachable.
  const base = visionBaseFromEnv()
  const url = `${base}/api/remote/info`
  const remoteKey = visionRemoteKeyFromEnv()
  const headers = { 'Content-Type': 'application/json' }
  if (remoteKey) headers['X-Vision-Remote-Key'] = remoteKey
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    if (res.status >= 500) return { ok: false, error: `HTTP ${res.status}` }
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
export async function runTcpHealthPoll() {
  const edges = []
  const visionRes = await probeVision()
  const vEdge = applyResult('vision', visionRes)
  if (vEdge.edge) edges.push({ key: 'vision', edge: vEdge.edge, error: _state.vision.lastError })

  if (!isSetupInProgress()) {
    // Pick & Place Nano is one-client (same as centring) — never open a second
    // TCP connect for health while production holds the long-lived session.
    const ppRes = await healthProbePickPlace()
    const ppEdge = applyResult('pickPlace', ppRes)
    if (ppEdge.edge) edges.push({ key: 'pickPlace', edge: ppEdge.edge, error: _state.pickPlace.lastError })
    if (ppRes.ok) setPickPlaceReachable(true)

    const ceRes = await probeCentringHealth()
    const ceEdge = applyResult('centring', ceRes)
    if (ceEdge.edge) edges.push({ key: 'centring', edge: ceEdge.edge, error: _state.centring.lastError })
    if (ceRes.ok) {
      try {
        const st = await centringStatus()
        // status() returns null on failure — never wipe a good cache.
        if (st) {
          _lastCentringStatus = st
        }
      } catch {
        /* status read failed — keep previous cache */
      }
    }
  }

  return edges
}
