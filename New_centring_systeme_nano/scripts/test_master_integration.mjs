#!/usr/bin/env node
/**
 * Master ↔ mock Nano integration (full TCP command flow, no hardware).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { startMockNano } from './lib/mock_nano_tcp.mjs'
import { MODEL_H_RANGE_MM } from '../master/centring_calibration.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centring-int-'))
process.env.CENTRING_CONFIG_PATH = path.join(tmpDir, 'centring_config.json')
process.env.CENTRING_HOST = '127.0.0.1'

const mock = await startMockNano(0)
process.env.CENTRING_PORT = String(mock.port)

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

try {
  const probe = await master.probeConnection(3000)
  check('probeConnection ok', probe.ok, JSON.stringify(probe))

  check('ping', await master.ping() === true)

  let st = await master.status()
  check('status parsed', st != null && Number.isFinite(st.h))
  check('status mechOff field', st.mechOff != null)

  await master.setMechOffsetMm(-2)
  st = await master.status()
  check('SETMECHOFF via master', Math.abs(st.mechOff + 2) < 0.05)
  check('hmin shifted', Math.abs(st.hMin - (MODEL_H_RANGE_MM.min - 2)) < 0.15)
  check('hmax shifted', Math.abs(st.hMax - (MODEL_H_RANGE_MM.max - 2)) < 0.15)

  await master.setMechOffsetMm(0)

  const home = await master.homeBoth()
  check('homeBoth DONE', home.tag === 'HOME')
  st = await master.status()
  check('homed after HOME', st.homedUpper && st.homedLower && st.ready)

  try {
    await master.moveBoth(2)
    check('moveBoth below min throws', false)
  } catch (e) {
    check('moveBoth below min throws', /outside band/i.test(e.message))
  }

  const mv = await master.moveBoth(18)
  check('moveBoth 18 DONE', mv.tag === 'MOVEBOTHMM')
  check('moveBoth h', Math.abs(mv.h - 18) < 0.35, String(mv.h))

  const travel = await master.seekTravelBoth()
  check('seekTravel DONE', travel.tag === 'SEEK_TRAVEL')
  check('seekTravel h ~ min', Math.abs(travel.h - MODEL_H_RANGE_MM.min) < 0.35)

  await master.homeBoth()
  await master.moveBoth(30)
  const up = await master.moveUpper(32)
  check('moveUpper 32', up.tag === 'MOVE_UPPERMM' && Math.abs(up.h - 32) < 0.35)

  mock.sim.reset()
  mock.sim.handle('HOME_UPPER')
  st = await master.status()
  check('upper-only homed flag', st.homedUpper && !st.homedLower)
  try {
    await master.moveUpper(2)
    check('moveUpper below min blocked at master', false)
  } catch (e) {
    check('moveUpper below min blocked at master', /outside band/i.test(e.message))
  }
  const upOnly = await master.moveUpper(55)
  check('moveUpper with lower unhomed', upOnly.tag === 'MOVE_UPPERMM' && Math.abs(upOnly.h - 55) < 0.35)

  await master.homeBoth()
  await master.moveBoth(30)
  const lo = await master.moveLower(32)
  check('moveLower 32', lo.tag === 'MOVE_LOWERMM' && Math.abs(lo.h - 32) < 0.35)

  mock.sim.reset()
  try {
    await master.moveBoth(18)
    check('move without home blocked', false)
  } catch (e) {
    check('move without home blocked', /not homed|not_ready|blocked/i.test(e.message))
  }

  mock.sim.reset()
  mock.sim.handle('HOME')
  const calHome = await master.calibrateSeekHome()
  check('calibrateSeekHome', calHome.position === 'home' && Math.abs(calHome.modelGapMm - MODEL_H_RANGE_MM.max) < 0.2)

  const calTravel = await master.calibrateSeekTravel()
  check('calibrateSeekTravel', calTravel.position === 'travel')

  const applied = await master.applyMechCalibration({
    measuredHomeMm: -2,
    measuredClosedMm: 65.6,
    pushToNano: true,
  })
  check('applyMechCalibration offset', Math.abs(applied.mechOffsetMm + 2) < 0.05)
  st = await master.status()
  check('nano mechOff after cal', Math.abs(st.mechOff + 2) < 0.05)

  await master.setMechOffsetMm(0)

  mock.sim.reset()
  mock.sim.handle('HOME')
  const stop = await master.stop()
  check('stop ok', typeof stop === 'string')

  mock.sim.reset()
  mock.sim.handle('ESTOP')
  try {
    await master.homeBoth()
    check('home blocked on estop', false)
  } catch (e) {
    check('home blocked on estop', /estop|blocked/i.test(e.message))
  }
  await master.clearFault()
  check('clearFault', (await master.status()).estop === false)

  check('getConnectionInfo', master.getConnectionInfo().slaveTarget.includes(`127.0.0.1:${mock.port}`))
} finally {
  await mock.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
