import { Router } from 'express'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import {
  captureRealtimeFrameWithLighting,
  assertRealtimeConfigCurrent,
  createRealtimeReferenceFromCapture,
  disableRealtimeInspection,
  enableRealtimeInspection,
  fetchRealtimeImage,
  getRealtimeConfiguredReferenceId,
  getRealtimeConfig,
  getRealtimeCaptureStatus,
  getRealtimeReference,
  getRealtimeSnapshot,
  proxyRealtimeImageUrls,
  putRealtimeZones,
  realtimeStatus,
  runRealtimeInspectionWithLighting,
  waitForRealtimeDisabled,
  registerRealtimeImage,
} from './realtimeInspectionClient.mjs'
import { getRealtimeConfigForReference, getVisionSettingsForReference, saveRealtimeInspectionForReference } from './realtimeInspectionReference.mjs'
import { validateRealtimeZones, verifyRealtimeZones } from './realtimeZones.mjs'
import { captureConfigAreaFrame } from './configAreaCapture.mjs'
import { getMachineOperationAccess } from './machineOperationAccess.mjs'
import { isVisionSyncProduction } from './visionSyncMode.mjs'

function errorResponse(error, res) {
  const status = error?.status ?? (error?.code === 'UPSTREAM_TIMEOUT' ? 504 : error?.code === 'UPSTREAM_UNREACHABLE' ? 502 : 500)
  res.status(status).json({ error: error?.message ?? 'Inspection slave request failed', code: error?.code ?? null, ...(error?.payload ?? {}), ...(error?.saved ? { saved: true } : {}) })
}

function asyncRoute(fn) { return (req, res) => Promise.resolve(fn(req, res)).catch(error => errorResponse(error, res)) }

function captureId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    const error = new Error('A valid capture ID is required')
    error.status = 400
    throw error
  }
  return value
}

async function requireArchivedCapture(id) {
  const response = await getRealtimeCaptureStatus(id)
  const state = response?.capture?.archive_status ?? response?.archive_status
  if (state !== 'COMPLETE') throw Object.assign(new Error(state === 'FAILED' ? 'Capture storage failed' : 'Capture storage is incomplete'), { status: 409 })
}

async function requireInspectionIdle() {
  const status = realtimeStatus(await getRealtimeSnapshot())
  if (status.active || status.disable_pending) {
    throw Object.assign(new Error('Inspection slave is busy'), { status: 409 })
  }
}

async function saveAndVerifyBackground(id) {
  await createRealtimeReferenceFromCapture(id)
  try {
    const reference = await getRealtimeReference()
    const activeId = reference?.capture_id ?? reference?.active_capture_id ?? reference?.reference?.capture_id
    if (activeId !== id) {
      throw Object.assign(new Error('Inspection slave did not confirm the new background image'), { status: 409 })
    }
    return reference
  } catch (error) {
    error.saved = true
    throw error
  }
}

