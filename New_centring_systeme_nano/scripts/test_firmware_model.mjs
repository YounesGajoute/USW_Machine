#!/usr/bin/env node
/**
 * Host-side tests mirroring centring_systeme_nano/src/main.cpp math + protocol rules.
 * Run: node scripts/test_firmware_model.mjs
 */
import {
  S_HOME,
  S_TRAVEL,
  S_MIN,
  S_MAX,
  heightFromSigned,
  solveSignedFromHeight,
  gapMmToMoveTarget,
  getModelHRangeMm,
  SMAX_MECH_OFFSET_MM,
} from '../master/centring_height_model.js'
import {
  computeMechOffsetFromMeasurements,
  effectiveHRangeFromOffset,
} from '../master/centring_calibration.js'
import { resolveGapMove } from '../master/centring_reference.js'

const SPEED_MAX = 120
const { min: gHMin, max: gHMax } = getModelHRangeMm(SMAX_MECH_OFFSET_MM)

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) {
    pass++
  } else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const hHome = heightFromSigned(S_HOME)
const hTravel = heightFromSigned(S_TRAVEL)

check('h at HOME (closed) per side 0 mm', Math.abs(hHome) < 0.01, String(hHome.toFixed(2)))
check('h at TRAVEL (open) per side 33.8 mm', Math.abs(hTravel - 33.8) < 0.01, String(hTravel.toFixed(2)))
check('gHMin ~0 mm', Math.abs(gHMin) < 0.1, `gHMin=${gHMin.toFixed(2)}`)
check('gHMax ~67.6 mm', Math.abs(gHMax - 67.6) < 0.1, `gHMax=${gHMax.toFixed(2)}`)

// --- Uniform mechanical offset ---
{
  const off = -2
  const band = effectiveHRangeFromOffset(off)
  check('offset shifts min', Math.abs(band.min - (gHMin + off)) < 0.05, `${band.min}`)
  check('offset shifts max', Math.abs(band.max - (gHMax + off)) < 0.05, `${band.max}`)
  const computed = computeMechOffsetFromMeasurements({ measuredHomeMm: -2, measuredClosedMm: 65.6 })
  check('calibration example -2 mm', Math.abs(computed + 2) < 0.05, String(computed))
  const t = gapMmToMoveTarget({
    gapMm: 18,
    moveCommand: 'MOVEBOTHMM',
    uNow: S_HOME,
    lNow: S_HOME,
    mechOffsetMm: off,
  })
  check('MOVEBOTHMM with offset', Math.abs(t.expectedH - 18) < 0.25)
}

// --- MOVEBOTHMM: across model band ---
{
  const t0 = gapMmToMoveTarget({
    gapMm: 0,
    moveCommand: 'MOVEBOTHMM',
    uNow: S_TRAVEL,
    lNow: S_TRAVEL,
  })
  check('MOVEBOTHMM at hmin (closed)', Math.abs(t0.expectedH) < 0.25)
}
for (let h = 0; h <= gHMax + 0.001; h += 0.5) {
  const hR = Math.round(h * 2) / 2
  const t = gapMmToMoveTarget({
    gapMm: hR,
    moveCommand: 'MOVEBOTHMM',
    uNow: S_HOME,
    lNow: S_HOME,
  })
  check(
    `MOVEBOTHMM h=${hR}`,
    Math.abs(t.expectedH - hR) < 0.25,
    `expected=${t.expectedH.toFixed(2)}`,
  )
}

// --- Out-of-range heights ---
for (const h of [-0.1, gHMax + 0.1]) {
  check(`h=${h} outside band`, h < gHMin || h > gHMax)
}

// --- parseMove rules ---
function parseMoveArg(a) {
  if (!a) return null
  const spc = a.lastIndexOf(' ')
  if (spc < 0) return null
  const hStr = a.slice(0, spc).trim().replace(',', '.')
  const sStr = a.slice(spc + 1).trim().replace(',', '.')
  const h = Number(hStr)
  const s = Number(sStr)
  if (!Number.isFinite(h) || !Number.isFinite(s)) return null
  if (s <= 0 || s > SPEED_MAX) return null
  return { h, s }
}

check('parseMove ok', parseMoveArg('18 45')?.h === 18 && parseMoveArg('18 45')?.s === 45)

// --- Gap move resolver ---

for (const [axis, cmd, gap] of [
  ['both', 'MOVEBOTHMM', 18],
  ['upper', 'MOVE_UPPERMM', 30],
  ['lower', 'MOVE_LOWERMM', 30],
]) {
  const r = resolveGapMove({ gapMm: gap, axis })
  check(`${axis} uses ${cmd}`, r.moveCommand === cmd)
  check(`${axis} gap in band`, r.gapMm >= gHMin && r.gapMm <= gHMax, `${r.gapMm}mm`)
  const t = gapMmToMoveTarget({
    gapMm: r.gapMm,
    moveCommand: r.moveCommand,
    uNow: S_MIN,
    lNow: S_MIN,
  })
  check(`${axis} from homed`, Math.abs(t.expectedH - r.gapMm) < 0.25)
}

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
