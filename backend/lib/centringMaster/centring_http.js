#!/usr/bin/env node
/**
 * Centring master HTTP API + calibration settings panel.
 * Run: node centring_http.js
 * Or mount handleCentringHttpRequest in Express (backend index.mjs).
 */
import fs from 'fs'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import master, {
  applyMechCalibration,
  calibrate,
  calibrateSeekHome,
  calibrateSeekTravel,
  computeMechOffsetFromMeasurements,
  getCentringCalibrationInfo,
  getCentringConfig,
  getConfigPath,
  getConnectionInfo,
  getCentringTcpSessionInfo,
  getEffectiveHRangeMm,
  getModelHeightRangeMm,
  homeByAxis,
  loadCentringConfig,
  loadGap,
  moveTo,
  probeConnection,
  saveCentringConfig,
  seekTravelBoth,
  seekTravelByAxis,
  setMechOffsetMm,
  setCal,
  saveSlaveCal,
  clearEstop,
  clearFault,
  status,
  ping,
  isReachable,
} from './centring_master.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const settingsHtmlPath = path.join(__dirname, 'centring_settings.html')
const SETTINGS_HTML = fs.existsSync(settingsHtmlPath)
  ? fs.readFileSync(settingsHtmlPath, 'utf8')
  : '<!doctype html><html><body><p>Centring settings are in the HMI (Settings → Centring connection).</p></body></html>'
const PORT = Number(process.env.CENTRING_HTTP_PORT || 8788)

function apiRoutePath(req) {
  const raw = req.originalUrl || req.url || '/'
  return new URL(raw, 'http://127.0.0.1').pathname.replace(/\/+$/, '') || '/'
}

function apiQuery(req) {
  const raw = req.originalUrl || req.url || '/'
  return new URL(raw, 'http://127.0.0.1').searchParams
}

function apiSendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function apiSendHtml(res, code, html) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

async function apiReadBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
    return req.body
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

/**
 * Soft recovery aliases (Double_Actuator FW):
 *   POST /api/centring/stop         → waitIdle (no STOP wire cmd)
 *   POST /api/centring/estop        → close TCP session
 *   POST /api/centring/clear-fault  → CLEARESTOP
 *   POST /api/centring/clearestop   → CLEARESTOP
 *   POST /api/centring/setcal       → SETCAL (body = slaveCal)
 *   POST /api/centring/recover      → reconnect + ensureReady (SETCAL if cal=0)
 */
function apiFormatStatus(st) {
  if (!st) return null
  return {
    u: st.u,
    l: st.l,
    h: st.h,
    hMin: st.hMin,
    hMax: st.hMax,
    mechOff: st.mechOff,
    busy: st.busy,
    cal: st.cal,
    calValid: st.calValid ?? st.cal,
    estop: st.estop,
    reason: st.reason,
    accepted: st.accepted,
    lastCmd: st.lastCmd,
    calId: st.calId,
    hu: st.hu,
    tu: st.tu,
    hl: st.hl,
    tl: st.tl,
    puMm: st.puMm,
    plMm: st.plMm,
    pu: st.pu,
    pl: st.pl,
    uh: st.uh,
    ut: st.ut,
    lh: st.lh,
    lt: st.lt,
    targetH: st.targetH,
    moveEnd: st.moveEnd,
    ready: st.ready,
  }
}

function apiParseAxis(value, fallback = 'both') {
  const v = (value ?? fallback).toString().toLowerCase()
  if (v === 'both' || v === 'upper' || v === 'lower') return v
  throw new Error(`invalid axis "${value}" (use both, upper, or lower)`)
}

function apiAxisFromPath(routePath) {
  if (routePath.endsWith('/home_upper')) return 'upper'
  if (routePath.endsWith('/home_lower')) return 'lower'
  return 'both'
}

function apiConnectionError(err) {
  const info = getConnectionInfo()
  const hint =
    'Ensure bot is 192.168.10.1/24, centring Nano 192.168.10.55:8177 with Double_Actuator firmware (SETCAL + keepalive).'
  return {
    ok: false,
    error: err?.message || String(err),
    target: info.target,
    transport: info.transport,
    host: info.host,
    port: info.port,
    hint,
    connection: info,
  }
}

