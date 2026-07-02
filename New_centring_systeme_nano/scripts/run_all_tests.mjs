#!/usr/bin/env node
/**
 * Full offline test suite — master + slave logic, no hardware required.
 *
 * Usage:
 *   node scripts/run_all_tests.mjs           # all host tests + firmware build
 *   node scripts/run_all_tests.mjs --no-build  # skip PlatformIO (faster)
 *   node scripts/run_all_tests.mjs --hardware  # also try real Nano (optional)
 */
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const hardware = process.argv.includes('--hardware')
const noBuild = process.argv.includes('--no-build')

const suites = [
  ['test_calibration.mjs', 'Calibration math'],
  ['test_firmware_model.mjs', 'Firmware height model'],
  ['test_move_commands.mjs', 'Move command reachability'],
  ['test_master_config.mjs', 'Master config'],
  ['test_master_slave_contract.mjs', 'Master/slave wire contract'],
  ['test_protocol_static.mjs', 'Protocol static checks'],
  ['test_slave_simulator.mjs', 'Slave simulator (offline Nano)'],
  ['test_master_integration.mjs', 'Master TCP vs mock slave'],
  ['test_reference_flow.mjs', 'Reference loading flow'],
  ['test_http_api.mjs', 'HTTP API + mock slave'],
]

if (hardware) suites.push(['test_hardware_smoke.mjs', 'Hardware smoke (optional)'])

let failed = 0
let totalPass = 0

console.log('=== Centring offline test suite (no hardware required) ===\n')

for (const [file, label] of suites) {
  console.log(`--- ${file} — ${label} ---`)
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', file)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  if (r.status !== 0) {
    failed++
    console.error(`FAILED: ${file}\n`)
  } else {
    totalPass++
  }
}

if (!noBuild) {
  console.log('--- PlatformIO build (centring_nano + centring_nano_motor) ---')
  const pio = spawnSync('pio', ['run', '-e', 'centring_nano', '-e', 'centring_nano_motor'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
  if (pio.status !== 0) failed++
  else totalPass++
  console.log('')
}

console.log('=== Summary ===')
console.log(`Suites passed: ${totalPass}/${suites.length + (noBuild ? 0 : 1)}`)
if (failed) {
  console.error(`${failed} stage(s) failed`)
  process.exit(1)
}
console.log('All offline stages passed (master + slave logic verified without hardware)')
