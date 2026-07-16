import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeCentringConfigPatch,
  normalizeCentringConfig,
} from './centringConfigStore.mjs'
import { resolveTransportConfig } from './centringMaster/centring_master.js'

describe('normalizeCentringConfig', () => {
  it('defaults to tcp transport with host/port', () => {
    const cfg = normalizeCentringConfig(null)
    assert.equal(cfg.transport, 'tcp')
    assert.equal(cfg.tcp.host, '192.168.10.55')
    assert.equal(cfg.tcp.port, 8177)
    assert.equal(cfg.serial, undefined)
  })

  it('forces tcp even when serial transport is requested', () => {
    const cfg = normalizeCentringConfig({
      transport: 'serial',
      serial: { baudRate: 57600 },
    })
    assert.equal(cfg.transport, 'tcp')
    assert.equal(cfg.serial, undefined)
  })

  it('merges nested tcp on patch and keeps transport tcp', () => {
    const cur = normalizeCentringConfig({ transport: 'tcp' })
    const next = mergeCentringConfigPatch(cur, {
      transport: 'serial',
      tcp: { host: '10.0.0.5' },
      serial: { baudRate: 9600 },
    })
    assert.equal(next.transport, 'tcp')
    assert.equal(next.tcp.host, '10.0.0.5')
    assert.equal(next.tcp.port, 8177)
    assert.equal(next.serial, undefined)
  })
})

describe('resolveTransportConfig', () => {
  it('returns tcp target from config', () => {
    const t = resolveTransportConfig({
      transport: 'tcp',
      tcp: { host: '192.168.10.55', port: 8177 },
    })
    assert.equal(t.transport, 'tcp')
    assert.equal(t.target, '192.168.10.55:8177')
  })

  it('ignores serial env and stays on tcp', () => {
    const prevPath = process.env.CENTRING_SERIAL_PATH
    const prevTransport = process.env.CENTRING_TRANSPORT
    process.env.CENTRING_SERIAL_PATH = '/dev/ttyUSB0'
    process.env.CENTRING_TRANSPORT = 'serial'
    try {
      const t = resolveTransportConfig({
        transport: 'serial',
        tcp: { host: '192.168.10.55', port: 8177 },
      })
      assert.equal(t.transport, 'tcp')
      assert.equal(t.target, '192.168.10.55:8177')
      assert.equal(t.serialPath, null)
      assert.equal(t.serialPathConfigured, false)
    } finally {
      if (prevPath === undefined) delete process.env.CENTRING_SERIAL_PATH
      else process.env.CENTRING_SERIAL_PATH = prevPath
      if (prevTransport === undefined) delete process.env.CENTRING_TRANSPORT
      else process.env.CENTRING_TRANSPORT = prevTransport
    }
  })

  it('env CENTRING_HOST overrides tcp host in resolved config', () => {
    const prevHost = process.env.CENTRING_HOST
    process.env.CENTRING_HOST = '192.168.10.99'
    try {
      const t = resolveTransportConfig({
        transport: 'tcp',
        tcp: { host: '192.168.10.55', port: 8177 },
      })
      assert.equal(t.host, '192.168.10.99')
      assert.equal(t.target, '192.168.10.99:8177')
    } finally {
      if (prevHost === undefined) delete process.env.CENTRING_HOST
      else process.env.CENTRING_HOST = prevHost
    }
  })
})
