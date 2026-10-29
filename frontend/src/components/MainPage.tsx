import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { StatusBar } from './StatusBar'
import { LIFECYCLE_STATE } from '@/types/machineLifecycle.types'
import { MachineVisualState } from '@/types/machineStatus.types'
import { MainCard } from './main/MainCard'
import { resolveFault, faultCategoryTitle, isActiveFault, buildUnmetConditions } from '@/lib/faultPresentation'
import { useVision } from '@/hooks/useVision'
import { InfoCard, INFO_CARD_ROW_HEIGHT } from './main/InfoCard'
import {
  broadcastReference,
  getReferenceById,
  type SerialBroadcastFailure,
} from '@/services/referencesApi'
import { useActiveReference } from '@/contexts/ActiveReferenceContext'
import {
  ensureReferenceHasVisionProgram,
  referenceUsesVision,
} from '@/lib/referenceVisionProgram'
import { useProductionCounts } from '@/hooks/useProductionCounts'
import { useMachineInitialization } from '@/hooks/useMachineInitialization'
import { useMachineOperationAccess } from '@/hooks/useMachineOperationAccess'
import { useLocale } from '@/contexts/LocaleContext'
import { runMachineStopProduction } from '@/services/machineInitApi'
import { fetchLastProductionCapture } from '@/services/visionService'
import { realtimeInspectionApi, normalizeRealtimeResult, type RealtimeResult } from '@/services/realtimeInspectionApi'
import { isNewProductionInspection } from '@/lib/realtimeResultGate.mjs'
import { inspectionPresentation, inspectionGroups } from '@/lib/realtimePresentation.mjs'
import { referenceHasShrinkTube } from '@/lib/referenceShrinkTube'
import { setupPhaseDetailMessage } from '@/lib/setupPhaseMessages'
import { productionPhaseDetailMessage } from '@/lib/productionPhaseMessages'
import { deriveCycleResultFromJob } from '@/lib/deriveCycleResultFromJob'
import { visionSyncIssueMessage } from '@/lib/visionSettingsSaveFeedback.mjs'
import type { VisionResult } from '@/types/vision.types'

export interface MainPageProps {
  /** When set, shown as the mode illustration with proper `alt` text. */
  modeImageSrc?: string
  /** Accessible name for the image when `modeImageSrc` is set (defaults to a generic illustration label). */
  modeImageAlt?: string
  /** `aria-label` for the empty illustration region when no `modeImageSrc` is provided. */
  modeImageAriaLabel?: string
  /** Machine model name, shown in the Info Card model badge. */
  modelName?: string
  showBarcodeSlot?: boolean
}

/**
 * Main view: Info, Main content, and Status regions.
 */
