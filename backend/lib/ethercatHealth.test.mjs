import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  handleEtherCATHealthOk,
  handleEtherCATHealthWarning,
  getEthercatHealthSnapshot,
  __resetEthercatHealthForTest,
} from './ethercatHealth.mjs'

const ORIGINAL_THRESHOLD = process.env.COMM_FAILURE_THRESHOLD

beforeEach(() => {
  __resetEthercatHealthForTest()
  process.env.COMM_FAILURE_THRESHOLD = '3'
})

afterEach(() => {
  if (ORIGINAL_THRESHOLD === undefined) {
    delete process.env.COMM_FAILURE_THRESHOLD
  } else {
    process.env.COMM_FAILURE_THRESHOLD = ORIGINAL_THRESHOLD
  }
  __resetEthercatHealthForTest()
})

test('health_ok resets failure counter and stores advisory without tearing down', () => {
  handleEtherCATHealthOk({ status: 'ok' })
  handleEtherCATHealthWarning({ status: 'error', error: 'Slave(s) not in OP state' })
  handleEtherCATHealthWarning({ status: 'error', error: 'Slave(s) not in OP state' })

  let snap = getEthercatHealthSnapshot()
  assert.equal(snap.consecutiveFailures, 2)
  assert.equal(snap.reachable, true)

  handleEtherCATHealthOk({
    status: 'ok',
    warning: 'Process data WKC 2 != expected 3',
  })

  snap = getEthercatHealthSnapshot()
  assert.equal(snap.consecutiveFailures, 0)
  assert.equal(snap.reachable, true)
  assert.equal(snap.lastAdvisory, 'Process data WKC 2 != expected 3')
  assert.equal(snap.lastError, null)
})

test('status=ok with warning via health_warning handler does not increment failures', () => {
  handleEtherCATHealthWarning({
    status: 'ok',
    warning: 'Process data WKC 2 != expected 3',
  })

  const snap = getEthercatHealthSnapshot()
  assert.equal(snap.consecutiveFailures, 0)
  assert.equal(snap.reachable, true)
  assert.equal(snap.lastAdvisory, 'Process data WKC 2 != expected 3')
})

test('true ping errors increment toward threshold while bridge stays up', () => {
  handleEtherCATHealthOk({ status: 'ok' })
  handleEtherCATHealthWarning({ status: 'error', error: 'Not initialized' })
  handleEtherCATHealthWarning({ status: 'error', error: 'Not initialized' })

  const snap = getEthercatHealthSnapshot()
  assert.equal(snap.consecutiveFailures, 2)
  assert.equal(snap.reachable, true)
  assert.match(snap.lastError, /Not initialized/)
})
