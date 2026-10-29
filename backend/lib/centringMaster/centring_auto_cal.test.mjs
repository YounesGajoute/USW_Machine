import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

// Isolated TCP fake only. Exercise the real background keepalive, never hardware.
process.env.CENTRING_HOST = '127.0.0.1'
process.env.CENTRING_LOCAL_ADDRESS = '127.0.0.1'
process.env.CENTRING_KEEPALIVE_MS = '40'
process.env.CENTRING_STATUS_TIMEOUT_MS = '200'
process.env.CENTRING_MOVE_TIMEOUT_MS = '300'
const master = await import('./centring_master.js')
const saved = { calId: 'meas-v1', hu: 2102, tu: 1266, hl: 1538, tl: 742,
  A: 4.67687625, B: -0.176873, C: 0.00197035, sHome: -80, sTravel: 35 }
const base = { u: 0, l: 0, h: 10, busy: 0, cal: 1, estop: 0, accepted: 1,
  reason: 'ok', moveEnd: 'none', uh: 0, ut: 0, lh: 0, lt: 0,
  hmin: 1.8, hmax: 62.87, mechOff: 0, ...saved }

async function withNano(run) {
  const commands = []
  const sockets = new Set()
  const fake = { state: { ...base }, saved, reject: false, mismatch: false, drop: false }
  const reply = (cmd, changes = {}) => Object.entries({ ...fake.state, ...changes, lastCmd: cmd })
    .filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(' ') + '\n'
  const server = net.createServer(sock => {
    sockets.add(sock)
    sock.on('error', () => {})
    sock.on('close', () => sockets.delete(sock))
    sock.write('READY\nPING\n')
    let buffer = ''
    sock.on('data', chunk => {
      buffer += chunk.toString()
      while (buffer.includes('\n')) {
        const nl = buffer.indexOf('\n')
        const cmd = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        commands.push(cmd)
        if (cmd.startsWith('SETCAL ')) {
          if (fake.drop) { sock.destroy(); continue }
          if (fake.reject) sock.write(reply('SETCAL', { accepted: 0, reason: 'range' }))
          else {
            Object.assign(fake.state, saved, { cal: 1 })
            if (fake.mismatch) fake.state.hu = 2000
            sock.write(reply('SETCAL'))
          }
        } else {
          assert.ok(cmd === 'PING' || cmd === 'STATUS', `Unexpected command ${cmd}`)
          if (fake.busyNext) {
            fake.busyNext = false
            sock.write(reply(cmd, { busy: 1 }))
            setTimeout(() => {
              assert.equal(writes(commands).length, 0, 'must not SETCAL while moving')
              sock.write(reply(cmd, { busy: 0 }))
            }, 25)
          } else sock.write(reply(cmd))
        }
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  process.env.CENTRING_PORT = String(server.address().port)
  master.registerCentringConfigStore({
    load: () => ({ ...master.DEFAULT_CENTRING_CONFIG, slaveCal: fake.saved }),
    save: () => assert.fail('Auto-restore must not modify persisted calibration'),
  })
  master.loadCentringConfig()
  try {
    // Healthy status resets any cooldown left by the preceding isolated test.
    await master.status()
    commands.length = 0
    await run(fake, commands)
  } finally {
    master.setCentringProductionTcpHold(false)
    master.closeSerialSession()
    master.registerCentringConfigStore(null)
    for (const sock of sockets) sock.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}

const writes = commands => commands.filter(c => c.startsWith('SETCAL '))
const loseCal = fake => Object.assign(fake.state, { cal: 0, calId: 'placeholder', h: 'nan' })

test('idle STATUS restores exact saved model once and returns verified calibration', async () => {
  await withNano(async (fake, commands) => {
    loseCal(fake)
    const results = await Promise.all([master.status(), master.status(), master.status()])
    assert.ok(results.every(st => st.cal && st.calId === 'meas-v1'))
    assert.equal(results[0].lastCmd, 'STATUS')
    assert.deepEqual(writes(commands), [
      'SETCAL meas-v1 2102 1266 1538 742 4.67687625 -0.176873 0.00197035 -80 35',
    ])
    assert.deepEqual(commands.slice(0, 3), ['STATUS', writes(commands)[0], 'STATUS'])
  })
})

test('background keepalive restores cal after idle Nano reset without an API call', async () => {
  await withNano(async (fake, commands) => {
    loseCal(fake)
    const deadline = Date.now() + 1000
    while (!fake.state.cal && Date.now() < deadline) await delay(10)
    assert.equal(fake.state.cal, 1)
    await master.status() // drain completed restore before cleanup
    assert.equal(writes(commands).length, 1)
    // A later independent reboot is restored too, not suppressed indefinitely.
    loseCal(fake)
    await master.status()
    assert.equal(writes(commands).length, 2)
  })
})

test('connect/reconnect restores a freshly booted Nano', async () => {
  await withNano(async (fake, commands) => {
    master.closeSerialSession()
    loseCal(fake)
    await master.connectWithRetry()
    assert.equal(writes(commands).length, 1)
    assert.equal((await master.status()).cal, true)
  })
})

test('valid calibration is never overwritten just because saved values differ', async () => {
  await withNano(async (fake, commands) => {
    fake.state.hu = 2000
    await master.status()
    await delay(90)
    assert.equal(writes(commands).length, 0)
  })
})

test('E-stop, conflicting switches, fault and incomplete status block auto-restore', async () => {
  for (const change of [{ estop: 1 }, { uh: 1, ut: 1 }, { moveEnd: 'cal_fail' },
    { moveEnd: 'home_fail' }, { moveEnd: 'timeout' }, { accepted: 0 },
    { reason: 'range' }, { cal: undefined }, { busy: undefined }, { lt: undefined }]) {
    await withNano(async (fake, commands) => {
      loseCal(fake)
      Object.assign(fake.state, change)
      await master.status()
      assert.equal(writes(commands).length, 0)
    })
  }
})

test('production session ownership blocks restore until released', async () => {
  await withNano(async (fake, commands) => {
    loseCal(fake)
    master.setCentringProductionTcpHold(true)
    assert.equal((await master.status()).cal, false)
    assert.equal(writes(commands).length, 0)
    master.setCentringProductionTcpHold(false)
    assert.equal((await master.status()).cal, true)
  })
})

test('busy polling reply cannot restore calibration before motion completes', async () => {
  await withNano(async (fake, commands) => {
    loseCal(fake)
    fake.busyNext = true
    assert.equal((await master.status()).cal, true)
    assert.equal(writes(commands).length, 1)
  })
})

test('missing saved calibration stays unavailable and never fabricates defaults', async () => {
  await withNano(async (fake, commands) => {
    fake.saved = null
    master.loadCentringConfig()
    loseCal(fake)
    await assert.rejects(master.ping(), /no valid saved slaveCal/)
    assert.equal((await master.status()).cal, false)
    assert.equal(writes(commands).length, 0)
  })
})

test('rejected/mismatched SETCAL fails verification and is not retried on every poll', async () => {
  for (const failure of ['reject', 'mismatch']) {
    await withNano(async (fake, commands) => {
      fake[failure] = true
      loseCal(fake)
      await assert.rejects(master.ping(), /SETCAL not confirmed/)
      await master.status()
      assert.equal(writes(commands).length, 1)
    })
  }
})

test('lost SETCAL reply does not cause immediate replay after reconnect', async () => {
  await withNano(async (fake, commands) => {
    fake.drop = true
    loseCal(fake)
    await assert.rejects(master.ping())
    assert.equal((await master.status()).cal, false)
    assert.equal(writes(commands).length, 1)
  })
})
