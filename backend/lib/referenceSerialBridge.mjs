/**
 * Fan-out product reference string to ultrasonic welding + shrink machines over USB serial
 * (e.g. FTDI FT232). Payload: UTF-8 text + line ending per port.
 *
 * Settings: SQLite `system_settings.reference_serial` (normalized in db.mjs) for port options.
 * Device paths are **only** from `REFERENCE_SERIAL_WELD_PATH` / `REFERENCE_SERIAL_SHRINK_PATH` (env), not the DB.
 */

import { SerialPort } from 'serialport'
import { normalizeReferenceSerial } from './db.mjs'

/** @type {Map<string, import('serialport').SerialPort>} */
const portCache = new Map()

/** @type {null | ReturnType<typeof normalizeReferenceSerial>} */
let settingsOverride = null

/** @param {unknown} v */
function optionalBaud(v) {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  if (Number.isFinite(n) && n >= 300) return n
  return undefined
}

const SERIAL_RETRY_ATTEMPTS = 3
const SERIAL_RETRY_BACKOFF_MS = [150, 300]

/** @param {number} ms */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * True for intermittent USB-serial faults that a reopen/retry can recover
 * (e.g. CH340 `-121`/EREMOTEIO modem-status glitch). Permanent errors such as
 * bad baud or EACCES return false so we fail fast.
 * @param {unknown} err
 */
function isTransientSerialError(err) {
  const code = /** @type {{ code?: unknown }} */ (err)?.code
  if (typeof code === 'string') {
    if (['EIO', 'EREMOTEIO', 'EAGAIN', 'EBUSY', 'ECONNRESET', 'ENXIO', 'EPIPE'].includes(code)) {
      return true
    }
  }
  const msg = String(/** @type {{ message?: unknown }} */ (err)?.message ?? err).toLowerCase()
  return (
    msg.includes('input/output error') ||
    msg.includes('-121') ||
    msg.includes('eremoteio') ||
    msg.includes('resource temporarily unavailable') ||
    msg.includes('resource busy') ||
    (msg.includes('cannot open') && msg.includes('error'))
  )
}

/**
 * Call on startup and after saving Hardware → Serial communication.
 * @param {unknown} ref — `reference_serial` from system_settings JSON
 */
export function setReferenceSerialFromSettings(ref) {
  for (const [, p] of portCache) {
    try {
      if (p.isOpen) p.close()
    } catch {
      /* ignore */
    }
  }
  portCache.clear()

  if (!ref || typeof ref !== 'object') {
    settingsOverride = null
    return
  }
  settingsOverride = normalizeReferenceSerial(/** @type {object} */ (ref))
}

function weldPath() {
  return (process.env.REFERENCE_SERIAL_WELD_PATH || '').trim()
}

function shrinkPath() {
  return (process.env.REFERENCE_SERIAL_SHRINK_PATH || '').trim()
}

/**
 * Resolved open options + suffix for one logical port.
 * @param {'weld' | 'shrink'} which
 */
function resolvedPort(which) {
  const o = settingsOverride
  const nested = which === 'weld' ? o?.weld : o?.shrink
  const legacyBaud =
    optionalBaud(which === 'weld' ? o?.weld_baud : o?.shrink_baud) ?? optionalBaud(o?.baud)
  const envSpecific = which === 'weld' ? process.env.REFERENCE_SERIAL_WELD_BAUD : process.env.REFERENCE_SERIAL_SHRINK_BAUD
  const baudRate =
    optionalBaud(nested?.baudRate) ??
    legacyBaud ??
    (envSpecific && Number.isFinite(Number(envSpecific)) && Number(envSpecific) >= 300
      ? Number(envSpecific)
      : undefined) ??
    Number(process.env.REFERENCE_SERIAL_BAUD || 9600)

  let bufferSize = Number(nested?.bufferSize)
  if (!Number.isFinite(bufferSize) || bufferSize < 16) bufferSize = 255

  const dataBits = nested?.dataBits === 7 ? 7 : 8
  const flowControl = nested?.flowControl === 'hardware' ? 'hardware' : 'none'
  const parity = nested?.parity === 'even' || nested?.parity === 'odd' ? nested.parity : 'none'
  const stopBits = nested?.stopBits === 2 ? 2 : 1

  const leKey = which === 'weld' ? 'weld_line_ending' : 'shrink_line_ending'
  const envLe =
    which === 'weld' ? process.env.REFERENCE_SERIAL_WELD_LINE_ENDING : process.env.REFERENCE_SERIAL_SHRINK_LINE_ENDING
  const rawLe = String(
    nested?.lineEnding ?? o?.[leKey] ?? o?.line_ending ?? envLe ?? process.env.REFERENCE_SERIAL_LINE_ENDING ?? 'CRLF',
  ).toUpperCase()
  let lineSuffix = '\r\n'
  if (rawLe === 'LF') lineSuffix = '\n'
  else if (rawLe === 'CR') lineSuffix = '\r'
  else if (rawLe === 'NONE' || rawLe === '') lineSuffix = ''

  return {
    baudRate,
    bufferSize,
    dataBits,
    flowControl,
    parity,
    stopBits,
    lineSuffix,
  }
}

/**
 * Close (best-effort) and remove a cached port so the next open is a fresh handle.
 * @param {string} cacheKey
 */
function evictPort(cacheKey) {
  const p = portCache.get(cacheKey)
  if (p) {
    try {
      if (p.isOpen) p.close()
    } catch {
      /* ignore */
    }
  }
  portCache.delete(cacheKey)
}

