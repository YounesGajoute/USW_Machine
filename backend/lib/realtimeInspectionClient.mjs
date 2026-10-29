/**
 * Client for the standalone Real-Time Inspection V2 slave.
 *
 * The legacy Vision Pi client remains in visionProgramTools.mjs. This client
 * deliberately uses the slave's /realtime API and never exposes its URL to the
 * browser.
 */

import { randomUUID } from 'node:crypto'
import { normalizeRealtimeConfig } from './realtimeInspectionConfig.mjs'

import { assertUnversionedVisionAllowed } from './visionSyncMode.mjs'
import { dispatchVersionedRun, reconcileUnresolvedRuns } from './visionSync/dispatch.mjs'

const DEFAULT_BASE_URL = 'http://192.168.10.2:3174/api'
const DEFAULT_TIMEOUT_MS = 15_000
const CAPTURE_TIMEOUT_MS = 65_000
const RUN_TIMEOUT_MS = 95_000

let _readSystemSettings = () => ({})
let _setLighting = null
let _lightingTail = Promise.resolve()
let _lightingBusy = false
let _configuredReferenceId = null
let _configuredReferenceFingerprint = null
let _configuredConfigFingerprint = null
let _readReferenceFingerprint = null
let _referenceSyncState = null
const imagePaths = new Map()
const imageTokensByPath = new Map()

export function initRealtimeInspectionClient({ readSystemSettings, setLighting, readReferenceFingerprint }) {
  _readSystemSettings = readSystemSettings ?? (() => ({}))
  _setLighting = setLighting ?? null
  _readReferenceFingerprint = readReferenceFingerprint ?? null
}

export function realtimeConfigFingerprint(config) {
  const value = normalizeRealtimeConfig(config)
  const group = (source, fields) => ({
    enabled: source?.enabled,
    checks: Object.fromEntries(fields.map(name => [name, source?.checks?.[name]?.enabled])),
    values: Object.fromEntries([
      'expected_length_mm', 'length_tolerance_mm', 'expected_width_mm', 'width_tolerance_mm',
      'position_tolerance_mm', 'expected_diameter_mm', 'diameter_tolerance_mm',
    ].map(name => [name, source?.[name]])),
  })
  return JSON.stringify({
    calibration: {
      x: value.calibration?.mm_per_px_x, y: value.calibration?.mm_per_px_y,
      valid: value.calibration?.valid,
    },
    welding_splice: group(value.welding_splice, ['length', 'width', 'position']),
    heat_shrink_tube: group(value.heat_shrink_tube, ['length', 'diameter', 'position']),
  })
}

export function setRealtimeConfiguredReferenceId(referenceId, config = null) {
  _configuredReferenceId = referenceId == null ? null : String(referenceId)
  _configuredReferenceFingerprint = _configuredReferenceId && _readReferenceFingerprint
    ? _readReferenceFingerprint(_configuredReferenceId) : null
  _configuredConfigFingerprint = config ? realtimeConfigFingerprint(config) : null
}

export function getRealtimeConfiguredReferenceId() {
  if (!_configuredReferenceId) return null
  if (_readReferenceFingerprint && _readReferenceFingerprint(_configuredReferenceId) !== _configuredReferenceFingerprint) return null
  return _configuredReferenceId
}

export function setRealtimeReferenceSyncState(referenceId, blockReason = null) {
  _referenceSyncState = referenceId ? { referenceId, blockReason } : null
}

export function getRealtimeReferenceSyncBlockReason(referenceId) {
  return _referenceSyncState?.referenceId === referenceId ? _referenceSyncState.blockReason : null
}

export async function assertRealtimeConfigCurrent() {
  if (!_configuredConfigFingerprint || realtimeConfigFingerprint(await getRealtimeConfig()) !== _configuredConfigFingerprint) {
    const error = new Error('Inspection slave configuration changed — save V2 settings again')
    error.status = 409
    throw error
  }
}

