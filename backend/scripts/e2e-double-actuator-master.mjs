#!/usr/bin/env node
/**
 * Deep E2E — Double_Actuator Nano ↔ backend centringMaster.
 *
 * Covers: banner, keepalive, SETCAL, CLEARESTOP, HOME*, SEEK_TRAVEL,
 * MOVE*MM (±1 mm), reason=range/unknown, ensureReady, reconnect.
 *
 * Usage:
 *   node backend/scripts/e2e-double-actuator-master.mjs
 *   CENTRING_E2E_SKIP_MOTION=1 node ...   # no HOME/MOVE/SEEK
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import net from 'net'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, '..', 'tmp', 'centring-e2e-double-actuator.json')

const SKIP_MOTION = process.env.CENTRING_E2E_SKIP_MOTION === '1'
const MOVE_TOL = Number(process.env.CENTRING_MOVE_TOL_MM || 1.0)
const TARGET_H = Number(process.env.CENTRING_E2E_TARGET_H || 40)

// Measured on-bench pulses (pre-suite STATUS); restore after FW suite placeholder SETCAL.
const MEASURED_CAL = {
  calId: 'unit_01',
  hu: 2148,
  tu: 1272,
  hl: 1584,
  tl: 696,
}

const results = []
let failed = 0

function check(name, ok, detail = {}) {
  results.push({ name, ok: !!ok, ...detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail.detail ? ` — ${detail.detail}` : ''}`)
  if (!ok) failed += 1
  return !!ok
}

function require(name, ok, detail) {
  if (!check(name, ok, typeof detail === 'string' ? { detail } : detail)) {
    throw new Error(`${name} failed`)
  }
}

async function rawBannerCheck(host, port) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket()
    let buf = ''
    const lines = []
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error('banner timeout'))
    }, 4000)
    sock.connect(port, host, () => {
      sock.setNoDelay(true)
    })
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (line) lines.push(line)
        if (lines.length >= 2) {
          clearTimeout(timer)
          sock.destroy()
          resolve(lines.slice(0, 2))
        }
      }
    })
    sock.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function keepaliveSurvival(host, port, silentMs = 12000) {
  // Raw socket, keepalive PING every 3s — must survive >10s idle window
  return new Promise((resolve, reject) => {
    const sock = new net.Socket()
    let buf = ''
    let lastStatus = null
    let pings = 0
    const started = Date.now()
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error('keepalive overall timeout'))
    }, silentMs + 8000)

    const sendPing = () => {
      try {
        sock.write('PING\n')
        pings += 1
      } catch {
        /* closed */
      }
    }

    sock.connect(port, host, () => {
      sock.setNoDelay(true)
      // drain banners then start keepalive
      setTimeout(() => {
        sendPing()
        const iv = setInterval(() => {
          if (Date.now() - started >= silentMs) {
            clearInterval(iv)
            clearTimeout(timer)
            sock.destroy()
            resolve({ pings, lastStatus, elapsedMs: Date.now() - started })
          } else {
            sendPing()
          }
        }, 3000)
      }, 500)
    })
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (line.startsWith('u=') && line.includes('busy=')) lastStatus = line
      }
    })
    sock.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    sock.on('close', () => {
      /* resolve handled by timer path */
    })
  })
}

