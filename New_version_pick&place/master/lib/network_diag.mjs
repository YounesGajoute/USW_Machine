/**
 * Pick-place Nano network preflight — subnet + TCP reachability.
 */
import os from 'os'
import { execSync } from 'child_process'

export const NANO_IP_DEFAULT = '192.168.10.5'
export const NANO_PORT_DEFAULT = 8177
const MACHINE_SUBNET = '192.168.10.'

function listLocalIps() {
  const out = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        out.push({ name, address: a.address, cidr: a.cidr })
      }
    }
  }
  return out
}

/** True when this host has an IPv4 on 192.168.10.0/24. */
export function subnetReachable(targetHost = NANO_IP_DEFAULT) {
  const prefix = targetHost.split('.').slice(0, 3).join('.') + '.'
  const localIps = listLocalIps()
  const match = localIps.find(i => i.address.startsWith(prefix) || i.address.startsWith(MACHINE_SUBNET))
  if (match) {
    return { ok: true, localIp: match.address, iface: match.name, localIps }
  }
  return { ok: false, localIps }
}

export function buildConnectionDiagnosis(host, port, probe, subnet = subnetReachable(host)) {
  const target = `${host}:${port}`
  const tcpOk = !!probe?.ok
  const subnetOk = !!subnet?.ok
  const ok = subnetOk && tcpOk
  return {
    ok,
    subnetOk,
    tcpOk,
    host,
    port,
    target,
    localIp: subnet.localIp || null,
    iface: subnet.iface || null,
    probeError: probe?.error || null,
    report: formatDiagnosisReport({
      ok,
      subnetOk,
      tcpOk,
      target,
      localIp: subnet.localIp,
      iface: subnet.iface,
      localIps: subnet.localIps,
      probeError: probe?.error,
    }),
  }
}

export function formatDiagnosisReport(diag) {
  const lines = []
  lines.push(`Target: ${diag.target}`)
  if (diag.subnetOk) {
    lines.push(`Subnet OK — ${diag.localIp} (${diag.iface}) on machine LAN`)
  } else {
    lines.push('Subnet FAIL — no interface on 192.168.10.0/24')
    for (const i of diag.localIps || []) {
      lines.push(`  ${i.address} (${i.name})`)
    }
  }
  if (diag.tcpOk) {
    lines.push(`TCP OK — port ${diag.target.split(':')[1]} reachable`)
  } else {
    lines.push(`TCP FAIL — ${diag.probeError || 'unreachable'}`)
    try {
      const ping = execSync(`ping -c 1 -W 2 ${diag.target.split(':')[0]} 2>&1`, { encoding: 'utf8' })
      if (/1 received|1 packets received/i.test(ping)) {
        lines.push('ICMP ping succeeded — check Nano TCP server on :8177')
      }
    } catch { /* ignore */ }
  }
  if (!diag.ok) {
    lines.push('')
    lines.push('Fix: bot eth0 = 192.168.10.1/24, Nano = 192.168.10.5, ENC28J60 cable + power')
  }
  return lines.join('\n')
}
