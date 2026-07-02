#!/usr/bin/env node
/**
 * Master ↔ slave contract: wire commands, STATUS fields, new calibration commands.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainCpp = readFileSync(path.join(root, 'src', 'main.cpp'), 'utf8')
const commandsMd = readFileSync(path.join(root, 'COMMANDS.md'), 'utf8')
const masterJs = readFileSync(path.join(root, 'master', 'centring_master.js'), 'utf8')
const httpJs = readFileSync(path.join(root, 'master', 'centring_http.js'), 'utf8')

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const wireCmds = [
  'SETMECHOFF', 'SEEK_TRAVEL',
  'HOME', 'HOME_UPPER', 'HOME_LOWER',
  'MOVEBOTHMM', 'MOVE_UPPERMM', 'MOVE_LOWERMM',
  'PING', 'STATUS', 'STOP', 'ESTOP', 'CLRFAULT',
]

for (const c of wireCmds) {
  check(`firmware handles ${c}`, mainCpp.includes(`STR_EQ(cmd, "${c}")`) || mainCpp.includes(`"${c}"`))
  check(`COMMANDS.md lists ${c}`, commandsMd.includes(c))
}

check('master seekTravelBoth sends SEEK_TRAVEL', masterJs.includes("'SEEK_TRAVEL'"))
check('master moveTo export', masterJs.includes('export async function moveTo'))
check('master homeByAxis export', masterJs.includes('export async function homeByAxis'))
check('master axis-aware assertCanMove', !masterJs.includes("if (!s.ready) throw new Error('move blocked: not ready')"))
check('master maps mechOff', masterJs.includes("kv.mechOff"))
check('http calibrate seek-home', httpJs.includes('/api/centring/calibrate/seek-home'))
check('http calibrate apply', httpJs.includes('/api/centring/calibrate/apply'))
check('http ping-nano', httpJs.includes('/api/centring/ping-nano'))
check('http move_to', httpJs.includes('/api/centring/move_to'))
check('http home routes', httpJs.includes('/api/centring/home'))
check('http recover', httpJs.includes('/api/centring/recover'))

check('firmware hPhysical adds offset', mainCpp.includes('hTot() + gMechOffsetMm'))
check('firmware mmToTarget subtracts offset', mainCpp.includes('hMm - gMechOffsetMm'))
check('firmware init hmax with offset', mainCpp.includes('2.0f * hHome + gMechOffsetMm'))

check('AC_SEEK_TRAVEL enum', mainCpp.includes('AC_SEEK_TRAVEL'))
check('startSeekTravel defined', mainCpp.includes('startSeekTravel'))

const statusFields = ['hmin=', 'hmax=', 'mechOff=', 'homedUpper=', 'async=']
for (const f of statusFields) {
  check(`STATUS field ${f}`, mainCpp.includes(f))
}

check('15 commands in header', mainCpp.includes('15 cmds'))

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
