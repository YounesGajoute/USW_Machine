#!/usr/bin/env node
/**
 * Centring master HTTP API + calibration settings panel.
 * Run: node master/centring_http.js
 */
import fs from 'fs'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import master, {
  applyMechCalibration,
  calibrateSeekHome,
  calibrateSeekTravel,
  computeMechOffsetFromMeasurements,
  getCentringCalibrationInfo,
  getCentringConfig,
  getConfigPath,
  getConnectionInfo,
  getEffectiveHRangeMm,
  getModelHeightRangeMm,
  homeByAxis,
  loadCentringConfig,
  loadGap,
  moveTo,
  probeConnection,
  saveCentringConfig,
  seekTravelBoth,
  setMechOffsetMm,
  status,
} from './centring_master.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SETTINGS_HTML = fs.readFileSync(path.join(__dirname, 'centring_settings.html'), 'utf8')
const PORT = Number(process.env.CENTRING_HTTP_PORT || 8788)

function apiSendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function apiSendHtml(res, code, html) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

async function apiReadBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

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
    homeSt: st.homeSt,
    homedUpper: st.homedUpper,
    homedLower: st.homedLower,
    homing: st.homing,
    asyncCmd: st.asyncCmd,
    ready: st.ready,
    fault: st.fault,
    estop: st.estop,
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
  return {
    ok: false,
    error: err?.message || String(err),
    target: info.target,
    host: info.host,
    port: info.port,
    hint: 'Ensure bot is 192.168.10.1/24, centring Nano 192.168.10.55, port 8177 open.',
  }
}

