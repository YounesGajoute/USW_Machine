/**
 * VisionPanel — single canvas display.
 *
 * Shows (in priority order):
 *   1. Live stream  — when live feed is active
 *   2. Last image   — snapshot from the most recent inspection
 *   3. Empty state  — camera icon
 */

import {
  CheckCircle,
  XCircle,
  HelpCircle,
  Loader,
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import type { UseVisionReturn } from '@/hooks/useVision'
import type { VisionResult } from '@/types/vision.types'

function ResultBadge({ result }: { result: VisionResult | null }) {
  const { colors } = useTheme()
  if (!result) return null

  const config: Record<VisionResult, { label: string; bg: string; border: string; text: string; Icon: typeof CheckCircle }> = {
    PASS:    { label: 'PASS',    bg: '#e8f5e9',      border: colors.success,       text: colors.success,       Icon: CheckCircle },
    FAIL:    { label: 'FAIL',    bg: colors.errorBg, border: colors.error,         text: colors.error,         Icon: XCircle     },
    UNKNOWN: { label: 'UNKNOWN', bg: colors.grey,    border: colors.border,        text: colors.textSecondary, Icon: HelpCircle  },
  }

  const { label, bg, border, text, Icon } = config[result]

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 14px',
        borderRadius: '8px',
        backgroundColor: bg,
        border: `2px solid ${border}`,
      }}
    >
      <Icon size={18} strokeWidth={2.5} color={text} />
      <span style={{ fontSize: '15px', fontWeight: 800, color: text, letterSpacing: '0.08em' }}>
        {label}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export interface VisionPanelProps extends UseVisionReturn {
  onInspectionPass?: () => void
  onInspectionFail?: () => void
}

export function VisionPanel({
  lastResult,
  lastImage,
  lastDetails: _lastDetails,
  lastInspectedAt,
  isInspecting,
  isLiveFeedActive,
  liveFeedFrame,
  connectionStatus: _connectionStatus,
  error: _error,
  programs: _programs,
  selectedProgramId: _selectedProgramId,
  inspect: _inspect,
  startLiveFeed: _startLiveFeed,
  stopLiveFeed: _stopLiveFeed,
  selectProgram: _selectProgram,
  reconnect: _reconnect,
  clearError: _clearError,
  onInspectionPass: _onInspectionPass,
  onInspectionFail: _onInspectionFail,
}: VisionPanelProps) {
  const displayFrame = isLiveFeedActive ? liveFeedFrame : lastImage
  const canvasLabel = isLiveFeedActive ? 'Live Stream' : lastImage ? 'Last Inspection' : null


  return (
    <div
      style={{
        background: 'transparent',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Single canvas ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          width: '480px',
          backgroundColor: displayFrame ? '#111' : 'transparent',
          borderRadius: '10px',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: displayFrame
            ? `2px solid ${isLiveFeedActive ? '#ff4444' : lastResult === 'FAIL' ? 'var(--color-error, #e53e3e)' : lastResult === 'PASS' ? 'var(--color-success, #38a169)' : '#333'}`
            : 'none',
          transition: 'border-color 0.3s',
        }}
      >
        {displayFrame ? (
          <img
            src={`data:image/jpeg;base64,${displayFrame}`}
            alt="Vision camera"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : null}

        {/* Inspecting overlay */}
        {isInspecting && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              color: 'white',
              fontSize: '15px',
              fontWeight: 600,
            }}
          >
            <Loader size={22} style={{ animation: 'spin 1s linear infinite' }} />
            Inspecting…
          </div>
        )}

        {/* LIVE badge */}
        {isLiveFeedActive && !isInspecting && (
          <div
            style={{
              position: 'absolute',
              top: '10px',
              left: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              backgroundColor: 'rgba(0,0,0,0.65)',
              color: '#ff4444',
              padding: '3px 9px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.05em',
            }}
          >
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#ff4444', animation: 'pulse 1s ease-in-out infinite' }} />
            LIVE
          </div>
        )}

        {/* Mode label (top-right) */}
        {canvasLabel && !isLiveFeedActive && (
          <div
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              backgroundColor: 'rgba(0,0,0,0.55)',
              color: '#ccc',
              padding: '3px 9px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}
          >
            {canvasLabel}
          </div>
        )}

        {/* Result badge (bottom-left) */}
        {lastResult && !isInspecting && (
          <div style={{ position: 'absolute', bottom: '10px', left: '10px' }}>
            <ResultBadge result={lastResult} />
          </div>
        )}

        {/* Timestamp (bottom-right) */}
        {lastInspectedAt && !isInspecting && (
          <div
            style={{
              position: 'absolute',
              bottom: '10px',
              right: '10px',
              backgroundColor: 'rgba(0,0,0,0.55)',
              color: '#ccc',
              padding: '3px 9px',
              borderRadius: '4px',
              fontSize: '11px',
            }}
          >
            {lastInspectedAt.toLocaleTimeString()}
          </div>
        )}

      </div>

      <style>{`
        @keyframes spin  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  )
}
