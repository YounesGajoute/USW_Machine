import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pointerToSource, imageSizeFromConfig, normalizeGeometry, moveZone, resizeZone, moveGuide, centerX, centerY, geometryError, clampImagePan, zoomImageAt } from './realtimeZoneGeometry.mjs'
const image = { width: 1600, height: 1200 }
const initial = normalizeGeometry({ weld_zone: { x: 300, y: 400, width: 300, height: 201 }, heat_shrink_zone: { x: 700, y: 470, width: 120, height: 100 }, weld_center_x_px: 450.5 }, image)

test('legacy zones normalize to one exact horizontal center and preserve half-pixel guide target', () => {
  assert.equal(initial.heat_shrink_zone.height, 101)
  assert.equal(centerY(initial), centerY({ ...initial, weld_zone: initial.heat_shrink_zone }))
  assert.equal(centerX(initial), 450.5)
  assert.equal(geometryError(initial, image), null)
  assert.deepEqual(imageSizeFromConfig({ camera: { width_px: 1600, height_px: 1200 } }), image)
})

test('horizontal movement changes only one rectangle; vertical movement moves both', () => {
  const horizontal = moveZone(initial, 'weld_zone', 200, 0, image)
  assert.equal(horizontal.weld_zone.x, initial.weld_zone.x + 200)
  assert.deepEqual(horizontal.heat_shrink_zone, initial.heat_shrink_zone)
  assert.equal(centerX(horizontal), centerX(initial))
  const vertical = moveZone(initial, 'heat_shrink_zone', 0, -1000, image)
  assert.equal(vertical.weld_zone.y - initial.weld_zone.y, vertical.heat_shrink_zone.y - initial.heat_shrink_zone.y)
  assert.equal(centerY(vertical), centerY({ ...vertical, weld_zone: vertical.heat_shrink_zone }))
  assert.equal(geometryError(vertical, image), null)
})

test('edges and corners resize symmetrically without moving guides', () => {
  const vertical = resizeZone(initial, 'weld_zone', 'n', 0, -20, image)
  assert.equal(centerY(vertical), centerY(initial))
  assert.equal(vertical.weld_zone.height, initial.weld_zone.height + 40)
  assert.deepEqual(vertical.heat_shrink_zone, initial.heat_shrink_zone)
  assert.equal(centerX(vertical), centerX(initial))
  const corner = resizeZone(initial, 'heat_shrink_zone', 'se', 30, 10, image)
  assert.equal(corner.heat_shrink_zone.width, initial.heat_shrink_zone.width + 30)
  assert.equal(corner.heat_shrink_zone.height, initial.heat_shrink_zone.height + 20)
  assert.equal(centerY(corner), centerY(initial))
  assert.equal(geometryError(corner, image), null)
})

test('guides move independently, cannot cross, and retain exact .5 midpoint', () => {
  const left = moveGuide(initial, 'left', 441, image)
  assert.deepEqual(left.weld_zone, initial.weld_zone)
  assert.deepEqual(left.heat_shrink_zone, initial.heat_shrink_zone)
  assert.equal(left.weld_center_right_x_px, initial.weld_center_right_x_px)
  assert.equal(centerX(left), (441 + left.weld_center_right_x_px) / 2)
  const clamped = moveGuide(left, 'right', -100, image)
  assert.equal(clamped.weld_center_right_x_px - clamped.weld_center_left_x_px, 12)
  assert.equal(geometryError(clamped, image), null)
})

test('source pointer mapping uses displayed bounds and zoom stays bounded', () => {
  assert.deepEqual(pointerToSource(250, 175, { left: 50, top: 100, width: 400, height: 300 }, image), { x: 800, y: 300 })
  assert.deepEqual(pointerToSource(999, -100, { left: 50, top: 100, width: 400, height: 300 }, image), { x: 1600, y: 0 })
  const canvas = { width: 800, height: 600 }
  const view = zoomImageAt({ zoom: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 }, canvas, canvas)
  assert.deepEqual(view, { zoom: 2, x: -100, y: -50 })
  assert.deepEqual(clampImagePan({ x: 999, y: -999 }, 2, canvas, canvas), { x: 400, y: -300 })
})