export async function verifyRealtimeConfig(expected) {
  const actual = await getRealtimeConfig()
  if (realtimeConfigFingerprint(actual) !== realtimeConfigFingerprint(expected)) {
    const error = new Error('Inspection slave did not retain the selected checks, values and tolerances')
    error.status = 409
    throw error
  }
  for (const key of ['weld_zone', 'heat_shrink_zone', 'heat_shrink_zones', 'weld_center_left_x_px', 'weld_center_right_x_px', 'weld_center_x_px']) {
    if (expected[key] !== undefined && JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      const error = new Error(`Inspection slave did not retain ${key} while applying the product recipe`)
      error.status = 409
      throw error
    }
  }
  return actual
}

function getConfig() {
  const settings = _readSystemSettings?.() ?? {}
  const raw = settings.realtime_inspection_url ?? process.env.REALTIME_INSPECTION_URL ?? DEFAULT_BASE_URL
  const baseUrl = String(raw).replace(/\/$/, '')
  return { baseUrl }
}

/** Use the same configured slave address for production calls and health probes. */
export function getRealtimeInspectionBaseUrl() { return getConfig().baseUrl }

function headers(extra = {}) {
  return { Accept: 'application/json', 'Content-Type': 'application/json', ...extra }
}

function timeoutFor(path, method) {
  if (path.includes('/camera/capture')) return CAPTURE_TIMEOUT_MS
  if (method === 'POST' && path.endsWith('/run')) return RUN_TIMEOUT_MS
  return DEFAULT_TIMEOUT_MS
}

