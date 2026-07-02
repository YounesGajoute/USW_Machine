/**
 * GIF-inspired copper circuit-path accents for Versigent brand surfaces.
 * Decorative only (aria-hidden, no pointer events): traces, branch stubs,
 * junction vias and pads etched across surface edges with a soft copper glow.
 * Static (no animation); denser/brighter on the header, lighter on the page.
 */
export interface VersigentCopperLinesProps {
  copper?: string
  /** 'header' — dense circuit field along the top bar; 'page' — corner accents for content shell */
  variant?: 'header' | 'page'
}

interface Trace {
  d: string
  width?: number
  opacity?: number
  dash?: string
  glow?: boolean
  /** render in the brighter "hot" copper tint */
  highlight?: boolean
}

interface Node {
  cx: number
  cy: number
  r?: number
  opacity?: number
  /** draw an open pad ring around the node */
  ring?: boolean
  /** fill the core with the brighter "hot" copper tint */
  highlight?: boolean
}

/** Lighten a #rrggbb hex toward white by `amt` (0..1). Falls back to input on bad hex. */
function lighten(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const int = parseInt(m[1], 16)
  const r = (int >> 16) & 0xff
  const g = (int >> 8) & 0xff
  const b = int & 0xff
  const mix = (c: number) => Math.round(c + (255 - c) * amt)
  const toHex = (c: number) => c.toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

const HEADER_TRACES: Trace[] = [
  // Left cluster — stepped traces fanning in from the edge
  { d: 'M 0 18 L 70 18 L 96 44 L 180 44 L 206 70 L 300 70', width: 1.6, opacity: 0.9, glow: true, highlight: true },
  { d: 'M 0 50 L 40 50 L 64 26 L 150 26 L 174 50 L 250 50 L 274 74 L 360 74', width: 1.4, opacity: 0.68, glow: true },
  { d: 'M 0 92 L 110 92 L 132 114 L 232 114 L 256 138 L 330 138', width: 1.2, opacity: 0.58, dash: '5 7' },
  { d: 'M 0 132 L 86 132 L 104 150 L 210 150', width: 1.1, opacity: 0.5 },
  { d: 'M 300 70 L 340 70 L 360 50 L 430 50', width: 1.1, opacity: 0.55 },
  // Left gap — bridge from the logo cluster toward the nav
  { d: 'M 430 50 L 470 50 L 494 28 L 560 28 L 584 52 L 660 52', width: 1.3, opacity: 0.6, glow: true },
  { d: 'M 470 96 L 540 96 L 562 118 L 640 118 L 662 96 L 720 96', width: 1.1, opacity: 0.5, dash: '5 7' },
  { d: 'M 560 28 L 580 28 L 600 12 L 660 12', width: 1, opacity: 0.5 },
  { d: 'M 500 150 L 600 150 L 622 134 L 700 134', width: 1, opacity: 0.42 },
  // Right cluster — mirror of the left
  { d: 'M 1920 18 L 1850 18 L 1824 44 L 1740 44 L 1714 70 L 1620 70', width: 1.6, opacity: 0.85, glow: true, highlight: true },
  { d: 'M 1920 50 L 1880 50 L 1856 26 L 1770 26 L 1746 50 L 1670 50 L 1646 74 L 1560 74', width: 1.4, opacity: 0.66, glow: true },
  { d: 'M 1920 92 L 1810 92 L 1788 114 L 1688 114 L 1664 138 L 1590 138', width: 1.2, opacity: 0.56, dash: '5 7' },
  { d: 'M 1920 132 L 1834 132 L 1816 150 L 1710 150', width: 1.1, opacity: 0.5 },
  { d: 'M 1620 70 L 1580 70 L 1560 50 L 1490 50', width: 1.1, opacity: 0.55 },
  // Right gap — bridge from the nav toward the user / login area
  { d: 'M 1490 50 L 1450 50 L 1426 28 L 1360 28 L 1336 52 L 1260 52', width: 1.3, opacity: 0.58, glow: true },
  { d: 'M 1450 96 L 1380 96 L 1358 118 L 1280 118 L 1258 96 L 1200 96', width: 1.1, opacity: 0.5, dash: '5 7' },
  { d: 'M 1360 28 L 1340 28 L 1320 12 L 1260 12', width: 1, opacity: 0.5 },
  { d: 'M 1420 150 L 1320 150 L 1298 134 L 1220 134', width: 1, opacity: 0.42 },
  // Top-edge brackets above the nav
  { d: 'M 760 0 L 786 24 L 838 24', width: 1.1, opacity: 0.48 },
  { d: 'M 806 0 L 845 18 L 922 18 L 960 0', width: 1.1, opacity: 0.52, glow: true },
  { d: 'M 1036 0 L 1075 14 L 1152 14 L 1190 0', width: 1.1, opacity: 0.52, glow: true },
  { d: 'M 1160 0 L 1134 24 L 1082 24', width: 1.1, opacity: 0.48 },
  // Brighter baseline running across the lower edge with periodic vias
  { d: 'M 360 158 L 760 158 L 786 150 L 1140 150 L 1166 158 L 1560 158', width: 1.1, opacity: 0.4, dash: '2 10' },
]

const HEADER_NODES: Node[] = [
  { cx: 70, cy: 18, r: 2.8, opacity: 0.95, ring: true, highlight: true },
  { cx: 96, cy: 44, r: 2, opacity: 0.7 },
  { cx: 174, cy: 50, r: 2, opacity: 0.62 },
  { cx: 300, cy: 70, r: 2.6, opacity: 0.78, ring: true },
  { cx: 232, cy: 114, r: 1.8, opacity: 0.55 },
  { cx: 430, cy: 50, r: 2.2, opacity: 0.62, ring: true },
  { cx: 584, cy: 52, r: 2, opacity: 0.58 },
  { cx: 660, cy: 52, r: 2.4, opacity: 0.7, ring: true, highlight: true },
  { cx: 640, cy: 118, r: 1.8, opacity: 0.5 },
  { cx: 1850, cy: 18, r: 2.8, opacity: 0.9, ring: true, highlight: true },
  { cx: 1824, cy: 44, r: 2, opacity: 0.65 },
  { cx: 1620, cy: 70, r: 2.6, opacity: 0.72, ring: true },
  { cx: 1688, cy: 114, r: 1.8, opacity: 0.55 },
  { cx: 1490, cy: 50, r: 2.2, opacity: 0.6, ring: true },
  { cx: 1336, cy: 52, r: 2, opacity: 0.56 },
  { cx: 1260, cy: 52, r: 2.4, opacity: 0.68, ring: true, highlight: true },
  { cx: 1280, cy: 118, r: 1.8, opacity: 0.5 },
  { cx: 845, cy: 18, r: 1.8, opacity: 0.5 },
  { cx: 1075, cy: 14, r: 1.8, opacity: 0.5 },
]

const PAGE_TRACES: Trace[] = [
  { d: 'M 0 48 L 0 12 L 36 12 L 52 28 L 88 28 L 104 44 L 148 44 L 168 64 L 240 64', width: 1.4, opacity: 0.55, glow: true, highlight: true },
  { d: 'M 0 96 L 64 96 L 84 76 L 150 76 L 170 96 L 224 96', width: 1.1, opacity: 0.42, dash: '4 8' },
  { d: 'M 1920 36 L 1892 36 L 1876 20 L 1824 20 L 1808 36 L 1760 36 L 1740 56 L 1672 56', width: 1.4, opacity: 0.5, glow: true, highlight: true },
  { d: 'M 1920 1056 L 1880 1056 L 1864 1040 L 1800 1040 L 1784 1024 L 1720 1024 L 1700 1004 L 1632 1004', width: 1.6, opacity: 0.48, glow: true },
  { d: 'M 0 1048 L 64 1048 L 80 1032 L 140 1032 L 160 1052 L 232 1052', width: 1.4, opacity: 0.5 },
  { d: 'M 0 1004 L 96 1004 L 116 1024 L 188 1024', width: 1.1, opacity: 0.38, dash: '4 8' },
]

const PAGE_NODES: Node[] = [
  { cx: 36, cy: 12, r: 2.6, opacity: 0.68, ring: true, highlight: true },
  { cx: 104, cy: 44, r: 2, opacity: 0.55 },
  { cx: 1876, cy: 20, r: 2.5, opacity: 0.62, ring: true, highlight: true },
  { cx: 80, cy: 1032, r: 2.3, opacity: 0.6, ring: true },
  { cx: 1784, cy: 1024, r: 2, opacity: 0.55 },
]

function CircuitField({
  copper,
  hot,
  traces,
  nodes,
  viewBox,
  filterId,
}: {
  copper: string
  hot: string
  traces: Trace[]
  nodes: Node[]
  viewBox: string
  filterId: string
}) {
  const svgStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    overflow: 'hidden',
  }
  return (
    <svg aria-hidden viewBox={viewBox} preserveAspectRatio="none" style={svgStyle}>
      <defs>
        <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {traces.map((t, i) => (
        <path
          key={`t-${i}`}
          d={t.d}
          fill="none"
          stroke={t.highlight ? hot : copper}
          strokeWidth={t.width ?? 1.2}
          strokeOpacity={t.opacity ?? 0.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={t.dash}
          filter={t.glow ? `url(#${filterId})` : undefined}
        />
      ))}
      {nodes.map((n, i) => (
        <g key={`n-${i}`}>
          {n.ring && (
            <circle
              cx={n.cx}
              cy={n.cy}
              r={(n.r ?? 2) + 2.5}
              fill="none"
              stroke={copper}
              strokeWidth="1"
              strokeOpacity={(n.opacity ?? 0.5) * 0.6}
            />
          )}
          <circle
            cx={n.cx}
            cy={n.cy}
            r={n.r ?? 2}
            fill={n.highlight ? hot : copper}
            fillOpacity={n.opacity ?? 0.5}
          />
        </g>
      ))}
    </svg>
  )
}

export function VersigentCopperLines({
  copper = '#CD7925',
  variant = 'header',
}: VersigentCopperLinesProps) {
  const hot = lighten(copper, 0.38)

  if (variant === 'page') {
    return (
      <CircuitField
        copper={copper}
        hot={hot}
        traces={PAGE_TRACES}
        nodes={PAGE_NODES}
        viewBox="0 0 1920 1080"
        filterId="versigent-copper-glow-page"
      />
    )
  }

  return (
    <CircuitField
      copper={copper}
      hot={hot}
      traces={HEADER_TRACES}
      nodes={HEADER_NODES}
      viewBox="0 0 1920 160"
      filterId="versigent-copper-glow-header"
    />
  )
}
