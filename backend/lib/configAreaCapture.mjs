import { getEtherCATManager } from './ethercat.mjs'
import { assertDryCycleSafety } from './mechanicalDryCycle.mjs'
import { getMachineInitStatus } from './machineInit.mjs'
import { getLifecycleSnapshot } from './machineLifecycle.mjs'
import { getMaintenanceMode } from './maintenanceMode.mjs'
import { isSetupInProgress } from './machineSetupHealth.mjs'
import { isProductionBusy } from './productionJobQueue.mjs'
import { ownsConfigAreaFocus } from './panelFocus.mjs'
import { isSettingsPageActive } from './hmiPageLease.mjs'
import { getProductionTiming, readStartButton } from './productionSequence.mjs'
import { getPneumaticSnapshot, setPneumaticOutputs } from './pneumatics.mjs'
import { captureRealtimeFrameWithLighting, getRealtimeReference, getRealtimeSnapshot, isRealtimeLightingBusy, realtimeStatus } from './realtimeInspectionClient.mjs'
import { acquireConfigAreaCapture, assertConfigAreaCaptureNotAborted } from './configAreaCaptureLock.mjs'
import { armClampTriggerRearmAfterBothValvesOpen } from './clampTriggerMode.mjs'

const conflict = message => Object.assign(new Error(message), { status: 409 })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const CAMERA_WATCHDOG_MS = 75_000

export function assertConfigAreaPageAccess(focusToken) {
  if (!isSettingsPageActive() || !ownsConfigAreaFocus(focusToken)) {
    throw conflict('HMI is no longer on the Config Area page. Reopen Config Area.')
  }
}

/** Capture one product frame with the same pneumatic delays as production. */
export async function captureConfigAreaFrame(deps = {}) {
  const ecm = deps.ecm ?? getEtherCATManager()
  const write = deps.write ?? setPneumaticOutputs
  const camera = deps.camera ?? captureRealtimeFrameWithLighting
  const pause = deps.pause ?? sleep
  const timing = deps.timing ?? getProductionTiming()
  const expectedReferenceId = deps.expectedReferenceId
  const expectedBackgroundCaptureId = deps.expectedBackgroundCaptureId
  const focusToken = deps.focusToken
  const startHeld = deps.startHeld ?? readStartButton
  const safety = deps.safety ?? assertDryCycleSafety
  const afterClampsOpen = deps.afterClampsOpen ?? armClampTriggerRearmAfterBothValvesOpen
  const machineReady = deps.machineReady ?? (() => {
    assertConfigAreaCaptureNotAborted()
    const init = getMachineInitStatus()
    const lifecycle = getLifecycleSnapshot()
    if (!init.referenceLoaded || !init.initialized || !lifecycle.machineInitialized) throw conflict('Load and initialize a product reference before capturing')
    if (!expectedReferenceId || init.referenceId !== expectedReferenceId) throw conflict('Loaded product reference changed. Reopen Config Area.')
    if (lifecycle.isProductionActive || lifecycle.isSafetyLockout || lifecycle.isError || isProductionBusy() || isSetupInProgress() || getMaintenanceMode().active) {
      throw conflict('Machine must be idle before Config Area capture')
    }
    assertConfigAreaPageAccess(focusToken)
  })
  const inspectionReady = deps.inspectionReady ?? (async () => {
    if (isRealtimeLightingBusy()) throw conflict('Camera is busy')
    const status = realtimeStatus(await getRealtimeSnapshot())
    if (status.active !== false || status.disable_pending === true) throw conflict('Inspection slave has not confirmed it is idle')
  })
  const referenceReady = deps.referenceReady ?? (async () => {
    const reference = await getRealtimeReference()
    const id = reference?.capture_id ?? reference?.active_capture_id ?? reference?.reference?.capture_id
    if (!id) throw conflict('Save an empty-fixture background before capturing a product frame')
    if (!expectedBackgroundCaptureId || id !== expectedBackgroundCaptureId) throw conflict('Empty-fixture background changed. Reopen Config Area.')
  })
  const outputsReady = deps.outputsReady ?? (async () => {
    const { pneumatics } = await getPneumaticSnapshot(ecm)
    if (pneumatics.leverUp || pneumatics.ppClamp || pneumatics.puller) {
      throw conflict('Lever and pick-and-place clamp must be in their ready positions before capture')
    }
  })
  const release = acquireConfigAreaCapture()
  let motionStarted = false
  let pendingCamera = null
  let deferRelease = false
  try {
    if (!ecm?.isInitialized) throw conflict('Machine connection lost')
    machineReady()
    await safety(ecm)
    await inspectionReady()
    await referenceReady()
    await outputsReady()
    if (!await startHeld(ecm)) throw conflict('Hold the physical Start button, then tap Capture one frame')

    const step = async (outputs, delayMs, requireStart = true) => {
      machineReady()
      await safety(ecm)
      if (requireStart && !await startHeld(ecm)) throw conflict('Keep holding the physical Start button until the image is captured')
      assertConfigAreaCaptureNotAborted()
      motionStarted = true
      await write(ecm, outputs)
      if (outputs.clampRight === false) afterClampsOpen()
      await pause(delayMs)
    }
    await step({ clampRight: true, clampLeft: true }, timing.delayAfterClampCloseMs)
    await step({ leverUp: true }, timing.delayAfterLeverUpMs)
    await step({ ppClamp: true }, timing.delayAfterPpClampCloseMs)
    machineReady()
    await safety(ecm)
    await inspectionReady()
    await referenceReady()
    if (!await startHeld(ecm)) throw conflict('Keep holding the physical Start button until the image is captured')
    assertConfigAreaCaptureNotAborted()
    pendingCamera = Promise.resolve().then(() => camera('zone-reference'))
    let watchdog
    const deadline = new Promise((_, reject) => {
      watchdog = setTimeout(() => reject(Object.assign(new Error('Camera capture timed out; pneumatics were released'), { status: 504, code: 'CAPTURE_WATCHDOG' })), deps.cameraTimeoutMs ?? CAMERA_WATCHDOG_MS)
    })
    let frame
    try { frame = await Promise.race([pendingCamera, deadline]) }
    catch (error) {
      if (error?.code === 'CAPTURE_WATCHDOG') deferRelease = true
      throw error
    } finally { clearTimeout(watchdog) }
    if (frame?.archive_status !== 'COMPLETE' || !frame.capture_id || !frame.image_url) {
      throw new Error('Inspection slave did not return a complete image capture')
    }
    await pause(timing.delayAfterVisionCaptureMs)
    await step({ ppClamp: false }, timing.delayAfterPickClampOpenMs, false)
    await step({ leverUp: false }, timing.delayAfterLeverDownMs, false)
    await step({ clampRight: false, clampLeft: false }, timing.delayAfterClampOpenMs, false)
    motionStarted = false
    return frame
  } catch (error) {
    if (!motionStarted) throw error
    try {
      // A failed capture or interrupted step must release the valves immediately.
      await write(ecm, { ppClamp: false, leverUp: false, clampRight: false, clampLeft: false })
      afterClampsOpen()
    } catch (cleanupError) {
      throw Object.assign(new Error(`${error?.message ?? error}; could not release pneumatics: ${cleanupError?.message ?? cleanupError}`), { status: 503 })
    }
    throw error
  } finally {
    // An uncertain camera request retains the production gate until it settles.
    if (deferRelease && pendingCamera) void pendingCamera.finally(release).catch(() => undefined)
    else release()
  }
}
