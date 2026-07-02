#!/usr/bin/env node
/**
 * Verify firmware simulator matches height model and enforces same rules as main.cpp.
 */
import { NanoSimulator } from './lib/firmware_simulator.mjs'
import {
  S_HOME,
  S_TRAVEL,
  getModelHRangeMm,
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

const sim = new NanoSimulator()

check('PING', sim.handle('PING') === 'PONG')
check('STATUS has mechOff', sim.handle('STATUS').includes('mechOff='))

sim.handle('SETMECHOFF -2')
check('SETMECHOFF band min', Math.abs(sim.band().min + 2) < 0.15)
check('SETMECHOFF band max', Math.abs(sim.band().max - 65.6) < 0.15)
check('SETMECHOFF ok', sim.handle('SETMECHOFF 0') === 'OK SETMECHOFF')

sim.reset()
sim.handle('HOME')
check('HOME homed both', sim.homedUpper && sim.homedLower)
check('HOME at S_HOME', sim.u === S_HOME && sim.l === S_HOME)
check('HOME h ~ min (closed)', Math.abs(sim.hPhysical() - getModelHRangeMm(0).min) < 0.3)

const homeDone = sim.handle('HOME')
check('HOME DONE tag', homeDone.startsWith('DONE HOME'))
check('HOME DONE has h', homeDone.includes('h='))

sim.handle('SEEK_TRAVEL')
check('SEEK_TRAVEL at S_TRAVEL', sim.u === S_TRAVEL && sim.l === S_TRAVEL)
check('SEEK_TRAVEL h ~ max (open)', Math.abs(sim.hPhysical() - getModelHRangeMm(0).max) < 0.3)

sim.handle('HOME')
const move18 = sim.handle('MOVEBOTHMM 18 45')
check('MOVEBOTHMM 18 ok', move18.startsWith('DONE MOVEBOTHMM'))
const h18 = sim.hPhysical()
check('MOVEBOTHMM 18 h', Math.abs(h18 - 18) < 0.3, String(h18))

check('MOVEBOTHMM above max rejected', sim.handle('MOVEBOTHMM 80 45').includes('h_out_of_range'))
check('MOVEBOTHMM bad speed', sim.handle('MOVEBOTHMM 18 200').includes('args'))

sim.reset()
check('move blocked not homed', sim.handle('MOVEBOTHMM 18 45').includes('not_ready'))

sim.handle('HOME')
sim.handle('MOVEBOTHMM 30 45')
const up32 = sim.handle('MOVE_UPPERMM 32 45')
check('MOVE_UPPERMM after sym', up32.startsWith('DONE'))
check('asymmetric u!=l', sim.u !== sim.l)
check('total h 32', Math.abs(sim.hPhysical() - 32) < 0.35)

sim.reset()
sim.handle('HOME')
sim.handle('SETMECHOFF -1')
sim.handle('MOVEBOTHMM 17 45')
check('move with offset h', Math.abs(sim.hPhysical() - 17) < 0.35)

sim.reset()
sim.handle('ESTOP')
check('ESTOP clears homed', !sim.homedUpper)
check('HOME blocked estop', sim.handle('HOME').includes('estop'))
sim.handle('CLRFAULT')
check('CLRFAULT ok', sim.handle('CLRFAULT') === 'OK CLRFAULT')

sim.reset()
sim.busy = true
check('SETMECHOFF preempts busy', sim.handle('SETMECHOFF 1') === 'OK SETMECHOFF')
sim.busy = false

check('UNKNOWN', sim.handle('FOOBAR') === 'ERR UNKNOWN')

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
