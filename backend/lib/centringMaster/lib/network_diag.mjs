/**
 * Centring Nano network preflight — subnet + TCP reachability.
 *
 * Prefer the dedicated machine LAN (end0 / 192.168.10.1). Never prefer wlan0 when
 * Wi‑Fi is wrongly DHCP'd onto 192.168.10.0/24 (architecture: wlan = internet only).
 */
import os from 'os'
import { execSync } from 'child_process'

export const NANO_IP_DEFAULT = '192.168.10.55'
export const NANO_PORT_DEFAULT = 8177
const MACHINE_SUBNET = '192.168.10.'
const MACHINE_LAN_MASTER = '192.168.10.1'

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

function isWifiOrVpn(name) {
  const n = String(name || '').toLowerCase()
  return (
    n.startsWith('wlan')
    || n.startsWith('wl')
    || n.includes('tailscale')
    || n.startsWith('tun')
    || n.startsWith('wwan')
  )
}

function isWiredLan(name) {
  const n = String(name || '').toLowerCase()
  return (
    n === 'end0'
    || n.startsWith('end')
    || n === 'eth0'
    || n.startsWith('enx')
    || n.startsWith('enp')
    || n.startsWith('eno')
  )
}

/**
 * Pick the IPv4 to bind Nano TCP clients to (source address on machine LAN).
 * @param {string} [targetHost]
 * @param {string} [envLocal] explicit override (CENTRING_LOCAL_ADDRESS / MACHINE_LAN_LOCAL_ADDRESS)
 */
export function pickMachineLanIp(targetHost = NANO_IP_DEFAULT, envLocal) {
  const localIps = listLocalIps()
  const override = typeof envLocal === 'string' ? envLocal.trim() : ''
  if (override) {
    return { ok: true, localIp: override, iface: 'env', localIps, preferred: true, wifiSameSubnet: false }
  }
  const prefix = String(targetHost || NANO_IP_DEFAULT).split('.').slice(0, 3).join('.') + '.'
  const onSubnet = localIps.filter(
    (i) => i.address.startsWith(prefix) || i.address.startsWith(MACHINE_SUBNET),
  )
  const wifiSameSubnet = onSubnet.some((i) => isWifiOrVpn(i.name))
  const wired = onSubnet.find((i) => isWiredLan(i.name))
  if (wired) {
    return { ok: true, localIp: wired.address, iface: wired.name, localIps, preferred: true, wifiSameSubnet }
  }
  const master = onSubnet.find((i) => i.address === MACHINE_LAN_MASTER)
  if (master) {
    return { ok: true, localIp: master.address, iface: master.name, localIps, preferred: true, wifiSameSubnet }
  }
  const nonWifi = onSubnet.find((i) => !isWifiOrVpn(i.name))
  if (nonWifi) {
    return { ok: true, localIp: nonWifi.address, iface: nonWifi.name, localIps, preferred: true, wifiSameSubnet }
  }
  if (onSubnet[0]) {
    return {
      ok: true,
      localIp: onSubnet[0].address,
      iface: onSubnet[0].name,
      localIps,
      preferred: false,
      wifiSameSubnet,
    }
  }
  return { ok: false, localIps, wifiSameSubnet: false }
}

/** True when this host has an IPv4 on the machine LAN — wired preferred over wlan. */
export function subnetReachable(targetHost = NANO_IP_DEFAULT) {
  return pickMachineLanIp(
    targetHost,
    process.env.CENTRING_LOCAL_ADDRESS || process.env.MACHINE_LAN_LOCAL_ADDRESS,
  )
}

/**
 * Source address for net.Socket.connect (undefined → OS default route selection).
 * @param {string} [targetHost]
 * @param {string} [envKey]
 */
export function resolveTcpLocalAddress(targetHost = NANO_IP_DEFAULT, envKey = 'CENTRING_LOCAL_ADDRESS') {
  const picked = pickMachineLanIp(
    targetHost,
    process.env[envKey] || process.env.MACHINE_LAN_LOCAL_ADDRESS,
  )
  return picked.ok ? picked.localIp : undefined
}

export function buildConnectionDiagnosis(host, port, probe, subnet = subnetReachable(host)) {
  const target = `${host}:${port}`
  const tcpOk = !!probe?.ok
  const subnetOk = !!subnet?.ok
  const ok = subnetOk && tcpOk
  return {
    ok, subnetOk, tcpOk, host, port, target,
    localIp: subnet.localIp || null,
    iface: subnet.iface || null,
    wifiSameSubnet: !!subnet.wifiSameSubnet,
    probeError: probe?.error || null,
    report: formatDiagnosisReport({
      ok, subnetOk, tcpOk, target,
      localIp: subnet.localIp, iface: subnet.iface,
      localIps: subnet.localIps, probeError: probe?.error,
      wifiSameSubnet: subnet.wifiSameSubnet,
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
    for (const i of diag.localIps || []) lines.push(`  ${i.address} (${i.name})`)
  }
  if (diag.wifiSameSubnet) {
    lines.push(
      'WARN — wlan0 also has 192.168.10.x (conflicts with machine LAN). '
        + 'Move Wi‑Fi to a different subnet (architecture: internet only, e.g. 192.168.1.x).',
    )
  }
  if (diag.tcpOk) {
    lines.push(`TCP OK — port ${diag.target.split(':')[1]} reachable`)
  } else {
    lines.push(`TCP FAIL — ${diag.probeError || 'unreachable'}`)
    try {
      const ping = execSync(`ping -c 1 -W 2 ${diag.target.split(':')[0]} 2>&1`, { encoding: 'utf8' })
      if (/1 received|1 packets received/i.test(ping)) {
        lines.push('ICMP ping succeeded — check centring Nano TCP server on :8177')
      }
    } catch { /* ignore */ }
  }
  if (!diag.ok) {
    lines.push('')
    lines.push('Fix: bot end0 = 192.168.10.1/24, centring Nano = 192.168.10.55, ENC28J60 cable + power')
  }
  return lines.join('\n')
}