export function createRealtimeInspectionRouter({ db, getLoadedReferenceId, getLoadedReferenceSelection,
  getVisionSyncStatus, runVersionedInspection, isMachineBusy = () => false,
  requireAuth, captureZone = captureConfigAreaFrame }) {
  const router = Router()
  const selectionEpoch = randomUUID()
  router.use(requireAuth)

  const loadedSelection = () => {
    const selection = getLoadedReferenceSelection?.()
    return {
      referenceId: selection?.referenceId ?? getLoadedReferenceId?.() ?? null,
      selectionRevision: selection?.selectionRevision ?? null,
    }
  }

  router.get('/settings', (_req, res) => {
    const selection = loadedSelection()
    res.json({
      ...getVisionSettingsForReference(db, selection.referenceId),
      selectionEpoch,
      selectionRevision: selection.selectionRevision,
      syncStatus: getVisionSyncStatus?.() ?? null,
    })
  })
  router.put('/settings', asyncRoute(async (req, res) => {
    const selection = loadedSelection()
    const referenceId = selection.referenceId
    // During a rolling HMI deployment an already-open tab may not yet send the
    // revision fields. Keep that legacy same-reference save compatible; once a
    // client supplies concurrency identity, enforce it strictly.
    const epochChanged = req.body?.selectionEpoch != null && req.body.selectionEpoch !== selectionEpoch
    const revisionChanged = getLoadedReferenceSelection && req.body?.selectionRevision != null &&
      req.body.selectionRevision !== selection.selectionRevision
    if (!referenceId || req.body?.referenceId !== referenceId || epochChanged || revisionChanged) {
      return res.status(409).json({
        error: 'The loaded reference on the master changed.',
        code: 'REFERENCE_CHANGED',
        currentReferenceId: referenceId,
        selectionEpoch,
        selectionRevision: selection.selectionRevision,
      })
    }
    if (!req.body?.checks || typeof req.body.checks !== 'object') {
      return res.status(400).json({ error: 'Inspection checks are required' })
    }
    const result = await saveRealtimeInspectionForReference({
      db, referenceId, getLoadedReferenceId, getLoadedReferenceSelection,
      expectedSelectionRevision: selection.selectionRevision,
      draft: req.body?.config ?? {}, checks: req.body.checks,
      delivery: 'pull',
    })
    res.json({
      ...getVisionSettingsForReference(db, referenceId),
      ...result,
      selectionEpoch,
      selectionRevision: loadedSelection().selectionRevision,
      syncStatus: getVisionSyncStatus?.() ?? null,
    })
  }))

  router.get('/snapshot', asyncRoute(async (_req, res) => {
    res.json({ ...proxyRealtimeImageUrls(await getRealtimeSnapshot()), configured_reference_id: getRealtimeConfiguredReferenceId() })
  }))
  router.get('/config', asyncRoute(async (_req, res) => {
    res.json(await getRealtimeConfigForReference(db, getLoadedReferenceId()))
  }))
  router.put('/config', asyncRoute(async (req, res) => {
    const referenceId = getLoadedReferenceId()
    if (!referenceId || req.body?.referenceId !== referenceId) {
      return res.status(409).json({ error: 'Load the selected product reference before saving inspection settings' })
    }
    const saved = await saveRealtimeInspectionForReference({
      db, referenceId, getLoadedReferenceId, draft: req.body?.config ?? {},
    })
    res.json(saved)
  }))

  router.post('/capture/zone', asyncRoute(async (req, res) => {
    const reason = getMachineOperationAccess().denialReason(req)
    if (reason) return res.status(403).json({ error: reason })
    res.json(proxyRealtimeImageUrls(await captureZone({
      expectedReferenceId: req.body?.referenceId,
      expectedBackgroundCaptureId: req.body?.backgroundCaptureId,
      focusToken: req.body?.focusToken,
    })))
  }))
  router.post('/capture/background', asyncRoute(async (_req, res) => {
    await requireInspectionIdle()
    res.json(proxyRealtimeImageUrls(await captureRealtimeFrameWithLighting('empty-fixture')))
  }))
  router.post('/capture/empty-fixture', asyncRoute(async (_req, res) => {
    await requireInspectionIdle()
    const capture = await captureRealtimeFrameWithLighting('empty-fixture')
    const id = captureId(capture.capture_id ?? capture.capture?.capture_id)
    const reference = await saveAndVerifyBackground(id)
    res.json({ capture: proxyRealtimeImageUrls(capture), reference: proxyRealtimeImageUrls(reference) })
  }))
  router.put('/zones', asyncRoute(async (req, res) => {
    if (!getLoadedReferenceId() || req.body?.referenceId !== getLoadedReferenceId()) {
      return res.status(409).json({ error: 'Loaded product reference changed. Reopen Config Area before saving zones.' })
    }
    const status = realtimeStatus(await getRealtimeSnapshot())
    if (status.active || status.disable_pending) return res.status(409).json({ error: 'Inspection slave is busy' })
    const wasEnabled = status.enabled === true
    const before = await getRealtimeConfig()
    const zones = validateRealtimeZones({ ...req.body, reference_capture_id: captureId(req.body?.reference_capture_id) }, before)
    await requireArchivedCapture(zones.reference_capture_id)
    await putRealtimeZones(zones)
    const saved = verifyRealtimeZones(await getRealtimeConfig(), zones, before)
    if (!wasEnabled) return res.json({ saved, reenabled: false })
    try {
      const enabled = await enableRealtimeInspection()
      return res.json({ saved, reenabled: true, enabled })
    } catch (error) {
      return res.json({ saved, reenabled: false, reload_error: error.message })
    }
  }))
  router.get('/reference', asyncRoute(async (_req, res) => {
    res.json(proxyRealtimeImageUrls(await getRealtimeReference()))
  }))
  router.post('/reference/from-current-frame', asyncRoute(async (req, res) => {
    // The HMI requires explicit operator confirmation and a saved zone frame.
    if (req.body?.confirm_empty_fixture !== true) return res.status(400).json({ error: 'Confirm the fixture is empty' })
    const id = captureId(req.body?.capture_id)
    await requireInspectionIdle()
    await requireArchivedCapture(id)
    res.json(proxyRealtimeImageUrls(await saveAndVerifyBackground(id)))
  }))
  router.post('/enable', asyncRoute(async (_req, res) => {
    const referenceId = getLoadedReferenceId()
    if (!referenceId || getRealtimeConfiguredReferenceId() !== referenceId) {
      return res.status(409).json({ error: 'Save V2 inspection configuration for the loaded reference first' })
    }
    await assertRealtimeConfigCurrent()
    res.json(await enableRealtimeInspection())
  }))
  router.post('/disable', asyncRoute(async (_req, res) => {
    const response = await disableRealtimeInspection()
    if (response?.disable_pending) {
      const settled = await waitForRealtimeDisabled()
      return res.json({ ...response, snapshot: proxyRealtimeImageUrls(settled) })
    }
    return res.json(response)
  }))
  router.post('/run', asyncRoute(async (req, res) => {
    const denial = getMachineOperationAccess().denialReason(req)
    if (denial) return res.status(403).json({ error: denial })
    const referenceId = getLoadedReferenceId()
    if (isVisionSyncProduction()) {
      if (isMachineBusy()) return res.status(409).json({ error: 'Wait for the active machine cycle to finish' })
      const sync = getVisionSyncStatus?.()
      if (!referenceId || sync?.productionAuthorized !== true ||
          sync.referenceId !== referenceId || sync.desiredMode !== 'enabled') {
        return res.status(409).json({
          error: sync?.issues?.[0] ?? 'Vision Slave production grant is not installed for the loaded reference',
          syncStatus: sync ?? null,
        })
      }
      if (typeof runVersionedInspection !== 'function') {
        throw Object.assign(new Error('Master inspection dispatch is unavailable'), { status: 503 })
      }
      return res.json(proxyRealtimeImageUrls(await runVersionedInspection(referenceId)))
    }
    if (!referenceId || getRealtimeConfiguredReferenceId() !== referenceId) {
      return res.status(409).json({ error: 'Save V2 inspection configuration for the loaded reference first' })
    }
    await assertRealtimeConfigCurrent()
    const status = realtimeStatus(await getRealtimeSnapshot())
    if (status.active || status.disable_pending || status.can_run !== true) {
      return res.status(409).json({ error: 'Inspection is not ready to run', status })
    }
    res.json(proxyRealtimeImageUrls(await runRealtimeInspectionWithLighting()))
  }))

  router.get('/images/reference', asyncRoute(async (_req, res) => {
    const url = registerRealtimeImage('/api/realtime/inspection/reference/image')
    return res.redirect(url)
  }))
  router.get('/images/:token', asyncRoute(async (req, res) => {
    const response = await fetchRealtimeImage(req.params.token)
    res.set('Content-Type', response.headers.get('content-type'))
    res.set('Cache-Control', 'no-store')
    Readable.fromWeb(response.body).on('error', error => res.destroy(error)).pipe(res)
  }))

  return router
}
