/**
 * EtherCAT bridge health — auto-reconnect with backoff; lifecycle sync on disconnect.
 */
import { getEtherCATManager } from './ethercat.mjs'
import {
  ensureEtherCAT,
  clearEtherCATInitPromise,
  shutdownEtherCATMonitors,
} from './lifter.mjs'
import { onEtherCATDisconnected } from './machineLifecycle.mjs'
import { recordError } from './historyStore.mjs'
import { classifyActiveFault, faultToErrorRecord, FAULT_CODE } from './faultClassifier.mjs'

let _reconnectTimer = null
let _reconnecting = false
let _healthFailures = 0
let _autoReconnectDisabled = false
let _wired = false

const DEFAULT_MIN_MS = 1000
const DEFAULT_MAX_MS = Number(process.env.ETHERCAT_RECONNECT_MAX_BACKOFF_MS || 30000)

function envAutoReconnect() {
  const v = process.env.ETHERCAT_AUTO_RECONNECT
  if (v === undefined || v === null) return true
  const s = String(v).trim().toLowerCase()
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false
  return true
}

function ethercatSubsystemState() {
  return { reachable: false, lastOk: null, lastError: null, consecutiveFailures: 0, reconnecting: false }
}

let _snapshot = ethercatSubsystemState()
let _backoffMs = DEFAULT_MIN_MS

export function getEthercatHealthSnapshot() {
  const ecm = getEtherCATManager()
  const st = ecm.getStatus()
  return {
    ..._snapshot,
    bridgeRunning: st.bridgeRunning,
    slaveOp: st.initialized,
  }
}

function scheduleReconnect(reason) {
  if (_autoReconnectDisabled || !envAutoReconnect()) return
  if (_reconnectTimer) return
  _snapshot.reconnecting = true
  const delay = _backoffMs
  _backoffMs = Math.min(_backoffMs * 2, DEFAULT_MAX_MS)
  console.warn(`[ethercat-health] Reconnect in ${delay}ms (${reason})`)
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null
    attemptReconnect().catch((e) => {
      console.warn(`[ethercat-health] Reconnect attempt failed: ${e.message}`)
      scheduleReconnect('retry')
    })
  }, delay)
  _reconnectTimer.unref?.()
}

async function attemptReconnect() {
  if (_reconnecting) return
  _reconnecting = true
  try {
    clearEtherCATInitPromise()
    await ensureEtherCAT()
    _backoffMs = DEFAULT_MIN_MS
    _healthFailures = 0
    _snapshot.reachable = true
    _snapshot.lastOk = Date.now()
    _snapshot.lastError = null
    _snapshot.consecutiveFailures = 0
    _snapshot.reconnecting = false
    console.log('[ethercat-health] EtherCAT reconnected')
  } finally {
    _reconnecting = false
  }
}

function logDisconnect(message, context = {}) {
  const fault = classifyActiveFault({ connected: false })
  const record = faultToErrorRecord(fault)
  if (record) {
    recordError({ ...record, errorMessage: message, context: { ...record.context, ...context } })
  }
}

export function handleEtherCATDisconnect(code, reason = 'bridge exit') {
  const ecm = getEtherCATManager()
  if (!ecm.isInitialized && !_snapshot.reachable && _snapshot.reconnecting) return
  shutdownEtherCATMonitors()
  _snapshot.reachable = false
  _snapshot.reconnecting = true
  _snapshot.lastError = reason
  _healthFailures = 0
  logDisconnect(`EtherCAT disconnected (${reason})`, { code })
  onEtherCATDisconnected()
  scheduleReconnect(reason)
}

export function handleEtherCATHealthWarning(result) {
  _healthFailures += 1
  const threshold = Number(process.env.COMM_FAILURE_THRESHOLD || 3)
  _snapshot.consecutiveFailures = _healthFailures
  _snapshot.lastError = result?.error || 'health ping failed'
  if (_healthFailures >= threshold && getEtherCATManager().isInitialized) {
    console.warn('[ethercat-health] Health threshold exceeded — treating as disconnect')
    getEtherCATManager().cleanup().catch(() => {})
    handleEtherCATDisconnect(null, _snapshot.lastError)
  }
}

export function noteEtherCATHealthy() {
  _healthFailures = 0
  _snapshot.reachable = true
  _snapshot.lastOk = Date.now()
  _snapshot.lastError = null
  _snapshot.consecutiveFailures = 0
  _snapshot.reconnecting = false
  _backoffMs = DEFAULT_MIN_MS
}

export function startEtherCATHealth() {
  if (_wired) return
  _wired = true
  _autoReconnectDisabled = false
  const ecm = getEtherCATManager()
  ecm.on('disconnected', (code) => handleEtherCATDisconnect(code, `bridge exit code ${code}`))
  ecm.on('health_warning', (result) => handleEtherCATHealthWarning(result))
  ecm.on('connected', () => noteEtherCATHealthy())
  if (ecm.isInitialized) noteEtherCATHealthy()
}

export function stopEtherCATHealth() {
  _autoReconnectDisabled = true
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }
  _snapshot.reconnecting = false
}

export async function bootEtherCATWithReconnect() {
  startEtherCATHealth()
  if (!envAutoReconnect()) {
    try {
      await ensureEtherCAT()
      noteEtherCATHealthy()
    } catch (e) {
      console.warn(`[ethercat-health] Boot connect failed: ${e.message}`)
    }
    return
  }
  try {
    await ensureEtherCAT()
    noteEtherCATHealthy()
  } catch (e) {
    console.warn(`[ethercat-health] Boot connect failed: ${e.message}`)
    scheduleReconnect('boot failure')
  }
}
