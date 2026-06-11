/**
 * Detailed weld splice and heat-shrink sleeve rendering for the cable schematic.
 */

export interface ComponentBox {
  x: number
  y: number
  w: number
  h: number
}

export interface ShrinkLabelStyle {
  label: string
  textColor: string
  backgroundColor: string
}

/** Ultrasonic weld splice — fused copper barrel with per-wire nuggets. */
export function drawWeldSplice(
  ctx: CanvasRenderingContext2D,
  box: ComponentBox,
  wireYs: number[],
  wireStroke: number,
  enabled: boolean,
) {
  const { x, y, w, h } = box
  if (w <= 0 || h <= 0) return

  ctx.save()

  if (!enabled) {
    drawWeldSpliceDisabled(ctx, x, y, w, h, wireYs, wireStroke)
    ctx.restore()
    return
  }

  const cx = x + w / 2
  const bodyTop = y
  const bodyH = h
  const bulge = Math.min(w * 0.18, 6)

  // Drop shadow
  ctx.shadowColor = 'rgba(30,18,8,0.35)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2

  // Barrel body (slightly wider in the middle)
  const bodyPath = new Path2D()
  bodyPath.moveTo(x, bodyTop + bodyH * 0.12)
  bodyPath.bezierCurveTo(x - bulge * 0.3, bodyTop, x - bulge * 0.2, bodyTop + bodyH, x, bodyTop + bodyH * 0.88)
  bodyPath.lineTo(x + w, bodyTop + bodyH * 0.88)
  bodyPath.bezierCurveTo(x + w + bulge * 0.2, bodyTop + bodyH, x + w + bulge * 0.3, bodyTop, x + w, bodyTop + bodyH * 0.12)
  bodyPath.closePath()

  const bodyGrad = ctx.createLinearGradient(x, bodyTop, x + w, bodyTop + bodyH)
  bodyGrad.addColorStop(0, '#6b3f18')
  bodyGrad.addColorStop(0.15, '#c47a32')
  bodyGrad.addColorStop(0.38, '#f0c078')
  bodyGrad.addColorStop(0.52, '#e8a85a')
  bodyGrad.addColorStop(0.68, '#b8732e')
  bodyGrad.addColorStop(0.85, '#8f5520')
  bodyGrad.addColorStop(1, '#5c3612')
  ctx.fillStyle = bodyGrad
  ctx.fill(bodyPath)

  ctx.shadowColor = 'transparent'

  // Inner fusion cavity (darker center)
  const cavityW = w * 0.55
  const cavityH = bodyH * 0.72
  const cavityGrad = ctx.createRadialGradient(cx, bodyTop + bodyH / 2, 1, cx, bodyTop + bodyH / 2, cavityW / 2)
  cavityGrad.addColorStop(0, 'rgba(40,22,8,0.55)')
  cavityGrad.addColorStop(0.6, 'rgba(90,50,18,0.25)')
  cavityGrad.addColorStop(1, 'rgba(180,110,40,0)')
  ctx.fillStyle = cavityGrad
  ctx.beginPath()
  ctx.ellipse(cx, bodyTop + bodyH / 2, cavityW / 2, cavityH / 2, 0, 0, Math.PI * 2)
  ctx.fill()

  // Per-wire copper nuggets (ultrasonic weld spots)
  const nuggetRx = Math.max(wireStroke * 0.95, Math.min(w * 0.22, 9))
  const nuggetRy = Math.max(wireStroke * 0.55, Math.min(4, bodyH * 0.35))
  for (const wy of wireYs) {
    const nuggetGrad = ctx.createRadialGradient(cx - nuggetRx * 0.25, wy - nuggetRy * 0.3, 0, cx, wy, nuggetRx)
    nuggetGrad.addColorStop(0, '#fff0c8')
    nuggetGrad.addColorStop(0.35, '#e8b060')
    nuggetGrad.addColorStop(0.7, '#a86528')
    nuggetGrad.addColorStop(1, '#6b4018')
    ctx.fillStyle = nuggetGrad
    ctx.beginPath()
    ctx.ellipse(cx, wy, nuggetRx, nuggetRy, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(50,28,8,0.45)'
    ctx.lineWidth = 0.75
    ctx.stroke()
  }

  // Ultrasonic imprint texture (fine cross-hatch)
  ctx.save()
  ctx.clip(bodyPath)
  ctx.strokeStyle = 'rgba(40,24,8,0.18)'
  ctx.lineWidth = 0.6
  const step = 4
  for (let i = x - h; i < x + w + h; i += step) {
    ctx.beginPath()
    ctx.moveTo(i, bodyTop)
    ctx.lineTo(i + bodyH * 0.5, bodyTop + bodyH)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(i + bodyH * 0.5, bodyTop)
    ctx.lineTo(i, bodyTop + bodyH)
    ctx.stroke()
  }
  ctx.restore()

  // Specular highlight
  const gloss = ctx.createLinearGradient(x, bodyTop, x + w * 0.4, bodyTop + bodyH * 0.35)
  gloss.addColorStop(0, 'rgba(255,240,200,0.45)')
  gloss.addColorStop(1, 'rgba(255,240,200,0)')
  ctx.fillStyle = gloss
  ctx.beginPath()
  ctx.ellipse(cx - w * 0.08, bodyTop + bodyH * 0.28, w * 0.28, bodyH * 0.18, -0.35, 0, Math.PI * 2)
  ctx.fill()

  // Crimp / edge seams
  ctx.strokeStyle = 'rgba(45,26,8,0.5)'
  ctx.lineWidth = 1.25
  ctx.stroke(bodyPath)
  for (const edge of [x + 1.5, x + w - 1.5]) {
    ctx.beginPath()
    ctx.moveTo(edge, bodyTop + bodyH * 0.08)
    ctx.lineTo(edge, bodyTop + bodyH * 0.92)
    ctx.strokeStyle = 'rgba(30,18,6,0.35)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // Wire entry notches (wires appear to feed into the splice)
  for (const wy of wireYs) {
    ctx.fillStyle = 'rgba(30,18,8,0.2)'
    ctx.beginPath()
    ctx.ellipse(x - 1, wy, wireStroke * 0.55, wireStroke * 0.45, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(x + w + 1, wy, wireStroke * 0.55, wireStroke * 0.45, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

function drawWeldSpliceDisabled(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  wireYs: number[],
  wireStroke: number,
) {
  const r = Math.min(5, h / 8)
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1.5
  ctx.fillStyle = 'rgba(148,163,184,0.12)'
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
  ctx.stroke()
  ctx.setLineDash([])

  for (const wy of wireYs) {
    ctx.fillStyle = '#cbd5e1'
    ctx.beginPath()
    ctx.ellipse(x + w / 2, wy, wireStroke * 0.5, wireStroke * 0.4, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Heat-shrink sleeve — rectangular matte black sleeve with printed RBK label. */
export function drawShrinkSleeve(
  ctx: CanvasRenderingContext2D,
  box: ComponentBox,
  style: ShrinkLabelStyle,
  wireYs: number[],
  wireStroke: number,
  enabled: boolean,
) {
  const { x, y, w, h } = box
  if (!enabled || w <= 0 || h <= 0) return

  ctx.save()

  const sleevePath = buildShrinkPath(x, y, w, h)
  const bodyX = x
  const bodyW = w

  const bg = style.backgroundColor || '#101010'

  // Soft ground shadow (matches sample photo on light bench)
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.beginPath()
  ctx.ellipse(x + w / 2, y + h + 2.5, w * 0.46, h * 0.22, 0, 0, Math.PI * 2)
  ctx.fill()

  // Cylindrical body — uniform diameter, deep matte black
  const axialGrad = ctx.createLinearGradient(bodyX, y, bodyX + bodyW, y)
  axialGrad.addColorStop(0, darkenColor(bg, 0.14))
  axialGrad.addColorStop(0.06, lightenColor(bg, 0.04))
  axialGrad.addColorStop(0.5, bg)
  axialGrad.addColorStop(0.94, lightenColor(bg, 0.03))
  axialGrad.addColorStop(1, darkenColor(bg, 0.16))
  ctx.fillStyle = axialGrad
  ctx.fill(sleevePath)

  const verticalGrad = ctx.createLinearGradient(bodyX, y, bodyX, y + h)
  verticalGrad.addColorStop(0, 'rgba(255,255,255,0.07)')
  verticalGrad.addColorStop(0.22, 'rgba(255,255,255,0)')
  verticalGrad.addColorStop(0.55, 'rgba(0,0,0,0)')
  verticalGrad.addColorStop(1, 'rgba(0,0,0,0.28)')
  ctx.save()
  ctx.clip(sleevePath)
  ctx.fillStyle = verticalGrad
  ctx.fillRect(bodyX, y, bodyW, h)

  // Fine matte micro-texture
  ctx.globalAlpha = 0.045
  for (let gy = y; gy < y + h; gy += 2) {
    ctx.strokeStyle = gy % 4 === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(bodyX, gy)
    ctx.lineTo(bodyX + bodyW, gy)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // Top highlight streak (subtle studio reflection on tubing)
  const gloss = ctx.createLinearGradient(bodyX, y, bodyX, y + h * 0.55)
  gloss.addColorStop(0, 'rgba(255,255,255,0)')
  gloss.addColorStop(0.35, 'rgba(255,255,255,0.11)')
  gloss.addColorStop(0.55, 'rgba(255,255,255,0.04)')
  gloss.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gloss
  ctx.fillRect(bodyX, y + h * 0.14, bodyW, h * 0.34)

  // Wire channels (wires pass through the sleeve bore)
  for (const wy of wireYs) {
    const grooveGrad = ctx.createLinearGradient(bodyX, wy - wireStroke, bodyX + bodyW, wy + wireStroke)
    grooveGrad.addColorStop(0, 'rgba(0,0,0,0)')
    grooveGrad.addColorStop(0.5, 'rgba(0,0,0,0.18)')
    grooveGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grooveGrad
    ctx.fillRect(bodyX, wy - wireStroke * 0.5, bodyW, wireStroke)
  }

  ctx.restore()

  // Square end faces
  const endW = Math.max(2, w * 0.025)
  for (const endX of [x, x + w - endW]) {
    const endGrad = ctx.createLinearGradient(endX, y, endX + endW, y)
    endGrad.addColorStop(0, 'rgba(0,0,0,0.5)')
    endGrad.addColorStop(0.5, 'rgba(48,48,48,0.3)')
    endGrad.addColorStop(1, 'rgba(0,0,0,0.5)')
    ctx.fillStyle = endGrad
    ctx.fillRect(endX, y, endW, h)
  }

  ctx.strokeStyle = darkenColor(bg, 0.42)
  ctx.lineWidth = 1
  ctx.stroke(sleevePath)

  drawShrinkLabel(ctx, bodyX, y, bodyW, h, style)

  for (const wy of wireYs) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)'
    ctx.beginPath()
    ctx.ellipse(x + w + 1.2, wy, wireStroke * 0.42, wireStroke * 0.36, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

/** Rectangular heat-shrink sleeve profile. */
function buildShrinkPath(x: number, y: number, w: number, h: number): Path2D {
  const path = new Path2D()
  path.rect(x, y, w, h)
  return path
}

function drawShrinkLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  style: ShrinkLabelStyle,
) {
  const text = style.label.replace(/^RBK\s*/i, 'RBK-').toUpperCase()
  const textColor = style.textColor || '#f8fafc'
  const padX = Math.max(4, w * 0.08)
  const labelW = w - padX * 2
  const labelH = h * 0.42
  const labelY = y + (h - labelH) / 2
  const labelX = x + padX

  let fontSize = Math.min(12, Math.max(7, labelH * 0.58))
  ctx.font = `800 ${fontSize}px system-ui, "Segoe UI", sans-serif`
  let metrics = ctx.measureText(text)
  while (metrics.width > labelW - 6 && fontSize > 7) {
    fontSize -= 0.5
    ctx.font = `800 ${fontSize}px system-ui, "Segoe UI", sans-serif`
    metrics = ctx.measureText(text)
  }

  const lx = labelX + labelW / 2
  const ly = labelY + labelH / 2

  // Pad-print on matte black sleeve
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(0,0,0,0.65)'
  ctx.lineWidth = Math.max(1.2, fontSize * 0.12)
  ctx.strokeText(text, lx, ly + 0.5)
  ctx.fillStyle = textColor
  ctx.fillText(text, lx, ly)
  ctx.globalAlpha = 0.28
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText(text, lx, ly - 0.6)
  ctx.globalAlpha = 1
}

function lightenColor(color: string, amount: number): string {
  return mixColor(color, '#ffffff', amount)
}

function darkenColor(color: string, amount: number): string {
  return mixColor(color, '#000000', amount)
}

function mixColor(color: string, target: string, amount: number): string {
  const parse = (c: string) => {
    const h = c.replace('#', '')
    if (h.length !== 6) return null
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const a = parse(color)
  const b = parse(target)
  if (!a || !b) return color
  const r = Math.round(a[0] * (1 - amount) + b[0] * amount)
  const g = Math.round(a[1] * (1 - amount) + b[1] * amount)
  const bl = Math.round(a[2] * (1 - amount) + b[2] * amount)
  return `rgb(${r},${g},${bl})`
}
