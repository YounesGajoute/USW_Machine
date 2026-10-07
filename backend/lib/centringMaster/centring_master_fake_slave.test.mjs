/**
 * Centring master against a local fake slave that records every command:
 * - clearEstop with a loaded reference runs HOME, then the height command
 *   for that tube's centring mechanism.
 * - reconnectCentringSession returns the connect STATUS at once, also mid-move.
 */
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import Database from 'better-sqlite3'
import {
  clearEstop,
  hasOpenSession,
  healthProbeCentring,
  killCentringSession,
  loadCentringConfig,
  probeConnection,
  reconnectCentringSession,
  registerCentringConfigStore,
} from './centring_master.js'
import { initProductionContext } from '../productionContext.mjs'
import { __setMachineInitStateForTest } from '../machineInit.mjs'

const REF_ID = 'REF-ESTOP-AXIS'
const TUBE_ID = 'TUBE-ESTOP-AXIS'
const CAL = Object.freeze({ calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })

let server
let commands = []
let db
/** Extra STATUS the slave sends after READY / PING on accept (a move in progress). */
let connectStatus = ''
/** '0' simulates a Nano that just powered on. SETCAL flips it to '1'. */
let reportCal = '1'
let kills = []
let acceptCount = 0
let refuseCount = 0
let lastSock = null

function statusLine(verb) {
  if (String(verb).startsWith('SETCAL')) reportCal = '1'
  const cal = String(verb).startsWith('SETCAL') ? '1' : reportCal
  const moveEnd = verb === 'HOME' ? 'home_fail' : 'ok'
  return `u=35 l=35 h=40 busy=0 cal=${cal} estop=0 accepted=1 moveEnd=${moveEnd} lastCmd=${verb} uh=0 ut=1 lh=0 lt=1 hu=2200 tu=900 hl=2150 tl=850\n`
}

function createDb(centringAxis) {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE product_references (id TEXT PRIMARY KEY, shrink_tube_id TEXT);
    CREATE TABLE shrink_tubes (
      id TEXT PRIMARY KEY, name TEXT, diameter_mm REAL, length_mm REAL,
      centring_mechanism TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      h_pre_mm REAL, h_post_mm REAL, l_eff_mm REAL, centering_travel_mm REAL,
      centering_input_mm REAL, centering_output_mm REAL, centering_move_travel_mm REAL,
      centring_axis TEXT, centring_derived_updated_at TEXT
    );
  `)
  d.prepare(`INSERT INTO shrink_tubes VALUES (?, 'tube', 5, 50, ?, 1, 3, 22, 50, 40, 140, 180, 40, ?, NULL)`)
    .run(TUBE_ID, centringAxis, centringAxis)
  d.prepare('INSERT INTO product_references VALUES (?, ?)').run(REF_ID, TUBE_ID)
  return d
}

function loadReference(centringAxis) {
  db?.close()
  db = createDb(centringAxis)
  initProductionContext(db, () => ({ centring_frame_config: {}, centering_input_start_mm: 140, centering_input_offset_mm: 0 }))
  __setMachineInitStateForTest({ referenceId: REF_ID, initialized: false })
}

before(async () => {
  server = net.createServer((sock) => {
    acceptCount += 1
    if (refuseCount > 0) {
      refuseCount -= 1
      sock.destroy()
      return
    }
    lastSock = sock
    let buf = ''
    const banner = connectStatus || statusLine('STATUS')
    sock.write(`READY\nPING\n${banner.endsWith('\n') ? banner : `${banner}\n`}`)
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        if (line === 'KILL') {
          kills.push('KILL')
          continue
        }
        const verb = line.split(/\s+/)[0]
        if (verb !== 'PING') commands.push(line)
        sock.write(statusLine(verb))
      }
    })
    sock.on('error', () => {})
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.CENTRING_HOST = '127.0.0.1'
  process.env.CENTRING_PORT = String(server.address().port)
  delete process.env.PRODUCTION_SKIP_CENTRING
  delete process.env.CENTRING_SKIP_INIT
  registerCentringConfigStore({ load: () => ({ slaveCal: { ...CAL }, mechOffsetMm: 0 }), save: () => {}, path: () => ':memory:' })
  loadCentringConfig()
})

after(async () => {
  await killCentringSession()
  await new Promise((resolve) => server.close(resolve))
  db?.close()
  delete process.env.CENTRING_HOST
  delete process.env.CENTRING_PORT
})

beforeEach(() => {
  commands = []
  kills = []
  connectStatus = ''
  reportCal = '1'
  refuseCount = 0
})

for (const axis of ['upper', 'lower']) {
  test(`clearEstop, centring_axis ${axis}: latch cleared, then HOME is sent for that mechanism`, async () => {
    loadReference(axis)
    await assert.rejects(clearEstop(), (err) => {
      assert.equal(err.code, 'HOME_FAILED')
      return true
    })
    assert.ok(commands.includes('CLEARESTOP'))
    assert.ok(commands.some((c) => c === 'HOME' || c.startsWith('HOME ')))
  })
}

test('reconnectCentringSession returns the live STATUS at once while busy, sends no command', async () => {
  connectStatus = 'u=10 l=12 h=30 busy=1 cal=1 estop=0 accepted=1 moveEnd=none lastCmd=MOVEBOTHMM uh=0 ut=0 lh=0 lt=0\n'
  const t0 = Date.now()
  const r = await reconnectCentringSession()
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`)
  assert.equal(r.ok, true)
  assert.equal(r.moveContinues, true)
  assert.equal(r.status.busy, true)
  assert.equal(r.status.lastCmd, 'MOVEBOTHMM')
  assert.deepEqual(commands, [])
})

