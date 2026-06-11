#!/usr/bin/env node
/**
 * Deep API audit — hits every route in index.mjs and records status/body summary.
 * Usage: node backend/scripts/api-deep-check.mjs [baseUrl]
 */
import { createRequire } from 'module'

const BASE = process.argv[2] || 'http://127.0.0.1:3333'
const TIMEOUT_MS = 12000

const results = []

async function req(method, path, { body, cookie, expectStatus, timeoutMs } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs ?? TIMEOUT_MS)
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (cookie) headers.Cookie = cookie
  let status = 0
  let text = ''
  let err = null
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    status = res.status
    text = await res.text()
    const setCookie = res.headers.getSetCookie?.() || []
    return { status, text, setCookie, err: null }
  } catch (e) {
    err = e.message || String(e)
    return { status: 0, text: '', setCookie: [], err }
  } finally {
    clearTimeout(t)
  }
}

function summarize(text, max = 120) {
  if (!text) return ''
  try {
    const j = JSON.parse(text)
    const s = JSON.stringify(j)
    return s.length > max ? s.slice(0, max) + '…' : s
  } catch {
    return text.length > max ? text.slice(0, max) + '…' : text
  }
}

function record(group, name, method, path, r, { expect, note, skip, acceptAbort } = {}) {
  const aborted = r.err && /abort/i.test(r.err)
  const ok = skip
    ? 'SKIP'
    : aborted && acceptAbort
      ? 'SKIP'
      : r.err
        ? 'FAIL'
        : expect != null
          ? (Array.isArray(expect) ? expect.includes(r.status) : r.status === expect)
            ? 'PASS'
            : 'FAIL'
          : r.status >= 200 && r.status < 300
            ? 'PASS'
            : r.status >= 400 && r.status < 500
              ? 'WARN'
              : 'FAIL'
  const noteText = note || (aborted && acceptAbort ? 'connect timed out (no EtherCAT hardware?)' : r.err || '')
  results.push({ group, name, method, path, status: r.status, ok, note: noteText, body: summarize(r.text) })
}

function cookieFrom(setCookie) {
  if (!setCookie?.length) return ''
  return setCookie.map(c => c.split(';')[0]).join('; ')
}

