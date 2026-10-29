function bad(message) { return Object.assign(new Error(message), { status: 400 }) }
function imageSize(config) {
  for (const source of [config, config?.camera, config?.image, config?.image_size, config?.capture, config?.resolution]) {
    if (!source || typeof source !== 'object') continue
    const width = Number(source.image_width_px ?? source.width_px ?? source.image_width ?? source.width)
    const height = Number(source.image_height_px ?? source.height_px ?? source.image_height ?? source.height)
    if (Number.isInteger(width) && Number.isInteger(height) && width >= 32 && height >= 32) return { width, height }
  }
  return null
}
export { imageSize as realtimeImageSize }

function rect(value, label, size) {
  if (!value || typeof value !== 'object') throw bad(`${label} is required`)
  for (const key of ['x', 'y', 'width', 'height']) if (!Number.isInteger(value[key])) throw bad(`${label}.${key} must be an integer`)
  if (value.width <= 0 || value.height <= 0 || value.x < 0 || value.y < 0 || value.x + value.width > size.width || value.y + value.height > size.height) throw bad(`${label} must be inside the configured image`)
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}
export function validateRealtimeZones(body, config) {
  const size = imageSize(config)
  if (!size) throw Object.assign(new Error('Inspection configuration has no image dimensions; zone saving is unavailable'), { status: 409 })
  const weld_zone = rect(body?.weld_zone, 'weld_zone', size)
  const heat_shrink_zone = rect(body?.heat_shrink_zone, 'heat_shrink_zone', size)
  if (2 * weld_zone.y + weld_zone.height !== 2 * heat_shrink_zone.y + heat_shrink_zone.height) throw bad('Zones must share an exact horizontal center')
  const left = body?.weld_center_left_x_px
  const right = body?.weld_center_right_x_px
  if (!Number.isInteger(left) || !Number.isInteger(right) || left < 0 || right > size.width || right - left < 12) throw bad('Both ordered weld center guides are required inside the image')
  const center = body?.weld_center_x_px
  if (typeof center !== 'number' || !Number.isFinite(center) || center !== (left + right) / 2) throw bad('Weld center target must equal the exact guide midpoint')
  return { reference_capture_id: body.reference_capture_id, weld_zone, heat_shrink_zone,
    weld_center_left_x_px: left, weld_center_right_x_px: right, weld_center_x_px: center }
}
export function verifyRealtimeZones(actual, requested, previous) {
  const expected = { ...requested }
  delete expected.reference_capture_id
  const field = (name) => actual?.[name]
  for (const [name, value] of Object.entries(expected)) {
    if (JSON.stringify(field(name)) !== JSON.stringify(value)) {
      const error = new Error(`Inspection slave did not persist ${name}; geometry save needs slave support`)
      error.status = 409
      error.saved = true
      throw error
    }
  }
  if (Array.isArray(previous?.heat_shrink_zones)) {
    if (!Array.isArray(actual?.heat_shrink_zones) || JSON.stringify(actual.heat_shrink_zones.slice(1)) !== JSON.stringify(previous.heat_shrink_zones.slice(1)) || JSON.stringify(actual.heat_shrink_zones[0]) !== JSON.stringify(requested.heat_shrink_zone)) {
      const error = new Error('Inspection slave did not synchronize the active heat-shrink zone or preserve additional zones')
      error.status = 409
      error.saved = true
      throw error
    }
  }
  return expected
}
