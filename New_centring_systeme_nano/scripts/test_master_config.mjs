#!/usr/bin/env node
/**
 * Master config validation: mechOffsetMm, derived hRangeMm, effective limits.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'centring-cfg-'))
const tmpConfig = path.join(tmpDir, 'centring_config.json')
process.env.CENTRING_CONFIG_PATH = tmpConfig

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

const model = master.getModelHeightRangeMm()

const cfg0 = master.saveCentringConfig({
  movementSpeedDegS: 45,
  homingSpeedDegS: 90,
  mechOffsetMm: 0,
})
check('save offset 0', cfg0.mechOffsetMm === 0)
check('hRange at 0 matches model', Math.abs(cfg0.hRangeMm.min - model.min) < 0.01)

const cfgNeg = master.saveCentringConfig({ ...cfg0, mechOffsetMm: -2 })
check('save offset -2', cfgNeg.mechOffsetMm === -2)
check('hRange min -2', Math.abs(cfgNeg.hRangeMm.min - (model.min - 2)) < 0.05)
check('hRange max 65.6', Math.abs(cfgNeg.hRangeMm.max - (model.max - 2)) < 0.05)

const eff = master.getEffectiveHRangeMm(cfgNeg)
check('getEffectiveHRangeMm', eff.min === cfgNeg.hRangeMm.min && eff.max === cfgNeg.hRangeMm.max)

const legacy = master.saveCentringConfig({
  movementSpeedDegS: 45,
  homingSpeedDegS: 90,
  hRangeMm: { min: model.min + 1, max: model.max + 1 },
})
check('legacy hRange derives offset +1', Math.abs(legacy.mechOffsetMm - 1) < 0.05)

const loaded = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'))
check('persisted mechOffsetMm', loaded.mechOffsetMm != null)

try {
  master.saveCentringConfig({ movementSpeedDegS: 45, homingSpeedDegS: 90, mechOffsetMm: 'bad' })
  check('reject bad mechOffsetMm', false)
} catch {
  check('reject bad mechOffsetMm', true)
}

const cal = master.getCentringCalibrationInfo(cfgNeg)
check('calibration info', cal.mechOffsetMm === -2 && Math.abs(cal.effectiveHRangeMm.min + 2) < 0.15)

fs.rmSync(tmpDir, { recursive: true, force: true })

console.log('---')
console.log(`Results: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
