#!/usr/bin/env node
/**
 * Static pick-place master ↔ slave contract (firmware + COMMANDS.md + master).
 */
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainCpp = readFileSync(path.join(root, 'src', 'main.cpp'), 'utf8')
const commandsMd = readFileSync(path.join(root, 'COMMANDS.md'), 'utf8')
const masterJs = readFileSync(path.join(root, 'master', 'pick_place_master.js'), 'utf8')

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
  'PING', 'STATUS', 'STOP', 'ESTOP', 'CLRFAULT',
  'HOME', 'HOMEA', 'HOMEB', 'MOVEAMM', 'MOVEBMM',
]
for (const c of wireCmds) {
  check(`firmware handles ${c}`, mainCpp.includes(`"${c}"`) || mainCpp.includes(`strcmp(cmd, "${c}")`))
  check(`COMMANDS.md lists ${c}`, commandsMd.includes(c))
}

const statusFields = ['stepA=', 'stepB=', 'busy=', 'homeSt=', 'homedA=', 'homedB=', 'async=', 'fault=', 'estop=', 'pulseMm=', 'enA=', 'enB=']
for (const f of statusFields) {
  check(`STATUS emits ${f}`, mainCpp.includes(f))
}

for (const f of ['posA=', 'posB=', 'homedA=', 'homedB=', 'bkA=', 'bkB=']) {
  check(`DONE emits ${f}`, mainCpp.includes(f))
}

check('master persistent TCP session', masterJs.includes('PickPlaceTcpSession'))
check('master STATUS terminator stepA=', masterJs.includes("'STATUS', 'stepA='"))
check('master parseDoneLine posA', masterJs.includes("'posA'"))
check('master resolveHomeBackoff', masterJs.includes('resolveHomeBackoff'))
check('master handlePickPlaceHttpRequest', masterJs.includes('handlePickPlaceHttpRequest'))
check('master ping-nano route', masterJs.includes('/api/pick-place/ping-nano'))
check('master move_a alias', masterJs.includes('/api/pick-place/move_a'))
check('no ALMCLR in firmware', !mainCpp.includes('ALMCLR'))
check('no SPEED wire cmd in firmware handler', !mainCpp.includes('strcmp(cmd, "SPEED")'))
check('HOME command in firmware', mainCpp.includes('strcmp(cmd, "HOME")'))
check('HOME_BOTH_SEEK state', mainCpp.includes('HOME_BOTH_SEEK'))
check('HOME_A_RELEASE state', mainCpp.includes('HOME_A_RELEASE'))
check('HOME_RELEASE_CS 5mm', mainCpp.includes('HOME_RELEASE_CS = 500'))
check('firmware ERR MOVEMM documented', commandsMd.includes('ERR MOVEMM'))
check('master errLineMatchesTag export', masterJs.includes('errLineMatchesTag'))

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
