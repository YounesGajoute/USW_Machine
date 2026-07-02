#!/usr/bin/env node
/**
 * Shrink-tube gap phase + gap move speed.
 */
import { resolveShrinkTubeCentring } from '../master/centring_frame_model.js'

const master = await import('../master/centring_master.js')

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

master.loadCentringConfig()
const cfg = master.getCentringConfig()
check('gapMoveSpeedDegS default 90', cfg.gapMoveSpeedDegS === 90)
check('gap faster than movementSpeedDegS', cfg.gapMoveSpeedDegS > cfg.movementSpeedDegS)
check('getGapMoveSpeedDegS', master.getGapMoveSpeedDegS() === 90)

const prev = process.env.CENTRING_GAP_MOVE_SPEED_DEG_S
process.env.CENTRING_GAP_MOVE_SPEED_DEG_S = '120'
check('env override 120', master.getGapMoveSpeedDegS() === 120)
if (prev == null) delete process.env.CENTRING_GAP_MOVE_SPEED_DEG_S
else process.env.CENTRING_GAP_MOVE_SPEED_DEG_S = prev

const resolved = resolveShrinkTubeCentring(
  {
    diameter_mm: 6,
    length_mm: 65,
    centring_length_tolerance_mm: 2,
    centring_mechanism: 'upper_and_lower',
  },
  { centering_input_start_mm: 120 },
)
check('h_pre 4.5', Math.abs(resolved.h_pre_mm - 4.5) < 0.001)
check('h_post 8', Math.abs(resolved.h_post_mm - 8) < 0.001)
check('travel 190.2', Math.abs(resolved.centering_travel_mm - 190.204) < 0.01)
check('axis both', resolved.centring_axis === 'both')

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
