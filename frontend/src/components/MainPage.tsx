import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { StatusBar } from './StatusBar'
import { LIFECYCLE_STATE } from '@/types/machineLifecycle.types'
import { MainCard } from './main/MainCard'
import { resolveFault, faultCategoryTitle, isActiveFault } from '@/lib/faultPresentation'
import { useVision } from '@/hooks/useVision'
import { InfoCard, INFO_CARD_ROW_HEIGHT } from './main/InfoCard'
import { broadcastReference, type SerialBroadcastFailure } from '@/services/referencesApi'
import { listShrinkTubes } from '@/services/shrinkTubesApi'
import { useActiveReference } from '@/contexts/ActiveReferenceContext'
import { ensureReferenceHasVisionProgram, referenceUsesVision } from '@/lib/referenceVisionProgram'
import { useProductionCounts } from '@/hooks/useProductionCounts'
import { useMachineInitialization } from '@/hooks/useMachineInitialization'
import { useMachineOperationAccess } from '@/hooks/useMachineOperationAccess'
import { useLocale } from '@/contexts/LocaleContext'
import { runMachineStopProduction } from '@/services/machineInitApi'
import { referenceHasShrinkTube } from '@/lib/referenceShrinkTube'
import type { ShrinkTube } from '@/types/shrinkTube.types'

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
  const { activeReference, setActiveReference, clearActiveReference, visionProgramId } =
    useActiveReference()
  const [isRunning, setIsRunning] = useState(false)

  const beginProductionRun = useCallback(() => {
    vision.clearLastInspection()
    setIsRunning(true)
  }, [vision.clearLastInspection])

  const {
    initialized: machineInitialized,
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
  } = useMachineInitialization({
    referenceId: activeReference?.id ?? null,
    onProductionStarted: beginProductionRun,
    machineOperationsEnabled: canOperateMachine,
  })

  const [broadcastErr, setBroadcastErr] = useState<string | null>(null)
  const [broadcastWarn, setBroadcastWarn] = useState<string | null>(null)
  const [shrinkTubes, setShrinkTubes] = useState<ShrinkTube[]>([])
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const { totalCounts, referenceCounts, recordCycleResult, resetTotalCounts } =
    useProductionCounts(activeReference?.id)

  useEffect(() => {
    void listShrinkTubes()
      .then(setShrinkTubes)
      .catch(() => setShrinkTubes([]))
  }, [activeReference?.id])

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
    if (!activeReference || !machineInitialized || isRunning || isProductionRunning) return
    void (async () => {
      beginProductionRun()
      const ok = await startProduction()
      if (!ok) {
        setIsRunning(false)
      }
    })()
  }, [
    activeReference,
    machineInitialized,
    isRunning,
    isProductionRunning,
    beginProductionRun,
    startProduction,
    canOperateMachine,
    general.loginRequiredOperate,
  ])

  const handleSetup = useCallback(() => {
    if (isInitializing || isRecovering || isProductionRunning) return
    setBroadcastErr(null)
    void setup()
  }, [isInitializing, isRecovering, isProductionRunning, setup])

  const handleStop = useCallback(() => {
    void (async () => {
      if (!isRunning && !isProductionRunning) return
      setIsRunning(false)
      try {
        await runMachineStopProduction()
      } catch {
        /* local UI still stops */
      }

      if (
        activeReference &&
        referenceUsesVision(activeReference) &&
        visionProgramId != null
      ) {
        const result = await vision.inspect()
        recordCycleResult(result)
      } else if (activeReference) {
        // Non-vision references still count each completed cycle: Good unless a
        // machine fault is active at the time of Stop.
        recordCycleResult(isActiveFault(activeFault) ? 'FAIL' : 'PASS')
      }
    })()
  }, [
    isRunning,
    isProductionRunning,
    activeReference,
    activeFault,
    visionProgramId,
    vision.inspect,
    recordCycleResult,
  ])

  const referenceMissingShrinkTube = activeReference != null && !referenceHasShrinkTube(activeReference)
  const hasFault = isActiveFault(activeFault)
  const isRunningState = isRunning || isProductionRunning
  const needsSetup =
    needsInitialization ||
    hasFault ||
    isSafetyLockout ||
    (!activeReference && canRunSetup && !machineInitialized)
  const showSetupButton = !isRunningState && needsSetup
  const setupBusy = isInitializing || isRecovering
  const setupLabel = hasFault || isSafetyLockout ? general.recoverLabel : general.initializationLabel
  const setupDisabled = setupBusy || !canRunSetup
  const setupBlockDetail =
    setupDisabled && !setupBusy ? (setupBlockReason ?? recoveryBlockReason ?? null) : null

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

  const statusTitle = faultPresentation
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
          : general.statusInitRequired
      : !canOperateMachine
        ? general.loginRequiredTitle
      : !activeReference
        ? general.statusNoReference
        : referenceMissingShrinkTube
          ? general.statusShrinkTubeRequired
          : general.statusReady

  const statusDetail = faultPresentation
    ? pnozCircuitRestored
      ? general.statusDetailCircuitRestored
      : faultPresentation.description || `${faultPresentation.label}. ${general.emergencyRecovery}`
    : isSafetyLockout && pnozCircuitRestored
      ? general.statusDetailCircuitRestored
    : needsSetup
      ? initButtonPressed
        ? general.statusDetailInitButtonPressed
        : isInitializing
          ? general.statusDetailInitializing
          : hasFault || isSafetyLockout
            ? general.emergencyRecovery
            : general.statusDetailNeedsInit
      : !canOperateMachine
        ? general.loginRequiredOperate
    : isRunning || isProductionRunning
    ? general.statusDetailRunning
      : !activeReference
        ? general.statusDetailNoReference
        : referenceMissingShrinkTube
          ? general.statusDetailShrinkTube
          : startButtonPressed
          ? general.statusDetailStartButtonPressed
          : general.statusDetailReady

  const startDisabled =
    !canOperateMachine ||
    !activeReference ||
    referenceMissingShrinkTube ||
    needsInitialization ||
    isInitializing ||
    isRecovering ||
    isProductionRunning ||
    hasFault
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
          gap: '20px',
          alignContent: 'stretch',
        }}
      >
        <InfoCard
          modeImageSrc={modeImageSrc}
          modeImageAlt={modeImageAlt}
          modeImageAriaLabel={modeImageAriaLabel}
          modelName={modelName}
          showBarcodeSlot={showBarcodeSlot}
          activeReference={activeReference}
          shrinkTubes={shrinkTubes}
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
          hasReference={activeReference != null}
          visionChecksConfig={activeReference?.vision_checks_config ?? null}
          masterImageB64={vision.masterImageB64}
          masterImageFormat={vision.masterImageFormat}
          lastResult={vision.lastResult}
          lastImage={vision.lastImage}
          lastInspectedAt={vision.lastInspectedAt}
          isInspecting={vision.isInspecting}
          lastToolResults={vision.lastToolResults}
          activeFault={activeFault}
        />

        {/* Status card */}
        <section aria-label="Status card" style={{ minWidth: 0 }}>
          <StatusBar
            phaseTitle={statusTitle}
            detailMessage={statusDetail}
            showFailure={faultPresentation != null}
            lifecycleState={
              isRunning || isProductionRunning
                ? LIFECYCLE_STATE.RUN
                : backendLifecycleState ?? LIFECYCLE_STATE.IDLE
            }
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
