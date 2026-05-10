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
 * @param {string} path
 * @param {'weld' | 'shrink'} which
 * @param {Buffer} data
 */
async function writePort(path, which, data) {
  const port = await getOpenPort(path, which)
  await new Promise((resolve, reject) => {
    port.write(data, err => (err ? reject(err) : resolve()))
  })
  await new Promise((resolve, reject) => {
    port.drain(err => (err ? reject(err) : resolve()))
  })
}

/**
 * Send the same reference string to both configured machines.
 * @param {string} referenceName canonical name from database
 * @returns {Promise<{ sentTo: string[], skipped: boolean }>}
 */
export async function broadcastReferenceToMachines(referenceName) {
  const w = weldPath()
  const sh = shrinkPath()
  const name = String(referenceName)

  const payloadW = Buffer.from(name + resolvedPort('weld').lineSuffix, 'utf8')
  const payloadS = Buffer.from(name + resolvedPort('shrink').lineSuffix, 'utf8')

  const sentTo = []
  const tasks = []

  if (w) {
    tasks.push(
      writePort(w, 'weld', payloadW)
        .then(() => {
          sentTo.push('weld')
        })
        .catch(err => {
          throw new Error(`welding serial (${w}): ${err.message}`)
        }),
    )
  }
  if (sh) {
    tasks.push(
      writePort(sh, 'shrink', payloadS)
        .then(() => {
          sentTo.push('shrink')
        })
        .catch(err => {
          throw new Error(`shrink serial (${sh}): ${err.message}`)
        }),
    )
  }

  await Promise.all(tasks)

  if (sentTo.length === 0) {
    console.warn('[reference-serial] No weld/shrink serial paths configured (settings or env) — broadcast skipped')
  }

  return { sentTo, skipped: sentTo.length === 0 }
}