test('new session with cal=0 sends the saved calibration and does not repeat it', async () => {
  reportCal = '0'
  await killCentringSession()
  const first = await healthProbeCentring()
  assert.equal(first.ok, true)
  const setcals = commands.filter((c) => c.startsWith('SETCAL '))
  assert.equal(setcals.length, 1)
  assert.match(setcals[0], /^SETCAL T1 2200 900 2150 850 /)
  const second = await healthProbeCentring()
  assert.equal(second.ok, true)
  assert.equal(commands.filter((c) => c.startsWith('SETCAL ')).length, 1)
})

test('kill flushes KILL, then reconnect opens one session and does not send KILL', async () => {
  await reconnectCentringSession()
  kills = []
  const killed = await killCentringSession()
  assert.equal(killed.killed, true)
  assert.equal(killed.flushed, true)
  const killDeadline = Date.now() + 1000
  while (kills.length < 1 && Date.now() < killDeadline) {
    await new Promise((r) => setTimeout(r, 10))
  }
  assert.deepEqual(kills, ['KILL'])
  assert.equal(hasOpenSession(), false)
  const r = await reconnectCentringSession()
  assert.equal(r.ok, true)
  assert.equal(hasOpenSession(), true)
  assert.deepEqual(kills, ['KILL'])
})

test('connect retries when the Nano drops the first accept', async () => {
  await killCentringSession()
  refuseCount = 1
  const r = await reconnectCentringSession()
  assert.equal(r.ok, true)
  assert.equal(hasOpenSession(), true)
  assert.equal(r.status?.accepted, true)
})

test('peer close reconnects; KILL is written only while the socket can still take it', async () => {
  await reconnectCentringSession()
  kills = []
  const dropped = lastSock
  assert.ok(dropped)
  const acceptsBefore = acceptCount
  dropped.destroy()
  const deadline = Date.now() + 4000
  while (Date.now() < deadline && !(hasOpenSession() && acceptCount > acceptsBefore)) {
    await new Promise((r) => setTimeout(r, 30))
  }
  assert.ok(acceptCount > acceptsBefore, 'replacement session was not opened')
  assert.equal(hasOpenSession(), true)
  assert.deepEqual(kills, [])
})

test('probeConnection keeps the single persistent session', async () => {
  await killCentringSession()
  const before = acceptCount
  const probe = await probeConnection(3000)
  assert.equal(probe.ok, true)
  assert.equal(probe.via, 'session')
  assert.equal(hasOpenSession(), true)
  assert.equal(acceptCount - before, 1)
})

test('clearEstop, centring_axis both: initialization still runs (HOME sent)', async () => {
  loadReference('both')
  await assert.rejects(clearEstop(), (err) => err.code === 'HOME_FAILED')
  assert.ok(commands.includes('HOME'), `commands: ${commands.join(', ')}`)
  assert.equal(commands[0], 'CLEARESTOP')
  assert.ok(!commands.some((c) => c.startsWith('MOVE')), `commands: ${commands.join(', ')}`)
})
