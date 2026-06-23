#!/usr/bin/env node
/**
 * Pick-place master protocol tests (offline — wire command builders + backoff parsing).
 */
import {
  homeCommand,
  moveCommandA,
  moveCommandB,
  resolveHomeBackoff,
  errLineMatchesTag,
} from '../master/pick_place_master.js'

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function expectThrow(name, fn, pattern) {
  try {
    fn()
    check(name, false, 'expected throw')
  } catch (e) {
    check(name, pattern.test(e.message), e.message)
  }
}

check('HOME both wire', homeCommand('HOME', 'both', { a: 0.5, b: 0.8 }, 80) === 'HOME 0.5 0.8 80')
check('HOMEA wire', homeCommand('HOMEA', 'a', 0.5, 80) === 'HOMEA 0.5 80')
check('HOMEB wire', homeCommand('HOMEB', 'b', 0.8, 80) === 'HOMEB 0.8 80')
check('MOVEAMM absolute', moveCommandA(10, 80) === 'MOVEAMM 10 80')
check('MOVEBMM absolute', moveCommandB(10, 80) === 'MOVEBMM 10 80')

check('resolveHomeBackoff both object', resolveHomeBackoff({ a: 0.5, b: 0.8 }, 'both').a === 0.5)
check('resolveHomeBackoff axis a number', resolveHomeBackoff(0.6, 'a') === 0.6)
check('resolveHomeBackoff axis a from backoffA object', resolveHomeBackoff({ backoffA: 0.55 }, 'a') === 0.55)
check('resolveHomeBackoff axis b from backoffB object', resolveHomeBackoff({ backoffB: 0.75 }, 'b') === 0.75)
check('resolveHomeBackoff both scalar', resolveHomeBackoff(5, 'both').a === 5 && resolveHomeBackoff(5, 'both').b === 5)
check(
  'resolveHomeBackoff home_a backoffA-only object (doc fix)',
  resolveHomeBackoff({ a: 0.5, b: undefined }, 'a') === 0.5,
)

check('errLineMatchesTag MOVEAMM accepts MOVEMM', errLineMatchesTag('ERR MOVEMM', 'MOVEAMM'))
check('errLineMatchesTag MOVEAMM rejects unrelated', !errLineMatchesTag('ERR HOME busy', 'MOVEAMM'))

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
