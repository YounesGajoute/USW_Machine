const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const integer = value => typeof value === 'number' && Number.isInteger(value)
const validRect = (r, image) => r && ['x', 'y', 'width', 'height'].every(key => integer(r[key])) && r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.x + r.width <= image.width && r.y + r.height <= image.height
export const MIN_ZONE_SIZE = 12
export const MIN_GUIDE_GAP = 12

export function pointerToSource(clientX, clientY, bounds, image) {
  return {
    x: clamp(Math.round((clientX - bounds.left) * image.width / bounds.width), 0, image.width),
    y: clamp(Math.round((clientY - bounds.top) * image.height / bounds.height), 0, image.height),
  }
}

export function imageSizeFromConfig(config) {
  const sources = [config, config?.camera, config?.image, config?.image_size, config?.capture, config?.resolution]
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    const width = Number(source.image_width_px ?? source.width_px ?? source.image_width ?? source.width)
    const height = Number(source.image_height_px ?? source.height_px ?? source.image_height ?? source.height)
    if (integer(width) && integer(height) && width >= 32 && height >= 32) return { width, height }
  }
  return null
}

function fitRect(raw, image, fallback) {
  if (!raw || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(raw[key]))) return fallback
  const width = clamp(Math.round(raw.width), MIN_ZONE_SIZE, image.width)
  const height = clamp(Math.round(raw.height), MIN_ZONE_SIZE, image.height)
  return { x: clamp(Math.round(raw.x), 0, image.width - width), y: clamp(Math.round(raw.y), 0, image.height - height), width, height }
}

export function normalizeGeometry(config, image) {
  const weldFallback = { x: Math.round(image.width * .25), y: Math.round(image.height * .4), width: Math.round(image.width * .5), height: Math.round(image.height * .2) }
  const weld_zone = fitRect(config?.weld_zone ?? weldFallback, image, weldFallback)
  const heatRaw = config?.heat_shrink_zones?.[0] ?? config?.heat_shrink_zone
  const heatFallback = { x: Math.round(image.width * .3), y: Math.round(image.height * .45), width: Math.round(image.width * .4), height: Math.round(image.height * .1) }
  let heat_shrink_zone = fitRect(heatRaw ?? heatFallback, image, heatFallback)
  if (heat_shrink_zone.height % 2 !== weld_zone.height % 2) {
    const height = heat_shrink_zone.height < image.height ? heat_shrink_zone.height + 1 : heat_shrink_zone.height - 1
    heat_shrink_zone = { ...heat_shrink_zone, height }
  }
  const maxHalf = Math.max(weld_zone.height, heat_shrink_zone.height) / 2
  const center = clamp(weld_zone.y + weld_zone.height / 2, maxHalf, image.height - maxHalf)
  const movedWeld = { ...weld_zone, y: Math.round(center - weld_zone.height / 2) }
  heat_shrink_zone = { ...heat_shrink_zone, y: Math.round(center - heat_shrink_zone.height / 2) }
  const guideCenter = Number.isFinite(config?.weld_center_x_px) ? config.weld_center_x_px : movedWeld.x + movedWeld.width / 2
  const savedLeft = config?.weld_center_left_x_px
  const savedRight = config?.weld_center_right_x_px
  let left, right
  if (integer(savedLeft) && integer(savedRight) && savedLeft >= 0 && savedRight <= image.width && savedRight - savedLeft >= MIN_GUIDE_GAP) {
    left = savedLeft; right = savedRight
  } else {
    const center2 = clamp(Math.round(guideCenter * 2), MIN_GUIDE_GAP, 2 * image.width - MIN_GUIDE_GAP)
    const gap = MIN_GUIDE_GAP + ((center2 - MIN_GUIDE_GAP) % 2)
    left = Math.floor((center2 - gap) / 2)
    right = Math.floor((center2 + gap) / 2)
  }
  return { weld_zone: movedWeld, heat_shrink_zone, weld_center_left_x_px: left, weld_center_right_x_px: right }
}

