/**
 * Lifecycle-independent communication supervisor — polls all subsystems at boot.
 */
import { runTcpHealthPoll, getTcpHealthSnapshot } from './tcpSubsystemHealth.mjs'
import { getEthercatHealthSnapshot, startEtherCATHealth, stopEtherCATHealth, bootEtherCATWithReconnect } from './ethercatHealth.mjs'
import { recordError } from './historyStore.mjs'
import { FAULT_CODE } from './faultClassifier.mjs'

let _timer = null
let _running = false

const EDGE_FAULT = {
  vision: FAULT_CODE.VISION_UNREACHABLE,
  pickPlace: FAULT_CODE.PICK_PLACE_UNREACHABLE,
  centring: FAULT_CODE.CENTRING_UNREACHABLE,
}

function logEdge(edge) {
  const code = EDGE_FAULT[edge.key] || edge.key
  const msg = edge.edge === 'down'
    ? `${edge.key} unreachable: ${edge.error || code}`
    : `${edge.key} reachable again`
  console.log(`[comm-supervisor] ${msg}`)
  if (edge.edge === 'down') {
    recordError({
      errorCode: code,
      errorMessage: msg,
      severity: 'critical',
      phase: 'connectivity',
      context: { subsystem: edge.key },
    })
  }
}

export function getConnectivitySnapshot() {
  const tcp = getTcpHealthSnapshot()
  const ethercat = getEthercatHealthSnapshot()
  return {
    vision: tcp.vision,
    pickPlace: tcp.pickPlace,
    centring: tcp.centring,
    ethercat,
  }
}

async function tick() {
  if (!_running) return
  try {
    const edges = await runTcpHealthPoll()
    for (const e of edges) logEdge(e)
  } catch (err) {
    console.warn(`[comm-supervisor] poll error: ${err.message}`)
  }
}

export function startCommunicationSupervisor() {
  if (_running) return
  _running = true
  startEtherCATHealth()
  const interval = Number(process.env.COMM_HEALTH_INTERVAL_MS || 5000)
  _timer = setInterval(() => { tick().catch(() => {}) }, interval)
  _timer.unref?.()
  tick().catch(() => {})
  console.log(`[comm-supervisor] Started (interval ${interval}ms)`)
}

export function stopCommunicationSupervisor() {
  _running = false
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
  stopEtherCATHealth()
  console.log('[comm-supervisor] Stopped')
}

export { bootEtherCATWithReconnect }
