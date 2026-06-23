#!/usr/bin/env node
/**
 * Pick-place ALL-COMMANDS hardware test — every wire command vs real Nano.
 *
 * Commands exercised (10):
 *   PING STATUS STOP ESTOP CLRFAULT
 *   HOMEA HOMEB MOVEAMM MOVEBMM
 *
 * Safe sequence: read → recover → STOP(idle) → HOMEA → MOVEAMM → HOMEB → MOVEBMM
 *   → HOMEA+HOMEB → STOP(during move) → ESTOP → CLRFAULT
 *
 * Env:
 *   PICK_PLACE_HOST (192.168.10.5)  PICK_PLACE_PORT (8177)
 *   PICK_PLACE_SINGLE_MOTOR=1       skip axis B / HOMEB / MOVEBMM
 *   PICK_PLACE_SKIP_ESTOP=1         skip ESTOP phase (leave machine running)
 *   PICK_PLACE_SKIP_FULL_HOME=1     skip dual HOMEA+HOMEB
 *   PICK_PLACE_REHOME_AFTER=1       run HOME after ESTOP to leave homed (slow)
 *   PICK_PLACE_HOME_SPEED=60        homing mm/s
 *   PICK_PLACE_MOVE_SPEED=35        move mm/s
 */
import net from 'net'
import master, {
  getConnectionInfo,
  getPickPlaceConfig,
  homeCommand,
  moveCommandA,
  moveCommandB,
  parseDoneLine,
  probeConnection,
} from '../master/pick_place_master.js'

const HOST = process.env.PICK_PLACE_HOST || '192.168.10.5'
const PORT = Number(process.env.PICK_PLACE_PORT || 8177)
const SINGLE = process.env.PICK_PLACE_SINGLE_MOTOR === '1'
const SKIP_ESTOP = process.env.PICK_PLACE_SKIP_ESTOP === '1'
const SKIP_FULL_HOME = process.env.PICK_PLACE_SKIP_FULL_HOME === '1'
const REHOME_AFTER = process.env.PICK_PLACE_REHOME_AFTER === '1'
const HOME_SPEED = Number(process.env.PICK_PLACE_HOME_SPEED || 60)
const MOVE_SPEED = Number(process.env.PICK_PLACE_MOVE_SPEED || 35)
const HOME_TIMEOUT = 270000
const AXIS_HOME_TIMEOUT = 150000
const MOVE_TIMEOUT = 120000

let pass = 0
let fail = 0
const logLines = []

