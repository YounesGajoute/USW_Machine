import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { once } from 'node:events'

// This process can only contact our loopback fake; never load the machine .env.
process.env.CENTRING_HOST = '127.0.0.1'
process.env.CENTRING_LOCAL_ADDRESS = '127.0.0.1'
process.env.CENTRING_KEEPALIVE_MS = '0'
process.env.CENTRING_STATUS_TIMEOUT_MS = '200'
process.env.CENTRING_MOVE_TIMEOUT_MS = '300'
const master = await import('./centring_master.js')
const { homeUnconfirmedCentringAxes } = await import('../centringHoming.mjs')

const home = { u: -80, l: -80, h: 63.27, busy: 0, cal: 1, estop: 0, accepted: 1,
  reason: 'ok', hmin: 1.86, hmax: 63.27, mechOff: 0, hu: 2102, tu: 1266, hl: 1538, tl: 742,
  uh: 1, ut: 0, lh: 1, lt: 0, moveEnd: 'ok', calId: 'meas-v1' }
function line(lastCmd, changes = {}) {
  return Object.entries({ ...home, lastCmd, ...changes }).map(([k, v]) => `${k}=${v}`).join(' ') + '\n'
}

async function withFake(handler, run) {
  const commands = []
  const sockets = new Set()
  const server = net.createServer(sock => {
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))
    sock.on('error', () => {})
    sock.write('READY\nPING\n')
    let buffer = ''
    sock.on('data', chunk => {
      buffer += chunk.toString()
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n')
        const cmd = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        commands.push(cmd)
        handler(cmd, sock)
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  process.env.CENTRING_PORT = String(server.address().port)
  try {
    await run(commands)
  } finally {
    master.closeSerialSession()
    for (const sock of sockets) sock.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}

for (const [axis, changes, command] of [
  ['both', { u: 35, l: 35, uh: 0, ut: 0, lh: 0, lt: 0 }, 'HOME'],
  ['upper', { u: 0, uh: 0 }, 'HOME_UPPER'],
  ['lower', { l: 0, lh: 0 }, 'HOME_LOWER'],
]) {
  test(`wire Initialization homes ${axis} with neither endpoint confirmed before any closing command`, async () => {
    let homed = false
    await withFake((cmd, sock) => {
      if (cmd === 'STATUS') sock.write(line(cmd, homed ? {} : changes))
      else if (cmd === command) {
        homed = true
        sock.write(line(cmd, { busy: 1 }) + line(cmd))
      } else assert.fail(`Unexpected command: ${cmd}`)
    }, async commands => {
      const result = await homeUnconfirmedCentringAxes({
        status: master.status, homeByAxis: master.homeByAxis, waitIdle: master.waitIdle,
      })
      assert.equal(result.didHome, true)
      assert.equal(result.homeAxis, axis)
      assert.equal(commands.filter(cmd => cmd === command).length, 1)
      assert.ok(commands.every(cmd => cmd === 'STATUS' || cmd === command))
    })
  })
}

test('wire actual mismatch recovers with HOME then permits the target only after verified HOME', async () => {
  let state = { u: 33.35, l: 35, h: 1.93, uh: 0, ut: 0, lh: 1, lt: 0 }
  await withFake((cmd, sock) => {
    if (cmd === 'STATUS') sock.write(line(cmd, state))
    else if (cmd === 'HOME') {
      state = {}
      sock.write(line(cmd, { busy: 1 }) + line(cmd))
    } else if (cmd.startsWith('MOVEBOTHMM ')) {
      state = { u: 33.35, l: 33.35, h: 3, targetH: 3, uh: 0, ut: 0, lh: 0, lt: 0 }
      sock.write(line('MOVEBOTHMM', state))
    } else assert.fail(`Unexpected command: ${cmd}`)
  }, async commands => {
    await homeUnconfirmedCentringAxes({ establishHome: true,
      status: master.status, homeByAxis: master.homeByAxis, waitIdle: master.waitIdle,
    })
    await master.moveBoth(3)
    const motion = commands.filter(cmd => cmd !== 'STATUS')
    assert.equal(motion.length, 2)
    assert.equal(motion[0], 'HOME')
    assert.match(motion[1], /^MOVEBOTHMM 3(?: |$)/)
  })
})

test('wire single-axis HOME does not energize an untrusted peer', async () => {
  await withFake((cmd, sock) => {
    assert.equal(cmd, 'STATUS')
    sock.write(line(cmd, { u: 33.35, l: 35, uh: 0, lh: 1 }))
  }, async commands => {
    await assert.rejects(master.homeUpper(), { code: 'CENTRING_FEEDBACK_MISMATCH' })
    assert.deepEqual(commands, ['STATUS'])
  })
})

test('wire failed HOME recovery never sends target or automatically retries', async () => {
  const stale = { u: 33.35, l: 35, uh: 0, lh: 1 }
  await withFake((cmd, sock) => {
    if (cmd === 'STATUS') sock.write(line(cmd, stale))
    else if (cmd === 'HOME') sock.write(line(cmd, { ...stale, moveEnd: 'home_fail' }))
    else assert.fail(`Unexpected command after failed HOME: ${cmd}`)
  }, async commands => {
    await assert.rejects(async () => {
      await homeUnconfirmedCentringAxes({ establishHome: true,
        status: master.status, homeByAxis: master.homeByAxis, waitIdle: master.waitIdle,
      })
      await master.moveBoth(3)
    }, { code: 'CENTRING_FEEDBACK_MISMATCH' })
    assert.deepEqual(commands.filter(cmd => cmd !== 'STATUS'), ['HOME'])
  })
})

test('wire HOME still rejects conflicting switches and E-stop without motion', async () => {
  for (const state of [{ uh: 1, ut: 1 }, { estop: 1 }]) {
    await withFake((cmd, sock) => {
      assert.equal(cmd, 'STATUS')
      sock.write(line(cmd, state))
    }, async commands => {
      await assert.rejects(master.homeBoth())
      assert.deepEqual(commands, ['STATUS'])
    })
  }
})

test('wire SETCAL ignores stale PING and waits for its own acknowledgement', async () => {
  await withFake((cmd, sock) => {
    assert.ok(cmd.startsWith('SETCAL '))
    sock.write(line('PING') + line('SETCAL'))
  }, async commands => {
    const st = await master.setCal({ calId: 'meas-v1', hu: 2102, tu: 1266, hl: 1538, tl: 742 })
    assert.equal(st.lastCmd, 'SETCAL')
    assert.equal(commands.length, 1)
  })
})

test('wire SEEK_TRAVEL stops the sequence if only upper confirms travel', async () => {
  await withFake((cmd, sock) => {
    if (cmd === 'STATUS') sock.write(line(cmd))
    else if (cmd === 'SEEK_TRAVEL') {
      sock.write(line(cmd, { busy: 1 }) + line(cmd, { u: 35, uh: 0, ut: 1, moveEnd: 'limit' }))
    } else assert.fail(`Unexpected command after failed travel: ${cmd}`)
  }, async commands => {
    await assert.rejects(async () => {
      await master.seekTravelBoth()
      await master.homeBoth()
    }, { code: 'CENTRING_FEEDBACK_MISMATCH' })
    assert.deepEqual(commands, ['STATUS', 'SEEK_TRAVEL'])
  })
})

test('wire MOVE cannot report success with lower HOME still active', async () => {
  await withFake((cmd, sock) => {
    if (cmd === 'STATUS') sock.write(line(cmd))
    else if (cmd.startsWith('MOVEBOTHMM ')) sock.write(line('MOVEBOTHMM', {
      u: 33.35, l: 35, h: 1.93, targetH: 2, uh: 0, ut: 0, lh: 1, lt: 0,
    }))
    else assert.fail(`Unexpected command: ${cmd}`)
  }, async commands => {
    await assert.rejects(master.moveBoth(2), { code: 'CENTRING_FEEDBACK_MISMATCH' })
    assert.equal(commands.length, 2)
  })
})

test('wire preflight prevents a new MOVE from a contradictory starting position', async () => {
  await withFake((cmd, sock) => {
    assert.equal(cmd, 'STATUS')
    sock.write(line(cmd, { u: 33.35, l: 35, h: 1.93, uh: 0, lh: 1 }))
  }, async commands => {
    await assert.rejects(master.moveBoth(2), { code: 'CENTRING_FEEDBACK_MISMATCH' })
    assert.deepEqual(commands, ['STATUS'])
  })
})

test('wire timeout closes the uncertain session and never repeats SETCAL', async () => {
  await withFake((cmd, sock) => sock.write(line('PING')), async commands => {
    await assert.rejects(master.setCal({ calId: 'meas-v1', hu: 2102, tu: 1266, hl: 1538, tl: 742 }),
      { code: 'CENTRING_REPLY_UNCERTAIN' })
    assert.equal(master.hasOpenSession(), false)
    assert.equal(commands.length, 1)
  })
})

test('connecting for diagnostics never clears E-stop or applies calibration', async () => {
  await withFake((cmd, sock) => {
    assert.equal(cmd, 'PING')
    sock.write(line(cmd, { estop: 1, cal: 0 }))
  }, async commands => {
    await master.connectWithRetry()
    assert.deepEqual(commands, ['PING'])
  })
})
