#!/usr/bin/env node
/**
 * Pick-place HTTP API integration against mock Nano.
 */
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { startMockPickPlaceNano } from './lib/mock_pick_place_tcp.mjs'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-place-http-'))
process.env.PICK_PLACE_CONFIG_PATH = path.join(tmpDir, 'pick_place_config.json')
process.env.PICK_PLACE_HOST = '127.0.0.1'
process.env.PICK_PLACE_API_PORT = '0'

const mock = await startMockPickPlaceNano(0)
process.env.PICK_PLACE_PORT = String(mock.port)

const { startPickPlaceApi } = await import('../master/pick_place_master.js')

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
          try { json = JSON.parse(text) } catch { /* html */ }
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
  const s = startPickPlaceApi(0)
  s.once('listening', () => resolve(s))
  s.once('error', reject)
})
const apiPort = apiServer.address().port

try {
  const cfg = await request(apiPort, 'GET', '/api/pick-place/config')
  check('GET config', cfg.status === 200 && cfg.json?.config?.backoffMmA === 0.5)

  const info = await request(apiPort, 'GET', '/api/pick-place/info')
  check('info nanoReachable', info.json?.nanoReachable === true)

  const ping = await request(apiPort, 'GET', '/api/pick-place/ping-nano')
  check('ping-nano', ping.status === 200 && ping.json?.ok === true)

  mock.sim.reset()
  const homeA = await request(apiPort, 'POST', '/api/pick-place/home_a', { backoffA: 0.5, homingSpeed: 80 })
  check('home_a backoffA body', homeA.status === 200 && homeA.json?.command === 'HOMEA 0.5 80')

  mock.sim.reset()
  mock.sim.handle('HOMEA 0.5 80')
  const mv = await request(apiPort, 'POST', '/api/pick-place/move_a', { position: 10, speed: 80 })
  check('move_a', mv.status === 200 && mv.json?.command === 'MOVEAMM 10 80')

  mock.sim.reset()
  const home = await request(apiPort, 'POST', '/api/pick-place/home', { axis: 'both', homingSpeed: 80 })
  check('POST home both', home.status === 200 && home.json?.command === 'HOME 0.5 0.8 80')

  const st = await request(apiPort, 'GET', '/api/pick-place/status')
  check('GET status', st.status === 200 && st.json?.homedA === true)

  const recover = await request(apiPort, 'POST', '/api/pick-place/recover')
  check('POST recover', recover.status === 200 && recover.json?.ok === true)

  mock.sim.reset()
  const init = await request(apiPort, 'POST', '/api/pick-place/initialize', { homingSpeed: 80 })
  check('POST initialize', init.status === 200 && init.json?.ok === true)
  check('initialize homed both', init.json?.homedA === true && init.json?.homedB === true)
  check('initialize A backoff', Math.abs(init.json?.positionA - 0.5) < 0.16)
} finally {
  await new Promise(r => apiServer.close(() => r()))
  await mock.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