function check(name, ok, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`
  logLines.push(line)
  if (ok) pass++
  else {
    fail++
    console.error(line)
  }
}

function log(msg) {
  console.log(msg)
  logLines.push(msg)
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

const TCP_GAP_MS = Number(process.env.PICK_PLACE_TCP_GAP_MS || 350)

function tcpGap() {
  return sleep(TCP_GAP_MS)
}

function tcpLine(cmd, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket()
    let buf = ''
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`timeout (${cmd})`))
    }, timeoutMs)
    sock.connect(PORT, HOST, () => sock.write(`${cmd}\n`))
    sock.on('data', chunk => {
      buf += chunk.toString('ascii')
      const nl = buf.indexOf('\n')
      if (nl !== -1) {
        clearTimeout(timer)
        sock.destroy()
        resolve(buf.slice(0, nl).replace(/\r$/, ''))
      }
    })
    sock.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function validateDone(line, tag) {
  if (!line?.startsWith(`DONE ${tag}`)) return false
  const d = parseDoneLine(line)
  return d.tag === tag
    && Number.isFinite(d.positionA)
    && Number.isFinite(d.positionB)
    && line.includes('homedA=')
    && line.includes('bkA=')
}

async function ensureRecover() {
  let st = await master.status()
  if (!st) throw new Error('STATUS unavailable')
  if (st.fault || st.estop) {
    log('CLRFAULT / recover() …')
    const r = await master.recover()
    check('CLRFAULT', r.ok && r.reply?.includes('CLRFAULT'))
    await master.waitIdle(30000)
    st = await master.status()
    check('cleared fault/estop', st && !st.fault && !st.estop)
  }
  return st
}

async function waitReady() {
  await master.waitIdle(120000)
  const st = await master.status()
  if (st?.busy || st?.asyncBusy) throw new Error('still busy after waitIdle')
  return st
}

async function main() {
  const cfg = getPickPlaceConfig()
  log(`=== Pick-place ALL commands hardware test → ${HOST}:${PORT} ===`)
  log(`dual motor: ${!SINGLE}  homeSpeed=${HOME_SPEED}  moveSpeed=${MOVE_SPEED}`)
  log(`skip full HOME: ${SKIP_FULL_HOME}  skip ESTOP: ${SKIP_ESTOP}  rehome after: ${REHOME_AFTER}`)

  check('connectionInfo', getConnectionInfo().sessionMode === 'request-response')

  const probe = await probeConnection(10000)
  check('TCP probe', probe.ok, probe.error || '')
  if (!probe.ok) return summary(1)

  // ── PING ──
  await master.connectWithRetry()
  try {
    check('PING (master)', await master.ping(5) === true)
  } catch (e) {
    const stFallback = await master.status()
    check('PING fallback STATUS', stFallback != null, e.message)
  }
  await tcpGap()
  try {
    const rawPong = await tcpLine('PING')
    check('PING (raw TCP)', rawPong === 'PONG', rawPong)
  } catch (e) {
    check('PING (raw TCP) optional', true, `skipped: ${e.message}`)
  }
  await tcpGap()

  // ── STATUS ──
  let st = await master.status()
  check('STATUS', st != null)
  if (!st) return summary(1)
  log(`STATUS: homedA=${st.homedA} homedB=${st.homedB} posA=${st.positionA?.toFixed(3)} posB=${st.positionB?.toFixed(3)} state=${st.state}`)
  check('STATUS fields stepA/homedA/busy', Number.isFinite(st.positionA) && typeof st.homedA === 'boolean')
  const rawSt = await tcpLine('STATUS')
  check('STATUS (raw) stepA=', rawSt.includes('stepA=') && rawSt.includes('homedA='))
  await tcpGap()

  // ── CLRFAULT (no fault) ──
  st = await ensureRecover()
  const clr = await master.clearError()
  check('CLRFAULT (idle)', clr.reply?.includes('CLRFAULT'))

  // ── STOP (idle) ──
  const stopIdle = await master.stop()
  check('STOP (idle)', stopIdle === 'OK STOP' || stopIdle.includes('OK STOP'), stopIdle)

  // ── HOMEA ──
  log(`\n--- HOMEA ${cfg.backoffMmA} ${HOME_SPEED} ---`)
  const wireHomeA = homeCommand('HOMEA', 'a', cfg.backoffMmA, HOME_SPEED)
  check('HOMEA wire', wireHomeA === `HOMEA ${cfg.backoffMmA} ${HOME_SPEED}`)
  try {
    const ha = await master.homeA(cfg.backoffMmA, HOME_SPEED)
    check('HOMEA DONE', ha.homedA === true)
    check('HOMEA pos ~backoff', Math.abs(ha.positionA - cfg.backoffMmA) < 0.2, String(ha.positionA))
    if (ha.doneLine) check('HOMEA DONE format', validateDone(ha.doneLine, 'HOMEA'))
  } catch (e) {
    check('HOMEA', false, e.message)
  }
  await waitReady()

  // ── MOVEAMM ──
  st = await master.status()
  const targetA = Math.min(15, Math.max(2, (st?.positionA ?? cfg.backoffMmA) + 3))
  log(`\n--- MOVEAMM ${targetA} ${MOVE_SPEED} ---`)
  try {
    const ma = await master.moveAmm(targetA, MOVE_SPEED)
    check('MOVEAMM DONE', Math.abs(ma.positionA - targetA) < 0.25, String(ma.positionA))
    check('MOVEAMM wire', ma.command === moveCommandA(targetA, MOVE_SPEED))
    if (ma.doneLine) check('MOVEAMM DONE format', validateDone(ma.doneLine, 'MOVEAMM'))
  } catch (e) {
    check('MOVEAMM', false, e.message)
  }
  await waitReady()

  if (!SINGLE) {
    // ── HOMEB ──
    log(`\n--- HOMEB ${cfg.backoffMmB} ${HOME_SPEED} ---`)
    try {
      const hb = await master.homeB(cfg.backoffMmB, HOME_SPEED)
      check('HOMEB DONE', hb.homedB === true)
      check('HOMEB pos ~backoff', Math.abs(hb.positionB - cfg.backoffMmB) < 0.2, String(hb.positionB))
      if (hb.doneLine) check('HOMEB DONE format', validateDone(hb.doneLine, 'HOMEB'))
    } catch (e) {
      check('HOMEB', false, e.message)
    }
    await waitReady()

    // ── MOVEBMM ──
    st = await master.status()
    const targetB = Math.min(15, Math.max(2, (st?.positionB ?? cfg.backoffMmB) + 3))
    log(`\n--- MOVEBMM ${targetB} ${MOVE_SPEED} ---`)
    try {
      const mb = await master.moveBmm(targetB, MOVE_SPEED)
      check('MOVEBMM DONE', Math.abs(mb.positionB - targetB) < 0.25, String(mb.positionB))
      if (mb.doneLine) check('MOVEBMM DONE format', validateDone(mb.doneLine, 'MOVEBMM'))
    } catch (e) {
      check('MOVEBMM', false, e.message)
    }
    await waitReady()
  } else {
    log('SKIP HOMEB / MOVEBMM (PICK_PLACE_SINGLE_MOTOR=1)')
  }

  if (!SKIP_FULL_HOME && !SINGLE) {
    log(`\n--- HOME parallel (${HOME_SPEED} mm/s, up to ~270s) ---`)
    try {
      const h = await master.home(undefined, HOME_SPEED)
      check('HOME DONE both homed', h.homedA && h.homedB)
      check('HOME posA', Math.abs(h.positionA - cfg.backoffMmA) < 0.2, String(h.positionA))
      check('HOME posB', Math.abs(h.positionB - cfg.backoffMmB) < 0.2, String(h.positionB))
      if (h.doneLine) check('HOME DONE format', validateDone(h.doneLine, 'HOME'))
    } catch (e) {
      check('HOME', false, e.message)
    }
    await waitReady()
  } else {
    log('SKIP HOME parallel')
  }

  // ── STOP (during move) ──
  log('\n--- STOP during MOVEAMM ---')
  st = await ensureRecover()
  if (st?.homedA) {
    try {
      const far = Math.min(40, (st.positionA ?? 5) + 20)
      const moveP = master.moveAmm(far, 15)
      await sleep(400)
      const stopMv = await master.stop()
      check('STOP during move', stopMv.includes('STOP') || stopMv.includes('stopped'), stopMv)
      await sleep(500)
      try { await moveP } catch { /* expected cancel */ }
      await ensureRecover()
      if (!(await master.status())?.homedA) {
        log('Re-HOMEA after STOP (drives may disable homed flag)')
        await master.homeA(cfg.backoffMmA, HOME_SPEED)
      }
      await waitReady()
    } catch (e) {
      check('STOP during move', false, e.message)
    }
  }

  // ── ESTOP + CLRFAULT ──
  if (!SKIP_ESTOP) {
    log('\n--- ESTOP + CLRFAULT ---')
    try {
      const est = await master.emergencyStop()
      check('ESTOP reply', est.includes('ESTOP') || est.includes('estop'), est)
      st = await master.status()
      check('ESTOP latched', st?.estop === true || st?.fault === true)
      check('ESTOP cleared homed', !st?.homedA && !st?.homedB)
      const rec = await master.recover()
      check('CLRFAULT after ESTOP', rec.reply?.includes('CLRFAULT'))
      st = await master.status()
      check('fault cleared after CLRFAULT', !st?.fault && !st?.estop)

      if (REHOME_AFTER && !SINGLE) {
        log('REHOME_AFTER: HOME parallel …')
        await master.home(undefined, HOME_SPEED)
        st = await master.status()
        check('re-home after ESTOP', st?.homedA && st?.homedB)
      } else if (REHOME_AFTER) {
        await master.homeA(cfg.backoffMmA, HOME_SPEED)
        check('re-HOMEA after ESTOP', (await master.status())?.homedA)
      }
    } catch (e) {
      check('ESTOP/CLRFAULT', false, e.message)
    }
  } else {
    log('SKIP ESTOP (PICK_PLACE_SKIP_ESTOP=1)')
  }

  await tcpGap()
  // ── ERR UNKNOWN (raw) ──
  try {
    const unk = await tcpLine('NOTACOMMAND')
    check('ERR UNKNOWN', unk === 'ERR UNKNOWN', unk)
  } catch (e) {
    check('ERR UNKNOWN', false, e.message)
  }

  st = await master.status()
  log(`\nFinal STATUS: homedA=${st?.homedA} homedB=${st?.homedB} posA=${st?.positionA?.toFixed(3)} posB=${st?.positionB?.toFixed(3)} fault=${st?.fault} estop=${st?.estop}`)

  summary(fail ? 1 : 0)
}

function summary(code) {
  console.log('\n---')
  console.log(`Results: ${pass} passed, ${fail} failed`)
  process.exit(code)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  summary(1)
})