export function MainPage({
  modeImageSrc,
  modeImageAlt = 'Mode illustration',
  modeImageAriaLabel = 'Mode illustration',
  modelName,
  showBarcodeSlot = true,
}: MainPageProps) {
  const { colors } = useTheme()
  const { general } = useLocale()
  const { canOperateMachine } = useMachineOperationAccess()
  const vision = useVision()
  const { activeReference, setActiveReference, clearActiveReference } =
    useActiveReference()
  const [isRunning, setIsRunning] = useState(false)
  const [realtimeResult, setRealtimeResult] = useState<RealtimeResult | null>(null)
  const [realtimeResultReferenceId, setRealtimeResultReferenceId] = useState<string | null>(null)
  const lastFinishedAtRef = useRef<number | null>(null)
  const awaitingNewResultRef = useRef(false)
  const priorFinishedAtRef = useRef<number | null>(null)
  const priorInspectionRef = useRef<string | null>(null)
  const baselineCaptureIdRef = useRef<string | null>(null)
  const baselineKnownRef = useRef(false)
  const displayedCaptureIdRef = useRef<string | null>(null)
  const runStartedAtRef = useRef<number | null>(null)
  const runReferenceIdRef = useRef<string | null>(null)
  const resultPollDeadlineRef = useRef<number | null>(null)

  const beginProductionRun = useCallback(() => {
    vision.clearLastInspection()
    setRealtimeResult(null)
    setRealtimeResultReferenceId(null)
    awaitingNewResultRef.current = true
    priorFinishedAtRef.current = lastFinishedAtRef.current
    priorInspectionRef.current = null
    displayedCaptureIdRef.current = null
    runStartedAtRef.current = Date.now()
    runReferenceIdRef.current = activeReference?.id ?? null
    resultPollDeadlineRef.current = null
    setIsRunning(true)
  }, [vision.clearLastInspection, activeReference?.id])

  const [broadcastErr, setBroadcastErr] = useState<string | null>(null)
  const [broadcastWarn, setBroadcastWarn] = useState<string | null>(null)
  const [serialBroadcast, setSerialBroadcast] = useState<{
    referenceId: string
    sentTo: string[]
    failed: SerialBroadcastFailure[]
    skipped: boolean
  } | null>(null)
  const [isBroadcasting, setIsBroadcasting] = useState(false)

  const {
    status: machineStatus,
    machineInitialized,
    needsInitialization,
    lifecycleState: backendLifecycleState,
    productionError,
    initError,
    isInitializing,
    isRecovering,
    isProductionRunning,
    initButtonPressed,
    startButtonPressed,
    startProduction,
    setup,
    queueDepth,
    activeFault,
    canRunSetup,
    pnozCircuitRestored,
    isSafetyLockout,
    setupBlockReason,
    recoveryBlockReason,
    initPreconditions,
    setupPhase,
    productionPhase,
    lastJob,
    canStartProduction,
    productionBlockReason,
    clampTriggerMode,
    clampRightTriggered,
    clampLeftTriggered,
    clampRightDi,
    clampLeftDi,
    clampInhibitRight,
    clampInhibitLeft,
  } = useMachineInitialization({
    referenceId: activeReference?.id ?? null,
    onProductionStarted: beginProductionRun,
    machineOperationsEnabled: canOperateMachine,
  })
  lastFinishedAtRef.current = lastJob?.finishedAt ?? null

  const backendReferenceId = machineStatus?.referenceId ?? null
  const backendReferenceLoaded = machineStatus?.referenceLoaded === true
  /** Backend is authoritative; keep local ref only while broadcasting or backend agrees. */
  const effectiveReference =
    isBroadcasting || (backendReferenceLoaded && activeReference?.id === backendReferenceId)
      ? activeReference : null

  const sync = machineStatus?.visionSync
  const syncIssue = sync?.issues?.[0]
  const visionSyncWarning = effectiveReference?.vision_inspection_enabled &&
    !isBroadcasting && backendReferenceId === effectiveReference.id && sync &&
    !sync.productionAuthorized
    ? machineStatus?.productionBlockCode === 'VISION_SYNC_COMMISSIONING'
      ? `V2 inspection: ${machineStatus.productionBlockReason}`
      : syncIssue
        ? `V2 inspection: ${visionSyncIssueMessage(syncIssue)}`
        : !sync.connected
          ? 'V2 inspection: Vision Slave is disconnected; production grant unavailable.'
          : sync.state === 'failed'
            ? 'V2 inspection: Vision Slave synchronization failed.'
            : 'V2 inspection: Waiting for the Vision Slave production grant.'
    : null
  const requiredSerialPorts = effectiveReference
    ? [
        ...(effectiveReference.send_barcode_weld_enabled ? ['weld'] : []),
        ...(effectiveReference.send_barcode_shrink_enabled ? ['shrink'] : []),
      ] : []
  const serialMissing = serialBroadcast && effectiveReference &&
    serialBroadcast.referenceId === effectiveReference.id
    ? requiredSerialPorts.filter(port => !serialBroadcast.sentTo.includes(port)) : []
  const serialMissingAdapter = serialBroadcast?.failed.filter(f =>
    serialMissing.includes(f.port) && /USB serial adapter is missing at /.test(f.message)) ?? []
  const serialWarning = serialMissing.length === 0 ? null
    : serialMissingAdapter.length
      ? `Reference accepted but not sent to: ${serialMissing.join(', ')}. Configured USB adapter missing at ${serialMissingAdapter.map(f => f.path).join(', ')}. Reconnect the correct adapter without swapping ports.`
      : serialBroadcast?.skipped
        ? `Reference accepted but not sent to: ${serialMissing.join(', ')}. Serial ports are not configured on the server.`
        : `Reference accepted but not sent to: ${serialMissing.join(', ')}. Check the serial connection or scan the reference again.`
  const displayBroadcastWarn = effectiveReference
    ? [broadcastWarn, serialWarning, visionSyncWarning].filter(Boolean).join(' ') || null
    : null

  const { totalCounts, referenceCounts, recordCycleResult, resetTotalCounts } =
    useProductionCounts()
  const countedJobIdsRef = useRef(new Set<string>())
  const prevProductionRunningRef = useRef(false)
  const lastVisionCanvasSeqRef = useRef<number | null>(null)
  const lastVisionCanvasFetchInFlightRef = useRef(false)

  // A slave snapshot may contain the previous product's result. Remember its
  // capture ID on reference load, but never promote it to the production card.
  useEffect(() => {
    const referenceId = effectiveReference?.id ?? null
    let cancelled = false
    setRealtimeResult(null)
    setRealtimeResultReferenceId(null)
    priorInspectionRef.current = null
    displayedCaptureIdRef.current = null
    baselineCaptureIdRef.current = null
    baselineKnownRef.current = false
    if (runReferenceIdRef.current !== referenceId) {
      runStartedAtRef.current = null
      runReferenceIdRef.current = null
      awaitingNewResultRef.current = false
      resultPollDeadlineRef.current = null
    }
    if (referenceId && effectiveReference?.vision_inspection_enabled) {
      void realtimeInspectionApi.snapshot().then(snapshot => {
        if (cancelled || runStartedAtRef.current !== null) return
        baselineCaptureIdRef.current = snapshot.result?.capture_id ?? null
        baselineKnownRef.current = true
      }).catch(() => undefined)
    }
    return () => { cancelled = true }
  }, [effectiveReference?.id, effectiveReference?.vision_inspection_enabled])

  // Production capture-only → main canvas: poll meta seq, fetch image once when it advances.
  // Soft-empty GET (data:null) does not advance seq — next poll retries. Only commit seq on image.
  useEffect(() => {
    const meta = machineStatus?.lastVisionCanvas
    const seq = meta?.seq
    if (seq == null || meta?.mode !== 'capture') return
    if (lastVisionCanvasSeqRef.current === seq) return
    if (lastVisionCanvasFetchInFlightRef.current) return
    let cancelled = false
    lastVisionCanvasFetchInFlightRef.current = true
    void fetchLastProductionCapture(seq)
      .then((payload) => {
        if (cancelled) return
        if (!payload) return
        lastVisionCanvasSeqRef.current = seq
        vision.applyProductionCanvas({
          image_b64: payload.image_b64,
          format: payload.format ?? meta.format ?? 'png',
          mode: 'capture',
          capturedAt: payload.capturedAt ?? meta.capturedAt ?? null,
        })
      })
      .catch((err) => {
        console.warn('[MainPage] Failed to load production capture canvas:', err)
      })
      .finally(() => {
        lastVisionCanvasFetchInFlightRef.current = false
      })
    return () => {
      cancelled = true
    }
  }, [machineStatus?.lastVisionCanvas, vision.applyProductionCanvas])

  useEffect(() => {
    if (!effectiveReference?.vision_inspection_enabled) return
    const referenceId = effectiveReference.id
    let cancelled = false
    const poll = () => {
      if (runStartedAtRef.current === null || runReferenceIdRef.current !== referenceId) return
      if (isProductionRunning || isRunning) return
      if (awaitingNewResultRef.current) {
        if (!lastJob?.finishedAt || lastJob.finishedAt === priorFinishedAtRef.current) return
        awaitingNewResultRef.current = false
        resultPollDeadlineRef.current = Date.now() + 30_000
      }
      if (!displayedCaptureIdRef.current && resultPollDeadlineRef.current !== null && Date.now() > resultPollDeadlineRef.current) {
        runStartedAtRef.current = null
        return
      }
      void realtimeInspectionApi.snapshot().then(snapshot => {
        if (cancelled || runReferenceIdRef.current !== referenceId || runStartedAtRef.current === null) return
        const captureId = snapshot.result?.capture_id ?? null
        const alreadyDisplayed = captureId !== null && captureId === displayedCaptureIdRef.current
        if (!alreadyDisplayed && !isNewProductionInspection({
          captureId,
          baselineKnown: baselineKnownRef.current,
          baselineCaptureId: baselineCaptureIdRef.current,
          lastResultUtc: snapshot.status?.last_result_utc,
          runStartedAtMs: runStartedAtRef.current,
        })) return
        const value = normalizeRealtimeResult(snapshot)
        if (!value) return
        displayedCaptureIdRef.current = captureId
        baselineCaptureIdRef.current = captureId
        baselineKnownRef.current = true
        const serialized = JSON.stringify(value)
        if (serialized !== priorInspectionRef.current) {
          priorInspectionRef.current = serialized
          setRealtimeResultReferenceId(referenceId)
          setRealtimeResult(value)
        }
        if (value.overlay_status === 'COMPLETE' || value.overlay_status === 'FAILED') runStartedAtRef.current = null
      }).catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, 2500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [effectiveReference?.id, effectiveReference?.vision_inspection_enabled, isProductionRunning, isRunning, lastJob?.finishedAt])

  const recordJobIfNew = useCallback(
    (jobId: string | null | undefined, cycleResult: VisionResult | null | undefined) => {
      if (cycleResult !== 'PASS' && cycleResult !== 'FAIL') return
      const key = jobId ?? `anon-${Date.now()}`
      if (countedJobIdsRef.current.has(key)) return
      countedJobIdsRef.current.add(key)
      recordCycleResult(cycleResult)
    },
    [recordCycleResult],
  )

  // Clear local running latch when backend production ends (panel or HMI).
  // Must track backend-only — including local isRunning here permanently latches Running.
  useEffect(() => {
    const wasRunning = prevProductionRunningRef.current
    prevProductionRunningRef.current = isProductionRunning
    if (wasRunning && !isProductionRunning) {
      if (lastJob?.finishedAt) {
        const result = deriveCycleResultFromJob({
          status: lastJob.status,
          cycleResult: lastJob.cycleResult,
          activeFault: isActiveFault(activeFault),
        })
        recordJobIfNew(lastJob.jobId, result)
      }
      setIsRunning(false)
    }
  }, [isProductionRunning, lastJob, activeFault, recordJobIfNew])

  // Drop stale sessionStorage reference when backend has none (e.g. after server restart).
  useEffect(() => {
    if (!machineStatus || isBroadcasting) return
    if (!backendReferenceLoaded && activeReference) {
      clearActiveReference()
      setBroadcastWarn(null)
      setSerialBroadcast(null)
    }
  }, [machineStatus, backendReferenceLoaded, activeReference, isBroadcasting, clearActiveReference])

  // Rehydrate HMI sessionStorage from backend authoritative referenceId when the
  // machine has a loaded ref the UI is missing/mismatched (e.g. after session wipe).
  useEffect(() => {
    if (!machineStatus || !backendReferenceLoaded || !backendReferenceId) return
    if (activeReference?.id === backendReferenceId) return
    let cancelled = false
    void getReferenceById(backendReferenceId)
      .then((ref) => {
        if (cancelled || !ref) return
        setActiveReference(ref)
      })
      .catch(() => {
        /* keep local until next poll / scan */
      })
    return () => {
      cancelled = true
    }
  }, [
    machineStatus,
    backendReferenceId,
    backendReferenceLoaded,
    activeReference?.id,
    setActiveReference,
  ])

  const handleReferenceCode = useCallback(
    async (code: string) => {
      const trimmed = code.trim()
      if (!trimmed) return
      if (!canOperateMachine) {
        setBroadcastErr(general.loginRequiredScan)
        return
      }
      setIsBroadcasting(true)
      setBroadcastErr(null)
      setBroadcastWarn(null)
      setSerialBroadcast(null)
      try {
        const out = await broadcastReference(trimmed)
        setSerialBroadcast(out.reference ? {
          referenceId: out.reference.id,
          sentTo: out.sentTo ?? [],
          failed: out.serialFailed ?? [],
          skipped: out.serialSkipped === true,
        } : null)
        if (out.reference) {
          let loaded = out.reference
          if (!referenceHasShrinkTube(loaded)) {
            setBroadcastWarn(
              'This reference has no shrink tube profile. Open References, edit it, and assign a shrink tube before production.',
            )
          }
          if (import.meta.env.VITE_PRODUCTION_VISION_ENGINE === 'legacy' && referenceUsesVision(loaded)) {
            try {
              const ensured = await ensureReferenceHasVisionProgram(loaded)
              loaded = ensured.reference
            } catch {
              /* program tools sync failed — reference still loaded */
            }
          }
          setActiveReference(loaded)
        } else {
          clearActiveReference()
        }
      } catch (e) {
        setBroadcastErr(e instanceof Error ? e.message : 'Broadcast failed')
        clearActiveReference()
      } finally {
        setIsBroadcasting(false)
      }
    },
    [setActiveReference, clearActiveReference, canOperateMachine, general.loginRequiredScan],
  )

  const handleStart = useCallback(() => {
    if (!canOperateMachine) {
      setBroadcastErr(general.loginRequiredOperate)
      return
    }
    if (!effectiveReference || !machineInitialized || isRunning || isProductionRunning) return
    if (!canStartProduction) {
      setBroadcastErr(productionBlockReason ?? 'Cannot start production')
      return
    }
    void (async () => {
      beginProductionRun()
      const outcome = await startProduction()
      // startProduction awaits the full job; always clear the local running latch.
      setIsRunning(false)
      if (outcome.ok) {
        recordJobIfNew(outcome.jobId, outcome.cycleResult)
      } else {
        recordJobIfNew(outcome.jobId, outcome.cycleResult ?? 'FAIL')
      }
    })()
  }, [
    effectiveReference,
    machineInitialized,
    isRunning,
    isProductionRunning,
    beginProductionRun,
    startProduction,
    canOperateMachine,
    general.loginRequiredOperate,
    recordJobIfNew,
    canStartProduction,
    productionBlockReason,
  ])

  const handleSetup = useCallback(() => {
    if (!canOperateMachine) {
      setBroadcastErr(general.loginRequiredOperate)
      return
    }
    if (isInitializing || isRecovering || isProductionRunning) return
    setBroadcastErr(null)
    void setup()
  }, [canOperateMachine, general.loginRequiredOperate, isInitializing, isRecovering, isProductionRunning, setup])

  const handleStop = useCallback(() => {
    void (async () => {
      if (!isRunning && !isProductionRunning) return
      setIsRunning(false)
      try {
        await runMachineStopProduction()
      } catch {
        /* local UI still stops */
      }
      // Good/NG is recorded from lastJob on productionRunning fall — do not
      // run a second vision inspect or double-count here.
    })()
  }, [isRunning, isProductionRunning])

  const referenceMissingShrinkTube =
    effectiveReference != null && !referenceHasShrinkTube(effectiveReference)
  const hasFault = isActiveFault(activeFault)
  const isRunningState = isRunning || isProductionRunning
  // Soft-stop mid-centring leaves posture off idle; machineInitialized stays true
  // so the Setup button is labeled Recover — still surface it so the operator can restore.
  const centringAtClosingHeight =
    (machineStatus?.centringPosition?.lines?.length ?? 0) > 0 &&
    machineStatus?.centringPosition?.lines?.every((line) => line.position === 'H_PRE') === true
  const productionNeedsSetup =
    canRunSetup &&
    !centringAtClosingHeight &&
    typeof productionBlockReason === 'string' &&
    /centring/i.test(productionBlockReason)
  const needsCentringForJob =
    machineInitialized &&
    !!effectiveReference &&
    machineStatus?.initialized === false &&
    !centringAtClosingHeight &&
    !isRunningState
  // Setup is only for power-up / fault / lockout / centring restore — not for
  // "initialized but no reference" (IDLE). That state shows "No reference" instead.
  const needsSetup =
    needsInitialization ||
    hasFault ||
    isSafetyLockout ||
    productionNeedsSetup ||
    needsCentringForJob
  const showSetupButton = !isRunningState && needsSetup && canOperateMachine
  const setupBusy = isInitializing || isRecovering || isBroadcasting
  // Initialization vs Recover. Same Setup sequence; label follows machineInitialized:
  //  • Not initialized (boot, ERROR, POWER_OFF, lockout, connect) → "Initialization"
  //  • Job loaded, centring not yet homed for that reference → "Initialization"
  //  • Initialized but still needs Setup (e.g. centring restore) → "Recover"
  const setupLabel =
    needsInitialization || needsCentringForJob
      ? general.initializationLabel
      : general.recoverLabel
  const setupDisabled = setupBusy || !canRunSetup || !canOperateMachine
  // Only surface setup-block copy when the Setup button is visible. During a
  // production cycle canRunSetup is false, which would otherwise append
  // "Cannot run setup while production is running…" onto the phase detail.
  const setupBlockDetail =
    showSetupButton && setupDisabled && !setupBusy
      ? (setupBlockReason ?? recoveryBlockReason ?? null)
      : null

  const needsInitDetail = !effectiveReference
    ? general.statusDetailNeedsInitNoReference
    : needsCentringForJob
      ? general.statusDetailNeedsCentringForJob
      : general.statusDetailNeedsInit

  /** Align backend block CTAs with the visible Setup button label. */
  const setupAwareBlockDetail = (reason: string | null | undefined): string | null => {
    if (!reason) return null
    if (setupLabel === general.recoverLabel) {
      return reason
        .replace(/press Initialization first/gi, 'press Recover first')
        .replace(/press Initialization/gi, 'press Recover')
    }
    return reason
      .replace(/press Recover first/gi, 'press Initialization first')
      .replace(/press Recover/gi, 'press Initialization')
  }

  const faultPresentation = useMemo(() => {
    if (!isActiveFault(activeFault)) return null
    const resolved = resolveFault(activeFault.primary, general)
    const title =
      activeFault.category === 'SAFETY'
        ? resolved.label
        : faultCategoryTitle(activeFault.category, general)
    return {
      title,
      label: resolved.label,
      description: resolved.description,
    }
  }, [activeFault, general])

  const visibleInspection = realtimeResultReferenceId === effectiveReference?.id && !isRunning && !isProductionRunning && !vision.isInspecting ? realtimeResult : null
  const inspectionModel = inspectionPresentation(visibleInspection)
  const failedParts = inspectionGroups.filter(key => inspectionModel.groups[key].verdict === 'FAIL')
  const inspectionFailed = inspectionModel.verdict === 'FAIL' || failedParts.length > 0
  const [imageLoadErrors, setImageLoadErrors] = useState<{ capture: unknown; titles: string[] }>({ capture: null, titles: [] })
  const unavailableImages = imageLoadErrors.capture === visibleInspection?.capture_id ? imageLoadErrors.titles : []
  const inspectionMessages = visibleInspection ? [
    inspectionFailed ? `FAIL — ${failedParts.length ? failedParts.map(key => key === 'welding_splice' ? 'Welding splice' : 'Heat-shrink tube').join(', ') : 'Inspection failed; component not identified'}.` : '',
    ...failedParts.filter(key => !visibleInspection.image_urls?.[key]).map(key => `${key === 'welding_splice' ? 'Welding splice' : 'Heat-shrink tube'} image ${visibleInspection.overlay_status === 'PENDING' ? 'pending' : 'unavailable'}.`),
    ...unavailableImages.map(title => `${title} image could not be loaded.`),
    visibleInspection.archive_warning,
  ].filter(Boolean).join(' ') : ''
  const conditionMessages = buildUnmetConditions(activeFault, showSetupButton ? initPreconditions : null, general)
    .map(issue => `${issue.label}: ${issue.description}`).join(' ')

  const statusTitle = !canOperateMachine
    ? general.loginRequiredTitle
    : faultPresentation
    ? faultPresentation.title
    : isRunning || isProductionRunning
    ? queueDepth > 0
      ? `${general.statusRunning} (+${queueDepth} ${general.statusQueuedSuffix})`
      : general.statusRunning
    : needsSetup
      ? isInitializing
        ? general.statusInitializing
        : hasFault || isSafetyLockout
          ? general.recoverLabel
          : needsInitialization || needsCentringForJob
            ? general.statusInitRequired
            : general.statusRecoverRequired
      : !effectiveReference
        ? general.statusNoReference
        : referenceMissingShrinkTube
          ? general.statusShrinkTubeRequired
          : general.statusReady

  const statusDetail = !canOperateMachine
    ? general.loginUnlockMachine
    : faultPresentation
    ? pnozCircuitRestored
      ? general.statusDetailCircuitRestored
      : faultPresentation.description || `${faultPresentation.label}. ${general.emergencyRecovery}`
    : isSafetyLockout && pnozCircuitRestored
      ? general.statusDetailCircuitRestored
    : needsSetup
      ? initButtonPressed
        ? general.statusDetailInitButtonPressed
        : isInitializing
          ? (setupPhaseDetailMessage(setupPhase, general) ?? general.statusDetailInitializing)
          : hasFault || isSafetyLockout
            ? general.emergencyRecovery
            : productionNeedsSetup && productionBlockReason
              ? (setupAwareBlockDetail(productionBlockReason) ??
                  (needsInitialization || needsCentringForJob
                    ? needsInitDetail
                    : general.statusDetailNeedsRecover))
              : needsInitialization || needsCentringForJob
                ? needsInitDetail
                : general.statusDetailNeedsRecover
    : isRunning || isProductionRunning
    ? productionPhaseDetailMessage(productionPhase, general) ?? general.statusDetailRunning
      : !effectiveReference
        ? general.statusDetailNoReference
        : referenceMissingShrinkTube
          ? general.statusDetailShrinkTube
          : (() => {
              const clampMode = clampTriggerMode ?? 'off'
              if (clampMode !== 'off') {
                const needRight = clampMode === 'di10' || clampMode === 'both'
                const needLeft =
                  clampMode === 'di9' || clampMode === 'di11' || clampMode === 'both'
                const needsPlace =
                  (needRight && (!clampRightDi || clampInhibitRight)) ||
                  (needLeft && (!clampLeftDi || clampInhibitLeft)) ||
                  (typeof productionBlockReason === 'string' &&
                    /place the cable on the clamp/i.test(productionBlockReason))
                const needsClose =
                  !needsPlace &&
                  ((needRight && clampRightDi && !clampRightTriggered) ||
                    (needLeft && clampLeftDi && !clampLeftTriggered) ||
                    (typeof productionBlockReason === 'string' &&
                      /waiting for .*clamp/i.test(productionBlockReason)))
                if (needsClose) {
                  if (clampMode === 'di10') return general.statusDetailClampCloseRight
                  if (clampMode === 'di9' || clampMode === 'di11') {
                    return general.statusDetailClampCloseLeft
                  }
                  return general.statusDetailClampCloseBoth
                }
                if (needsPlace) {
                  if (clampMode === 'di10') return general.statusDetailClampCableRight
                  if (clampMode === 'di9' || clampMode === 'di11') {
                    return general.statusDetailClampCableLeft
                  }
                  return general.statusDetailClampCableBoth
                }
              }
              if (productionBlockReason) return productionBlockReason
              if (startButtonPressed) return general.statusDetailStartButtonPressed
              return general.statusDetailReady
            })()

  const startDisabled =
    !canOperateMachine ||
    !effectiveReference ||
    referenceMissingShrinkTube ||
    needsInitialization ||
    needsCentringForJob ||
    isInitializing ||
    isRecovering ||
    isProductionRunning ||
    hasFault ||
    !canStartProduction
  // Post-connect ERROR has no lastError — treat as init/recover warning, not fault red,
  // so the StatusBar matches the tower and the "Initialization required" copy.
  const statusVisual =
    !canOperateMachine || faultPresentation || isRunningState
      ? undefined
      : needsSetup && (isInitializing || isRecovering)
        ? MachineVisualState.INITIALIZATION
        : needsSetup && needsInitialization && !hasFault && !isSafetyLockout
          ? MachineVisualState.INITIALIZATION
          : needsSetup && !hasFault && !isSafetyLockout
            ? MachineVisualState.REINITIALIZATION
            : undefined
  const displayBroadcastErr =
    broadcastErr ?? (hasFault ? null : initError ?? productionError ?? null)

  return (
    <div
      style={{
        height: '100%',
        backgroundColor: colors.background,
        overflow: 'hidden',
        touchAction: 'auto',
        minHeight: 0,
      }}
    >
      <div
        className={KIOSK_TOUCH_SCROLL_CLASS}
        style={{
          boxSizing: 'border-box',
          padding: '20px',
          height: '100%',
          overflow: 'auto',
          ...touchScrollable,
          display: 'grid',
          gridTemplateRows: `${INFO_CARD_ROW_HEIGHT} minmax(380px, 1fr) clamp(160px, 18vh, 200px)`,
          gap: '12px',
          alignContent: 'stretch',
        }}
      >
        <InfoCard
          modeImageSrc={modeImageSrc}
          modeImageAlt={modeImageAlt}
          modeImageAriaLabel={modeImageAriaLabel}
          modelName={modelName}
          showBarcodeSlot={showBarcodeSlot}
          activeReference={effectiveReference}
          referenceCounts={referenceCounts}
          totalCounts={totalCounts}
          onResetTotal={resetTotalCounts}
          isBroadcasting={isBroadcasting}
          broadcastErr={displayBroadcastErr}
          broadcastWarn={displayBroadcastWarn}
          onScan={code => void handleReferenceCode(code)}
          scanDisabled={!canOperateMachine}
          scanDisabledHint={general.loginRequiredScan}
        />

        <MainCard
          hasReference={effectiveReference != null}
          visionChecksConfig={effectiveReference?.vision_checks_config ?? null}
          masterImageB64={vision.masterImageB64}
          masterImageFormat={vision.masterImageFormat}
          lastResult={vision.lastResult}
          lastImage={vision.lastImage}
          lastImageFormat={vision.lastImageFormat}
          lastCanvasMode={vision.lastCanvasMode}
          lastInspectedAt={vision.lastInspectedAt}
          isInspecting={vision.isInspecting}
          lastToolResults={vision.lastToolResults}
          realtimeResult={realtimeResultReferenceId === effectiveReference?.id ? realtimeResult : null}
          onImageUnavailable={title => setImageLoadErrors(previous => ({
            capture: realtimeResult?.capture_id,
            titles: Array.from(new Set([...(previous.capture === realtimeResult?.capture_id ? previous.titles : []), title])),
          }))}
          activeFault={activeFault}
          lockedMessage={!canOperateMachine ? general.loginUnlockMachine : null}
          initPreconditions={showSetupButton ? initPreconditions : null}
          machineStatus={machineStatus}
        />

        {/* Status card */}
        <section aria-label="Status card" tabIndex={0} style={{ minWidth: 0, minHeight: 0, overflow: 'auto', ...touchScrollable }}>
          <StatusBar
            phaseTitle={canOperateMachine && inspectionFailed && !faultPresentation && !needsSetup ? 'FAIL — Inspection failed' : statusTitle}
            detailMessage={Array.from(new Set([
              canOperateMachine && inspectionFailed && !faultPresentation && !needsSetup ? '' : statusDetail,
              canOperateMachine ? conditionMessages : '',
              canOperateMachine ? inspectionMessages : '',
            ].filter(Boolean))).join(' ')}
            showFailure={faultPresentation != null || (canOperateMachine && inspectionFailed)}
            statusVisual={statusVisual}
            lifecycleState={backendLifecycleState ?? LIFECYCLE_STATE.IDLE}
            isRunning={isRunning || isProductionRunning}
            onStart={handleStart}
            onStop={handleStop}
            onInitialize={showSetupButton ? handleSetup : undefined}
            initLabel={setupLabel}
            initBusy={setupBusy}
            initDisabled={setupDisabled}
            initBlockDetail={setupBlockDetail ?? undefined}
            startDisabled={startDisabled}
          />
        </section>
      </div>
    </div>
  )
}
