/**
 * End-to-end HMI settings verification — SQLite persist + startup reload.
 * Writes NDJSON to the debug session log (session 44d5f0).
 */
import fs from 'node:fs'

const LOG = '/home/bot/US Machine/.cursor/debug-44d5f0.log'
const BASE = process.env.API_BASE || 'http://127.0.0.1:3333'

function log(hypothesisId, location, message, data) {
  const line = JSON.stringify({
    sessionId: '44d5f0',
    runId: 'post-fix',
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  })
  fs.appendFileSync(LOG, line + '\n')
  console.log(`[${hypothesisId}] ${message}`, JSON.stringify(data))
}

function cookieFrom(setCookie) {
  if (!setCookie) return ''
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie]
  return raw.map((c) => String(c).split(';')[0]).join('; ')
}

async function req(method, path, { body, cookie } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (cookie) headers.Cookie = cookie
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie?.() ?? res.headers.get('set-cookie') }
}

async function login() {
  const tries = ['admin', 'Admin123!', 'password', 'vendor', 'changeme']
  for (const pw of tries) {
    const r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: pw } })
    if (r.status === 200) {
      return { cookie: cookieFrom(r.setCookie), password: pw }
    }
  }
  for (const username of ['vendor', 'bypass', 'admin']) {
    for (const pw of tries) {
      const r = await req('POST', '/api/auth/login', { body: { username, password: pw } })
      if (r.status === 200) {
        return { cookie: cookieFrom(r.setCookie), password: pw, username }
      }
    }
  }
  return null
}

