import { useState, useCallback } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { StatusBar } from './StatusBar'
import type { LifecycleState } from '@/types/machineLifecycle.types'
import { LIFECYCLE_STATE } from '@/types/machineLifecycle.types'
import { VisionPanel } from './main/VisionPanel'
import { useVision } from '@/hooks/useVision'
import { BarcodeScanner } from './main/BarcodeScanner'
import { broadcastReference } from '@/services/referencesApi'
import { useActiveReference } from '@/contexts/ActiveReferenceContext'
import { syncReferenceVisionTools } from '@/lib/referenceToolConfig'

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
  const { setActiveReference, clearActiveReference } = useActiveReference()
  const [isRunning, setIsRunning] = useState(false)
  const [lifecycleState, setLifecycleState] = useState<LifecycleState>(LIFECYCLE_STATE.IDLE)

  const [currentRef, setCurrentRef] = useState<string | null>(null)
  const [broadcastErr, setBroadcastErr] = useState<string | null>(null)
  const [broadcastWarn, setBroadcastWarn] = useState<string | null>(null)
  const [isBroadcasting, setIsBroadcasting] = useState(false)

  const applyBroadcastResult = useCallback((name: string, serialSkipped?: boolean) => {
    setCurrentRef(name)
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
        applyBroadcastResult(out.name, out.serialSkipped)
        if (out.reference) {
          setActiveReference(out.reference)
          if (out.reference.vision_program_id && out.reference.vision_inspection_enabled) {
            try {
              const sync = await syncReferenceVisionTools(out.reference)
              if (sync.specific_tools || sync.specific_tool_template_id !== undefined) {
                setActiveReference({
                  ...out.reference,
                  specific_tools: sync.specific_tools ?? out.reference.specific_tools,
                  specific_tool_template_id:
                    sync.specific_tool_template_id ?? out.reference.specific_tool_template_id,
                })
              }
            } catch {
              /* program tools sync failed — reference still loaded */
            }
          }
        } else {
          clearActiveReference()
        }
      } catch (e) {
        setBroadcastErr(e instanceof Error ? e.message : 'Broadcast failed')
        setCurrentRef(null)
        clearActiveReference()
      } finally {
        setIsBroadcasting(false)
      }
    },
    [applyBroadcastResult, setActiveReference, clearActiveReference],
  )

  const handleStart = useCallback(() => {
    setIsRunning(true)
    setLifecycleState(LIFECYCLE_STATE.RUN)
  }, [])

  const handleStop = useCallback(() => {
    setIsRunning(false)
    setLifecycleState(LIFECYCLE_STATE.IDLE)
  }, [])

  const statusTitle = isRunning ? 'Running' : 'Ready'
  const statusDetail = isRunning ? 'Cycle in progress.' : 'Press Start to begin the cycle.'

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
          gridTemplateRows: 'auto minmax(0, 1fr) auto',
          gap: '20px',
          alignContent: 'stretch',
        }}
      >
        {/* Info card */}
        <section
          aria-label="Info card"
          style={{
            backgroundColor: colors.white,
            border: `2px solid ${colors.border}`,
            borderRadius: '10px',
            minHeight: '200px',
            minWidth: 0,
            overflow: 'hidden',
            display: 'grid',
            gridTemplateColumns: showBarcodeSlot ? 'auto minmax(0, 1fr)' : '1fr',
          }}
        >
          <figure
            style={{
              margin: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'transparent',
              borderRadius: '8px 0 0 8px',
              padding: '16px',
              width: '220px',
              height: '100%',
              minHeight: '200px',
              flexShrink: 0,
              boxSizing: 'border-box',
            }}
          >
            {modeImageSrc ? (
              <img
                src={modeImageSrc}
                alt={modeImageAlt}
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div
                role="img"
                aria-label={modeImageAriaLabel}
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '6px',
                  border: `1px dashed ${colors.border}`,
                  background: colors.white,
                }}
              />
            )}
          </figure>
          {showBarcodeSlot ? (
            <div
              style={{
                width: '100%',
                minWidth: 0,
                padding: '16px',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                justifyContent: 'center',
              }}
            >
              <BarcodeScanner
                onScan={code => void handleReferenceCode(code)}
                disabled={isBroadcasting}
                isProcessing={isBroadcasting}
                label="Scan reference:"
                placeholder="Scan or type reference, Enter"
                currentValue={currentRef ?? undefined}
                currentValueLabel="Loaded:"
              />
              {broadcastErr ? (
                <div
                  style={{
                    fontSize: '13px',
                    color: colors.error,
                    padding: '8px 10px',
                    borderRadius: '8px',
                    backgroundColor: colors.errorBg,
                    border: `1px solid ${colors.error}`,
                  }}
                  role="alert"
                >
                  {broadcastErr}
                </div>
              ) : null}
              {broadcastWarn ? (
                <div
                  style={{
                    fontSize: '13px',
                    color: colors.text,
                    padding: '8px 10px',
                    borderRadius: '8px',
                    backgroundColor: `${colors.warning}18`,
                    border: `1px solid ${colors.border}`,
                  }}
                  role="status"
                >
                  {broadcastWarn}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Main card */}
        <section
          aria-label="Main card"
          className={KIOSK_TOUCH_SCROLL_CLASS}
          style={{
            backgroundColor: colors.white,
            border: `2px solid ${colors.border}`,
            borderRadius: '10px',
            minHeight: 0,
            overflow: 'auto',
            ...touchScrollable,
            minWidth: 0,
          }}
        >
          <VisionPanel {...vision} />
        </section>

        {/* Status card */}
        <section aria-label="Status card" style={{ minWidth: 0 }}>
          <StatusBar
            phaseTitle={statusTitle}
            detailMessage={statusDetail}
            lifecycleState={lifecycleState}
            isRunning={isRunning}
            onStart={handleStart}
            onStop={handleStop}
          />
        </section>
      </div>
    </div>
  )
}
