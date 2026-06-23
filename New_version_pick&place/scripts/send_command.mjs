#!/usr/bin/env node
/**
 * Send any pick-place command to the Nano (uses pick_place_master.js).
 *
 * Usage:
 *   node scripts/send_command.mjs ping
 *   node scripts/send_command.mjs status
 *   node scripts/send_command.mjs stop
 *   node scripts/send_command.mjs estop
 *   node scripts/send_command.mjs clrfault
 *   node scripts/send_command.mjs homea [backoff_mm] [speed_mm_s]
 *   node scripts/send_command.mjs homeb [backoff_mm] [speed_mm_s]
 *   node scripts/send_command.mjs movea <mm> [speed]
 *   node scripts/send_command.mjs moveaT1 <mm> [speed]
 *   node scripts/send_command.mjs moveaT2 <mm> [speed]
 *   node scripts/send_command.mjs moveb <mm> [speed]
 * Homing shortcuts (same as send_home.mjs):
 *   node scripts/send_home.mjs a
 *   node scripts/send_home.mjs b
 * Env: PICK_PLACE_HOST, PICK_PLACE_PORT, PICK_PLACE_SKIP_PREFLIGHT=1
 */
import master, { diagnoseConnection, readSwitchPins } from '../master/pick_place_master.js'

const [,, cmd, ...args] = process.argv

function usage() {
  console.log(`Usage: node scripts/send_command.mjs <command> [args...]

Commands:
  ping
  status
  switches
  stop
  estop
  clrfault
  homea [backoff_mm] [speed_mm_s]
  homeb [backoff_mm] [speed_mm_s]
  movea <mm> [speed_mm_s]
  moveaT1 <mm> [speed_mm_s]   # test: MOVEAMM + D7/D6 both enabled
  moveaT2 <mm> [speed_mm_s]   # test: MOVEAMM + D7/D6 both disabled
  moveb <mm> [speed_mm_s]

Homing shortcuts (dedicated script):
  node scripts/send_home.mjs a
  node scripts/send_home.mjs b`)
}

async function preflight() {
  if (process.env.PICK_PLACE_SKIP_PREFLIGHT === '1') return
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

function numArg(v, label) {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number (got "${v}")`)
  return n
}

async function main() {
  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage()
    process.exit(cmd ? 0 : 1)
  }

  await preflight()
  await master.connectWithRetry()
  const cfg = master.getPickPlaceConfig()
  const c = cmd.toLowerCase()

  if (c === 'ping') {
    const ok = await master.ping(3)
    console.log(ok ? 'PONG' : 'PING failed')
    return
  }

  if (c === 'status') {
    const st = await master.status()
    if (st?.raw) {
      console.log(`stepA=${st.raw.stepA} stepB=${st.raw.stepB} posA=${st.positionA?.toFixed(3)} posB=${st.positionB?.toFixed(3)} mm spmm=${st.stepsPerMm?.toFixed(4)} enA=${st.enabledA} enB=${st.enabledB} homedA=${st.homedA} homedB=${st.homedB} busy=${st.busy}`)
    }
    console.log(st)
    return
  }

  if (c === 'switches') {
    const sw = await readSwitchPins()
    console.log(sw.raw)
    console.log('(limits/ALM: 1=open, 0=pressed; enA/enB=firmware latch 1=on; enX_pin=raw D7/D6; enActLo=0 → HIGH=enabled)')
    console.log(sw)
    return
  }

  if (c === 'stop') {
    const reply = await master.stop()
    console.log(reply)
    return
  }

  if (c === 'estop') {
    const reply = await master.emergencyStop()
    console.log(reply)
    return
  }

  if (c === 'clrfault' || c === 'recover') {
    const r = await master.recover()
    console.log(r.reply ?? r)
    return
  }

  if (c === 'homea') {
    const backoff = args[0] != null ? numArg(args[0], 'backoff_mm') : cfg.backoffMmA
    const speed = args[1] != null ? numArg(args[1], 'speed_mm_s') : cfg.homingSpeedMmS
    const wire = master.homeCommand('HOMEA', 'a', backoff, speed)
    console.log(`Sending: ${wire}`)
    const r = await master.homeA(backoff, speed)
    console.log('HOMEA OK:', r)
    return
  }

  if (c === 'homeb') {
    const backoff = args[0] != null ? numArg(args[0], 'backoff_mm') : cfg.backoffMmB
    const speed = args[1] != null ? numArg(args[1], 'speed_mm_s') : cfg.homingSpeedMmS
    const wire = master.homeCommand('HOMEB', 'b', backoff, speed)
    console.log(`Sending: ${wire}`)
    const r = await master.homeB(backoff, speed)
    console.log('HOMEB OK:', r)
    return
  }

  if (c === 'movea' || c === 'moveamm') {
    if (!args[0]) throw new Error('movea requires <mm>')
    const mm = numArg(args[0], 'mm')
    const speed = args[1] != null ? numArg(args[1], 'speed_mm_s') : cfg.movementSpeedMmS
    const wire = master.moveCommandA(mm, speed)
    console.log(`Sending: ${wire}`)
    const r = await master.moveAmm(mm, speed)
    console.log('MOVEAMM OK:', r)
    return
  }

  if (c === 'moveat1' || c === 'moveammt1') {
    if (!args[0]) throw new Error('moveaT1 requires <mm>')
    const mm = numArg(args[0], 'mm')
    const speed = args[1] != null ? numArg(args[1], 'speed_mm_s') : cfg.movementSpeedMmS
    const wire = master.moveCommandAT1(mm, speed)
    console.log(`Sending: ${wire}`)
    const r = await master.moveAmmT1(mm, speed)
    console.log('MOVEAMMT1 OK:', r)
    return
  }

  if (c === 'moveat2' || c === 'moveammt2') {
    if (!args[0]) throw new Error('moveaT2 requires <mm>')
    const mm = numArg(args[0], 'mm')
    const speed = args[1] != null ? numArg(args[1], 'speed_mm_s') : cfg.movementSpeedMmS
    const wire = master.moveCommandAT2(mm, speed)
    console.log(`Sending: ${wire}`)
    const r = await master.moveAmmT2(mm, speed)
    console.log('MOVEAMMT2 OK:', r)
    return
  }

  if (c === 'moveb' || c === 'movebmm') {
    if (!args[0]) throw new Error('moveb requires <mm>')
    const mm = numArg(args[0], 'mm')
    const speed = args[1] != null ? numArg(args[1], 'speed_mm_s') : cfg.movementSpeedMmS
    const wire = master.moveCommandB(mm, speed)
    console.log(`Sending: ${wire}`)
    const r = await master.moveBmm(mm, speed)
    console.log('MOVEBMM OK:', r)
    return
  }

  console.error(`Unknown command "${cmd}"\n`)
  usage()
  process.exit(1)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