/** Shared HTTP handler — mount in Express or standalone http server. Returns true if handled. */
export async function handleCentringHttpRequest(req, res, { apiPort = PORT } = {}) {
  const routePath = apiRoutePath(req)
  if (!routePath.startsWith('/api/centring') && routePath !== '/settings/centring') {
    return false
  }
  const query = apiQuery(req)
  try {
    if (req.method === 'GET' && routePath === '/api/centring/config') {
      const cfg = getCentringConfig()
      const connection = getConnectionInfo()
      apiSendJson(res, 200, {
        ok: true,
        config: cfg,
        connection,
        transport: connection.transport,
        serialPathConfigured: connection.serialPathConfigured,
        path: getConfigPath(),
        modelHRangeMm: getModelHeightRangeMm(),
        calibration: getCentringCalibrationInfo(cfg),
      })
      return true
    }
    if (req.method === 'PUT' && routePath === '/api/centring/config') {
      const body = await apiReadBody(req)
      const config = saveCentringConfig(body)
      if (body.pushToNano) {
        await master.connectWithRetry()
        await setMechOffsetMm(config.mechOffsetMm)
      }
      const connection = getConnectionInfo()
      apiSendJson(res, 200, {
        ok: true,
        config,
        connection,
        transport: connection.transport,
        serialPathConfigured: connection.serialPathConfigured,
        path: getConfigPath(),
        calibration: getCentringCalibrationInfo(config),
      })
      return true
    }
    if (req.method === 'GET' && routePath === '/api/centring/ping') {
      const info = getConnectionInfo()
      const sessionBefore = getCentringTcpSessionInfo()
      try {
        const ok = await ping()
        const st = await status()
        const sessionInfo = getCentringTcpSessionInfo()
        apiSendJson(res, ok ? 200 : 503, {
          ok,
          connected: ok,
          session: isReachable(),
          cal: st?.cal ?? null,
          estop: st?.estop ?? null,
          ...info,
          sessionRemote: sessionInfo.remote ?? info.target,
          localPort: sessionInfo.localPort ?? null,
        })
      } catch (err) {
        apiSendJson(res, 503, {
          ok: false,
          connected: false,
          session: isReachable(),
          error: err.message,
          ...info,
          sessionRemote: sessionBefore.remote ?? info.target,
          localPort: sessionBefore.localPort ?? null,
        })
      }
      return true
    }
    if (req.method === 'GET' && routePath === '/api/centring/connection') {
      apiSendJson(res, 200, { connected: isReachable(), ...getConnectionInfo() })
      return true
    }
    if (req.method === 'GET' && routePath === '/api/centring/status') {
      await master.connectWithRetry()
      const st = await status()
      apiSendJson(res, 200, { ok: true, connected: isReachable(), status: apiFormatStatus(st) })
      return true
    }
    if (req.method === 'GET' && routePath === '/api/centring/info') {
      // Session-aware probe — never second-client while master holds the link (§3.1)
      const probe = await probeConnection()
      const cfg = getCentringConfig()
      const connection = getConnectionInfo()
      apiSendJson(res, 200, {
        ok: true,
        centringConfig: cfg,
        connection,
        transport: connection.transport,
        serialPathConfigured: connection.serialPathConfigured,
        effectiveHRangeMm: getEffectiveHRangeMm(cfg),
        modelHRangeMm: getModelHeightRangeMm(),
        calibration: getCentringCalibrationInfo(cfg),
        settingsUrl: `http://127.0.0.1:${apiPort}/settings/centring`,
        nanoReachable: probe.ok,
        nanoProbe: probe,
        ...connection,
      })
      return true
    }
    if (req.method === 'GET' && routePath === '/api/centring/ping-nano') {
      // Prefer PING on the persistent session (one-client slave)
      try {
        const ok = await ping()
        apiSendJson(res, ok ? 200 : 503, {
          ok,
          connected: isReachable(),
          via: 'session',
          target: getConnectionInfo().target,
        })
      } catch (err) {
        apiSendJson(res, 503, {
          ok: false,
          connected: isReachable(),
          via: 'session',
          target: getConnectionInfo().target,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return true
    }
    if (req.method === 'POST' && (
      routePath === '/api/centring/home'
      || routePath === '/api/centring/home_upper'
      || routePath === '/api/centring/home_lower'
    )) {
      await master.connectWithRetry()
      const body = req.headers['content-type']?.includes('json') ? await apiReadBody(req) : {}
      const axis = apiParseAxis(body.axis ?? query.get('axis'), apiAxisFromPath(routePath))
      const t0 = Date.now()
      const done = await homeByAxis(axis)
      const st = await status()
      apiSendJson(res, 200, {
        ok: true,
        axis,
        done,
        elapsedMs: Date.now() - t0,
        status: apiFormatStatus(st),
      })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/centring/seek-travel') {
      await master.connectWithRetry()
      const body = req.headers['content-type']?.includes('json') ? await apiReadBody(req) : {}
      const axis = apiParseAxis(body.axis ?? query.get('axis'), 'both')
      const t0 = Date.now()
      const done = axis === 'both' ? await seekTravelBoth() : await seekTravelByAxis(axis)
      const st = await status()
      apiSendJson(res, 200, {
        ok: true,
        axis,
        done,
        elapsedMs: Date.now() - t0,
        status: apiFormatStatus(st),
      })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/centring/move_to') {
      await master.connectWithRetry()
      const body = await apiReadBody(req)
      const h = body.h ?? body.position ?? body.height ?? query.get('h') ?? query.get('position')
      const speed = body.speed ?? query.get('speed')
      const axis = apiParseAxis(body.axis ?? query.get('axis'), 'both')
      if (h == null || h === '') {
        const err = new Error('h (physical opening height mm) required')
        err.statusCode = 400
        throw err
      }
      const cfg = getCentringConfig()
      const t0 = Date.now()
      const done = await moveTo(Number(h), speed != null && speed !== '' ? Number(speed) : undefined, axis)
      const st = await status()
      apiSendJson(res, 200, {
        ok: true,
        axis,
        h: Number(h),
        speed: speed != null && speed !== '' ? Number(speed) : cfg.movementSpeedDegS,
        done,
        elapsedMs: Date.now() - t0,
        status: apiFormatStatus(st),
      })
      return true
    }
    if (req.method === 'POST' && (
      routePath === '/api/centring/load-gap'
      || routePath === '/api/centring/load-reference'
    )) {
      await master.connectWithRetry()
      const body = await apiReadBody(req)
      const gapMm = body.gapMm ?? body.gap_mm ?? body.h ?? query.get('gapMm') ?? query.get('h')
      const axis = apiParseAxis(body.axis ?? query.get('axis'), 'both')
      const speed = body.speed ?? query.get('speed')
      if (gapMm == null || gapMm === '') {
        const err = new Error('gapMm (physical opening height mm) required')
        err.statusCode = 400
        throw err
      }
      const t0 = Date.now()
      const out = await loadGap({
        gapMm: Number(gapMm),
        axis,
        speedDegS: speed != null && speed !== '' ? Number(speed) : undefined,
        connect: false,
      })
      const st = await status()
      apiSendJson(res, 200, {
        ok: true,
        ...out,
        elapsedMs: Date.now() - t0,
        status: apiFormatStatus(st),
      })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/centring/stop') {
      await master.connectWithRetry()
      const result = await master.stop()
      apiSendJson(res, 200, {
        ok: true,
        soft: true,
        reply: 'wait idle (no STOP wire command on Double_Actuator)',
        status: apiFormatStatus(result.status ?? (await status())),
      })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/centring/estop') {
      const result = await master.emergencyStop()
      apiSendJson(res, 200, {
        ok: true,
        soft: true,
        reply: result.reply,
        status: null,
      })
      return true
    }
    if (req.method === 'POST' && (
      routePath === '/api/centring/clearestop'
      || routePath === '/api/centring/clear-fault'
    )) {
      await master.connectWithRetry()
      const result = routePath.endsWith('/clear-fault')
        ? await clearFault()
        : { ok: true, soft: false, reply: 'CLEARESTOP', status: await clearEstop() }
      apiSendJson(res, 200, {
        ok: result.ok !== false,
        soft: !!result.soft,
        reply: result.reply || 'CLEARESTOP',
        status: apiFormatStatus(result.status),
      })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/centring/setcal') {
      await master.connectWithRetry()
      const body = await apiReadBody(req)
      const cal = body?.slaveCal || body
      if (body?.persist !== false) {
        try {
          saveSlaveCal(cal)
        } catch {
          /* setCal will validate */
        }
      }
      const st = await setCal(cal)
      apiSendJson(res, 200, { ok: true, status: apiFormatStatus(st) })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/centring/calibrate') {
      // #region agent log
      const fsDbg = await import('node:fs')
      const beforeCal = getCentringConfig()?.slaveCal || null
      const dbg = (hypothesisId, location, message, data) => {
        const payload = {
          sessionId: '03ab89',
          runId: 'calibrate',
          hypothesisId,
          location,
          message,
          data,
          timestamp: Date.now(),
        }
        try {
          fsDbg.appendFileSync('/home/bot/US Machine/.cursor/debug-03ab89.log', `${JSON.stringify(payload)}\n`)
        } catch { /* ignore */ }
        fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '03ab89' },
          body: JSON.stringify(payload),
        }).catch(() => {})
      }
      dbg('F', 'centring_http.js:calibrate:entry', 'hardware CALIBRATE requested', { beforeCal })
      // #endregion
      await master.connectWithRetry()
      const body = req.headers['content-type']?.includes('json') ? await apiReadBody(req) : {}
      const timeoutMs = Number(body?.timeoutMs)
      const t0 = Date.now()
      // Dual-axis CALIBRATE: RecoverHigh→LeaveHome→SeekHome→LeaveTravel→SeekTravel per axis.
      const calTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : Number(process.env.CENTRING_CALIBRATE_TIMEOUT_MS || 180000)
      const out = await calibrate({ timeoutMs: calTimeout })
      const afterCal = getCentringConfig()?.slaveCal || null
      const st = await status()
      // #region agent log
      dbg('F', 'centring_http.js:calibrate:done', 'hardware CALIBRATE finished', {
        elapsedMs: Date.now() - t0,
        calResult: out?.calResult || null,
        beforeCal,
        afterCal,
        status: {
          cal: st?.cal, u: st?.u, l: st?.l, h: st?.h,
          hu: st?.hu, tu: st?.tu, hl: st?.hl, tl: st?.tl,
          uh: st?.uh, lh: st?.lh, ut: st?.ut, lt: st?.lt,
          moveEnd: st?.moveEnd, estop: st?.estop,
        },
        pulsesChanged: !!(afterCal && beforeCal && (
          afterCal.hu !== beforeCal.hu || afterCal.tu !== beforeCal.tu
          || afterCal.hl !== beforeCal.hl || afterCal.tl !== beforeCal.tl
        )),
      })
      // #endregion
      const okResult = out?.calResult
        && (out.calResult.ok === '1' || out.calResult.ok === 1 || out.calResult.ok === true)
      apiSendJson(res, okResult || st?.cal ? 200 : 500, {
        ok: !!(okResult || st?.cal),
        elapsedMs: Date.now() - t0,
        calResult: out?.calResult || null,
        slaveCal: afterCal,
        previousSlaveCal: beforeCal,
        status: apiFormatStatus(st),
        hint: okResult
          ? 'New pulse ends persisted. Run Initialization (SEEK_TRAVEL → HOME → SEEK_TRAVEL) to verify both jaws close.'
          : 'CALIBRATE did not return ok=1 — check mechanics, switches, and Nano logs.',
      })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/centring/recover') {
      const result = await master.recover()
      apiSendJson(res, 200, {
        ok: result.ok,
        soft: true,
        reply: result.reply,
        status: apiFormatStatus(result.status),
      })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/centring/calibrate/seek-home') {
      await master.connectWithRetry()
      const out = await calibrateSeekHome()
      apiSendJson(res, 200, {
        ok: true,
        ...out,
        status: apiFormatStatus(out.status),
        hint: `Measure physical gap at home switches. Model reference: ${out.modelGapMm.toFixed(1)} mm`,
      })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/centring/calibrate/seek-travel') {
      await master.connectWithRetry()
      const out = await calibrateSeekTravel()
      apiSendJson(res, 200, {
        ok: true,
        ...out,
        status: apiFormatStatus(out.status),
        hint: `Measure physical gap at travel switches. Model reference: ${out.modelGapMm.toFixed(1)} mm`,
      })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/centring/calibrate/preview') {
      const body = await apiReadBody(req)
      const mechOffsetMm = computeMechOffsetFromMeasurements(body)
      apiSendJson(res, 200, {
        ok: true,
        mechOffsetMm,
        calibration: getCentringCalibrationInfo({ mechOffsetMm }),
      })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/centring/calibrate/apply') {
      await master.connectWithRetry()
      const body = await apiReadBody(req)
      const out = await applyMechCalibration(body)
      apiSendJson(res, 200, { ok: true, ...out })
      return true
    }
    if (req.method === 'GET' && routePath === '/settings/centring') {
      apiSendHtml(res, 200, SETTINGS_HTML)
      return true
    }
    apiSendJson(res, 404, { ok: false, error: 'not found', path: routePath })
    return true
  } catch (err) {
    const msg = err?.message || String(err)
    const code = err?.statusCode === 400 ? 400 : /connect failed|Serial connect|TCP connect/i.test(msg) ? 503 : 500
    console.error(`[centring-api] ${req.method} ${routePath}: ${msg}`)
    apiSendJson(res, code, apiConnectionError(err))
    return true
  }
}

export function startCentringApi(port = PORT) {
  loadCentringConfig()

  const server = http.createServer(async (req, res) => {
    const handled = await handleCentringHttpRequest(req, res, { apiPort: port })
    if (!handled) {
      apiSendJson(res, 404, { ok: false, error: 'not found' })
    }
  })

  server.listen(port, '127.0.0.1', () => {
    const info = getConnectionInfo()
    console.log(`[centring] API http://127.0.0.1:${port}`)
    console.log(`[centring] Nano ${info.transport} → ${info.slaveTarget}`)
    console.log(`[centring] Config → ${getConfigPath()}`)
    console.log(`[centring] Settings → http://127.0.0.1:${port}/settings/centring`)
  })
  return server
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) startCentringApi()

export default { startCentringApi, handleCentringHttpRequest }
