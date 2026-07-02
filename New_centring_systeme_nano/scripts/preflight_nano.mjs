#!/usr/bin/env node
/**
 * Network + TCP preflight before sending master commands to the Centring Nano.
 *
 * Usage:
 *   node scripts/preflight_nano.mjs
 *   CENTRING_HOST=192.168.10.55 node scripts/preflight_nano.mjs
 */
import net from 'net'
import {
  buildConnectionDiagnosis,
  formatDiagnosisReport,
  NANO_IP_DEFAULT,
  NANO_PORT_DEFAULT,
  subnetReachable,
} from '../master/lib/network_diag.mjs'

const HOST = process.env.CENTRING_HOST || NANO_IP_DEFAULT
const PORT = Number(process.env.CENTRING_PORT || NANO_PORT_DEFAULT)
const TIMEOUT_MS = Number(process.env.CENTRING_CONNECT_TIMEOUT_MS || 5000)

function probeTcp(host, port, timeoutMs) {
  return new Promise(resolve => {
    const sock = new net.Socket()
    const timer = setTimeout(() => {
      sock.destroy()
      resolve({ ok: false, error: 'timeout' })
    }, timeoutMs)
    sock.once('error', err => {
      clearTimeout(timer)
      sock.destroy()
      resolve({ ok: false, error: err.message })
    })
    sock.connect(port, host, () => {
      clearTimeout(timer)
      sock.end()
      resolve({ ok: true })
    })
  })
}

console.log(`=== Centring Nano preflight → ${HOST}:${PORT} ===\n`)

const subnet = subnetReachable(HOST)
if (subnet.ok) {
  console.log(`Subnet: OK — ${subnet.localIp} (${subnet.iface}) is on 192.168.10.0/24`)
} else {
  console.log('Subnet: FAIL — this PC is not on 192.168.10.0/24')
  for (const i of subnet.localIps) console.log(`  ${i.address}  (${i.name})`)
  console.log('')
}

let probe = { ok: false, error: 'skipped (subnet mismatch)' }
if (subnet.ok) {
  process.stdout.write(`TCP probe ${HOST}:${PORT} ... `)
  probe = await probeTcp(HOST, PORT, TIMEOUT_MS)
  console.log(probe.ok ? 'OK' : `FAIL (${probe.error})`)
} else {
  console.log('TCP probe skipped — fix subnet first.')
}

const diag = buildConnectionDiagnosis(HOST, PORT, probe, subnet)
if (!diag.ok) {
  console.log('')
  console.log(formatDiagnosisReport(diag))
} else {
  console.log(`\nAll checks passed — ${diag.localIp} → ${diag.target}`)
  console.log('\nWire test: .\\scripts\\tcp_test.ps1 -Cmd PING')
}

process.exit(diag.ok ? 0 : 1)
