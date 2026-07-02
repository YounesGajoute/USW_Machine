#!/usr/bin/env node
/**
 * Optional hardware smoke tests — TCP to Nano and/or serial (centring_nano_motor).
 * Skips gracefully when hardware unreachable.
 *
 * Env: CENTRING_HOST, CENTRING_PORT, CENTRING_SERIAL_PORT (default COM4)
 */
import { spawnSync } from 'child_process'
import net from 'net'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOST = process.env.CENTRING_HOST || '192.168.10.55'
const PORT = Number(process.env.CENTRING_PORT || 8177)
const SERIAL = process.env.CENTRING_SERIAL_PORT || 'COM4'
const TIMEOUT = 8000

let pass = 0
let fail = 0
let skip = 0

function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function skipTest(name, reason) {
  skip++
  console.log(`SKIP: ${name} — ${reason}`)
}

function tcpLine(cmd, expectPrefix, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket()
    let buf = ''
    let done = false
    const finish = (fn, v) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { sock.destroy() } catch { /* ignore */ }
      fn(v)
    }
    const timer = setTimeout(() => finish(reject, new Error('timeout')), timeoutMs)
    sock.on('error', err => finish(reject, err))
    sock.on('data', chunk => {
      buf += chunk.toString('ascii')
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '').trim()
        buf = buf.slice(nl + 1)
        if (line.startsWith('ERR') && !expectPrefix.startsWith('ERR')) {
          finish(reject, new Error(line))
          return
        }
        if (line.startsWith(expectPrefix) || (expectPrefix === 'ANY' && line)) {
          finish(resolve, line)
          return
        }
      }
    })
    sock.connect(PORT, HOST, () => {
      sock.write(cmd + '\n')
    })
  })
}

function parseKv(line) {
  const out = {}
  for (const part of line.split(/\s+/)) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return out
}

async function testTcp() {
  console.log(`\n[TCP ${HOST}:${PORT}]`)
  try {
    const pong = await tcpLine('PING', 'PONG', 3000)
    check('PING → PONG', pong === 'PONG')

    const stLine = await tcpLine('STATUS', 'u=')
    const st = parseKv(stLine)
    check('STATUS has h', st.h != null)
    check('STATUS has hmin/hmax', st.hmin != null && st.hmax != null)
    check('STATUS has mechOff', st.mechOff != null, JSON.stringify(Object.keys(st)))

    const offBefore = Number(st.mechOff)
    const okSet = await tcpLine('SETMECHOFF -1.5', 'OK SETMECHOFF')
    check('SETMECHOFF reply', okSet === 'OK SETMECHOFF')

    const st2Line = await tcpLine('STATUS', 'u=')
    const st2 = parseKv(st2Line)
    check('mechOff updated', Math.abs(Number(st2.mechOff) + 1.5) < 0.05, st2.mechOff)
    const hmin2 = Number(st2.hmin)
    const hmax2 = Number(st2.hmax)
    check('hmin shifted with offset', Math.abs(hmin2 - (Number(st.hmin) - 1.5)) < 0.15)
    check('hmax shifted with offset', Math.abs(hmax2 - (Number(st.hmax) - 1.5)) < 0.15)

    await tcpLine(`SETMECHOFF ${offBefore}`, 'OK SETMECHOFF')
    check('SETMECHOFF restore', true)

    if (st2.busy === '0' && st2.fault === '0' && st2.estop === '0') {
      try {
        const errLine = await tcpLine('SETMECHOFF abc', 'ERR', 3000)
        check('SETMECHOFF bad args → ERR', errLine.startsWith('ERR SETMECHOFF'))
      } catch (e) {
        check('SETMECHOFF bad args → ERR', String(e.message).includes('ERR SETMECHOFF'))
      }
    }
  } catch (err) {
    skipTest('TCP suite', err.message)
  }
}

function testSerial() {
  console.log(`\n[Serial ${SERIAL}]`)
  const py = process.platform === 'win32' ? 'py' : 'python3'
  const script = path.join(__dirname, 'serial_cmd.py')

  function run(args, label) {
    const r = spawnSync(py, [script, ...args], {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, CENTRING_SERIAL_PORT: SERIAL },
    })
    if (r.error?.code === 'ETIMEDOUT') return { ok: false, err: 'timeout' }
    const out = (r.stdout || '') + (r.stderr || '')
    if (/could not open port|FileNotFoundError|Access is denied|COM\d+.*not/i.test(out)) {
      return { ok: false, err: out.split('\n')[0] }
    }
    return { ok: r.status === 0, out, status: r.status }
  }

  const ping = run(['PING'], 'PING')
  if (!ping.ok) {
    skipTest('Serial suite', ping.err || `exit ${ping.status}`)
    return
  }
  check('serial PING', /PONG/.test(ping.out))

  const st = run(['STATUS'], 'STATUS')
  check('serial STATUS', st.ok && /mechOff=/.test(st.out), st.out?.slice(0, 120))

  const set = run(['SETMECHOFF', '0.5'], 'SETMECHOFF')
  check('serial SETMECHOFF', set.ok && /OK SETMECHOFF/.test(set.out))

  const st2 = run(['STATUS'], 'STATUS after offset')
  const m = st2.out?.match(/mechOff=([-\d.]+)/)
  check('serial mechOff readback', m && Math.abs(Number(m[1]) - 0.5) < 0.05, m?.[1])

  run(['SETMECHOFF', '0'], 'restore')
}

console.log('Centring hardware smoke tests (optional)')
await testTcp()
testSerial()

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed, ${skip} skipped`)
process.exit(fail ? 1 : 0)
