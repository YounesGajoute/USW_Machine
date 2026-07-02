#!/usr/bin/env node
/**
 * Gap move flow with mock Nano (resolve gap → MOVE*MM → verify h).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { startMockNano } from './lib/mock_nano_tcp.mjs'
import { resolveGapMove } from '../master/centring_reference.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centring-ref-'))
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
  mock.sim.reset()
  mock.sim.handle('HOME')

  for (const [axis, cmd, gap] of [
    ['both', 'MOVEBOTHMM', 18],
    ['upper', 'MOVE_UPPERMM', 30],
    ['lower', 'MOVE_LOWERMM', 30],
  ]) {
    const resolved = resolveGapMove({ gapMm: gap, axis })
    check(`${axis} → ${cmd}`, resolved.moveCommand === cmd)

    const range = master.getEffectiveHRangeMm()
    check(`${axis} gap in band`, resolved.gapMm >= range.min && resolved.gapMm <= range.max, `${resolved.gapMm}`)

    mock.sim.reset()
    mock.sim.handle('HOME')
    const result = await master.applyGap({
      gapMm: gap,
      axis,
      connect: false,
    })
    check(`${axis} applyGap h`, Math.abs(result.done.h - result.gapMm) < 0.35, `${result.done.h} vs ${result.gapMm}`)
  }

  mock.sim.reset()
  try {
    await master.applyGap({ gapMm: 18, connect: false })
    check('applyGap not homed throws', false)
  } catch (e) {
    check('applyGap not homed throws', /homed/i.test(e.message))
  }
} finally {
  await mock.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