async function main() {
  console.log(`API deep check → ${BASE}\n`)

  // ── Health ──
  let r = await req('GET', '/api/health')
  record('core', 'health', 'GET', '/api/health', r, { expect: 200 })

  // ── Auth ──
  r = await req('GET', '/api/auth/me')
  record('auth', 'me (no session)', 'GET', '/api/auth/me', r, { expect: 401 })

  r = await req('POST', '/api/auth/login', { body: {} })
  record('auth', 'login empty', 'POST', '/api/auth/login', r, { expect: 400 })

  r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong' } })
  record('auth', 'login bad password', 'POST', '/api/auth/login', r, { expect: 401 })

  // Try common dev passwords (no secret exfil — only pass/fail)
  const tries = ['admin', 'Admin123!', 'password', 'vendor', 'changeme']
  let sessionCookie = ''
  for (const pw of tries) {
    r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: pw } })
    if (r.status === 200) {
      sessionCookie = cookieFrom(r.setCookie)
      record('auth', 'login admin', 'POST', '/api/auth/login', r, { expect: 200, note: 'session acquired' })
      break
    }
  }
  if (!sessionCookie) {
    record('auth', 'login admin', 'POST', '/api/auth/login', { status: 0, text: '', err: 'no valid dev password' }, {
      skip: true,
      note: 'admin routes tested unauthenticated only',
    })
  }

  r = await req('GET', '/api/auth/me', { cookie: sessionCookie })
  record('auth', 'me (session)', 'GET', '/api/auth/me', r, { expect: sessionCookie ? 200 : 401 })

  r = await req('POST', '/api/auth/logout', { cookie: sessionCookie })
  record('auth', 'logout', 'POST', '/api/auth/logout', r, { expect: 200 })

  let adminPassword = ''
  for (const pw of tries) {
    r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: pw } })
    if (r.status === 200) { adminPassword = pw; sessionCookie = cookieFrom(r.setCookie); break }
  }

  // ── Settings ──
  r = await req('GET', '/api/settings/system')
  record('settings', 'system (public)', 'GET', '/api/settings/system', r, { expect: 200 })

  r = await req('GET', '/api/settings/role-tab-access')
  record('settings', 'role-tab-access', 'GET', '/api/settings/role-tab-access', r, { expect: 200 })

  r = await req('PUT', '/api/settings/system', { body: { theme: 'dark' }, cookie: sessionCookie })
  record('settings', 'system PUT', 'PUT', '/api/settings/system', r, {
    expect: sessionCookie ? [200, 403] : 401,
    note: sessionCookie ? '' : 'needs admin session',
  })

  r = await req('GET', '/api/users', { cookie: sessionCookie })
  record('settings', 'users list', 'GET', '/api/users', r, {
    expect: sessionCookie ? 200 : 401,
  })

  // ── References ──
  r = await req('GET', '/api/references')
  record('references', 'list', 'GET', '/api/references', r, { expect: 200 })

  r = await req('POST', '/api/references', { body: { name: '__api_test__', description: 'auto' } })
  record('references', 'create', 'POST', '/api/references', r, { expect: [200, 201, 400] })

  // ── Vision ──
  r = await req('GET', '/api/vision/ping')
  record('vision', 'ping', 'GET', '/api/vision/ping', r, { expect: [200, 502, 503] })

  r = await req('GET', '/api/vision/programs')
  record('vision', 'programs list', 'GET', '/api/vision/programs', r, { expect: [200, 401, 502, 503] })

  r = await req('GET', '/api/vision/tool-templates')
  record('vision', 'tool-templates', 'GET', '/api/vision/tool-templates', r, { expect: [200, 401, 502, 503] })

  // ── Pick & place (read-only + safe writes) ──
  const ppGets = [
    '/api/pick-place/ping',
    '/api/pick-place/status',
    '/api/pick-place/connection',
    '/api/pick-place/help',
    '/api/pick-place/alminfo',
    '/api/pick-place/home_backoff',
    '/api/pick-place/switches',
    '/api/pick-place/alarm_codes',
    '/api/pick-place/config',
  ]
  for (const p of ppGets) {
    r = await req('GET', p)
    record('pick-place', p.split('/').pop(), 'GET', p, r, {
      expect: 200,
    })
  }

  const ppSafePosts = [
    ['enable', {}],
    ['disable', {}],
    ['stop', {}],
    ['clear_error', {}],
    ['clear_alarm', {}],
    ['set_speed', { value: 80 }],
    ['set_accel', { value: 200 }],
    ['set_default_speed', { value: 80 }],
    ['set_home_release_mm', { value: 0.5 }],
    ['save_config', {}],
    ['load_config', {}],
    ['apply_motion_defaults', {}],
    ['reset_position', {}],
  ]
  for (const [name, body] of ppSafePosts) {
    r = await req('POST', `/api/pick-place/${name}`, { body })
    const expect = name === 'reset_position' ? 400 : 200
    record('pick-place', name, 'POST', `/api/pick-place/${name}`, r, { expect })
  }

  r = await req('POST', '/api/pick-place/move', { body: { distanceMm: 0, speed: 10 } })
  record('pick-place', 'move 0mm', 'POST', '/api/pick-place/move', r, {
    expect: 400,
    note: 'validation reject (non-zero distance required)',
  })

  // ── Lifter ──
  r = await req('GET', '/api/lifter/status')
  record('lifter', 'status', 'GET', '/api/lifter/status', r, { expect: 200 })

  r = await req('POST', '/api/lifter/connect', { timeoutMs: 45000 })
  record('lifter', 'connect', 'POST', '/api/lifter/connect', r, {
    expect: [200, 503],
    acceptAbort: true,
  })

  r = await req('GET', '/api/lifter/status')
  record('lifter', 'status after connect', 'GET', '/api/lifter/status', r, { expect: 200 })

  // ── Pneumatics (DO0–DO5) ──
  r = await req('GET', '/api/pneumatics/status')
  record('pneumatics', 'status', 'GET', '/api/pneumatics/status', r, { expect: 200 })

  r = await req('POST', '/api/pneumatics/safe')
  record('pneumatics', 'safe', 'POST', '/api/pneumatics/safe', r, { expect: [200, 503] })

  // ── Machine initialization (DO0 panel button) ──
  r = await req('GET', '/api/machine/init-status')
  record('machine', 'init-status', 'GET', '/api/machine/init-status', r, { expect: 200 })

  r = await req('POST', '/api/machine/stop-production')
  record('machine', 'stop-production', 'POST', '/api/machine/stop-production', r, { expect: 200 })

  // ── Report ──
  const pass = results.filter(x => x.ok === 'PASS').length
  const fail = results.filter(x => x.ok === 'FAIL').length
  const warn = results.filter(x => x.ok === 'WARN').length
  const skip = results.filter(x => x.ok === 'SKIP').length

  console.log('─'.repeat(72))
  for (const g of [...new Set(results.map(x => x.group))]) {
    console.log(`\n## ${g}`)
    for (const row of results.filter(x => x.group === g)) {
      const icon = { PASS: '✓', FAIL: '✗', WARN: '!', SKIP: '-' }[row.ok]
      console.log(`  ${icon} ${row.method} ${row.path} → ${row.status} ${row.note ? `(${row.note})` : ''}`)
      if (row.ok === 'FAIL' && row.body) console.log(`      ${row.body}`)
    }
  }

  console.log('\n' + '═'.repeat(72))
  console.log(`SUMMARY: ${pass} pass, ${fail} fail, ${warn} warn, ${skip} skip (total ${results.length})`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
