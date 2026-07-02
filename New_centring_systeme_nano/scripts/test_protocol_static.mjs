#!/usr/bin/env node
/**
 * Static protocol contract tests — STATUS/DONE field names vs COMMANDS.md + centring_master.js
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainCpp = readFileSync(path.join(root, 'src', 'main.cpp'), 'utf8')
const commandsMd = readFileSync(path.join(root, 'COMMANDS.md'), 'utf8')

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// All wire commands documented
const expectedCmds = [
  'PING', 'STATUS', 'STOP', 'ESTOP', 'CLRFAULT', 'SETMECHOFF',
  'HOME', 'HOME_UPPER', 'HOME_LOWER', 'SEEK_TRAVEL',
  'MOVEBOTHMM', 'MOVE_UPPERMM', 'MOVE_LOWERMM',
]
for (const c of expectedCmds) {
  check(`COMMANDS.md lists ${c}`, commandsMd.includes(c))
  check(`main.cpp handles ${c}`, mainCpp.includes(`"${c}"`) || mainCpp.includes(`PSTR("${c}")`) || mainCpp.includes(`STR_EQ(cmd, "${c}")`))
}

// STATUS fields (master mapFirmwareStatus)
const statusFields = [
  'u=', 'l=', 'h=', 'busy=', 'homeSt=', 'homedUpper=', 'homedLower=',
  'async=', 'fault=', 'estop=', 'hmin=', 'hmax=', 'mechOff=',
]
for (const f of statusFields) {
  check(`STATUS emits ${f}`, mainCpp.includes(f))
}

// DONE fields
for (const f of ['homedUpper=', 'homedLower=', 'pu=', 'pl=']) {
  check(`DONE emits ${f}`, mainCpp.includes(f))
}

// MOVE*MM wire names (not legacy MOVEBOTH)
check('no legacy MOVEBOTH wire cmd', !mainCpp.includes('STR_EQ(cmd, "MOVEBOTH")'))
check('uses MOVEBOTHMM', mainCpp.includes('MOVEBOTHMM'))

// Async ERR/DONE tags
for (const tag of ['HOME', 'HOME_UPPER', 'HOME_LOWER', 'SEEK_TRAVEL', 'MOVEBOTHMM', 'MOVE_UPPERMM', 'MOVE_LOWERMM']) {
  check(`acmdTag ${tag}`, mainCpp.includes(`"${tag}"`))
}

// Safety fixes from review present
check('homAbortSync defined', mainCpp.includes('homAbortSync'))
check('F_HMU before lower HOME', mainCpp.includes('homFinishAxis(AX_U)'))
check('fixed gap model', mainCpp.includes('H_SIDE_HOME') && mainCpp.includes('H_SIDE_TRAVEL'))
check('model hmin at HOME', mainCpp.includes('2.0f * H_SIDE_HOME'))
check('uniform mech offset on hmax', mainCpp.includes('2.0f * H_SIDE_TRAVEL + gMechOffsetMm'))
check('home angle at switch latch', mainCpp.includes('gU = S_HOME'))
check('homStart uses S_HOME', mainCpp.includes('degUs(S_HOME, gCl, gTl)'))
check('REL skip travel at home pwm', mainCpp.includes('TRAVEL reads active at open'))
check('REL live lim pulse', mainCpp.includes('homRelPulse'))
check('TCP blocking homing', mainCpp.includes('Block until homing finishes'))
check('two-point homing phases', mainCpp.includes('HS_U_SEEK_H') && mainCpp.includes('HS_U_SEEK_T'))
check('runtime travel PWM', mainCpp.includes('gTu') && mainCpp.includes('gTl'))
check('SETMECHOFF command', mainCpp.includes('STR_EQ(cmd, "SETMECHOFF")'))
check('SEEK_TRAVEL command', mainCpp.includes('STR_EQ(cmd, "SEEK_TRAVEL")'))

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
