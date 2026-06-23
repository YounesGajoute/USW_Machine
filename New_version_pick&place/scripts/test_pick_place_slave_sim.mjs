#!/usr/bin/env node
/**
 * Pick-place slave simulator unit tests (wire protocol).
 */
import { PickPlaceNanoSimulator, stepsToMm } from './lib/pick_place_firmware_simulator.mjs'

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const sim = new PickPlaceNanoSimulator()

check('PING', sim.handle('PING') === 'PONG')
check('STATUS fields', sim.handle('STATUS').includes('stepA=') && sim.handle('STATUS').includes('homedA='))

sim.reset()
check('HOME both parallel', sim.handle('HOME 0.5 0.8 80')?.startsWith('DONE HOME'))
check('posA after HOME', Math.abs(stepsToMm(sim.stepsA) - 0.5) < 0.16)
check('posB after HOME', Math.abs(stepsToMm(sim.stepsB) - 0.8) < 0.16)

sim.reset()
check('HOMEA', sim.handle('HOMEA 0.5 80')?.startsWith('DONE HOMEA'))
check('homedA only', sim.homedA && !sim.homedB)

sim.reset()
check('HOMEB', sim.handle('HOMEB 0.8 80')?.startsWith('DONE HOMEB'))
check('homedB only', !sim.homedA && sim.homedB)

sim.reset()
sim.handle('HOME 0.5 0.8 80')
check('MOVEAMM after HOME', sim.handle('MOVEAMM 10 80')?.startsWith('DONE MOVEAMM'))
check('posA 10', Math.abs(stepsToMm(sim.stepsA) - 10) < 0.16)

sim.reset()
sim.handle('HOMEB 0.8 80')
check('MOVEBMM', sim.handle('MOVEBMM 12 80')?.startsWith('DONE MOVEBMM'))
check('posB 12', Math.abs(stepsToMm(sim.stepsB) - 12) < 0.16)

sim.reset()
sim.handle('HOMEA 0.5 80')
check('MOVEBOTHMM removed', sim.handle('MOVEBOTHMM 45 a 80') === 'ERR UNKNOWN')

sim.reset()
sim.handle('HOMEA 0.5 80')
check('bad MOVEAMM args', sim.handle('MOVEAMM bad') === 'ERR MOVEMM')

sim.reset()
check('MOVE without home blocked', sim.handle('MOVEAMM 10 80')?.includes('fail'))

sim.reset()
sim.handle('HOMEA 0.5 80')
sim.handle('ESTOP')
check('home blocked after estop', sim.handle('HOMEA 0.5 80')?.match(/estop|fault/))
sim.handle('CLRFAULT')
check('recover clears estop', !sim.estop && !sim.fault)

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