/**
 * @param {string} path
 * @param {'weld' | 'shrink'} which
 */
async function getOpenPort(path, which) {
  const cacheKey = `${path}:${which}`
  let p = portCache.get(cacheKey)
  if (p?.isOpen) return p

  const ro = resolvedPort(which)
  if (!Number.isFinite(ro.baudRate) || ro.baudRate < 300) {
    throw new Error('invalid serial baud rate')
  }

  p = new SerialPort({
    path,
    baudRate: ro.baudRate,
    dataBits: ro.dataBits,
    stopBits: ro.stopBits,
    parity: ro.parity,
    rtscts: ro.flowControl === 'hardware',
    highWaterMark: ro.bufferSize,
    autoOpen: false,
  })

  await new Promise((resolve, reject) => {
    p.open(err => {
      if (err) return reject(err)
      resolve()
    })
  })

  portCache.set(cacheKey, p)
  p.on('error', err => {
    console.error(`[reference-serial] ${path}: ${err.message}`)
    try {
      p.close()
    } catch {
      /* ignore */
    }
    portCache.delete(cacheKey)
  })
  return p
}

/**
 * Open the port (if needed) and write+drain once.
 * @param {string} path
 * @param {'weld' | 'shrink'} which
 * @param {Buffer} data
 */
async function writePortOnce(path, which, data) {
  const port = await getOpenPort(path, which)
  await new Promise((resolve, reject) => {
    port.write(data, err => (err ? reject(err) : resolve()))
  })
  await new Promise((resolve, reject) => {
    port.drain(err => (err ? reject(err) : resolve()))
  })
}

/**
 * Write with retry/backoff for transient USB-serial glitches. A reference broadcast
 * is just the name string (idempotent for the receiving machine), so a retry that
 * re-sends after a partial failure is harmless. Each retry evicts the cached handle
 * so the port is reopened fresh.
 * @param {string} path
 * @param {'weld' | 'shrink'} which
 * @param {Buffer} data
 */
async function writePort(path, which, data) {
  const cacheKey = `${path}:${which}`
  let lastErr
  for (let attempt = 0; attempt < SERIAL_RETRY_ATTEMPTS; attempt++) {
    try {
      await writePortOnce(path, which, data)
      return
    } catch (err) {
      lastErr = err
      if (!isTransientSerialError(err)) throw err
      evictPort(cacheKey)
      if (attempt < SERIAL_RETRY_ATTEMPTS - 1) {
        const backoff = SERIAL_RETRY_BACKOFF_MS[attempt] ?? SERIAL_RETRY_BACKOFF_MS[SERIAL_RETRY_BACKOFF_MS.length - 1]
        console.warn(
          `[reference-serial] ${path} (${which}) transient I/O error (attempt ${attempt + 1}/${SERIAL_RETRY_ATTEMPTS}): ${
            /** @type {{ message?: string }} */ (err)?.message ?? err
          } — retrying in ${backoff}ms`,
        )
        await delay(backoff)
      }
    }
  }
  throw lastErr
}

/**
 * Send the same reference string to configured machines.
 *
 * Each port is attempted independently: one port failing (e.g. a flaky CH340
 * USB glitch) never aborts the other, and never throws. Per-port failures are
 * returned in `failed` so the caller can surface a non-blocking warning while
 * the reference itself stays loaded.
 *
 * @param {string} referenceName canonical name from database
 * @param {{ weld?: boolean, shrink?: boolean }} [options] per-reference enable flags (default both true)
 * @returns {Promise<{ sentTo: string[], failed: Array<{ port: 'weld' | 'shrink', path: string, message: string }>, skipped: boolean }>}
 */
export async function broadcastReferenceToMachines(referenceName, options = {}) {
  const weldEnabled = options.weld !== false
  const shrinkEnabled = options.shrink !== false
  const w = weldPath()
  const sh = shrinkPath()
  const name = String(referenceName)

  const payloadW = Buffer.from(name + resolvedPort('weld').lineSuffix, 'utf8')
  const payloadS = Buffer.from(name + resolvedPort('shrink').lineSuffix, 'utf8')

  /** @type {string[]} */
  const sentTo = []
  /** @type {Array<{ port: 'weld' | 'shrink', path: string, message: string }>} */
  const failed = []

  /**
   * @param {'weld' | 'shrink'} which
   * @param {string} path
   * @param {Buffer} payload
   */
  const send = async (which, path, payload) => {
    try {
      await writePort(path, which, payload)
      sentTo.push(which)
    } catch (err) {
      const reason = /** @type {{ message?: string }} */ (err)?.message ?? String(err)
      const message = isTransientSerialError(err)
        ? `USB serial glitch on ${which} (${path}): ${reason} — retried ${SERIAL_RETRY_ATTEMPTS}x`
        : `${which} serial (${path}): ${reason}`
      console.error(`[reference-serial] ${message}`)
      failed.push({ port: which, path, message })
    }
  }

  const tasks = []
  if (w && weldEnabled) tasks.push(send('weld', w, payloadW))
  if (sh && shrinkEnabled) tasks.push(send('shrink', sh, payloadS))

  await Promise.all(tasks)

  const skipped = sentTo.length === 0 && failed.length === 0
  if (skipped) {
    console.warn('[reference-serial] No weld/shrink serial paths configured (settings or env) — broadcast skipped')
  }

  return { sentTo, failed, skipped }
}
