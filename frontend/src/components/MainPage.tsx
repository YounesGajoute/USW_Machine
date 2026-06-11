import { useState, useCallback, useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { StatusBar } from './StatusBar'
import type { LifecycleState } from '@/types/machineLifecycle.types'
import { LIFECYCLE_STATE } from '@/types/machineLifecycle.types'
import { MainCard } from './main/MainCard'
import { resolveHarnessFromReference } from '@/lib/cableAssemblyFromReference'
import { useVision } from '@/hooks/useVision'
import { InfoCard, INFO_CARD_ROW_HEIGHT } from './main/InfoCard'
import { broadcastReference } from '@/services/referencesApi'
import { useActiveReference } from '@/contexts/ActiveReferenceContext'
import { ensureReferenceHasVisionProgram, referenceUsesVision } from '@/lib/referenceVisionProgram'
import { useProductionCounts } from '@/hooks/useProductionCounts'
import { useMachineInitialization } from '@/hooks/useMachineInitialization'
import { runMachineStopProduction } from '@/services/machineInitApi'

export interface MainPageProps {
  /** When set, shown as the mode illustration with proper `alt` text. */
  modeImageSrc?: string
  /** Accessible name for the image when `modeImageSrc` is set (defaults to a generic illustration label). */
  modeImageAlt?: string
  /** `aria-label` for the empty illustration region when no `modeImageSrc` is provided. */
  modeImageAriaLabel?: string
  showBarcodeSlot?: boolean
}

/**
 * Main view: Info, Main content, and Status regions.
 */
export function MainPage({
  modeImageSrc,
  modeImageAlt = 'Mode illustration',
  modeImageAriaLabel = 'Mode illustration',
  showBarcodeSlot = true,
}: MainPageProps) {
  const { colors } = useTheme()
  const vision = useVision()
  const { activeReference, setActiveReference, clearActiveReference, visionProgramId } =
    useActiveReference()
  const [isRunning, setIsRunning] = useState(false)
  const [lifecycleState, setLifecycleState] = useState<LifecycleState>(LIFECYCLE_STATE.IDLE)

  const beginProductionRun = useCallback(() => {
    vision.clearLastInspection()
    setIsRunning(true)
    setLifecycleState(LIFECYCLE_STATE.RUN)
  }, [vision.clearLastInspection])

  const {
    initialized: machineInitialized,
    needsInitialization,
    productionError,
    isInitializing,
    isProductionRunning,
    initButtonPressed,
    startButtonPressed,
    startProduction,
  } = useMachineInitialization({
    referenceId: activeReference?.id ?? null,
    onProductionStarted: beginProductionRun,
  })

  const [broadcastErr, setBroadcastErr] = useState<string | null>(null)
  const [broadcastWarn, setBroadcastWarn] = useState<string | null>(null)
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const { totalCounts, referenceCounts, recordCycleResult, resetTotalCounts } =
    useProductionCounts(activeReference?.id)

  const applyBroadcastResult = useCallback((serialSkipped?: boolean) => {
    setBroadcastErr(null)
    setBroadcastWarn(
      serialSkipped
        ? 'Serial ports not configured on server — reference accepted but not sent to machines.'
        : null,
    )
  }, [])

  const handleReferenceCode = useCallback(
    async (code: string) => {
      const trimmed = code.trim()
      if (!trimmed) return
      setIsBroadcasting(true)
      setBroadcastErr(null)
      setBroadcastWarn(null)
      try {
        const out = await broadcastReference(trimmed)
        applyBroadcastResult(out.serialSkipped)
        if (out.reference) {
          let loaded = out.reference
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
    [applyBroadcastResult, setActiveReference, clearActiveReference],
  )

  const handleStart = useCallback(() => {
    if (!activeReference || !machineInitialized || isRunning || isProductionRunning) return
    void (async () => {
      beginProductionRun()
      const ok = await startProduction()
      if (!ok) {
        setIsRunning(false)
        setLifecycleState(LIFECYCLE_STATE.IDLE)
      }
    })()
  }, [
    activeReference,
    machineInitialized,
    isRunning,
    isProductionRunning,
    beginProductionRun,
    startProduction,
  ])

  const handleStop = useCallback(() => {
    void (async () => {
      if (!isRunning) return
      setIsRunning(false)
      setLifecycleState(LIFECYCLE_STATE.IDLE)
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
      }
    })()
  }, [
    isRunning,
    activeReference,
    visionProgramId,
    vision.inspect,
    recordCycleResult,
  ])

  const cableHarness = useMemo(
    () => resolveHarnessFromReference(activeReference),
    [activeReference],
  )

  const statusTitle = isRunning || isProductionRunning
    ? 'Running'
    : needsInitialization
      ? 'Initialization required'
      : !activeReference
        ? 'No reference'
        : 'Ready'

  const statusDetail = isRunning || isProductionRunning
    ? 'Production cycle in progress.'
    : needsInitialization
      ? initButtonPressed
        ? 'Initialization button (DI0) pressed — sequence starting.'
        : isInitializing
          ? 'Initialization in progress (DI0).'
          : 'Press the panel Initialization button (DI0) to initialize pneumatics before Start.'
      : !activeReference
        ? 'Scan a reference barcode to load a job.'
        : startButtonPressed
          ? 'Start button pressed — production sequence starting.'
          : 'Press Start (DI1) or the on-screen Start button to begin the cycle.'

  const startDisabled =
    !activeReference || needsInitialization || isInitializing || isProductionRunning
  const displayBroadcastErr =
    broadcastErr ?? (productionError && !needsInitialization ? productionError : null)

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
          showBarcodeSlot={showBarcodeSlot}
          activeReference={activeReference}
          referenceCounts={referenceCounts}
          totalCounts={totalCounts}
          onResetTotal={resetTotalCounts}
          isBroadcasting={isBroadcasting}
          broadcastErr={displayBroadcastErr}
          broadcastWarn={broadcastWarn}
          onScan={code => void handleReferenceCode(code)}
        />

        <MainCard
          cableHarness={cableHarness}
          masterImageB64={vision.masterImageB64}
          masterImageFormat={vision.masterImageFormat}
          lastResult={vision.lastResult}
          lastImage={vision.lastImage}
          lastInspectedAt={vision.lastInspectedAt}
          isInspecting={vision.isInspecting}
        />

        {/* Status card */}
        <section aria-label="Status card" style={{ minWidth: 0 }}>
          <StatusBar
            phaseTitle={statusTitle}
            detailMessage={statusDetail}
            lifecycleState={
              needsInitialization && !isRunning ? LIFECYCLE_STATE.INIT : lifecycleState
            }
            isRunning={isRunning}
            onStart={handleStart}
            onStop={handleStop}
            startDisabled={startDisabled}
          />
        </section>
      </div>
    </div>
  )
}
