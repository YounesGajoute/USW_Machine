import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeCentringConfigPatch,
  normalizeCentringConfig,
} from './centringConfigStore.mjs'
import { resolveTransportConfig } from '../../New_version_centring_systeme/centring_master.js'

describe('normalizeCentringConfig', () => {
  it('defaults to tcp transport with host/port and serial baud', () => {
    const cfg = normalizeCentringConfig(null)
    assert.equal(cfg.transport, 'tcp')
    assert.equal(cfg.tcp.host, '192.168.10.55')
    assert.equal(cfg.tcp.port, 8177)
    assert.equal(cfg.serial.baudRate, 115200)
  })

  it('accepts serial transport patch', () => {
    const cfg = normalizeCentringConfig({
      transport: 'serial',
      serial: { baudRate: 57600 },
    })
    assert.equal(cfg.transport, 'serial')
    assert.equal(cfg.serial.baudRate, 57600)
  })

  it('merges nested tcp and serial on patch', () => {
    const cur = normalizeCentringConfig({ transport: 'tcp' })
    const next = mergeCentringConfigPatch(cur, {
      transport: 'serial',
      tcp: { host: '10.0.0.5' },
      serial: { baudRate: 9600 },
    })
    assert.equal(next.transport, 'serial')
    assert.equal(next.tcp.host, '10.0.0.5')
    assert.equal(next.tcp.port, 8177)
    assert.equal(next.serial.baudRate, 9600)
  })
})

describe('resolveTransportConfig', () => {
  it('returns tcp target from config', () => {
    const t = resolveTransportConfig({
      transport: 'tcp',
      tcp: { host: '192.168.10.55', port: 8177 },
      serial: { baudRate: 115200 },
    })
    assert.equal(t.transport, 'tcp')
    assert.equal(t.target, '192.168.10.55:8177')
  })

  it('returns serial target with env path flag', () => {
    const prev = process.env.CENTRING_SERIAL_PATH
    process.env.CENTRING_SERIAL_PATH = '/dev/ttyUSB0'
    try {
      const t = resolveTransportConfig({
        transport: 'serial',
        tcp: { host: '192.168.10.55', port: 8177 },
        serial: { baudRate: 115200 },
      })
      assert.equal(t.transport, 'serial')
      assert.equal(t.serialPath, '/dev/ttyUSB0')
      assert.equal(t.serialPathConfigured, true)
      assert.match(t.target, /\/dev\/ttyUSB0/)
    } finally {
      if (prev === undefined) delete process.env.CENTRING_SERIAL_PATH
      else process.env.CENTRING_SERIAL_PATH = prev
    }
  })

  it('env CENTRING_HOST overrides tcp host in resolved config', () => {
    const prevHost = process.env.CENTRING_HOST
    process.env.CENTRING_HOST = '192.168.10.99'
    try {
      const t = resolveTransportConfig({
        transport: 'tcp',
        tcp: { host: '192.168.10.55', port: 8177 },
        serial: { baudRate: 115200 },
      })
      assert.equal(t.host, '192.168.10.99')
      assert.equal(t.target, '192.168.10.99:8177')
    } finally {
      if (prevHost === undefined) delete process.env.CENTRING_HOST
      else process.env.CENTRING_HOST = prevHost
    }
  })

  it('env CENTRING_TRANSPORT=serial overrides tcp in resolved config', () => {
    const prev = process.env.CENTRING_TRANSPORT
    process.env.CENTRING_TRANSPORT = 'serial'
    try {
      const t = resolveTransportConfig({
        transport: 'tcp',
        tcp: { host: '192.168.10.55', port: 8177 },
        serial: { baudRate: 115200 },
      })
      assert.equal(t.transport, 'serial')
    } finally {
      if (prev === undefined) delete process.env.CENTRING_TRANSPORT
      else process.env.CENTRING_TRANSPORT = prev
    }
  })
})
