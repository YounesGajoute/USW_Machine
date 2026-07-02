#!/usr/bin/env node
/**
 * Move command reachability: symmetric vs upper/lower bias.
 */
import {
  S_MIN,
  gapMmToMoveTarget,
  getModelHRangeMm,
  heightFromSigned,
} from '../master/centring_height_model.js'

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function tryMove(opts) {
  try {
    return { ok: true, ...gapMmToMoveTarget(opts) }
  } catch (err) {
    return { ok: false, err: err.message }
  }
}

function splitFor(cmd, t, uNow, lNow) {
  if (cmd === 'MOVEBOTHMM') {
    const h = heightFromSigned(t.deg)
    return [h, h]
  }
  if (cmd === 'MOVE_UPPERMM') {
    return [heightFromSigned(t.deg), heightFromSigned(lNow)]
  }
  return [heightFromSigned(uNow), heightFromSigned(t.deg)]
}

const range = getModelHRangeMm(0)

check('from HOME MOVEBOTHMM 18 ok', tryMove({ gapMm: 18, moveCommand: 'MOVEBOTHMM', uNow: S_MIN, lNow: S_MIN }).ok)
check('from HOME MOVE_UPPERMM 18 ok', tryMove({ gapMm: 18, moveCommand: 'MOVE_UPPERMM', uNow: S_MIN, lNow: S_MIN }).ok)
check('from HOME MOVE_LOWERMM 18 ok', tryMove({ gapMm: 18, moveCommand: 'MOVE_LOWERMM', uNow: S_MIN, lNow: S_MIN }).ok)

const sym40 = tryMove({ gapMm: 40, moveCommand: 'MOVEBOTHMM', uNow: S_MIN, lNow: S_MIN })
if (sym40.ok) {
  const s = splitFor('MOVEBOTHMM', sym40, S_MIN, S_MIN)
  check('MOVEBOTHMM 40 symmetric split', Math.abs(s[0] - s[1]) < 0.01, `${s[0].toFixed(1)}+${s[1].toFixed(1)}`)
}

const up40 = tryMove({ gapMm: 40, moveCommand: 'MOVE_UPPERMM', uNow: S_MIN, lNow: S_MIN })
if (up40.ok) {
  const s = splitFor('MOVE_UPPERMM', up40, S_MIN, S_MIN)
  check('MOVE_UPPERMM 40 biases lower side', s[1] > s[0] + 20, `${s[0].toFixed(1)}+${s[1].toFixed(1)}`)
}

const lo40 = tryMove({ gapMm: 40, moveCommand: 'MOVE_LOWERMM', uNow: S_MIN, lNow: S_MIN })
if (lo40.ok) {
  const s = splitFor('MOVE_LOWERMM', lo40, S_MIN, S_MIN)
  check('MOVE_LOWERMM 40 biases upper side', s[0] > s[1] + 20, `${s[0].toFixed(1)}+${s[1].toFixed(1)}`)
}

const sym30 = tryMove({ gapMm: 30, moveCommand: 'MOVEBOTHMM', uNow: S_MIN, lNow: S_MIN })
if (sym30.ok) {
  const u0 = sym30.deg
  const l0 = sym30.deg
  const up32 = tryMove({ gapMm: 32, moveCommand: 'MOVE_UPPERMM', uNow: u0, lNow: l0 })
  if (up32.ok) {
    const s = splitFor('MOVE_UPPERMM', up32, u0, l0)
    check('bias after sym: upper opens more at 32', s[0] > s[1] + 1, `${s[0].toFixed(1)}+${s[1].toFixed(1)}`)
  }
  const lo32 = tryMove({ gapMm: 32, moveCommand: 'MOVE_LOWERMM', uNow: u0, lNow: l0 })
  if (lo32.ok) {
    const s = splitFor('MOVE_LOWERMM', lo32, u0, l0)
    check('bias after sym: lower opens more at 32', s[1] > s[0] + 1, `${s[0].toFixed(1)}+${s[1].toFixed(1)}`)
  }
}

for (const off of [-2, 0, 1]) {
  const band = getModelHRangeMm(off)
  const mid = (band.min + band.max) / 2
  const t = tryMove({ gapMm: mid, moveCommand: 'MOVEBOTHMM', uNow: S_MIN, lNow: S_MIN, mechOffsetMm: off })
  check(`MOVEBOTHMM with offset ${off}`, t.ok && Math.abs(t.expectedH - mid) < 0.3, t.ok ? String(t.expectedH) : t.err)
}

for (let h = Math.ceil(range.min * 2) / 2; h <= range.max; h += 1) {
  const t = tryMove({ gapMm: h, moveCommand: 'MOVEBOTHMM', uNow: S_MIN, lNow: S_MIN })
  check(`band sweep h=${h}`, t.ok && Math.abs(t.expectedH - h) < 0.3)
}

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
