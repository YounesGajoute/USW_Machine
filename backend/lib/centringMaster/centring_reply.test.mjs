import test from 'node:test'
import assert from 'node:assert/strict'
import { readCentringCommandReply } from './centring_reply.js'

function reader(replies) {
  let time = 0
  let reads = 0
  return {
    now: () => time,
    acknowledgementTimeoutMs: 100,
    completionTimeoutMs: 200,
    readStatus: async () => {
      reads++
      time += 10
      if (!replies.length) throw new Error('timeout waiting for STATUS')
      return replies.shift()
    },
    reads: () => reads,
  }
}

test('SETCAL cannot consume a stale PING response', async () => {
  const expected = { lastCmd: 'SETCAL', busy: false, accepted: true }
  const d = reader([{ lastCmd: 'PING', busy: false }, expected])
  assert.equal(await readCentringCommandReply('SETCAL meas-v1 2102 1266 1538 742', d), expected)
  assert.equal(d.reads(), 2)
})

test('motion consumes matching busy and completion, ignoring unrelated idle lines', async () => {
  const expected = { lastCmd: 'HOME', busy: false, accepted: true, moveEnd: 'ok' }
  const d = reader([
    { lastCmd: 'STATUS', busy: false },
    { lastCmd: 'HOME', busy: true, accepted: true },
    { lastCmd: 'PING', busy: false },
    { lastCmd: 'HOME', busy: true, accepted: true },
    expected,
  ])
  assert.equal(await readCentringCommandReply('HOME', d), expected)
  assert.equal(d.reads(), 5)
})

test('busy rejection is returned immediately, not replaced with a later successful completion', async () => {
  const rejected = { lastCmd: 'HOME', busy: true, accepted: false, reason: 'busy' }
  const d = reader([rejected, { lastCmd: 'HOME', busy: false, accepted: true }])
  assert.equal(await readCentringCommandReply('HOME', d), rejected)
  assert.equal(d.reads(), 1)
})

test('missing matching reply or missing completion is an uncertain command, not success', async () => {
  for (const replies of [[], [{ lastCmd: 'PING', busy: false }], [{ lastCmd: 'HOME', busy: true, accepted: true }]]) {
    await assert.rejects(readCentringCommandReply('HOME', reader(replies)), { code: 'CENTRING_REPLY_UNCERTAIN' })
  }
})

test('a stream of unrelated replies cannot extend the acknowledgement deadline', async () => {
  const d = reader(Array.from({ length: 100 }, () => ({ lastCmd: 'PING', busy: false })))
  await assert.rejects(readCentringCommandReply('HOME', d), { code: 'CENTRING_REPLY_UNCERTAIN' })
  assert.equal(d.reads(), 10)
})
