/**
 * Live check: Double_Actuator centring master TCP session
 * (TCP_MASTER_SLAVE.md / MASTER_CONTROL.md).
 *
 * Non-destructive when already cal=1: PING/STATUS/ensureReady.
 * Verifies persistent one-client session reuse + reconnect with cal restore.
 *
 *   node backend/scripts/check-centring-tcp-session.mjs
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBackendEnv } from '../lib/loadBackendEnv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadBackendEnv(path.join(__dirname, '..', '.env'))

const {
  connectWithRetry,
  ping,
  status,
  ensureReady,
  hasOpenSession,
  getCentringTcpSessionInfo,
  getConnectionInfo,
  emergencyStop,
} = await import('../lib/centring.mjs')

function ssPorts() {
  try {
    const out = execSync('ss -tn state established', { encoding: 'utf8' })
    const ports = []
    for (const line of out.split('\n')) {
      if (!line.includes('192.168.10.55:8177')) continue
      const parts = line.trim().split(/\s+/)
      const local = parts[parts.length - 2] || ''
      const m = local.match(/:(\d+)$/)
      if (m) ports.push(Number(m[1]))
    }
    return [...new Set(ports)].sort((a, b) => a - b)
  } catch {
    return []
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('=== Centring TCP session check (Double_Actuator) ===\n')
console.log('target', getConnectionInfo().target)
console.log('protocol', getConnectionInfo().protocol)

// Phase 1 — open persistent session + multi-cmd reuse
await connectWithRetry()
const info1 = getCentringTcpSessionInfo()
const ports1 = ssPorts()
console.log('[1] after connectWithRetry', info1, 'ssPorts', ports1)
assert(hasOpenSession(), 'session should be open')
assert(info1.openCount === 1, `expected openCount=1 got ${info1.openCount}`)
assert(ports1.length === 1, `expected exactly 1 ESTABLISHED to :8177, got ${ports1.length}`)

const p1 = await ping()
const p2 = await ping()
const st = await status()
const info2 = getCentringTcpSessionInfo()
const ports2 = ssPorts()
console.log('[2] after 2xPING+STATUS', {
  p1, p2, h: st?.h, cal: st?.cal, estop: st?.estop, reason: st?.reason,
}, info2, 'ssPorts', ports2)
assert(p1 && p2, 'PINGs must succeed')
assert(st && st.accepted !== false, 'STATUS must succeed')
assert(st.cal === true, 'STATUS cal must be 1 after connectWithRetry/SETCAL')
assert(st.estop === false, 'STATUS estop must be 0')
assert(info2.openCount === 1, `session must be reused (openCount still 1), got ${info2.openCount}`)
assert(info2.sendCmdCount >= 3, `expected >=3 cmds on same socket, got ${info2.sendCmdCount}`)
assert(ports2.length === 1 && ports2[0] === ports1[0], 'local TCP port must stay the same across cmds')
assert(info2.localPort === ports2[0], 'session localPort must match ss')

// Phase 2 — ensureReady must keep cal=1 without tearing session
const ready = await ensureReady()
const info3 = getCentringTcpSessionInfo()
console.log('[3] ensureReady', {
  cal: ready.cal,
  estop: ready.estop,
  lastCmd: ready.lastCmd,
  openCount: info3.openCount,
})
assert(ready.cal === true, 'ensureReady must leave cal=1')
assert(ready.estop === false, 'ensureReady must leave estop=0')
assert(info3.openCount === 1, 'ensureReady must not open a new socket')

// Phase 3 — reconnect: SETCAL restores cal when RAM cleared / reconnect
await emergencyStop()
assert(!hasOpenSession(), 'session closed')
await connectWithRetry()
const afterReconnect = await status()
const info4 = getCentringTcpSessionInfo()
const ports4 = ssPorts()
console.log('[4] after reconnect', {
  h: afterReconnect?.h,
  cal: afterReconnect?.cal,
  estop: afterReconnect?.estop,
  openCount: info4.openCount,
  ssPorts: ports4,
})
assert(info4.openCount === 2, `reconnect should open exactly one new socket (openCount=2), got ${info4.openCount}`)
assert(ports4.length === 1, 'still one ESTABLISHED after reconnect')
assert(afterReconnect?.cal === true, 'cal=1 must be restored after TCP reconnect (SETCAL)')
assert(afterReconnect?.estop === false, 'estop must be clear after reconnect')
assert(Number.isFinite(afterReconnect?.h) || afterReconnect?.cal === true, 'h or cal present after reconnect')

console.log('\nPASS — Double_Actuator persistent TCP session matches production contract\n')
await emergencyStop()
process.exit(0)