async function main() {
  const m = await import('../lib/centring.mjs')
  const {
    connectWithRetry,
    ping,
    status,
    ensureReady,
    setCal,
    saveSlaveCal,
    clearEstop,
    homeBoth,
    homeUpper,
    homeLower,
    seekTravelBoth,
    moveBoth,
    waitIdle,
    getConnectionInfo,
    closeSerialSession,
    mapFirmwareStatus,
    hasOpenSession,
  } = m

  const startedAt = new Date().toISOString()
  console.log(`\n=== Double_Actuator master E2E @ ${startedAt} ===`)
  console.log(`skipMotion=${SKIP_MOTION} targetH=${TARGET_H} tol=${MOVE_TOL}\n`)

  try {
    // ---- 1. Raw banner (no master session) ----
    closeSerialSession()
    const info = getConnectionInfo()
    require('connection info protocol', info.protocol === 'double-actuator-centring-v1', info.protocol)
    require('cmd max len 128', info.cmdMaxLen === 128, String(info.cmdMaxLen))
    require('keepalive configured', info.keepaliveMs > 0 && info.keepaliveMs < 10000, String(info.keepaliveMs))

    const banner = await rawBannerCheck(info.host, info.port)
    require('banner READY then PING', banner[0] === 'READY' && banner[1] === 'PING', banner.join(','))

    // ---- 2. Keepalive survival (raw, no master) ----
    const ka = await keepaliveSurvival(info.host, info.port, 12000)
    require(
      'keepalive survives >10s idle window',
      ka.pings >= 3 && !!ka.lastStatus,
      `pings=${ka.pings} elapsed=${ka.elapsedMs}ms`,
    )

    // ---- 3. Master connect + STATUS ----
    await connectWithRetry()
    require('hasOpenSession after connect', hasOpenSession())
    require('master ping', await ping())

    let st = await status()
    require('STATUS returned', !!st)
    require('STATUS has cal field', st.cal === true || st.cal === false, `cal=${st.cal}`)
    require('STATUS has reason', typeof st.reason === 'string', st.reason)
    require('STATUS estop clear', st.estop === false, `estop=${st.estop}`)
    check('STATUS parse moveEnd', !!st.moveEnd, { detail: st.moveEnd })

    // Persist + restore measured cal (suite may have pushed placeholder pulses)
    saveSlaveCal(MEASURED_CAL)
    st = await setCal(MEASURED_CAL)
    require('SETCAL measured pulses', st.cal === true && st.accepted !== false, {
      detail: `cal=${st.cal} hu=${st.hu} tu=${st.tu} reason=${st.reason}`,
    })
    require('SETCAL hu matches', Number(st.hu) === MEASURED_CAL.hu, `hu=${st.hu}`)

    st = await clearEstop()
    require('CLEARESTOP ok', st.estop === false && st.accepted !== false, {
      detail: `estop=${st.estop} reason=${st.reason}`,
    })

    st = await ensureReady()
    require('ensureReady cal=1', st.cal === true, `cal=${st.cal}`)
    require('ensureReady !estop', st.estop === false)

    if (!SKIP_MOTION) {
      // ---- 4. HOME ----
      const home = await homeBoth()
      require('HOME moveEnd=ok', home.moveEnd === 'ok' || home.status?.moveEnd === 'ok', {
        detail: `moveEnd=${home.moveEnd}`,
      })
      st = await status()
      require('after HOME busy=0', st.busy === false)

      // Single-axis homes (no-op if already at HOME)
      const hu = await homeUpper()
      require('HOME_UPPER accepted', hu.accepted !== false, { detail: `moveEnd=${hu.moveEnd}` })
      const hl = await homeLower()
      require('HOME_LOWER accepted', hl.accepted !== false, { detail: `moveEnd=${hl.moveEnd}` })

      // ---- 5. MOVE mid-band ----
      const moved = await moveBoth(TARGET_H)
      st = moved.status || (await status())
      const h = Number(st.h)
      require('MOVEBOTHMM busy=0', st.busy === false)
      require('MOVEBOTHMM moveEnd=ok', st.moveEnd === 'ok', { detail: st.moveEnd })
      require(
        `MOVEBOTHMM |h−${TARGET_H}|≤${MOVE_TOL}`,
        Number.isFinite(h) && Math.abs(h - TARGET_H) <= MOVE_TOL,
        { detail: `h=${h} target=${TARGET_H}` },
      )

      // ---- 6. Range reject ----
      try {
        await moveBoth(999)
        check('MOVEBOTHMM 999 → throws/range', false, { detail: 'expected rejection' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        require('MOVEBOTHMM 999 → range/rejected', /range|outside|rejected|nocal/i.test(msg), msg)
      }

      await waitIdle()
      await homeBoth()

      // ---- 7. SEEK_TRAVEL → closed idle ----
      const seek = await seekTravelBoth()
      require('SEEK_TRAVEL accepted', seek.accepted !== false, {
        detail: `moveEnd=${seek.moveEnd} u=${seek.u} l=${seek.l}`,
      })
      st = await status()
      const nearTravel =
        Number.isFinite(st.u) && Number.isFinite(st.l)
        && Math.abs(st.u - 35) <= 3 && Math.abs(st.l - 35) <= 3
      check('SEEK_TRAVEL near +35/+35', nearTravel, {
        detail: `u=${st.u} l=${st.l} ut=${st.ut} lt=${st.lt}`,
      })

      // Return to HOME open for safe leave
      await homeBoth()
    } else {
      check('motion block skipped', true, { detail: 'CENTRING_E2E_SKIP_MOTION=1' })
    }

    // ---- 8. Reconnect path ----
    closeSerialSession()
    require('session closed', !hasOpenSession())
    await connectWithRetry()
    require('reconnect ping', await ping())
    st = await status()
    require('reconnect cal restored or still 1', st.cal === true, `cal=${st.cal}`)

    // mapFirmwareStatus golden
    const mapped = mapFirmwareStatus(
      'u=-80.00 l=-80.00 h=62.87 busy=0 cal=1 calValid=1 lastCmd=PING accepted=1 reason=ok '
      + 'hmin=1.80 hmax=62.87 mechOff=0.00 calId=unit_01 hu=2148 tu=1272 hl=1584 tl=696 '
      + 'puMm=31.44 plMm=31.44 uh=1 ut=0 lh=1 lt=0 estop=0 targetH=0.00 moveEnd=ok',
    )
    require('mapFirmwareStatus cal/ready', mapped.cal === true && mapped.ready === true)

  } catch (err) {
    check('suite aborted', false, { detail: err instanceof Error ? err.message : String(err) })
  } finally {
    try {
      closeSerialSession()
    } catch {
      /* ignore */
    }
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    failed,
    passed: results.filter((r) => r.ok).length,
    total: results.length,
    skipMotion: SKIP_MOTION,
    measuredCal: MEASURED_CAL,
    results,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`\n=== ${report.passed}/${report.total} passed (${failed} failed) ===`)
  console.log(`report: ${OUT}`)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
