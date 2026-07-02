#!/usr/bin/env node
/**
 * HTTP API integration against mock Nano (no hardware).
 */
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { startMockNano } from './lib/mock_nano_tcp.mjs'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centring-http-'))
process.env.CENTRING_CONFIG_PATH = path.join(tmpDir, 'centring_config.json')
process.env.CENTRING_HOST = '127.0.0.1'
process.env.CENTRING_HTTP_PORT = '0'

const mock = await startMockNano(0)
process.env.CENTRING_PORT = String(mock.port)

const { startCentringApi } = await import('../master/centring_http.js')

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function request(port, method, routePath, body) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: routePath,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      res => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try { json = JSON.parse(text) } catch { /* html or empty */ }
          resolve({ status: res.statusCode, json, text })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

const apiServer = await new Promise((resolve, reject) => {
  const s = startCentringApi(0)
  s.once('listening', () => resolve(s))
  s.once('error', reject)
})
const apiPort = apiServer.address().port

try {
  const cfg = await request(apiPort, 'GET', '/api/centring/config')
  check('GET config 200', cfg.status === 200 && cfg.json?.ok)
  check('config has mechOffsetMm', cfg.json?.config?.mechOffsetMm != null)
  check('config has calibration', cfg.json?.calibration?.modelHRangeMm != null)

  const preview = await request(apiPort, 'POST', '/api/centring/calibrate/preview', {
    measuredHomeMm: -2,
    measuredClosedMm: 65.6,
  })
  check('calibrate preview', preview.status === 200 && Math.abs(preview.json.mechOffsetMm + 2) < 0.05)

  const info = await request(apiPort, 'GET', '/api/centring/info')
  check('info nanoReachable', info.json?.nanoReachable === true)
  check('info effectiveHRange', info.json?.effectiveHRangeMm?.min != null)
  check('info sessionMode', info.json?.sessionMode === 'request-response')

  const ping = await request(apiPort, 'GET', '/api/centring/ping-nano')
  check('ping-nano ok', ping.status === 200 && ping.json?.ok === true)

  mock.sim.reset()
  mock.sim.handle('HOME')
  const home = await request(apiPort, 'POST', '/api/centring/home')
  check('POST home', home.status === 200 && home.json?.done?.tag === 'HOME')

  const mv = await request(apiPort, 'POST', '/api/centring/move_to', { h: 18, axis: 'both' })
  check('POST move_to', mv.status === 200 && mv.json?.done?.tag === 'MOVEBOTHMM')

  const stop = await request(apiPort, 'POST', '/api/centring/stop')
  check('POST stop', stop.status === 200 && stop.json?.ok === true)

  mock.sim.reset()
  mock.sim.handle('HOME')
  const recover = await request(apiPort, 'POST', '/api/centring/recover')
  check('POST recover', recover.status === 200 && recover.json?.ok === true)

  const st = await request(apiPort, 'GET', '/api/centring/status')
  check('GET status', st.status === 200 && st.json?.status?.mechOff != null)

  mock.sim.reset()
  mock.sim.handle('HOME')
  const seekHome = await request(apiPort, 'POST', '/api/centring/calibrate/seek-home')
  check('seek-home', seekHome.status === 200 && seekHome.json?.position === 'home')

  const seekTravel = await request(apiPort, 'POST', '/api/centring/calibrate/seek-travel')
  check('seek-travel', seekTravel.status === 200 && seekTravel.json?.position === 'travel')

  const apply = await request(apiPort, 'POST', '/api/centring/calibrate/apply', {
    measuredHomeMm: -2,
    measuredClosedMm: 65.6,
  })
  check('calibrate apply', apply.status === 200 && Math.abs(apply.json.mechOffsetMm + 2) < 0.05)

  const save = await request(apiPort, 'PUT', '/api/centring/config', { mechOffsetMm: 0, pushToNano: true })
  check('PUT config restore offset', save.status === 200 && save.json?.config?.mechOffsetMm === 0)

  const html = await request(apiPort, 'GET', '/settings/centring')
  check('settings html', html.status === 200 && html.text.includes('Centring mechanical offset'))

  const nf = await request(apiPort, 'GET', '/api/nope')
  check('404 route', nf.status === 404)
} finally {
  await new Promise(r => apiServer.close(() => r()))
  await mock.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
