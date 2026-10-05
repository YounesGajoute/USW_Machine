import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { StatusBar } from './StatusBar'
import { LIFECYCLE_STATE } from '@/types/machineLifecycle.types'
import { MachineVisualState } from '@/types/machineStatus.types'
import { MainCard } from './main/MainCard'
import { resolveFault, faultCategoryTitle, isActiveFault } from '@/lib/faultPresentation'
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
import { referenceHasShrinkTube } from '@/lib/referenceShrinkTube'
import { setupPhaseDetailMessage } from '@/lib/setupPhaseMessages'
import { productionPhaseDetailMessage } from '@/lib/productionPhaseMessages'
import { deriveCycleResultFromJob } from '@/lib/deriveCycleResultFromJob'
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

  const beginProductionRun = useCallback(() => {
    vision.clearLastInspection()
    setIsRunning(true)
  }, [vision.clearLastInspection])

  const [broadcastErr, setBroadcastErr] = useState<string | null>(null)
  const [broadcastWarn, setBroadcastWarn] = useState<string | null>(null)
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

  const backendReferenceId = machineStatus?.referenceId ?? null
  const backendReferenceLoaded = machineStatus?.referenceLoaded === true
  /** Backend is authoritative; keep local ref only while broadcasting or backend agrees. */
  const effectiveReference =
    isBroadcasting || backendReferenceLoaded ? activeReference : null

  const { totalCounts, referenceCounts, recordCycleResult, resetTotalCounts } =
    useProductionCounts()
  const countedJobIdsRef = useRef(new Set<string>())
  const prevProductionRunningRef = useRef(false)
  const lastVisionCanvasSeqRef = useRef<number | null>(null)
  const lastVisionCanvasFetchInFlightRef = useRef(false)

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

  const applyBroadcastResult = useCallback(
    (serialSkipped?: boolean, serialFailed?: SerialBroadcastFailure[]) => {
      setBroadcastErr(null)
      if (serialSkipped) {
        setBroadcastWarn('Serial ports not configured on server — reference accepted but not sent to machines.')
      } else if (serialFailed && serialFailed.length > 0) {
        const ports = serialFailed.map(f => f.port).join(', ')
        setBroadcastWarn(
          `Reference accepted but not sent to: ${ports} (USB serial issue). Check the cable/adapter/connection.`,
        )
      } else {
        setBroadcastWarn(null)
      }
    },
    [],
  )

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
      try {
        const out = await broadcastReference(trimmed)
        applyBroadcastResult(out.serialSkipped, out.serialFailed)
        if (out.reference) {
          let loaded = out.reference
          if (!referenceHasShrinkTube(loaded)) {
            setBroadcastWarn(
              'This reference has no shrink tube profile. Open References, edit it, and assign a shrink tube before production.',
            )
          }
          if (referenceUsesVision(loaded)) {
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
    [applyBroadcastResult, setActiveReference, clearActiveReference, canOperateMachine, general.loginRequiredScan],
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
  const productionNeedsSetup =
    canRunSetup &&
    typeof productionBlockReason === 'string' &&
    /centring/i.test(productionBlockReason)
  const needsCentringForJob =
    machineInitialized &&
    !!effectiveReference &&
    machineStatus?.initialized === false &&
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
          gridTemplateRows: `${INFO_CARD_ROW_HEIGHT} minmax(0, 1fr) auto`,
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
          broadcastWarn={broadcastWarn}
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
          activeFault={activeFault}
          lockedMessage={!canOperateMachine ? general.loginUnlockMachine : null}
          initPreconditions={showSetupButton ? initPreconditions : null}
          machineStatus={machineStatus}
        />

        {/* Status card */}
        <section aria-label="Status card" style={{ minWidth: 0 }}>
          <StatusBar
            phaseTitle={statusTitle}
            detailMessage={statusDetail}
            showFailure={faultPresentation != null}
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