export function startCentringApi(port = PORT) {
  loadCentringConfig()

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
    const routePath = url.pathname.replace(/\/+$/, '') || '/'
    try {
      if (req.method === 'GET' && routePath === '/api/centring/config') {
        const cfg = getCentringConfig()
        return apiSendJson(res, 200, {
          ok: true,
          config: cfg,
          path: getConfigPath(),
          modelHRangeMm: getModelHeightRangeMm(),
          calibration: getCentringCalibrationInfo(cfg),
        })
      }
      if (req.method === 'PUT' && routePath === '/api/centring/config') {
        const body = await apiReadBody(req)
        const config = saveCentringConfig(body)
        if (body.pushToNano) {
          await master.connectWithRetry()
          await setMechOffsetMm(config.mechOffsetMm)
        }
        return apiSendJson(res, 200, {
          ok: true,
          config,
          path: getConfigPath(),
          calibration: getCentringCalibrationInfo(config),
        })
      }
      if (req.method === 'GET' && routePath === '/api/centring/status') {
        await master.connectWithRetry()
        const st = await status()
        return apiSendJson(res, 200, { ok: true, status: apiFormatStatus(st) })
      }
      if (req.method === 'GET' && routePath === '/api/centring/info') {
        const probe = await probeConnection()
        const cfg = getCentringConfig()
        return apiSendJson(res, 200, {
          ok: true,
          centringConfig: cfg,
          effectiveHRangeMm: getEffectiveHRangeMm(cfg),
          modelHRangeMm: getModelHeightRangeMm(),
          calibration: getCentringCalibrationInfo(cfg),
          settingsUrl: `http://127.0.0.1:${port}/settings/centring`,
          nanoReachable: probe.ok,
          nanoProbe: probe,
          ...getConnectionInfo(),
        })
      }
      if (req.method === 'GET' && routePath === '/api/centring/ping-nano') {
        const probe = await probeConnection()
        return apiSendJson(res, probe.ok ? 200 : 503, { ok: probe.ok, ...probe })
      }
      if (req.method === 'POST' && (
        routePath === '/api/centring/home'
        || routePath === '/api/centring/home_upper'
        || routePath === '/api/centring/home_lower'
      )) {
        await master.connectWithRetry()
        const body = req.headers['content-type']?.includes('json') ? await apiReadBody(req) : {}
        const axis = apiParseAxis(body.axis ?? url.searchParams.get('axis'), apiAxisFromPath(routePath))
        const t0 = Date.now()
        const done = await homeByAxis(axis)
        const st = await status()
        return apiSendJson(res, 200, {
          ok: true,
          axis,
          done,
          elapsedMs: Date.now() - t0,
          status: apiFormatStatus(st),
        })
      }
      if (req.method === 'POST' && routePath === '/api/centring/seek-travel') {
        await master.connectWithRetry()
        const t0 = Date.now()
        const done = await seekTravelBoth()
        const st = await status()
        return apiSendJson(res, 200, {
          ok: true,
          done,
          elapsedMs: Date.now() - t0,
          status: apiFormatStatus(st),
        })
      }
      if (req.method === 'POST' && routePath === '/api/centring/move_to') {
        await master.connectWithRetry()
        const body = await apiReadBody(req)
        const h = body.h ?? body.position ?? body.height ?? url.searchParams.get('h') ?? url.searchParams.get('position')
        const speed = body.speed ?? url.searchParams.get('speed')
        const axis = apiParseAxis(body.axis ?? url.searchParams.get('axis'), 'both')
        if (h == null || h === '') {
          const err = new Error('h (physical opening height mm) required')
          err.statusCode = 400
          throw err
        }
        const cfg = getCentringConfig()
        const t0 = Date.now()
        const done = await moveTo(Number(h), speed != null && speed !== '' ? Number(speed) : undefined, axis)
        const st = await status()
        return apiSendJson(res, 200, {
          ok: true,
          axis,
          h: Number(h),
          speed: speed != null && speed !== '' ? Number(speed) : cfg.movementSpeedDegS,
          done,
          elapsedMs: Date.now() - t0,
          status: apiFormatStatus(st),
        })
      }
      if (req.method === 'POST' && (
        routePath === '/api/centring/load-gap'
        || routePath === '/api/centring/load-reference'
      )) {
        await master.connectWithRetry()
        const body = await apiReadBody(req)
        const gapMm = body.gapMm ?? body.gap_mm ?? body.h ?? url.searchParams.get('gapMm') ?? url.searchParams.get('h')
        const axis = apiParseAxis(body.axis ?? url.searchParams.get('axis'), 'both')
        const speed = body.speed ?? url.searchParams.get('speed')
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
        return apiSendJson(res, 200, {
          ok: true,
          ...out,
          elapsedMs: Date.now() - t0,
          status: apiFormatStatus(st),
        })
      }
      if (req.method === 'POST' && routePath === '/api/centring/stop') {
        await master.connectWithRetry()
        const line = await master.stop()
        const st = await status()
        return apiSendJson(res, 200, { ok: true, reply: line, status: apiFormatStatus(st) })
      }
      if (req.method === 'POST' && routePath === '/api/centring/estop') {
        await master.connectWithRetry()
        const line = await master.emergencyStop()
        const st = await status()
        return apiSendJson(res, 200, { ok: true, reply: line, status: apiFormatStatus(st) })
      }
      if (req.method === 'POST' && (
        routePath === '/api/centring/recover'
        || routePath === '/api/centring/clear-fault'
      )) {
        await master.connectWithRetry()
        const result = await master.recover()
        return apiSendJson(res, 200, {
          ok: result.ok,
          reply: result.reply,
          status: apiFormatStatus(result.status),
        })
      }
      if (req.method === 'POST' && routePath === '/api/centring/calibrate/seek-home') {
        await master.connectWithRetry()
        const out = await calibrateSeekHome()
        return apiSendJson(res, 200, {
          ok: true,
          ...out,
          status: apiFormatStatus(out.status),
          hint: `Measure physical gap at home switches. Model reference: ${out.modelGapMm.toFixed(1)} mm`,
        })
      }
      if (req.method === 'POST' && routePath === '/api/centring/calibrate/seek-travel') {
        await master.connectWithRetry()
        const out = await calibrateSeekTravel()
        return apiSendJson(res, 200, {
          ok: true,
          ...out,
          status: apiFormatStatus(out.status),
          hint: `Measure physical gap at travel switches. Model reference: ${out.modelGapMm.toFixed(1)} mm`,
        })
      }
      if (req.method === 'POST' && routePath === '/api/centring/calibrate/preview') {
        const body = await apiReadBody(req)
        const mechOffsetMm = computeMechOffsetFromMeasurements(body)
        return apiSendJson(res, 200, {
          ok: true,
          mechOffsetMm,
          calibration: getCentringCalibrationInfo({ mechOffsetMm }),
        })
      }
      if (req.method === 'POST' && routePath === '/api/centring/calibrate/apply') {
        await master.connectWithRetry()
        const body = await apiReadBody(req)
        const out = await applyMechCalibration(body)
        return apiSendJson(res, 200, { ok: true, ...out })
      }
      if (req.method === 'GET' && routePath === '/settings/centring') {
        return apiSendHtml(res, 200, SETTINGS_HTML)
      }
      return apiSendJson(res, 404, { ok: false, error: 'not found', path: routePath })
    } catch (err) {
      const msg = err?.message || String(err)
      const code = err?.statusCode === 400 ? 400 : /TCP connect failed/i.test(msg) ? 503 : 500
      console.error(`[centring-api] ${req.method} ${routePath}: ${msg}`)
      return apiSendJson(res, code, apiConnectionError(err))
    }
  })

  server.listen(port, '127.0.0.1', () => {
    const info = getConnectionInfo()
    console.log(`[centring] API http://127.0.0.1:${port}`)
    console.log(`[centring] Nano TCP → ${info.slaveTarget}`)
    console.log(`[centring] Config → ${getConfigPath()}`)
    console.log(`[centring] Settings → http://127.0.0.1:${port}/settings/centring`)
  })
  return server
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) startCentringApi()

export default { startCentringApi }