async function request(path, { method = 'GET', body, signal, productionAuth = false } = {}) {
  const { baseUrl } = getConfig()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutFor(path, method))
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: headers(productionAuth && process.env.VISION_MASTER_TO_SLAVE_TOKEN
        ? { Authorization: `Bearer ${process.env.VISION_MASTER_TO_SLAVE_TOKEN}` } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type') ?? ''
    const data = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : await response.text()
    return { ok: response.ok, status: response.status, data }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    err.code = err.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE'
    err.notSent = ['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(err.cause?.code)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function unwrap(outcome) {
  if (outcome.ok) return outcome.data
  const payload = outcome.data && typeof outcome.data === 'object' ? outcome.data : {}
  const message = payload.error?.message ?? payload.error ?? payload.message ?? `Inspection slave request failed (${outcome.status})`
  const error = new Error(String(message))
  error.status = outcome.status
  error.payload = payload
  throw error
}

export async function getRealtimeSnapshot() {
  return unwrap(await request('/realtime/inspection/snapshot'))
}

export async function getRealtimeConfig() {
  return normalizeRealtimeConfig(unwrap(await request('/config')))
}

export async function putRealtimeConfig(config) {
  assertUnversionedVisionAllowed()
  return unwrap(await request('/realtime/inspection/config', { method: 'PUT', body: config }))
}

export async function captureRealtimeFrame(partId) {
  const submitted = unwrap(await request('/camera/capture', { method: 'POST', body: { part_id: partId, async: true } }))
  const id = submitted?.capture_id ?? submitted?.capture?.capture_id
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Inspection slave did not return a capture ID')
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const status = await getRealtimeCaptureStatus(id)
    const detail = status?.capture ?? status
    const archiveStatus = detail?.archive_status ?? status?.archive_status
    if (archiveStatus === 'FAILED') throw new Error(detail?.archive_error ?? detail?.error ?? 'Inspection capture storage failed')
    if (archiveStatus === 'COMPLETE') return {
      ...submitted, ...detail, capture_id: id, archive_status: 'COMPLETE',
      image_url: detail?.image_url ?? submitted?.image_url ?? `/api/captures/${encodeURIComponent(id)}/image`,
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const error = new Error('Inspection capture storage timed out')
  error.code = 'CAPTURE_ARCHIVE_TIMEOUT'
  throw error
}

export async function getRealtimeCaptureStatus(id) {
  return unwrap(await request(`/captures/${encodeURIComponent(id)}/status`))
}

export async function putRealtimeZones(zones) {
  return unwrap(await request('/realtime/inspection/zones', { method: 'PUT', body: zones }))
}

export async function getRealtimeReference() {
  return unwrap(await request('/realtime/inspection/reference'))
}

export async function createRealtimeReferenceFromCapture(captureId) {
  return unwrap(await request(`/realtime/inspection/reference/from-capture/${encodeURIComponent(String(captureId))}`, { method: 'POST' }))
}

export async function enableRealtimeInspection() {
  assertUnversionedVisionAllowed()
  return unwrap(await request('/realtime/inspection/enable', { method: 'POST' }))
}

export async function disableRealtimeInspection() {
  assertUnversionedVisionAllowed()
  return unwrap(await request('/realtime/inspection/disable', { method: 'POST' }))
}

export async function runRealtimeInspection() {
  assertUnversionedVisionAllowed()
  let before = null
  try { before = await getRealtimeSnapshot() } catch { /* Run will report the actual error. */ }
  try {
    return unwrap(await request('/realtime/inspection/run', { method: 'POST' }))
  } catch (error) {
    if (error?.notSent) throw error
    if (error?.code !== 'UPSTREAM_TIMEOUT' && error?.code !== 'UPSTREAM_UNREACHABLE') throw error
    return reconcileRealtimeRun({ before })
  }
}

/** Reconcile a timed-out or network-uncertain run until the slave settles. */
export async function reconcileRealtimeRun({ before = null, timeoutMs = 120_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      last = await getRealtimeSnapshot()
      const status = last?.status ?? last
      const result = last?.result ?? status?.last_result ?? last?.last_result
      const previous = before?.result ?? before?.status?.last_result ?? before?.last_result
      if (!status?.active && result != null && JSON.stringify(result) !== JSON.stringify(previous)) return last
    } catch {
      // Keep polling: the network may be transient during a completed run.
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  const error = new Error('Inspection run state could not be reconciled')
  error.code = 'RUN_STATE_UNKNOWN'
  error.snapshot = last
  throw error
}

/**
 * Serialize all V2 lighting users. A queued operation owns the light until its
 * capture/run completes, including error and reconciliation paths.
 */
export function withRealtimeLighting(operation) {
  const run = _lightingTail.then(async () => {
    if (!_setLighting) throw new Error('Machine lighting is not available')
    _lightingBusy = true
    try {
      await _setLighting(true)
      // The camera stream may still hold frames from before the lamp switched
      // on. Let several frames pass before taking the inspection snapshot.
      await new Promise(resolve => setTimeout(resolve, 800))
      return await operation()
    } finally {
      try { await _setLighting(false) } finally { _lightingBusy = false }
    }
  })
  _lightingTail = run.catch(() => undefined)
  return run
}

export function isRealtimeLightingBusy() { return _lightingBusy }

export async function waitForRealtimeDisabled({ timeoutMs = 120_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const snapshot = await getRealtimeSnapshot()
      const status = snapshot.status ?? snapshot
      if (!status.active && !status.enabled) return snapshot
    } catch { /* Keep polling while the slave state is uncertain. */ }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  const error = new Error('Inspection disable is still pending')
  error.code = 'DISABLE_PENDING'
  throw error
}

export function realtimeStatus(snapshot) { return snapshot?.status ?? snapshot ?? {} }

export function realtimeVerdict(data) {
  const result = data?.result ?? data?.last_result ?? realtimeStatus(data)?.last_result ?? data
  const value = typeof result === 'string' ? result : result?.verdict ?? result?.outcome ?? result?.result ?? result?.status ?? data?.verdict ?? data?.outcome
  if (value === 'PASS' || value === 'OK') return 'PASS'
  if (value === 'FAIL' || value === 'NG') return 'FAIL'
  return 'UNKNOWN'
}

export async function runRealtimeInspectionWithLighting() {
  // Reject before acquiring the lighting lease or changing any physical output.
  assertUnversionedVisionAllowed()
  return withRealtimeLighting(async () => {
    try {
      const result = await runRealtimeInspection()
      await waitForPendingDisable()
      return result
    } catch (error) {
      if (error?.code === 'RUN_STATE_UNKNOWN') await waitUntilRealtimeIdle()
      throw error
    }
  })
}

/** Versioned, durable camera run reserved for the mechanical-inspection cycle. */
export async function runSynchronizedMechanicalInspectionWithLighting(referenceId) {
  if (!referenceId || typeof referenceId !== 'string') throw new Error('A loaded reference is required for inspection')
  const runId = randomUUID()
  return withRealtimeLighting(async () => {
    const deadline = Date.now() + 120_000
    let accepted = null
    // The run ID stays fixed across uncertain responses. The Slave journal
    // deduplicates it, so a lost POST response cannot dispatch a second run.
    while (!accepted && Date.now() < deadline) {
      try {
        accepted = unwrap(await request('/vision-sync/mechanical-inspection-runs', {
          method: 'POST', body: { runId, referenceId },
        }))
      } catch (error) {
        if (error?.status) throw error
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    if (!accepted?.ledgerId) throw new Error(`Inspection outcome unknown for run ${runId}; do not repeat automatically`)
    let record = accepted
    while (Date.now() < deadline) {
      if (record.state === 'COMPLETED') return { result: record.result, runId, ledgerId: record.ledgerId }
      if (record.state === 'FAILED' || record.state === 'UNKNOWN_OUTCOME') {
        throw new Error(`Inspection ${record.state.toLowerCase()}: ${record.error ?? 'See the Slave run journal'}`)
      }
      await new Promise(resolve => setTimeout(resolve, 500))
      try {
        record = unwrap(await request(`/vision-sync/runs/${encodeURIComponent(runId)}?ledgerId=${encodeURIComponent(accepted.ledgerId)}`))
      } catch (error) {
        if (error?.status && error.status !== 503) throw error
      }
    }
    throw new Error(`Inspection outcome unknown for run ${runId}; check the Slave journal before another cycle`)
  })
}

/** Granted production inspection: exact durable run identity, no POST retry. */
export async function runVersionedProductionInspectionWithLighting({ store, ticketProvider, referenceId }) {
  return withRealtimeLighting(async () => {
    const deadline = Date.now() + 10_000
    let ticket = null
    while (Date.now() < deadline) {
      ticket = ticketProvider()
      if (ticket?.binding?.referenceId === referenceId && ticket.expiresAt > Date.now() + 1_000) break
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    if (!ticket || ticket.binding?.referenceId !== referenceId || ticket.expiresAt <= Date.now() + 1_000) {
      throw new Error('Installed Vision Slave production grant expired before inspection')
    }
    return dispatchVersionedRun({ store, ticket,
      post: body => request('/vision-sync/runs', { method: 'POST', body, productionAuth: true }).then(unwrap),
      get: (runId, ledgerId) => request(`/vision-sync/runs/${encodeURIComponent(runId)}?ledgerId=${encodeURIComponent(ledgerId)}`, { productionAuth: true }).then(unwrap),
    })
  })
}

export async function reconcileVersionedProductionRuns(store) {
  return reconcileUnresolvedRuns({ store,
    get: (runId, ledgerId) => request(`/vision-sync/runs/${encodeURIComponent(runId)}?ledgerId=${encodeURIComponent(ledgerId)}`, { productionAuth: true }).then(unwrap),
  })
}

export async function captureRealtimeFrameWithLighting(partId) {
  return withRealtimeLighting(async () => {
    try {
      const result = await captureRealtimeFrame(partId)
      await waitForPendingDisable()
      return result
    } catch (error) {
      if (!error?.notSent && (error?.code === 'UPSTREAM_TIMEOUT' || error?.code === 'UPSTREAM_UNREACHABLE')) {
        await waitUntilRealtimeIdle()
      }
      throw error
    }
  })
}

async function waitForPendingDisable() {
  try {
    const status = realtimeStatus(await getRealtimeSnapshot())
    if (status.disable_pending) await waitForRealtimeDisabled()
  } catch (error) {
    if (error?.code === 'DISABLE_PENDING') {
      await waitUntilRealtimeIdle()
    } else if (error?.code === 'UPSTREAM_UNREACHABLE' || error?.code === 'UPSTREAM_TIMEOUT') {
      // The operation already returned its completed response.
      return
    } else {
      throw error
    }
  }
}

export async function waitUntilRealtimeIdle({ timeoutMs = 120_000, intervalMs = 1000 } = {}) {
  // A lost response does not tell us whether the camera is still working.
  // Retain the lighting lease until the slave positively reports idle.
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const status = realtimeStatus(await getRealtimeSnapshot())
      if (status.active === false && status.disable_pending !== true) return
    } catch { /* Network state remains unknown. */ }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw Object.assign(new Error('Inspection slave state could not be confirmed idle'), { status: 504, code: 'INSPECTION_STATE_UNKNOWN' })
}

/** Only relative API paths actually returned by the slave may be proxied. */
export function normalizeRealtimeImagePath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) return null
  if (rawPath.startsWith('//') || rawPath.includes('\\') || rawPath.includes('..') || rawPath.includes('#')) return null
  if (!rawPath.startsWith('/api/')) return null
  return rawPath
}

export function registerRealtimeImage(rawPath) {
  const path = normalizeRealtimeImagePath(rawPath)
  if (!path) return null
  const existing = imageTokensByPath.get(path)
  if (existing && imagePaths.get(existing)?.expires > Date.now()) {
    return `/api/realtime-v2/images/${existing}`
  }
  const token = randomUUID()
  imagePaths.set(token, { path, expires: Date.now() + 30 * 60_000 })
  imageTokensByPath.set(path, token)
  if (imagePaths.size > 512) {
    for (const [key, value] of imagePaths) {
      if (value.expires < Date.now() || imagePaths.size > 512) {
        imagePaths.delete(key)
        if (imageTokensByPath.get(value.path) === key) imageTokensByPath.delete(value.path)
      }
    }
  }
  return `/api/realtime-v2/images/${token}`
}

export function proxyRealtimeImageUrls(data) {
  if (Array.isArray(data)) return data.map(proxyRealtimeImageUrls)
  if (!data || typeof data !== 'object') return data
  const output = {}
  for (const [key, value] of Object.entries(data)) {
    if ((key === 'image_url' || key === 'image') && typeof value === 'string' && value.startsWith('/')) {
      output[key] = registerRealtimeImage(value)
    } else if (key === 'image_urls' && value && typeof value === 'object') {
      output[key] = Object.fromEntries(Object.entries(value).map(([name, url]) => [name, url == null ? null : registerRealtimeImage(url)]))
    } else {
      output[key] = proxyRealtimeImageUrls(value)
    }
  }
  return output
}

export async function fetchRealtimeImage(token) {
  const entry = imagePaths.get(token)
  if (!entry || entry.expires < Date.now()) {
    const error = new Error('Invalid inspection image path')
    error.status = 404
    throw error
  }
  const { baseUrl } = getConfig()
  const response = await fetch(`${baseUrl.replace(/\/api\/?$/, '')}${entry.path}`, {
    headers: headers({ Accept: 'image/*' }),
    signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
  })
  if (!response.ok) {
    const error = new Error(`Inspection image unavailable (${response.status})`)
    error.status = response.status
    throw error
  }
  if (!(response.headers.get('content-type') ?? '').startsWith('image/')) {
    const error = new Error('Inspection slave returned a non-image response')
    error.status = 502
    throw error
  }
  return response
}

