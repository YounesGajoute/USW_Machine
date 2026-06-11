#!/usr/bin/env node
/**
 * Pick-place HTTP API hardware smoke test (uses running API on :3333).
 * Env: PICK_PLACE_API_URL (default http://127.0.0.1:3333)
 */
const BASE = (process.env.PICK_PLACE_API_URL || 'http://127.0.0.1:3333').replace(/\/$/, '')

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function api(method, path, body, timeoutMs = 30000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    const json = await res.json().catch(() => ({}))
    return { status: res.status, json }
  } finally {
    clearTimeout(t)
  }
}

console.log(`=== Pick-place HTTP hardware smoke → ${BASE} ===`)

const ping = await api('GET', '/api/pick-place/ping-nano')
check('ping-nano 200', ping.status === 200 && ping.json?.ok === true)
check('nanoReachable', ping.json?.ok === true || ping.json?.nanoReachable === true)

const info = await api('GET', '/api/pick-place/info')
check('info ok', info.json?.ok === true)
check('info has pickPlaceConfig', info.json?.pickPlaceConfig?.backoffMmA === 0.5)

const st = await api('GET', '/api/pick-place/status')
check('status ok', st.json?.ok === true)
check('status homedA field', typeof st.json?.homedA === 'boolean')
console.log(`STATUS: homedA=${st.json?.homedA} homedB=${st.json?.homedB} posA=${st.json?.positionA} state=${st.json?.state}`)

if (process.env.PICK_PLACE_HW_HOME === '1' && !st.json?.homedA) {
  console.log('POST home_a (may take ~150s)...')
  const home = await api('POST', '/api/pick-place/home_a', { backoffA: 0.5, homingSpeed: 80 }, 180000)
  check('home_a 200', home.status === 200)
  check('home_a command', home.json?.command === 'HOMEA 0.5 80')
}

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
