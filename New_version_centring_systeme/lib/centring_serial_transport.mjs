/**
 * USB serial transport for centring Nano (centring_nano_motor firmware @ 115200).
 * Device path from CENTRING_SERIAL_PATH env only (stable by-path symlink on Linux).
 */
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(__dirname, '../../backend/package.json'))
const { SerialPort } = require('serialport')

const BOOT_LINES = new Set(['MOTOR_ONLY', 'READY'])

/** @type {import('serialport').SerialPort | null} */
let activePort = null
/** @type {{ path: string, baudRate: number } | null} */
let activeConfig = null

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function isTransientSerialError(err) {
  const code = err?.code
  if (typeof code === 'string') {
    if (['EIO', 'EREMOTEIO', 'EAGAIN', 'EBUSY', 'ECONNRESET', 'ENXIO', 'EPIPE'].includes(code)) {
      return true
    }
  }
  const msg = String(err?.message ?? err).toLowerCase()
  return (
    msg.includes('input/output error') ||
    msg.includes('-121') ||
    msg.includes('eremoteio') ||
    msg.includes('resource temporarily unavailable') ||
    msg.includes('resource busy')
  )
}

export function closeSerialSession() {
  if (activePort) {
    try {
      if (activePort.isOpen) activePort.close()
    } catch {
      /* ignore */
    }
  }
  activePort = null
  activeConfig = null
}

/**
 * Reset cached serial port when transport settings change.
 * @param {{ transport?: string, serial?: { baudRate?: number } }} cfg
 */
export function applyCentringTransportFromConfig(cfg) {
  closeSerialSession()
  if (cfg?.transport === 'serial') {
    const baudRate = Number(cfg?.serial?.baudRate ?? 115200)
    activeConfig = {
      path: (process.env.CENTRING_SERIAL_PATH || '').trim(),
      baudRate: Number.isFinite(baudRate) && baudRate >= 300 ? baudRate : 115200,
    }
  } else {
    activeConfig = null
  }
}

/**
 * @param {{ path: string, baudRate: number }} opts
 */
async function openSerialPort(opts) {
  if (!opts.path) {
    throw new Error('CENTRING_SERIAL_PATH is not set in server .env')
  }
  if (activePort?.isOpen && activeConfig?.path === opts.path && activeConfig?.baudRate === opts.baudRate) {
    return activePort
  }
  closeSerialSession()

  const port = new SerialPort({
    path: opts.path,
    baudRate: opts.baudRate,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    autoOpen: false,
  })

  await new Promise((resolve, reject) => {
    port.open(err => (err ? reject(err) : resolve()))
  })

  try {
    port.set({ dtr: false, rts: false })
  } catch {
    /* ignore — not all adapters support modem lines */
  }

  port.on('error', err => {
    console.warn(`[centring-serial] ${opts.path}: ${err.message}`)
    closeSerialSession()
  })

  activePort = port
  activeConfig = { path: opts.path, baudRate: opts.baudRate }
  await waitForBootReady(port, 3000)
  return port
}

/**
 * @param {import('serialport').SerialPort} port
 * @param {number} maxMs
 */
async function waitForBootReady(port, maxMs) {
  await new Promise(resolve => {
    let sawReady = false
    const onData = chunk => {
      const text = chunk.toString('ascii')
      if (/\bREADY\b/.test(text)) sawReady = true
    }
    port.on('data', onData)
    const timer = setTimeout(() => {
      port.off('data', onData)
      resolve()
    }, maxMs)
    const poll = setInterval(() => {
      if (sawReady) {
        clearInterval(poll)
        clearTimeout(timer)
        port.off('data', onData)
        resolve()
      }
    }, 30)
  })
  await sleep(100)
}

function matchLine(line, terminator, errTag) {
  const trimmed = line.trim()
  if (!trimmed || BOOT_LINES.has(trimmed)) return null
  if (terminator === 'ANY' || trimmed.startsWith(terminator)) return trimmed
  if (trimmed.startsWith('ERR')) {
    if (errTag && !trimmed.startsWith(`ERR ${errTag}`)) return null
    throw new Error(trimmed)
  }
  return null
}

/**
 * @param {import('serialport').SerialPort} port
 * @param {string} cmd
 * @param {string} terminator
 * @param {number} timeoutMs
 * @param {string | null} errTag
 */
async function readUntilReply(port, cmd, terminator, timeoutMs, errTag) {
  let rxBuf = ''
  const deadline = Date.now() + timeoutMs

  return new Promise((resolve, reject) => {
    const onData = chunk => {
      rxBuf += chunk.toString('ascii')
      let nl
      while ((nl = rxBuf.indexOf('\n')) !== -1) {
        const line = rxBuf.slice(0, nl).replace(/\r$/, '')
        rxBuf = rxBuf.slice(nl + 1)
        try {
          const matched = matchLine(line, terminator, errTag)
          if (matched != null) {
            cleanup()
            resolve(matched)
            return
          }
        } catch (err) {
          cleanup()
          reject(err)
          return
        }
      }
    }

    const timer = setInterval(() => {
      if (Date.now() >= deadline) {
        cleanup()
        reject(new Error(`timeout waiting for reply (cmd: "${cmd}")`))
      }
    }, 50)

    const onError = err => {
      cleanup()
      reject(err)
    }

    function cleanup() {
      clearInterval(timer)
      port.off('data', onData)
      port.off('error', onError)
    }

    port.on('data', onData)
    port.on('error', onError)
  })
}

/**
 * @param {string} cmd
 * @param {string} terminator
 * @param {number} timeoutMs
 * @param {string | null} [errTag]
 * @param {{ path: string, baudRate: number }} transport
 */
export async function serialTransact(cmd, terminator, timeoutMs, errTag, transport) {
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const port = await openSerialPort(transport)
      await new Promise((resolve, reject) => {
        port.write(`${cmd}\r\n`, err => (err ? reject(err) : resolve()))
      })
      return await readUntilReply(port, cmd, terminator, timeoutMs, errTag ?? null)
    } catch (err) {
      lastErr = err
      if (isTransientSerialError(err) && attempt < 2) {
        closeSerialSession()
        await sleep(150 * (attempt + 1))
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('serial transaction failed')
}

/**
 * @param {{ path: string, baudRate: number }} transport
 * @param {number} timeoutMs
 */
export async function probeSerialConnection(transport, timeoutMs = 8000) {
  const target = transport.path || '(CENTRING_SERIAL_PATH not set)'
  if (!transport.path) {
    return { ok: false, target, error: 'CENTRING_SERIAL_PATH not set' }
  }
  try {
    await serialTransact('PING', 'PONG', Math.min(timeoutMs, 3000), null, transport)
    return { ok: true, target: `${target} @ ${transport.baudRate}` }
  } catch (err) {
    closeSerialSession()
    return { ok: false, target, error: err?.message || String(err) }
  }
}
