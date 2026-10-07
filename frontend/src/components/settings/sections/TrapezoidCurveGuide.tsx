import { useTheme } from '@/contexts/ThemeContext'

export type TrapezoidCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

/** Isosceles trapezoid: wide base = open (HOME), narrow top = closed (TRAVEL). */
const TRAPEZOID = {
  bottomLeft: { x: 40, y: 178 },
  bottomRight: { x: 300, y: 178 },
  topRight: { x: 234, y: 38 },
  topLeft: { x: 106, y: 38 },
}

const OUTLINE = `M ${TRAPEZOID.bottomLeft.x} ${TRAPEZOID.bottomLeft.y} L ${TRAPEZOID.bottomRight.x} ${TRAPEZOID.bottomRight.y} L ${TRAPEZOID.topRight.x} ${TRAPEZOID.topRight.y} L ${TRAPEZOID.topLeft.x} ${TRAPEZOID.topLeft.y} Z`

/** Sample marks just inside each corner (matches reference artwork). */
const CORNER_POINTS: Record<TrapezoidCorner, { cx: number; cy: number; label: string }> = {
  'bottom-left': { cx: 64, cy: 158, label: '1' },
  'bottom-right': { cx: 276, cy: 158, label: '2' },
  'top-left': { cx: 112, cy: 54, label: '3' },
  'top-right': { cx: 228, cy: 54, label: '4' },
}

const MARKER_R = 15

type Props = {
  activeCorner: TrapezoidCorner | null
  completedCorners?: TrapezoidCorner[]
}

export function TrapezoidCurveGuide({ activeCorner, completedCorners = [] }: Props) {
  const { colors } = useTheme()
  const done = new Set(completedCorners)

  return (
    <svg viewBox="0 0 340 210" width="100%" height="210" role="img" aria-label="Tube opening — four sample marks">
      <path
        d={OUTLINE}
        fill="none"
        stroke={colors.text}
        strokeWidth="2.5"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
      {(Object.entries(CORNER_POINTS) as [TrapezoidCorner, typeof CORNER_POINTS[TrapezoidCorner]][]).map(([corner, pt]) => {
        const active = activeCorner === corner
        const complete = done.has(corner)
        return (
          <g key={corner}>
            {active ? (
              <circle cx={pt.cx} cy={pt.cy} r={MARKER_R + 8} fill={colors.primary} opacity={0.12} />
            ) : null}
            {complete && !active ? (
              <circle cx={pt.cx} cy={pt.cy} r={MARKER_R + 5} fill="none" stroke={colors.success} strokeWidth={2} opacity={0.5} />
            ) : null}
            <circle
              cx={pt.cx}
              cy={pt.cy}
              r={MARKER_R}
              fill={colors.white}
              stroke={active ? colors.primary : colors.text}
              strokeWidth={active ? 2.5 : 1.25}
            />
            <text x={pt.cx} y={pt.cy + 5} textAnchor="middle" fontSize="13" fontWeight={700} fill={colors.text}>
              {pt.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