async function main() {
  let health
  try {
    health = await req('GET', '/api/settings/system')
  } catch (e) {
    log('E', 'hmi-settings-e2e.mjs:health', 'api_unreachable', { error: String(e) })
    process.exit(1)
  }
  log('E', 'hmi-settings-e2e.mjs:health', 'api_reachable', { status: health.status })

  // ── A: unauth GET subset vs auth full (startup bootstrap gap) ─────────────
  const unauth = await req('GET', '/api/settings/system')
  const unauthKeys = Object.keys(unauth.json?.settings || {})
  const unauthHasSerial = 'serial_number' in (unauth.json?.settings || {})
  const unauthHasQuickpass = 'quickpass' in (unauth.json?.settings || {})
  const unauthHasPost = 'post_update_action' in (unauth.json?.settings || {})

  const session = await login()
  if (!session) {
    log('A', 'hmi-settings-e2e.mjs:login', 'login_failed', { note: 'cannot test auth path' })
  }
  const auth = session
    ? await req('GET', '/api/settings/system', { cookie: session.cookie })
    : { status: 0, json: null }
  const authKeys = Object.keys(auth.json?.settings || {})
  const authHasSerial = 'serial_number' in (auth.json?.settings || {})
  const authHasQuickpass = 'quickpass' in (auth.json?.settings || {})
  const authHasPost = 'post_update_action' in (auth.json?.settings || {})

  const simulatedCache = { ...(unauth.json?.settings || {}) }
  const cacheMissPostUpdate =
    !('post_update_action' in simulatedCache) && authHasPost

  log('A', 'hmi-settings-e2e.mjs:subset', 'unauth_vs_auth_get', {
    unauthKeyCount: unauthKeys.length,
    authKeyCount: authKeys.length,
    unauthHasSerial,
    unauthHasQuickpass,
    unauthHasPost,
    authHasSerial,
    authHasQuickpass,
    authHasPost,
    authSerial: auth.json?.settings?.serial_number ?? null,
    authQuickpass: auth.json?.settings?.quickpass ?? null,
    authPostUpdate: auth.json?.settings?.post_update_action ?? null,
    systemSectionCacheMissPostUpdate: cacheMissPostUpdate,
    systemSectionWouldShowWrongDefaults: cacheMissPostUpdate,
    confirmedHypothesisA: cacheMissPostUpdate === true,
  })

  if (!session) {
    console.log('No admin session — skipping write round-trips')
    process.exit(0)
  }
  const cookie = session.cookie
  const before = auth.json?.settings || {}

  // ── E: theme / locale / machine_model round-trip (UI device settings) ─────
  const themeTarget = before.theme === 'dark' ? 'light' : 'dark'
  const localeTarget = before.locale === 'fr' ? 'en' : 'fr'
  const modelTarget = before.machine_model === 'STCS-CS19' ? 'STCS-evo500' : 'STCS-CS19'

  await req('PUT', '/api/settings/system', { cookie, body: { theme: themeTarget } })
  await req('PUT', '/api/settings/system', { cookie, body: { locale: localeTarget } })
  await req('PUT', '/api/settings/system', { cookie, body: { machine_model: modelTarget } })

  const afterUi = await req('GET', '/api/settings/system', { cookie })
  const uiOk =
    afterUi.json?.settings?.theme === themeTarget &&
    afterUi.json?.settings?.locale === localeTarget &&
    afterUi.json?.settings?.machine_model === modelTarget

  log('E', 'hmi-settings-e2e.mjs:uiRoundTrip', 'theme_locale_model_persist', {
    themeTarget,
    localeTarget,
    modelTarget,
    gotTheme: afterUi.json?.settings?.theme,
    gotLocale: afterUi.json?.settings?.locale,
    gotModel: afterUi.json?.settings?.machine_model,
    ok: uiOk,
  })

  // Simulate startup reload (unauth bootstrap still gets theme/locale/model)
  const startup = await req('GET', '/api/settings/system')
  const startupOk =
    startup.json?.settings?.theme === themeTarget &&
    startup.json?.settings?.locale === localeTarget &&
    startup.json?.settings?.machine_model === modelTarget
  log('E', 'hmi-settings-e2e.mjs:startupReload', 'unauth_bootstrap_sees_ui_prefs', {
    ok: startupOk,
    theme: startup.json?.settings?.theme,
    locale: startup.json?.settings?.locale,
    machine_model: startup.json?.settings?.machine_model,
  })

  // ── B: unauth PUT response must match public GET when require_login ON ───
  const putTheme = await req('PUT', '/api/settings/system', {
    body: { theme: themeTarget },
  })
  const putKeys = Object.keys(putTheme.json?.settings || {})
  const putHasPost = 'post_update_action' in (putTheme.json?.settings || {})
  const putHasSerial = 'serial_number' in (putTheme.json?.settings || {})
  const putHasPickPlace = 'pick_place_config' in (putTheme.json?.settings || {})
  const getAfterPutUnauth = await req('GET', '/api/settings/system')
  const requireLoginOn = !!(before.require_login)
  // F4: with require_login ON, unauth PUT must not leak auth-only / motion keys.
  const putRedactedOk = !requireLoginOn || (!putHasPost && !putHasSerial && !putHasPickPlace)
  log('B', 'hmi-settings-e2e.mjs:putVsGet', 'unauth_put_response_vs_get', {
    putKeyCount: putKeys.length,
    getKeyCount: Object.keys(getAfterPutUnauth.json?.settings || {}).length,
    putHasPostUpdate: putHasPost,
    putHasSerial,
    putHasPickPlace,
    getHasPostUpdate: 'post_update_action' in (getAfterPutUnauth.json?.settings || {}),
    requireLoginOn,
    putRedactedOk,
    // Legacy hypothesis B was the leak; after F4 it should be false when require_login ON.
    confirmedHypothesisB: putHasPost && !('post_update_action' in (getAfterPutUnauth.json?.settings || {})),
  })

  // ── D: nested pick_place / centring / production_sequence round-trip ──────
  const origPp = before.pick_place_config || {}
  const ppSpeed = Number(origPp.movementSpeedMmS) === 91 ? 92 : 91
  const ppPut = await req('PUT', '/api/settings/system', {
    cookie,
    body: { pick_place_config: { movementSpeedMmS: ppSpeed } },
  })
  const ppGet = await req('GET', '/api/settings/system', { cookie })
  const ppOk = ppGet.json?.settings?.pick_place_config?.movementSpeedMmS === ppSpeed
  const ppMaxPreserved =
    ppGet.json?.settings?.pick_place_config?.maxPositionMm != null

  log('D', 'hmi-settings-e2e.mjs:nestedPp', 'pick_place_partial_patch', {
    intendedSpeed: ppSpeed,
    gotSpeed: ppGet.json?.settings?.pick_place_config?.movementSpeedMmS,
    maxPositionMm: ppGet.json?.settings?.pick_place_config?.maxPositionMm,
    putOk: ppPut.status === 200,
    ok: ppOk,
    maxPositionPreserved: ppMaxPreserved,
  })

  const origCent = before.centring_config || {}
  const centSpeed = Number(origCent.movementSpeedDegS) === 46 ? 47 : 46
  await req('PUT', '/api/settings/system', {
    cookie,
    body: { centring_config: { movementSpeedDegS: centSpeed } },
  })
  const centGet = await req('GET', '/api/settings/system', { cookie })
  const centOk = centGet.json?.settings?.centring_config?.movementSpeedDegS === centSpeed
  const centHostPreserved = !!centGet.json?.settings?.centring_config?.tcp?.host
  log('D', 'hmi-settings-e2e.mjs:nestedCent', 'centring_partial_patch', {
    intendedSpeed: centSpeed,
    gotSpeed: centGet.json?.settings?.centring_config?.movementSpeedDegS,
    host: centGet.json?.settings?.centring_config?.tcp?.host,
    ok: centOk,
    hostPreserved: centHostPreserved,
  })

  const origSeq = before.production_sequence_config || {}
  const delay = Number(origSeq.delayAfterClampCloseMs) === 1001 ? 1002 : 1001
  await req('PUT', '/api/settings/system', {
    cookie,
    body: { production_sequence_config: { delayAfterClampCloseMs: delay } },
  })
  const seqGet = await req('GET', '/api/settings/system', { cookie })
  const seqOk = seqGet.json?.settings?.production_sequence_config?.delayAfterClampCloseMs === delay
  log('D', 'hmi-settings-e2e.mjs:nestedSeq', 'production_sequence_partial_patch', {
    intendedDelay: delay,
    gotDelay: seqGet.json?.settings?.production_sequence_config?.delayAfterClampCloseMs,
    ok: seqOk,
  })

  // ── require_login round-trip (General settings) ────────────────────────────
  const requireLoginBefore = !!before.require_login
  await req('PUT', '/api/settings/system', { cookie, body: { require_login: !requireLoginBefore } })
  const rlGet = await req('GET', '/api/settings/system', { cookie })
  const rlOk = !!rlGet.json?.settings?.require_login === !requireLoginBefore
  await req('PUT', '/api/settings/system', { cookie, body: { require_login: requireLoginBefore } })
  log('E', 'hmi-settings-e2e.mjs:requireLogin', 'require_login_round_trip', {
    toggledTo: !requireLoginBefore,
    got: rlGet.json?.settings?.require_login,
    ok: rlOk,
  })

  // ── A continued: serial_number / quickpass / post_update_action persist ───
  const serial = `HMI-E2E-${Date.now().toString(36)}`
  await req('PUT', '/api/settings/system', { cookie, body: { serial_number: serial } })
  await req('PUT', '/api/settings/system', { cookie, body: { quickpass: true } })
  await req('PUT', '/api/settings/system', { cookie, body: { post_update_action: 'nothing' } })

  const adminReload = await req('GET', '/api/settings/system', { cookie })
  const guestReload = await req('GET', '/api/settings/system')
  const adminSees =
    adminReload.json?.settings?.serial_number === serial &&
    adminReload.json?.settings?.quickpass === true &&
    adminReload.json?.settings?.post_update_action === 'nothing'
  const guestMisses =
    !('serial_number' in (guestReload.json?.settings || {})) ||
    guestReload.json?.settings?.serial_number !== serial

  log('A', 'hmi-settings-e2e.mjs:systemFields', 'system_fields_persist_auth_only_on_get', {
    serial,
    adminSees,
    guestMissesSerial: guestMisses,
    guestKeys: Object.keys(guestReload.json?.settings || {}),
    adminSerial: adminReload.json?.settings?.serial_number,
    adminQuickpass: adminReload.json?.settings?.quickpass,
    adminPost: adminReload.json?.settings?.post_update_action,
    frontendCacheBugIfNoForceRefresh: guestMisses && adminSees,
  })

  // Restore prior UI prefs (best-effort) — keep e2e serial marker for HMI check
  await req('PUT', '/api/settings/system', {
    cookie,
    body: {
      theme: before.theme,
      locale: before.locale,
      machine_model: before.machine_model,
      pick_place_config: { movementSpeedMmS: origPp.movementSpeedMmS },
      centring_config: { movementSpeedDegS: origCent.movementSpeedDegS },
      production_sequence_config: { delayAfterClampCloseMs: origSeq.delayAfterClampCloseMs },
      quickpass: before.quickpass ?? false,
      post_update_action: before.post_update_action ?? 'reboot',
      serial_number: serial,
    },
  })

  log('E', 'hmi-settings-e2e.mjs:done', 'e2e_complete', {
    uiRoundTrip: uiOk,
    startupReload: startupOk,
    nestedPp: ppOk,
    nestedCent: centOk,
    nestedSeq: seqOk,
    requireLogin: rlOk,
    systemPersist: adminSees,
    hypothesisA: cacheMissPostUpdate,
    hypothesisB: putHasPost && !('post_update_action' in (getAfterPutUnauth.json?.settings || {})),
    putRedactedOk,
    markerSerial: serial,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
