import type { VisionChecksConfig } from '@/types/reference.types'
import {
  DEFAULT_HEAT_SHRINK_LAYOUT,
  type HeatShrinkPositionLayout,
} from './HeatShrinkLayoutControls'

type WireSpliceVisionAnimationProps = {
  config: VisionChecksConfig
  heatShrinkLayout?: HeatShrinkPositionLayout
}

const WELD = { x: 1213, y: 46, w: 144, h: 68, cx: 1285, cy: 80 }

/** Weld body + in-weld copper + wire-b stub copper (full width inspection zone) */
const WELD_CU_ZONE = { x: 1213, y: 46, w: 187, h: 68, cx: 1306.5, cy: 80 }

export function WireSpliceVisionAnimation({
  config,
  heatShrinkLayout = DEFAULT_HEAT_SHRINK_LAYOUT,
}: WireSpliceVisionAnimationProps) {
  const { tube, warningLeft, warningRight, safeZone } = heatShrinkLayout

  const weldChecksActive =
    config.welding_splice.enabled &&
    (config.welding_splice.length_check ||
      config.welding_splice.width_check ||
      config.welding_splice.position_check)

  const heatShrinkChecksActive =
    config.heat_shrink_tube.enabled &&
    (config.heat_shrink_tube.position_check ||
      config.heat_shrink_tube.diameter_check ||
      config.heat_shrink_tube.length_check)

  const showWeldLength = config.welding_splice.enabled && config.welding_splice.length_check
  const showWeldWidth = config.welding_splice.enabled && config.welding_splice.width_check
  const showHsLength =
    config.heat_shrink_tube.enabled &&
    config.heat_shrink_tube.length_check &&
    !config.heat_shrink_tube.position_check
  const showHsDiameter =
    config.heat_shrink_tube.enabled &&
    config.heat_shrink_tube.diameter_check &&
    !config.heat_shrink_tube.position_check

  const showWeldPosition = config.welding_splice.enabled && config.welding_splice.position_check
  const showHeatShrinkPosition = config.heat_shrink_tube.enabled && config.heat_shrink_tube.position_check

  const viewBox = showHeatShrinkPosition
    ? '0 -95 2620 340'
    : config.heat_shrink_tube.enabled && !config.welding_splice.enabled
      ? '1680 -95 640 340'
      : showWeldWidth && !showWeldLength && !showWeldPosition
        ? '1020 -110 780 370'
        : '1080 -95 720 340'

  const hsStartX = showHeatShrinkPosition ? tube.startX : tube.staticX
  const hsSlidePx = tube.endX - tube.startX

  const warningLeftLimitX = warningLeft.x + warningLeft.w
  const warningRightLimitX = warningRight.x
  const limitTop = Math.min(warningLeft.y, warningRight.y, safeZone.y) - 10
  const limitBottom = Math.max(warningLeft.y + warningLeft.h, warningRight.y + warningRight.h, safeZone.y + safeZone.h) + 10

  return (
    <div className="wire-splice-vision-animation">
      <svg
        viewBox={viewBox}
        role="img"
        aria-label="Wire splice vision check diagram"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath id="vc-lins">
            <rect x="20" y="30" width="1200" height="100" rx="50" />
          </clipPath>
          <clipPath id="vc-rins">
            <rect x="1400" y="30" width="1200" height="100" rx="50" />
          </clipPath>
          <clipPath id="vc-weld">
            <rect x="1213" y="46" width="144" height="68" rx="6" />
          </clipPath>

          <linearGradient id="vc-weldBodyGrad" x1="1213" y1="46" x2="1213" y2="114" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#E0A848" />
            <stop offset="22%" stopColor="#C88030" />
            <stop offset="55%" stopColor="#A86018" />
            <stop offset="82%" stopColor="#8A4A08" />
            <stop offset="100%" stopColor="#6A3800" />
          </linearGradient>
          <linearGradient id="vc-weldCoreGrad" x1="1285" y1="50" x2="1285" y2="110" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F0C868" stopOpacity="0.9" />
            <stop offset="45%" stopColor="#D09038" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#9A5808" stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id="vc-weldHAZ" x1="1213" y1="80" x2="1357" y2="80" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#D4944A" stopOpacity="0.85" />
            <stop offset="12%" stopColor="#B07020" stopOpacity="0.35" />
            <stop offset="50%" stopColor="#8A4800" stopOpacity="0" />
            <stop offset="88%" stopColor="#B07020" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#D4944A" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id="vc-weldBondSeam" x1="1281" y1="46" x2="1289" y2="46" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#5A2800" stopOpacity="0" />
            <stop offset="50%" stopColor="#3A1800" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#5A2800" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="vc-weldTopBulge" cx="1285" cy="46" r="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F8D878" stopOpacity="0.7" />
            <stop offset="60%" stopColor="#C88830" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#8A5008" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="vc-weldBotBulge" cx="1285" cy="114" r="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#5A3000" stopOpacity="0.55" />
            <stop offset="70%" stopColor="#8A5008" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#8A5008" stopOpacity="0" />
          </radialGradient>
          <filter id="vc-weldSoftShadow" x="-8%" y="-20%" width="116%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="#3A1800" floodOpacity="0.35" />
          </filter>

          <linearGradient id="vc-warningFillGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FCA5A5" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#EF4444" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#B91C1C" stopOpacity="0.48" />
          </linearGradient>
          <linearGradient id="vc-safeFillGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#86EFAC" stopOpacity="0.42" />
            <stop offset="50%" stopColor="#22C55E" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#15803D" stopOpacity="0.38" />
          </linearGradient>
          <pattern id="vc-warningHatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="14" stroke="#FECACA" strokeWidth="3" opacity="0.45" />
          </pattern>
          <pattern id="vc-safeHatch" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="8" cy="8" r="1.2" fill="#BBF7D0" opacity="0.35" />
          </pattern>
          <filter id="vc-safeGlow" x="-6%" y="-10%" width="112%" height="120%">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#22C55E" floodOpacity="0.35" />
          </filter>
          <filter id="vc-warningGlow" x="-6%" y="-10%" width="112%" height="120%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#EF4444" floodOpacity="0.4" />
          </filter>

          <pattern id="vc-cu" patternUnits="userSpaceOnUse" width="18" height="18" patternTransform="rotate(8)">
            <rect width="18" height="18" fill="#B86820" />
            <ellipse cx="5" cy="5" rx="4" ry="4" fill="#D4893A" opacity="0.9" />
            <ellipse cx="13" cy="13" rx="4" ry="4" fill="#C47228" opacity="0.9" />
            <ellipse cx="14" cy="4" rx="3.5" ry="3.5" fill="#E09848" opacity="0.8" />
            <ellipse cx="4" cy="14" rx="3.5" ry="3.5" fill="#C07020" opacity="0.8" />
            <ellipse cx="9" cy="9" rx="3" ry="3" fill="#A05010" opacity="0.7" />
          </pattern>
          <pattern id="vc-wcu" patternUnits="userSpaceOnUse" width="6" height="6">
            <rect width="6" height="6" fill="#A05810" />
            <line x1="0" y1="1.5" x2="6" y2="1.5" stroke="#D08030" strokeWidth="0.35" opacity="0.45" />
            <line x1="0" y1="3" x2="6" y2="3" stroke="#884008" strokeWidth="0.25" opacity="0.35" />
          </pattern>
          <pattern id="vc-wcuFine" patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="#B06818" />
            <line x1="0" y1="2" x2="4" y2="2" stroke="#D89040" strokeWidth="0.2" opacity="0.5" />
          </pattern>
          <pattern id="vc-redins" patternUnits="userSpaceOnUse" width="20" height="20">
            <rect width="20" height="20" fill="#B83020" />
            <line x1="0" y1="10" x2="20" y2="10" stroke="#902010" strokeWidth="1" opacity="0.3" />
          </pattern>
          <pattern id="vc-grnins" patternUnits="userSpaceOnUse" width="20" height="20">
            <rect width="20" height="20" fill="#2A8A30" />
            <line x1="0" y1="10" x2="20" y2="10" stroke="#106020" strokeWidth="1" opacity="0.3" />
          </pattern>

          <marker id="vc-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
          </marker>
        </defs>

        <g opacity={config.welding_splice.enabled || config.heat_shrink_tube.enabled ? 1 : 0.35}>
          <g>
            <g id="wire-a">
              <rect x="20" y="30" width="1200" height="100" rx="50" fill="url(#vc-redins)" />
              <rect x="28" y="33" width="1184" height="22" rx="11" fill="#E05040" opacity="0.35" clipPath="url(#vc-lins)" />
              <rect x="28" y="98" width="1184" height="28" fill="#701010" opacity="0.45" clipPath="url(#vc-lins)" />
              <rect x="20" y="30" width="1200" height="100" rx="50" fill="none" stroke="#8B1A10" strokeWidth="3" />
              <rect x="20" y="30" width="1200" height="100" rx="50" fill="none" stroke="#E06050" strokeWidth="1" opacity="0.4" />
            </g>

            <g id="wire-b">
              <rect x="1400" y="30" width="1200" height="100" rx="50" fill="url(#vc-grnins)" />
              <rect x="1408" y="33" width="1184" height="22" rx="11" fill="#50C858" opacity="0.35" clipPath="url(#vc-rins)" />
              <rect x="1408" y="98" width="1184" height="28" fill="#106010" opacity="0.45" clipPath="url(#vc-rins)" />
              <rect x="1400" y="30" width="1200" height="100" rx="50" fill="none" stroke="#1A6B18" strokeWidth="3" />
              <rect x="1400" y="30" width="1200" height="100" rx="50" fill="none" stroke="#60D068" strokeWidth="1" opacity="0.4" />
              <rect x="1350" y="46" width="50" height="68" fill="url(#vc-cu)" />
              <rect x="1350" y="46" width="50" height="10" fill="#F0C070" opacity="0.2" />
              <rect x="1396" y="46" width="4" height="68" fill="#5A2800" opacity="0.5" />
              <line x1="1400" y1="44" x2="1400" y2="116" stroke="#2C1400" strokeWidth="2" />
            </g>

            <g id="weld-zone" clipPath="url(#vc-weld)" filter="url(#vc-weldSoftShadow)">
              <WeldZoneGraphic x={WELD.x} y={WELD.y} w={WELD.w} h={WELD.h} />
            </g>

            <rect x="1213" y="46" width="144" height="68" rx="6" fill="none" stroke="#6A3800" strokeWidth="1.5" />
            <rect x="1221" y="50" width="12" height="60" fill="url(#vc-cu)" opacity="0.45" clipPath="url(#vc-weld)" />
            <rect x="1337" y="50" width="12" height="60" fill="url(#vc-cu)" opacity="0.45" clipPath="url(#vc-weld)" />

          </g>

          {showHeatShrinkPosition && (
            <g className="vc-warning-limits" aria-hidden="true">
              <WarningZoneBox zone={warningLeft} side="left" />
              <WarningZoneBox zone={warningRight} side="right" />
              <LimitBracket x={warningLeftLimitX} y1={limitTop} y2={limitBottom} facing="right" />
              <LimitBracket x={warningRightLimitX} y1={limitTop} y2={limitBottom} facing="left" />
            </g>
          )}

          {showHeatShrinkPosition && <SafeZoneBox zone={safeZone} />}

          {showHeatShrinkPosition && (
            <>
              <rect
                x={tube.startX}
                y={tube.y}
                width={tube.w}
                height={tube.h}
                fill="none"
                stroke="#F87171"
                strokeWidth="4"
                strokeDasharray="10 6"
                className="vc-hs-wrong-outline"
              />
              <rect
                x={tube.endX}
                y={tube.y}
                width={tube.w}
                height={tube.h}
                fill="none"
                stroke="#4ADE80"
                strokeWidth="3"
                strokeDasharray="8 5"
                className="vc-hs-target-outline"
              />
            </>
          )}

          <g
            className={showHeatShrinkPosition ? 'vc-heat-shrink-slide' : undefined}
            style={showHeatShrinkPosition ? { ['--hs-slide' as string]: `${hsSlidePx}px` } : undefined}
          >
            <g className={showHeatShrinkPosition ? 'vc-heat-shrink-body' : undefined}>
              <rect
                id="heat-shrink-pre"
                x={hsStartX}
                y={tube.y}
                width={tube.w}
                height={tube.h}
                fill="#000000"
                opacity={config.heat_shrink_tube.enabled ? 1 : 0.15}
              />
              {showHeatShrinkPosition && (
                <>
                  <rect x={hsStartX} y={tube.y} width={tube.w} height={tube.h} fill="#EF4444" className="vc-hs-warning-fill" />
                  <rect
                    x={hsStartX}
                    y={tube.y}
                    width={tube.w}
                    height={tube.h}
                    fill="none"
                    stroke="#FCA5A5"
                    strokeWidth="5"
                    className="vc-hs-warning-ring"
                  />
                  <rect x={hsStartX} y={tube.y} width={tube.w} height={tube.h} fill="#22C55E" className="vc-hs-safe-fill" />
                  <rect
                    x={hsStartX}
                    y={tube.y}
                    width={tube.w}
                    height={tube.h}
                    fill="none"
                    stroke="#86EFAC"
                    strokeWidth="5"
                    className="vc-hs-safe-ring"
                  />
                </>
              )}
            </g>
          </g>

        </g>

        {weldChecksActive && (
          <rect
            x={WELD.x - 6}
            y={WELD.y - 6}
            width={WELD.w + 12}
            height={WELD.h + 12}
            rx="10"
            fill="none"
            stroke="#38BDF8"
            strokeWidth="3"
            opacity="0.7"
          />
        )}

        {config.heat_shrink_tube.enabled && heatShrinkChecksActive && !showHeatShrinkPosition && (
          <rect
            x={tube.staticX - 6}
            y={tube.y - 6}
            width={tube.w + 12}
            height={tube.h + 12}
            fill="none"
            stroke="#A78BFA"
            strokeWidth="3"
            opacity="0.7"
          />
        )}

        {showWeldLength && (
          <>
            <WeldReferenceOutline x={WELD.x} y={WELD.y} w={WELD.w} h={WELD.h} color="#38BDF8" label="MASTER" />
            <g className="vc-measure-length" color="#38BDF8">
              <line x1={WELD.x} y1="18" x2={WELD.x + WELD.w} y2="18" stroke="currentColor" strokeWidth="2.5" markerStart="url(#vc-arrow)" markerEnd="url(#vc-arrow)" />
              <line x1={WELD.x} y1="18" x2={WELD.x} y2={WELD.y} stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
              <line x1={WELD.x + WELD.w} y1="18" x2={WELD.x + WELD.w} y2={WELD.y} stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
            </g>
          </>
        )}

        {showWeldWidth && (
          <>
            <WeldCopperZoneFaultHighlight zone={WELD_CU_ZONE} />
            <g className="vc-measure-width" color="#FB923C">
              <line
                x1={WELD_CU_ZONE.x + WELD_CU_ZONE.w + 22}
                y1={WELD_CU_ZONE.y}
                x2={WELD_CU_ZONE.x + WELD_CU_ZONE.w + 22}
                y2={WELD_CU_ZONE.y + WELD_CU_ZONE.h}
                stroke="currentColor"
                strokeWidth="2.5"
                markerStart="url(#vc-arrow)"
                markerEnd="url(#vc-arrow)"
              />
              <line
                x1={WELD_CU_ZONE.x + WELD_CU_ZONE.w}
                y1={WELD_CU_ZONE.y}
                x2={WELD_CU_ZONE.x + WELD_CU_ZONE.w + 22}
                y2={WELD_CU_ZONE.y}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="5 4"
              />
              <line
                x1={WELD_CU_ZONE.x + WELD_CU_ZONE.w}
                y1={WELD_CU_ZONE.y + WELD_CU_ZONE.h}
                x2={WELD_CU_ZONE.x + WELD_CU_ZONE.w + 22}
                y2={WELD_CU_ZONE.y + WELD_CU_ZONE.h}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="5 4"
              />
            </g>
          </>
        )}

        {showWeldPosition && (
          <g className="vc-measure-position" color="#4ADE80">
            <line x1="1080" y1={WELD.cy} x2="1800" y2={WELD.cy} stroke="currentColor" strokeWidth="2.5" strokeDasharray="10 8" />
            <line x1={WELD.cx} y1="10" x2={WELD.cx} y2="150" stroke="currentColor" strokeWidth="2.5" strokeDasharray="10 8" />
            <circle cx={WELD.cx} cy={WELD.cy} r="12" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.7" />
            <circle cx={WELD.cx} cy={WELD.cy} r="4" fill="currentColor" opacity="0.8" />
          </g>
        )}

        {showHsLength && (
          <g className="vc-measure-length" color="#7DD3FC">
            <line
              x1={tube.staticX}
              y1={tube.y - 18}
              x2={tube.staticX + tube.w}
              y2={tube.y - 18}
              stroke="currentColor"
              strokeWidth="3"
              markerStart="url(#vc-arrow)"
              markerEnd="url(#vc-arrow)"
            />
            <line x1={tube.staticX} y1={tube.y - 18} x2={tube.staticX} y2={tube.y} stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
            <line x1={tube.staticX + tube.w} y1={tube.y - 18} x2={tube.staticX + tube.w} y2={tube.y} stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
          </g>
        )}

        {showHsDiameter && (
          <g className="vc-measure-diameter" color="#FDBA74">
            <line
              x1={tube.staticX + tube.w + 16}
              y1={tube.y}
              x2={tube.staticX + tube.w + 16}
              y2={tube.y + tube.h}
              stroke="currentColor"
              strokeWidth="3"
              markerStart="url(#vc-arrow)"
              markerEnd="url(#vc-arrow)"
            />
            <line x1={tube.staticX + tube.w} y1={tube.y} x2={tube.staticX + tube.w + 16} y2={tube.y} stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
            <line x1={tube.staticX + tube.w} y1={tube.y + tube.h} x2={tube.staticX + tube.w + 16} y2={tube.y + tube.h} stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
          </g>
        )}
      </svg>

      <style>{`
        .wire-splice-vision-animation {
          width: 100%;
          border-radius: 10px;
          overflow: hidden;
          background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
          border: 1px solid rgba(15, 23, 42, 0.08);
        }

        .wire-splice-vision-animation svg {
          display: block;
          width: 100%;
          height: auto;
          min-height: 140px;
        }

        .vc-limit-bracket {
          fill: none;
          stroke: #F87171;
          stroke-width: 5;
          stroke-linecap: round;
          animation: vc-limit-bracket-pulse 2.4s ease-in-out infinite;
        }

        .vc-limit-bracket-right {
          animation-delay: 0.2s;
        }

        .vc-hs-wrong-outline {
          animation: vc-wrong-flash 6s ease-in-out infinite;
        }

        .vc-hs-target-outline {
          animation: vc-target-reveal 6s ease-in-out infinite;
        }

        .vc-warning-zone-left,
        .vc-warning-zone-right {
          animation: vc-warning-zone-active 6s ease-in-out infinite;
        }

        .vc-warning-zone-right {
          animation-delay: 0.15s;
        }

        .vc-warning-surface {
          filter: url(#vc-warningGlow);
        }

        .vc-warning-border {
          stroke: #FCA5A5;
          stroke-width: 3;
        }

        .vc-warning-edge {
          stroke: #DC2626;
          stroke-width: 5;
          stroke-dasharray: 14 9;
          animation: vc-warning-edge-flow 1.8s linear infinite;
        }

        .vc-safe-zone-group {
          animation: vc-safe-zone-active 6s ease-in-out infinite;
        }

        .vc-safe-surface {
          filter: url(#vc-safeGlow);
        }

        .vc-safe-outer {
          stroke: #4ADE80;
          stroke-width: 4;
        }

        .vc-safe-inner {
          stroke: #BBF7D0;
          stroke-width: 2;
          stroke-dasharray: 16 10;
          animation: vc-safe-inner-flow 2.2s linear infinite;
        }

        .vc-heat-shrink-body {
          animation: vc-hs-warning-shake 6s ease-in-out infinite;
        }

        .vc-hs-warning-fill {
          opacity: 0;
          mix-blend-mode: screen;
          animation: vc-hs-warning-fill 6s ease-in-out infinite;
        }

        .vc-hs-warning-ring {
          opacity: 0;
          animation: vc-hs-warning-ring 6s ease-in-out infinite;
        }

        .vc-hs-safe-fill {
          opacity: 0;
          mix-blend-mode: screen;
          animation: vc-hs-safe-fill 6s ease-in-out infinite;
        }

        .vc-hs-safe-ring {
          opacity: 0;
          animation: vc-hs-safe-ring 6s ease-in-out infinite;
        }

        .vc-heat-shrink-slide {
          animation: vc-hs-slide-to-weld 6s ease-in-out infinite;
        }

        .vc-weld-ref-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          font-family: system-ui, sans-serif;
        }

        @keyframes vc-limit-bracket-pulse {
          0%, 100% { opacity: 0.65; }
          50% { opacity: 1; }
        }

        @keyframes vc-warning-edge-flow {
          to { stroke-dashoffset: -46; }
        }

        @keyframes vc-safe-inner-flow {
          to { stroke-dashoffset: -52; }
        }

        @keyframes vc-wrong-flash {
          0%, 28% { opacity: 1; }
          34%, 100% { opacity: 0; }
        }

        @keyframes vc-target-reveal {
          0%, 50% { opacity: 0; }
          56%, 86% { opacity: 1; }
          100% { opacity: 0; }
        }

        @keyframes vc-warning-zone-active {
          0%, 26% { opacity: 1; }
          32%, 100% { opacity: 0.35; }
        }

        @keyframes vc-safe-zone-active {
          0%, 48% { opacity: 0.35; }
          54%, 86% { opacity: 1; }
          100% { opacity: 0.35; }
        }

        @keyframes vc-hs-warning-shake {
          0%, 4% { transform: translateX(0); }
          5% { transform: translateX(-3px); }
          6% { transform: translateX(3px); }
          7% { transform: translateX(-2px); }
          8% { transform: translateX(2px); }
          9%, 24% { transform: translateX(0); }
          25%, 100% { transform: translateX(0); }
        }

        @keyframes vc-hs-warning-fill {
          0%, 26% { opacity: 0.42; }
          32%, 100% { opacity: 0; }
        }

        @keyframes vc-hs-warning-ring {
          0%, 26% { opacity: 1; }
          32%, 100% { opacity: 0; }
        }

        @keyframes vc-hs-safe-fill {
          0%, 48% { opacity: 0; }
          54%, 86% { opacity: 0.38; }
          100% { opacity: 0; }
        }

        @keyframes vc-hs-safe-ring {
          0%, 48% { opacity: 0; }
          54%, 86% { opacity: 1; }
          100% { opacity: 0; }
        }

        @keyframes vc-hs-slide-to-weld {
          0%, 24% { transform: translateX(0); }
          30%, 86% { transform: translateX(var(--hs-slide, -1070px)); }
          100% { transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}

function WeldZoneGraphic({
  x,
  y,
  w,
  h,
  variant = 'master',
  strokeColor = '#FB923C',
}: {
  x: number
  y: number
  w: number
  h: number
  variant?: 'master' | 'candidate'
  strokeColor?: string
}) {
  const sx = (v: number) => (v * w) / WELD.w
  const sy = (v: number) => (v * h) / WELD.h
  const cx = x + w / 2

  return (
    <g opacity={variant === 'candidate' ? 0.65 : 1}>
      <rect x={x} y={y} width={w} height={h} rx={sx(6)} fill="url(#vc-weldBodyGrad)" />
      <rect x={x} y={y} width={w} height={h} rx={sx(6)} fill="url(#vc-wcu)" opacity="0.55" />
      <rect x={x + sx(10)} y={y + sy(6)} width={w - sx(20)} height={h - sy(12)} rx={sx(4)} fill="url(#vc-weldCoreGrad)" />
      <rect x={x + sx(18)} y={y + sy(12)} width={w - sx(36)} height={h - sy(24)} rx={sx(3)} fill="url(#vc-wcuFine)" opacity="0.4" />
      <rect x={x} y={y} width={w} height={h} rx={sx(6)} fill="url(#vc-weldHAZ)" />
      <rect x={x} y={y} width={w} height={sy(22)} fill="url(#vc-weldTopBulge)" />
      <rect x={x} y={y + h - sy(22)} width={w} height={sy(22)} fill="url(#vc-weldBotBulge)" />
      <rect x={cx - sx(4)} y={y + sy(2)} width={sx(8)} height={h - sy(4)} fill="url(#vc-weldBondSeam)" />
      {variant === 'candidate' && (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={sx(6)}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeDasharray="6 4"
        />
      )}
    </g>
  )
}

function WeldReferenceOutline({
  x,
  y,
  w,
  h,
  color,
  label,
  className,
}: {
  x: number
  y: number
  w: number
  h: number
  color: string
  label: string
  className?: string
}) {
  return (
    <g className={className} aria-hidden="true">
      <rect
        x={x - 4}
        y={y - 4}
        width={w + 8}
        height={h + 8}
        rx="8"
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray="8 5"
        opacity="0.85"
      />
      <text x={x + w / 2} y={y - 10} textAnchor="middle" fill={color} className="vc-weld-ref-label">
        {label}
      </text>
    </g>
  )
}

function WeldCopperZoneFaultHighlight({
  zone,
}: {
  zone: { x: number; y: number; w: number; h: number; cx: number; cy: number }
}) {
  const pad = 4
  return (
    <g aria-hidden="true">
      <rect
        x={zone.x - pad}
        y={zone.y - pad}
        width={zone.w + pad * 2}
        height={zone.h + pad * 2}
        rx="10"
        fill="url(#vc-warningFillGrad)"
        opacity="0.42"
        style={{ mixBlendMode: 'multiply' }}
      />
      <rect
        x={zone.x - pad}
        y={zone.y - pad}
        width={zone.w + pad * 2}
        height={zone.h + pad * 2}
        rx="10"
        fill="url(#vc-warningHatch)"
        opacity="0.5"
      />
      <rect
        x={zone.x - pad}
        y={zone.y - pad}
        width={zone.w + pad * 2}
        height={zone.h + pad * 2}
        rx="10"
        fill="none"
        stroke="#FCA5A5"
        strokeWidth="5"
      />
      <g style={{ transformOrigin: `${zone.cx}px ${zone.y - 22}px` }}>
        <rect x={zone.cx - 62} y={zone.y - 36} width={124} height={22} rx="5" fill="#DC2626" stroke="#FCA5A5" strokeWidth="2" />
        <text x={zone.cx} y={zone.y - 21} textAnchor="middle" fill="#FFF" fontSize="11" fontWeight="800" fontFamily="system-ui, sans-serif">
          WIDTH FAULT
        </text>
      </g>
    </g>
  )
}

type ZoneRect = { x: number; y: number; w: number; h: number }

function WarningZoneBox({ zone, side }: { zone: ZoneRect; side: 'left' | 'right' }) {
  const edgeX = side === 'left' ? zone.x + zone.w : zone.x

  return (
    <g className={`vc-warning-zone vc-warning-zone-${side}`}>
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.w}
        height={zone.h}
        rx="10"
        fill="url(#vc-warningFillGrad)"
        className="vc-warning-surface"
      />
      <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="10" fill="url(#vc-warningHatch)" opacity="0.35" />
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.w}
        height={zone.h}
        rx="10"
        fill="none"
        className="vc-warning-border"
      />
      <line
        x1={edgeX}
        y1={zone.y + 6}
        x2={edgeX}
        y2={zone.y + zone.h - 6}
        className="vc-warning-edge"
      />
    </g>
  )
}

function SafeZoneBox({ zone }: { zone: ZoneRect }) {
  const inset = 10

  return (
    <g className="vc-safe-zone-group">
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.w}
        height={zone.h}
        rx="14"
        fill="url(#vc-safeFillGrad)"
        className="vc-safe-surface"
      />
      <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="14" fill="url(#vc-safeHatch)" opacity="0.5" />
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.w}
        height={zone.h}
        rx="14"
        fill="none"
        className="vc-safe-outer"
      />
      <rect
        x={zone.x + inset}
        y={zone.y + inset}
        width={zone.w - inset * 2}
        height={zone.h - inset * 2}
        rx="10"
        fill="none"
        className="vc-safe-inner"
      />
    </g>
  )
}

function LimitBracket({
  x,
  y1,
  y2,
  facing,
}: {
  x: number
  y1: number
  y2: number
  facing: 'left' | 'right'
}) {
  const arm = 26
  const mid = (y1 + y2) / 2
  const d =
    facing === 'right'
      ? `M ${x} ${y1 + arm} L ${x} ${y1} L ${x + arm} ${y1} M ${x} ${y2 - arm} L ${x} ${y2} L ${x + arm} ${y2} M ${x} ${mid - arm} L ${x} ${mid + arm}`
      : `M ${x} ${y1 + arm} L ${x} ${y1} L ${x - arm} ${y1} M ${x} ${y2 - arm} L ${x} ${y2} L ${x - arm} ${y2} M ${x} ${mid - arm} L ${x} ${mid + arm}`

  return <path d={d} className={`vc-limit-bracket vc-limit-bracket-${facing}`} />
}