export function centerX(geometry) { return (geometry.weld_center_left_x_px + geometry.weld_center_right_x_px) / 2 }
export function centerY(geometry) { return geometry.weld_zone.y + geometry.weld_zone.height / 2 }

export function moveZone(geometry, zone, dx, dy, image) {
  const selected = geometry[zone]
  const other = geometry[zone === 'weld_zone' ? 'heat_shrink_zone' : 'weld_zone']
  const deltaY = clamp(dy, Math.max(-selected.y, -other.y), Math.min(image.height - selected.y - selected.height, image.height - other.y - other.height))
  return {
    ...geometry,
    weld_zone: { ...geometry.weld_zone, y: geometry.weld_zone.y + deltaY },
    heat_shrink_zone: { ...geometry.heat_shrink_zone, y: geometry.heat_shrink_zone.y + deltaY },
    [zone]: { ...selected, x: clamp(selected.x + dx, 0, image.width - selected.width), y: selected.y + deltaY },
  }
}

export function resizeZone(geometry, zone, edge, dx, dy, image) {
  const r = geometry[zone]
  const shared = centerY(geometry)
  let x = r.x, width = r.width, height = r.height
  if (edge.includes('w')) { x = clamp(r.x + dx, 0, r.x + r.width - MIN_ZONE_SIZE); width = r.x + r.width - x }
  if (edge.includes('e')) width = clamp(r.width + dx, MIN_ZONE_SIZE, image.width - r.x)
  if (edge.includes('n') || edge.includes('s')) {
    const change = (edge.includes('n') ? -dy : dy) * 2
    const maxHeight = Math.floor(2 * Math.min(shared, image.height - shared))
    const parityMax = maxHeight - ((maxHeight - r.height) % 2)
    const minHeight = MIN_ZONE_SIZE + (MIN_ZONE_SIZE % 2 === r.height % 2 ? 0 : 1)
    height = clamp(r.height + 2 * Math.round(change / 2), minHeight, parityMax)
  }
  return { ...geometry, [zone]: { x, width, height, y: Math.round(shared - height / 2) } }
}

export function moveGuide(geometry, side, x, image) {
  const left = side === 'left' ? clamp(Math.round(x), 0, geometry.weld_center_right_x_px - MIN_GUIDE_GAP) : geometry.weld_center_left_x_px
  const right = side === 'right' ? clamp(Math.round(x), geometry.weld_center_left_x_px + MIN_GUIDE_GAP, image.width) : geometry.weld_center_right_x_px
  return { ...geometry, weld_center_left_x_px: left, weld_center_right_x_px: right }
}

export function geometryError(g, image) {
  if (!validRect(g?.weld_zone, image) || !validRect(g?.heat_shrink_zone, image)) return 'Both zones must be integer pixel rectangles inside the configured image.'
  if (2 * g.weld_zone.y + g.weld_zone.height !== 2 * g.heat_shrink_zone.y + g.heat_shrink_zone.height) return 'The two zones must share one horizontal center.'
  if (!integer(g.weld_center_left_x_px) || !integer(g.weld_center_right_x_px) || g.weld_center_left_x_px < 0 || g.weld_center_right_x_px > image.width || g.weld_center_right_x_px - g.weld_center_left_x_px < MIN_GUIDE_GAP) return 'The weld center guides must be ordered integer pixels inside the image.'
  return null
}

export function clampImagePan(pan, zoom, canvas, viewport) {
  if (zoom <= 1) return { x: 0, y: 0 }
  const limitX = Math.max(0, (canvas.width * zoom - viewport.width) / 2)
  const limitY = Math.max(0, (canvas.height * zoom - viewport.height) / 2)
  return { x: clamp(pan.x, -limitX, limitX), y: clamp(pan.y, -limitY, limitY) }
}
export function zoomImageAt(view, requestedZoom, focus, canvas, viewport) {
  const zoom = clamp(requestedZoom, 1, 6)
  const ratio = zoom / view.zoom
  return { zoom, ...clampImagePan({ x: focus.x - (focus.x - view.x) * ratio, y: focus.y - (focus.y - view.y) * ratio }, zoom, canvas, viewport) }
}
