#!/usr/bin/env node
/**
 * Send HOME / HOMEA / HOMEB to the Nano via pick_place_master.js.
 *
 * Usage:
 *   node scripts/send_home.mjs both      # parallel dual HOME (config defaults)
 *   node scripts/send_home.mjs a         # HOMEA
 *   node scripts/send_home.mjs b         # HOMEB
 *
 * Env: PICK_PLACE_HOST, PICK_PLACE_PORT, PICK_PLACE_SKIP_PREFLIGHT=1
 */
import master, { diagnoseConnection } from '../master/pick_place_master.js'

const axis = (process.argv[2] || 'both').toLowerCase()

async function main() {
  if (axis === '-h' || axis === '--help') {
    console.error('Usage: node scripts/send_home.mjs [both|a|b]')
    process.exit(0)
  }

  if (process.env.PICK_PLACE_SKIP_PREFLIGHT !== '1') {
    const diag = await diagnoseConnection()
    if (!diag.subnetOk) {
      console.error(diag.report)
      process.exit(2)
    }
    if (!diag.tcpOk) {
      console.error(diag.report)
      process.exit(3)
    }
    console.log(`Connected path OK — ${diag.localIp} → ${diag.target}`)
  }

  await master.connectWithRetry()
  const cfg = master.getPickPlaceConfig()

  const st = await master.status().catch(() => null)
  if (st?.fault || st?.estop) {
    console.warn('[pick-place] fault/e-stop latched — running recover() before HOME')
    await master.recover().catch(() => {})
  }

  if (axis === 'a') {
    const wire = master.homeCommand('HOMEA', 'a', cfg.backoffMmA, cfg.homingSpeedMmS)
    console.log(`Sending: ${wire}  (homing may take up to ~2 min — wait for DONE)`)
    const r = await master.homeA(cfg.backoffMmA, cfg.homingSpeedMmS)
    console.log('HOMEA OK:', r)
    return
  }
  if (axis === 'b') {
    const wire = master.homeCommand('HOMEB', 'b', cfg.backoffMmB, cfg.homingSpeedMmS)
    console.log(`Sending: ${wire}  (homing may take up to ~2 min — wait for DONE)`)
    const r = await master.homeB(cfg.backoffMmB, cfg.homingSpeedMmS)
    console.log('HOMEB OK:', r)
    return
  }
  if (axis === 'both') {
    const wire = master.homeCommand('HOME', 'both', { a: cfg.backoffMmA, b: cfg.backoffMmB }, cfg.homingSpeedMmS)
    console.log(`Sending: ${wire}  (parallel seek — wait for DONE, up to ~4 min)`)
    const r = await master.home({ a: cfg.backoffMmA, b: cfg.backoffMmB }, cfg.homingSpeedMmS)
    console.log('HOME OK:', r)
    return
  }

  console.error(`Unknown axis "${axis}" — use both, a, or b`)
  process.exit(1)
}

main().catch(err => {
  const msg = err?.message || String(err)
  if (msg) console.error(msg)
  else console.error('HOME failed (no error message — check STATUS on Nano)')
  if (process.env.PICK_PLACE_DEBUG === '1' && err?.stack) console.error(err.stack)
  process.exit(1)
})
