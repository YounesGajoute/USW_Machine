#!/usr/bin/env node
/**
 * Run all offline pick-place communication tests (no hardware).
 * Hardware: node scripts/test_pick_place_hardware.mjs
 * HTTP HW:  node scripts/test_pick_place_hardware_http.mjs
 */
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tests = [
  'test_pick_place_protocol.mjs',
  'test_pick_place_static.mjs',
  'test_pick_place_slave_sim.mjs',
  'test_pick_place_integration.mjs',
  'test_pick_place_http.mjs',
]

console.log('=== Pick-place offline test suite (master ↔ slave communication) ===\n')
let passed = 0
for (const t of tests) {
  console.log(`--- ${t} ---`)
  const r = spawnSync(process.execPath, [path.join(dir, t)], { stdio: 'inherit', cwd: path.join(dir, '..') })
  if (r.status === 0) passed++
  console.log('')
}
console.log(`=== Summary: ${passed}/${tests.length} suites passed ===`)
process.exit(passed === tests.length ? 0 : 1)
