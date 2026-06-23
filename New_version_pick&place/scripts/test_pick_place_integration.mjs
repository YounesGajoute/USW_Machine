#!/usr/bin/env node

/**

 * Pick-place master ↔ mock Nano TCP integration (full command flow).

 */

import fs from 'fs'

import net from 'net'

import os from 'os'

import path from 'path'

import { startMockPickPlaceNano } from './lib/mock_pick_place_tcp.mjs'



const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-place-int-'))

process.env.PICK_PLACE_CONFIG_PATH = path.join(tmpDir, 'pick_place_config.json')

process.env.PICK_PLACE_HOST = '127.0.0.1'



const mock = await startMockPickPlaceNano(0)

process.env.PICK_PLACE_PORT = String(mock.port)



const master = await import('../master/pick_place_master.js')



let pass = 0

let fail = 0



function check(name, ok, detail = '') {

  if (ok) pass++

  else {

    fail++

    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)

  }

}



function tcpOneLine(port, cmd) {

  return new Promise((resolve, reject) => {

    const sock = new net.Socket()

    let buf = ''

    const timer = setTimeout(() => { sock.destroy(); reject(new Error('timeout')) }, 5000)

    sock.connect(port, '127.0.0.1', () => sock.write(`${cmd}\n`))

    sock.on('data', chunk => {

      buf += chunk.toString('ascii')

      const nl = buf.indexOf('\n')

      if (nl !== -1) {

        clearTimeout(timer)

        sock.destroy()

        resolve(buf.slice(0, nl).replace(/\r$/, ''))

      }

    })

    sock.on('error', err => { clearTimeout(timer); reject(err) })

  })

}





try {

  check('probeConnection', (await master.probeConnection(3000)).ok)

  await master.connectWithRetry()

  check('connectWithRetry + ping', await master.ping() === true)



  let st = await master.status()

  check('status parsed', st != null && Number.isFinite(st.positionA))



  const home = await master.homeByAxis('both')

  check('HOME DONE', home.command === 'HOME 0.5 0.8 80')

  check('homed both', home.homedA && home.homedB)

  check('posA after HOME', Math.abs(home.positionA - 0.5) < 0.16)

  check('posB after HOME', Math.abs(home.positionB - 0.8) < 0.16)



  mock.sim.reset()

  const homeA = await master.homeA(0.5, 80)

  check('HOMEA', homeA.command === 'HOMEA 0.5 80' && homeA.homedA)



  mock.sim.reset()

  mock.sim.handle('HOMEA 0.5 80')

  const mv = await master.moveAmm(10, 80)

  check('MOVEAMM', mv.command === 'MOVEAMM 10 80' && Math.abs(mv.positionA - 10) < 0.16)



  mock.sim.reset()

  mock.sim.handle('HOMEB 0.8 80')

  const mvB = await master.moveBmm(12, 80)

  check('MOVEBMM', mvB.command === 'MOVEBMM 12 80')

  check('posB 12', Math.abs(mvB.positionB - 12) < 0.16)



  mock.sim.reset()

  try {

    await master.moveAmm(10, 80)

    check('move without home blocked', false)

  } catch (e) {

    check('move without home blocked', /not homed|blocked/i.test(e.message))

  }



  mock.sim.reset()

  mock.sim.handle('HOMEA 0.5 80')

  mock.sim.handle('ESTOP')

  try {

    await master.homeA()

    check('home blocked on estop', false)

  } catch (e) {

    check('home blocked on estop', /estop|blocked/i.test(e.message))

  }

  await master.recover()

  check('recover clears estop', !(await master.status()).estop)



  mock.sim.reset()

  mock.sim.handle('HOMEA 0.5 80')

  const errLine = await tcpOneLine(mock.port, 'MOVEAMM bad 80')

  check('wire ERR MOVEMM on bad args', errLine === 'ERR MOVEMM')



  mock.sim.reset()

  mock.sim.handle('HOMEA 0.5 80')

  try {

    await master.moveAmm(10, 80)

    await master.moveAmm('bad', 80)

    check('bad move args fail fast', false)

  } catch (e) {

    check('bad move args fail fast', /MOVEMM|invalid|must be a number/i.test(e.message))

  }



  check('getConnectionInfo sessionMode', master.getConnectionInfo().sessionMode === 'request-response')

  mock.sim.reset()
  const init = await master.initializePickPlace()
  check('initializePickPlace ok', init.ok === true)
  check('initialize homedA', init.homedA === true)
  check('initialize homedB', init.homedB === true)
  check('initialize A backoff', Math.abs(init.positionA - 0.5) < 0.16)
  check('initialize B backoff', Math.abs(init.positionB - 0.8) < 0.16)
  check('initialize steps order', init.steps?.[0]?.axis === 'A' && init.steps?.[1]?.axis === 'B')

} finally {

  await mock.close()

  fs.rmSync(tmpDir, { recursive: true, force: true })

}



console.log('---')

console.log(`Results: ${pass} passed, ${fail} failed`)

process.exit(fail ? 1 : 0)

