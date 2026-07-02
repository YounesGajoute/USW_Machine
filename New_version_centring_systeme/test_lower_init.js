#!/usr/bin/env node
/**
 * Live test: initialize the LOWER centring mechanism (standalone, no backend).
 *
 * Replicates the lower-mechanism init posture used in production:
 *   connect → (recover if faulted) → HOME both → SEEK_TRAVEL (firmware)
 *   → both axes held on their travel limit switches.
 *
 * Uses the New_version_centring_systeme master directly (TCP to the Nano).
 *
 * Usage:
 *   node New_version_centring_systeme/test_lower_init.js
 *   CENTRING_HOST=192.168.10.55 CENTRING_PORT=8177 node New_version_centring_systeme/test_lower_init.js
 *
 * Exit: 0 = lower mechanism homed + idle at travel, 2 = Nano unreachable, 1 = init failure.
 */
import {
  probeConnection,
  connectWithRetry,
  status,
  recover,
  homeByAxis,
  seekTravelBoth,
  waitIdle,
  getConnectionInfo,
} from './centring_master.js'

function log(label, value) {
  console.log(`  ${String(label).padEnd(18)} ${value}`)
}

/** Travel limit switches from raw STATUS (ut = upper travel, lt = lower travel; '1' = active). */
function travelSwitches(st) {
  const raw = st?.raw || {}
  return {
    upper: raw.ut === '1',
    lower: raw.lt === '1',
    both: raw.ut === '1' && raw.lt === '1',
  }
}

async function ensureBothHomed() {
  let st = await status()
  if (!st) throw new Error('STATUS unavailable')
  if (st.fault || st.estop) {
    console.log('  fault/estop latched → recover()')
    await recover()
    st = await status()
    if (!st) throw new Error('STATUS unavailable after recover')
  }
  if (!st.homedUpper || !st.homedLower) {
    console.log('  not homed → HOME both')
    await homeByAxis('both')
    st = await status()
    if (!st?.homedUpper) throw new Error('upper not homed after HOME')
    if (!st?.homedLower) throw new Error('lower not homed after HOME')
  } else {
    console.log('  already homed (both)')
  }
  return st
}

async function main() {
  const info = getConnectionInfo()
  console.log('Lower centring initialization test')
  log('Nano target', `${info.slaveTarget} (${info.transport})`)

  console.log('\n[1/4] Probing Nano TCP link...')
  const probe = await probeConnection()
  if (!probe.ok) {
    console.error(`  FAIL Nano unreachable: ${probe.error}`)
    console.error('       Check: eth0 link up, Nano powered, on 192.168.10.x, port 8177 open.')
    return 2
  }
  console.log('  OK Nano reachable')
  await connectWithRetry()

  console.log('\n[2/4] Status before init...')
  const before = await status()
  if (before) {
    const sw = travelSwitches(before)
    log('homedUpper', before.homedUpper)
    log('homedLower', before.homedLower)
    log('h (mm)', before.h)
    log('travel sw (u/l)', `${sw.upper ? 1 : 0} / ${sw.lower ? 1 : 0}`)
    log('fault / estop', `${before.fault} / ${before.estop}`)
  }

  console.log('\n[3/4] HOME both (if needed)...')
  const stBefore = await ensureBothHomed()
  const alreadyHomed = stBefore.homedUpper && stBefore.homedLower

  console.log('\n[4/4] SEEK_TRAVEL (drive both axes onto travel switches)...')
  const t0 = Date.now()
  // Firmware can reply "ERR SEEK_TRAVEL no_travel" even after both axes physically
  // reach the travel switches — trust the limit-switch state, not the reply.
  let seekReplyOk = true
  let seekReply = 'DONE'
  try {
    await seekTravelBoth()
  } catch (err) {
    seekReplyOk = false
    seekReply = err.message
    console.log(`  note: SEEK_TRAVEL reply was not DONE → ${seekReply}`)
  }
  try {
    await waitIdle()
  } catch {
    /* idle wait best-effort; posture is verified from switches below */
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  const st = await status()
  if (!st) throw new Error('STATUS unavailable after SEEK_TRAVEL')
  const sw = travelSwitches(st)
  if (!sw.both) {
    throw new Error(
      `both axes not at travel switch (upper=${sw.upper ? 1 : 0} lower=${sw.lower ? 1 : 0}); ` +
      `seek reply: ${seekReply}`,
    )
  }

  console.log('\nOK Lower centring at travel switch')
  log('posture', 'both on travel switch (ut=1 lt=1)')
  log('seek reply', seekReplyOk ? 'DONE' : `tolerated: ${seekReply}`)
  log('already homed', alreadyHomed)
  log('h (mm)', st.h)
  log('travel elapsed (s)', elapsed)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\nFAIL Lower centring init: ${err.message}`)
    process.exit(1)
  })
