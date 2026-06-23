#!/usr/bin/env node
/**
 * Pick-place HARDWARE communication test — master ↔ Nano @ 192.168.10.5:8177
 *
 * Phases (safe order):
 *   1. TCP probe + PING + STATUS
 *   2. Optional HOMEA (single axis) if not homed and no fault
 *   3. Optional MOVEAMM 5 mm if axis A homed
 *   4. Wire-format validation on DONE/STATUS fields
 *
 * Env: PICK_PLACE_HOST, PICK_PLACE_PORT, PICK_PLACE_SKIP_MOTION=1 to skip HOME/MOVE
 */
import master, {
  errLineMatchesTag,
  getConnectionInfo,
  homeCommand,
  moveCommandA,
  parseDoneLine,
  probeConnection,
} from '../master/pick_place_master.js'

const SKIP_MOTION = process.env.PICK_PLACE_SKIP_MOTION === '1'
const HOST = process.env.PICK_PLACE_HOST || '192.168.10.5'
const PORT = process.env.PICK_PLACE_PORT || '8177'

let pass = 0
let fail = 0
const notes = []

function check(name, ok, detail = '') {
  if (ok) pass++
  else {
    fail++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function log(msg) {
  console.log(msg)
  notes.push(msg)
}

async function main() {
  log(`=== Pick-place hardware test → ${HOST}:${PORT} ===`)
  log(`Skip motion: ${SKIP_MOTION}`)

  const info = getConnectionInfo()
  check('sessionMode request-response', info.sessionMode === 'request-response')

  const probe = await probeConnection(10000)
  check('TCP probe', probe.ok, JSON.stringify(probe))
  if (!probe.ok) {
    summary()
    process.exit(1)
  }

  await master.connectWithRetry()
  check('PING', await master.ping() === true)

  let st = await master.status()
  check('STATUS available', st != null)
  if (!st) {
    summary()
    process.exit(1)
  }

  log(`STATUS: state=${st.state} homedA=${st.homedA} homedB=${st.homedB} posA=${st.positionA?.toFixed(3)} posB=${st.positionB?.toFixed(3)} fault=${st.fault} estop=${st.estop} busy=${st.busy} async=${st.asyncCmd}`)

  check('STATUS has stepA fields', Number.isFinite(st.positionA))
  check('STATUS has homed flags', typeof st.homedA === 'boolean' && typeof st.homedB === 'boolean')
  check('stepsPerMm ~3.33', Math.abs(st.stepsPerMm - 10 / 3) < 0.01)

  if (st.fault || st.estop) {
    log('Fault/e-stop latched — attempting recover()')
    try {
      await master.recover()
      st = await master.status()
      check('recover cleared fault/estop', !st.fault && !st.estop)
    } catch (e) {
      check('recover', false, e.message)
    }
  }

  if (!SKIP_MOTION && !st.busy && st.homeSt === 0) {
    if (!st.homedA) {
      log('Running HOMEA 0.5 80 (single axis, ~150s max)...')
      const wire = homeCommand('HOMEA', 'a', 0.5, 80)
      check('HOMEA wire format', wire === 'HOMEA 0.5 80')
      try {
        const home = await master.homeA(0.5, 80)
        check('HOMEA ok', home.homedA === true)
        check('HOMEA command echoed', home.command === 'HOMEA 0.5 80')
        check('HOMEA pos ~backoff', Math.abs(home.positionA - 0.5) < 0.15, String(home.positionA))
        check('DONE has posA/bkA', home.doneLine?.includes('posA=') && home.doneLine?.includes('bkA='))
        if (home.doneLine) {
          const done = parseDoneLine(home.doneLine)
          check('parseDoneLine tag', done.tag === 'HOMEA')
        }
        st = await master.status()
      } catch (e) {
        check('HOMEA', false, e.message)
      }
    } else {
      log('Axis A already homed — skipping HOMEA')
    }

    st = await master.status()
    if (st.homedA && !st.busy && !st.fault && !st.estop) {
      const target = Math.max(1, Math.min(20, (st.positionA ?? 0.5) + 2))
      const wire = moveCommandA(target, 40)
      log(`Running MOVEAMM ${target} 40 (slow speed)...`)
      check('MOVEAMM wire format', wire === `MOVEAMM ${target} 40`)
      try {
        const mv = await master.moveAmm(target, 40)
        check('MOVEAMM ok', Math.abs(mv.positionA - target) < 0.2, String(mv.positionA))
        check('MOVEAMM command echoed', mv.command === wire)
        check('homed flags kept', mv.homedA === true)
      } catch (e) {
        check('MOVEAMM', false, e.message)
      }
    }
  } else if (SKIP_MOTION) {
    log('Motion skipped (PICK_PLACE_SKIP_MOTION=1)')
  }

  check('errLineMatchesTag MOVEMM', errLineMatchesTag('ERR MOVEMM', 'MOVEAMM'))

  summary()
  process.exit(fail ? 1 : 0)
}

function summary() {
  console.log('---')
  console.log(`Results: ${pass} passed, ${fail} failed`)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
