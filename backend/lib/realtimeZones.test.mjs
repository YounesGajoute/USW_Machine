import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateRealtimeZones, verifyRealtimeZones } from './realtimeZones.mjs'
const config = { camera: { width_px: 1600, height_px: 1200 }, heat_shrink_zones: [{ x: 1, y: 2, width: 10, height: 10 }, { x: 900, y: 500, width: 50, height: 50 }] }
const request = { reference_capture_id: 'frame_1', weld_zone: { x: 400, y: 400, width: 400, height: 201 }, heat_shrink_zone: { x: 500, y: 450, width: 200, height: 101 }, weld_center_left_x_px: 610, weld_center_right_x_px: 631, weld_center_x_px: 620.5 }

test('zone request accepts exact shared center and half-pixel target', () => {
  assert.deepEqual(validateRealtimeZones(request, config), request)
  assert.throws(() => validateRealtimeZones({ ...request, weld_center_x_px: 620 }, config), /midpoint/)
  assert.throws(() => validateRealtimeZones({ ...request, weld_center_right_x_px: undefined }, config), /guides/)
  assert.throws(() => validateRealtimeZones({ ...request, weld_zone: { ...request.weld_zone, x: 0.5 } }, config), /integer/)
  assert.throws(() => validateRealtimeZones({ ...request, heat_shrink_zone: { ...request.heat_shrink_zone, y: 451 } }, config), /horizontal center/)
})

test('a successful HTTP response is not enough if slave drops a guide or other zone', () => {
  const actual = { ...request, heat_shrink_zones: [request.heat_shrink_zone, config.heat_shrink_zones[1]] }
  const { reference_capture_id: _id, ...expected } = request
  assert.deepEqual(verifyRealtimeZones(actual, request, config), expected)
  assert.throws(() => verifyRealtimeZones({ ...actual, weld_center_left_x_px: undefined }, request, config), /did not persist/)
  assert.throws(() => verifyRealtimeZones({ ...actual, heat_shrink_zones: [request.heat_shrink_zone] }, request, config), /additional zones/)
})
