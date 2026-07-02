#!/usr/bin/env node
/**
 * Centring MASTER — policy + orchestration (bot host 192.168.10.1).
 *
 * Architecture (same model as pick_place_master.js):
 *   Master — TCP client, sole policy peer: homed/fault/estop/busy gates, config, recovery.
 *   Nano   — TCP server :8177, execution slave: motion/homing, limits, panel STOP/ESTOP.
 *
 * Wire protocol (Nano TCP :8177):
 *   PING STATUS STOP ESTOP CLRFAULT
 *   HOME HOME_UPPER HOME_LOWER SEEK_TRAVEL
 *   SETMECHOFF <mm>
 *   MOVEBOTHMM <h_mm> <deg/s>   MOVE_UPPERMM <h_mm> <deg/s>   MOVE_LOWERMM <h_mm> <deg/s>
 */

import fs from 'fs'
import net from 'net'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  normalizeMoveAxis,
  resolveGapMove,
  applyGap,
  loadGap,
  applyShrinkTubeGapPhase,
} from './centring_reference.js'
import { getModelHRangeMm, gapMmToMoveTarget } from './centring_height_model.js'
import {
  computeMechOffsetFromMeasurements,
  deriveMechOffsetFromHRange,
  effectiveHRangeFromOffset,
  getCalibrationInfo,
  MODEL_H_RANGE_MM,
} from './centring_calibration.js'
import {
  buildConnectionDiagnosis,
  formatDiagnosisReport,
  NANO_IP_DEFAULT,
  NANO_PORT_DEFAULT,
  subnetReachable,
} from './lib/network_diag.mjs'
import {
  applyCentringTransportFromConfig,
  closeSerialSession,
  probeSerialConnection,
  serialTransact,
} from './lib/centring_serial_transport.mjs'

export {
  normalizeMoveAxis,
  resolveGapMove,
  gapMmForCentringAxis,
  applyGap,
  loadGap,
  applyShrinkTubeGapPhase,
} from './centring_reference.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CONFIG_PATH = process.env.CENTRING_CONFIG_PATH
  || path.join(__dirname, 'data', 'centring_config.json')

const CONNECT_TIMEOUT = Number(process.env.CENTRING_CONNECT_TIMEOUT_MS || 8000)
const CONNECT_RETRIES = Number(process.env.CENTRING_CONNECT_RETRIES || 3)
const CONNECT_RETRY_MS = Number(process.env.CENTRING_CONNECT_RETRY_MS || 2000)
const CMD_TIMEOUT = 15000
const PING_TIMEOUT = 2000
const HOME_TIMEOUT_MS = 270000
const MOVE_TIMEOUT_MS = 120000
const STATUS_TIMEOUT = 8000
const POLL_INTERVAL = 200
const TCP_CMD_MAX_LEN = 79

export const DEFAULT_HRANGE_MM = getModelHRangeMm()

export const DEFAULT_CENTRING_TCP = {
  host: NANO_IP_DEFAULT,
  port: NANO_PORT_DEFAULT,
}

export const DEFAULT_CENTRING_SERIAL = {
  baudRate: 115200,
}

export const DEFAULT_CENTRING_CONFIG = {
  transport: 'tcp',
  tcp: { ...DEFAULT_CENTRING_TCP },
  serial: { ...DEFAULT_CENTRING_SERIAL },
  movementSpeedDegS: 45,
  homingSpeedDegS: 90,
  /** Fast servo speed for production shrink-tube gap moves (h_pre / h_post MOVEBOTHMM). */
  gapMoveSpeedDegS: 90,
  mechOffsetMm: 0,
  hRangeMm: { ...DEFAULT_HRANGE_MM },
}

let configCached = null
/** When set, load/save use SQLite (backend) instead of CONFIG_PATH JSON file. */
let externalConfigStore = null
let cmdSendChain = Promise.resolve()
let _reachable = false

export function registerCentringConfigStore(store) {
  externalConfigStore = store
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function validateHRangeMm(hRangeMm) {
  const src = hRangeMm && typeof hRangeMm === 'object' ? hRangeMm : {}
  const minRaw = src.min ?? DEFAULT_HRANGE_MM.min
  const maxRaw = src.max ?? DEFAULT_HRANGE_MM.max
  const min = Number(minRaw)
  const max = Number(maxRaw)
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('hRangeMm.min/max must be finite numbers (total mm)')
  }
  if (min > max) throw new Error('hRangeMm.min must be <= hRangeMm.max')
  return { min, max }
}

/** Master-side gap validation limits (defaults match firmware model band; override in centring_config.json). */
export function getEffectiveHRangeMm(cfg = getCentringConfig()) {
  return validateHRangeMm(cfg.hRangeMm)
}

export function getModelHeightRangeMm() {
  return { ...MODEL_H_RANGE_MM }
}

function resolveMechOffsetMm(raw) {
  if (raw && Object.prototype.hasOwnProperty.call(raw, 'mechOffsetMm') && raw.mechOffsetMm !== '') {
    const off = Number(raw.mechOffsetMm)
    if (!Number.isFinite(off)) throw new Error('mechOffsetMm must be a finite number')
    return off
  }
  if (raw?.hRangeMm) return deriveMechOffsetFromHRange(raw.hRangeMm)
  return 0
}

function validateSpeedDegS(value, label) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || n > 120) {
    throw new Error(`${label} must be 0.01–120`)
  }
  return n
}

function transportFromEnv() {
  const env = (process.env.CENTRING_TRANSPORT || '').trim().toLowerCase()
  if (env === 'serial' || env === 'tcp') return env
  return null
}

function validateTransport(value) {
  const fromEnv = transportFromEnv()
  if (fromEnv) return fromEnv
  const t = String(value || 'tcp').toLowerCase()
  return t === 'serial' ? 'serial' : 'tcp'
}

function validateTcpSettings(raw) {
  const src = raw?.tcp && typeof raw.tcp === 'object' ? raw.tcp : {}
  const envHost = process.env.CENTRING_HOST?.trim()
  const envPort = process.env.CENTRING_PORT
  const host = envHost || String(src.host || DEFAULT_CENTRING_TCP.host)
  const port = envPort != null && envPort !== ''
    ? Number(envPort)
    : Number(src.port ?? DEFAULT_CENTRING_TCP.port)
  if (!host) throw new Error('tcp.host is required')
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error('tcp.port must be 1–65535')
  }
  return { host, port }
}

function validateSerialSettings(raw) {
  const src = raw?.serial && typeof raw.serial === 'object' ? raw.serial : {}
  const envBaud = process.env.CENTRING_SERIAL_BAUD
  let baudRate = Number(src.baudRate ?? DEFAULT_CENTRING_SERIAL.baudRate)
  if (envBaud != null && envBaud !== '' && Number.isFinite(Number(envBaud))) {
    baudRate = Number(envBaud)
  }
  if (!Number.isFinite(baudRate) || baudRate < 300 || baudRate > 921600) {
    throw new Error('serial.baudRate must be 300–921600')
  }
  return { baudRate }
}

function validateConfig(raw) {
  const out = { ...DEFAULT_CENTRING_CONFIG, ...raw }
  const move = validateSpeedDegS(out.movementSpeedDegS, 'movementSpeedDegS')
  const home = validateSpeedDegS(out.homingSpeedDegS, 'homingSpeedDegS')
  const gap = validateSpeedDegS(
    out.gapMoveSpeedDegS ?? out.homingSpeedDegS ?? DEFAULT_CENTRING_CONFIG.gapMoveSpeedDegS,
    'gapMoveSpeedDegS',
  )
  const mechOffsetMm = resolveMechOffsetMm(raw)
  return {
    transport: validateTransport(out.transport),
    tcp: validateTcpSettings(raw ?? out),
    serial: validateSerialSettings(raw ?? out),
    movementSpeedDegS: move,
    homingSpeedDegS: home,
    gapMoveSpeedDegS: gap,
    mechOffsetMm,
    hRangeMm: effectiveHRangeFromOffset(mechOffsetMm),
  }
}

/** Resolved wire transport (config + env overrides). */
export function resolveTransportConfig(cfg = getCentringConfig()) {
  const fromEnv = transportFromEnv()
  const transport = fromEnv || (cfg.transport === 'serial' ? 'serial' : 'tcp')
  const envHost = process.env.CENTRING_HOST?.trim()
  const envPort = process.env.CENTRING_PORT
  const host = envHost || cfg.tcp?.host || DEFAULT_CENTRING_TCP.host
  const port = envPort != null && envPort !== ''
    ? Number(envPort)
    : Number(cfg.tcp?.port ?? DEFAULT_CENTRING_TCP.port)
  const envBaud = process.env.CENTRING_SERIAL_BAUD
  let baudRate = Number(cfg.serial?.baudRate ?? DEFAULT_CENTRING_SERIAL.baudRate)
  if (envBaud != null && envBaud !== '' && Number.isFinite(Number(envBaud))) {
    baudRate = Number(envBaud)
  }
  const serialPath = (process.env.CENTRING_SERIAL_PATH || '').trim()
  const target = transport === 'serial'
    ? (serialPath ? `${serialPath} @ ${baudRate}` : '(CENTRING_SERIAL_PATH not set)')
    : `${host}:${port}`
  return {
    transport,
    host,
    port,
    baudRate,
    serialPath,
    serialPathConfigured: !!serialPath,
    target,
  }
}

export { applyCentringTransportFromConfig, closeSerialSession }

/** Servo deg/s for shrink-tube h_pre / h_post (MOVEBOTHMM). Env CENTRING_GAP_MOVE_SPEED_DEG_S overrides config. */
export function getGapMoveSpeedDegS(cfg = getCentringConfig()) {
  const env = Number(process.env.CENTRING_GAP_MOVE_SPEED_DEG_S)
  if (Number.isFinite(env) && env > 0) {
    return validateSpeedDegS(Math.min(env, 120), 'CENTRING_GAP_MOVE_SPEED_DEG_S')
  }
  return validateSpeedDegS(
    cfg.gapMoveSpeedDegS ?? cfg.homingSpeedDegS ?? DEFAULT_CENTRING_CONFIG.gapMoveSpeedDegS,
    'gapMoveSpeedDegS',
  )
}

export function loadCentringConfig() {
  if (externalConfigStore) {
    try {
      configCached = validateConfig(externalConfigStore.load())
      applyCentringTransportFromConfig(configCached)
      return { ...configCached, tcp: { ...configCached.tcp }, serial: { ...configCached.serial }, hRangeMm: { ...configCached.hRangeMm } }
    } catch (err) {
      console.warn('[centring] config load failed:', err.message)
    }
  } else {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        configCached = validateConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')))
        applyCentringTransportFromConfig(configCached)
        return { ...configCached, tcp: { ...configCached.tcp }, serial: { ...configCached.serial }, hRangeMm: { ...configCached.hRangeMm } }
      }
    } catch (err) {
      console.warn('[centring] config load failed:', err.message)
    }
  }
  configCached = validateConfig({ ...DEFAULT_CENTRING_CONFIG })
  applyCentringTransportFromConfig(configCached)
  return { ...configCached, tcp: { ...configCached.tcp }, serial: { ...configCached.serial }, hRangeMm: { ...configCached.hRangeMm } }
}

export function getCentringConfig() {
  return configCached ? { ...configCached } : loadCentringConfig()
}

export function saveCentringConfig(cfg) {
  configCached = validateConfig(cfg)
  if (externalConfigStore) {
    configCached = validateConfig(externalConfigStore.save(configCached))
  } else {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configCached, null, 2))
  }
  applyCentringTransportFromConfig(configCached)
  return {
    ...configCached,
    tcp: { ...configCached.tcp },
    serial: { ...configCached.serial },
    hRangeMm: { ...configCached.hRangeMm },
  }
}

export function getConfigPath() {
  if (externalConfigStore) return externalConfigStore.path()
  return CONFIG_PATH
}

function validateCmd(cmd) {
  if (!cmd || cmd.length > TCP_CMD_MAX_LEN) {
    throw new Error(`command exceeds ${TCP_CMD_MAX_LEN} chars`)
  }
}

function parseKvLine(line) {
  const out = {}
  for (const part of line.split(/\s+/)) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return out
}

function flag(kv, key) {
  return kv[key] === '1'
}

function mapFirmwareStatus(kv) {
  const homedUpper = flag(kv, 'homedUpper')
  const homedLower = flag(kv, 'homedLower')
  const busy = flag(kv, 'busy')
  const fault = flag(kv, 'fault')
  const estop = flag(kv, 'estop')
  const homing = Number(kv.homeSt || 0) !== 0
  const asyncCmd = Number(kv.async || 0)
  return {
    u: Number(kv.u),
    l: Number(kv.l),
    h: Number(kv.h),
    hMin: kv.hmin != null ? Number(kv.hmin) : null,
    hMax: kv.hmax != null ? Number(kv.hmax) : null,
    mechOff: kv.mechOff != null ? Number(kv.mechOff) : null,
    busy,
    homeSt: Number(kv.homeSt || 0),
    homedUpper,
    homedLower,
    homedU: homedUpper,
    homedL: homedLower,
    homing,
    homeFail: fault,
    fault,
    estop,
    ready: homedUpper && homedLower && !busy && !fault && !estop,
    asyncCmd,
    raw: kv,
  }
}

function parseDoneLine(line) {
  const kv = parseKvLine(line)
  const tag = line.split(/\s+/)[1]
  const homedUpper = flag(kv, 'homedUpper')
  const homedLower = flag(kv, 'homedLower')
  return {
    tag,
    u: Number(kv.u),
    l: Number(kv.l),
    h: Number(kv.h),
    homedUpper,
    homedLower,
    homedU: homedUpper,
    homedL: homedLower,
    pu: Number(kv.pu),
    pl: Number(kv.pl),
    raw: line,
  }
}

function connectErrorMessage(cause) {
  const t = resolveTransportConfig()
  if (t.transport === 'serial') {
    const base = `Serial connect failed (${t.target})`
    const hint = [
      'Verify Nano is powered and flashed with centring_nano_motor (USB serial 115200).',
      'Set CENTRING_SERIAL_PATH in server .env (prefer /dev/serial/by-path/... for stable naming).',
      'Close PlatformIO monitor or other apps holding the port.',
    ].join(' ')
    return cause ? `${base}: ${cause}. ${hint}` : `${base}. ${hint}`
  }
  const base = `TCP connect failed (${t.target})`
  const hint = [
    'Verify Nano is powered and flashed with centring_nano firmware (Ethernet TCP 8177).',
    'Bot/master must be on 192.168.10.0/24 (typically 192.168.10.1); centring Nano is 192.168.10.55.',
    'From bot: ping 192.168.10.55  then  nc -zv 192.168.10.55 8177.',
    'Check ENC28J60 cable, switch, and power.',
    'Override host: CENTRING_HOST / CENTRING_PORT env on us-machine-headless-web.service.',
  ].join(' ')
  return cause ? `${base}: ${cause}. ${hint}` : `${base}. ${hint}`
}

function tcpTransact(cmd, terminator, timeout, errTag = null) {
  const { host, port } = resolveTransportConfig()
  return new Promise((resolve, reject) => {
    validateCmd(cmd)
    const sock = new net.Socket()
    let rxBuf = ''
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { sock.destroy() } catch { /* ignore */ }
      fn(value)
    }
    const timer = setTimeout(() => {
      finish(reject, new Error(`timeout waiting for reply (cmd: "${cmd}")`))
    }, timeout)

    sock.on('error', err => finish(reject, new Error(connectErrorMessage(err.message))))
    sock.on('data', chunk => {
      rxBuf += chunk.toString('ascii')
      let nl
      while ((nl = rxBuf.indexOf('\n')) !== -1) {
        const line = rxBuf.slice(0, nl).replace(/\r$/, '')
        rxBuf = rxBuf.slice(nl + 1)
        if (terminator === 'ANY' || line.startsWith(terminator)) {
          finish(resolve, line)
          return
        }
        if (line.startsWith('ERR')) {
          if (errTag && !line.startsWith(`ERR ${errTag}`)) continue
          finish(reject, new Error(line.trim()))
          return
        }
      }
    })
    sock.on('close', () => {
      if (!settled) finish(reject, new Error(`TCP closed before reply (cmd: "${cmd}")`))
    })

    const connectTimer = setTimeout(() => {
      finish(reject, new Error(connectErrorMessage('connect timeout')))
    }, CONNECT_TIMEOUT)

    sock.connect(port, host, () => {
      clearTimeout(connectTimer)
      try { sock.setNoDelay(true) } catch { /* ignore */ }
      sock.write(cmd + '\n')
    })
  })
}

function wireTransact(cmd, terminator, timeout, errTag = null) {
  const t = resolveTransportConfig()
  if (t.transport === 'serial') {
    return serialTransact(cmd, terminator, timeout, errTag, {
      path: t.serialPath,
      baudRate: t.baudRate,
    })
  }
  return tcpTransact(cmd, terminator, timeout, errTag)
}

async function sendCommand(cmd, terminator = 'OK', timeout = CMD_TIMEOUT, errTag = null) {
  const p = cmdSendChain.then(() => wireTransact(cmd, terminator, timeout, errTag))
  cmdSendChain = p.catch(() => {})
  return p
}

async function sendAsyncCommand(cmd, timeoutMs, opts = {}) {
  const tag = cmd.split(/\s+/)[0]
  const { busyRetries = 3, busyWaitMs = 60000 } = opts
  for (let attempt = 0; attempt < busyRetries; attempt++) {
    try {
      if (attempt > 0) await waitIdle(Math.min(busyWaitMs, timeoutMs))
      const line = await sendCommand(cmd, `DONE ${tag}`, timeoutMs, tag)
      return parseDoneLine(line.trim())
    } catch (err) {
      if (String(err.message).includes(' busy') && attempt < busyRetries - 1) continue
      throw err
    }
  }
  throw new Error(`${cmd} failed after retries`)
}

async function readStatusRaw() {
  try {
    const line = await sendCommand('STATUS', 'u=', STATUS_TIMEOUT)
    return mapFirmwareStatus(parseKvLine(line))
  } catch {
    return null
  }
}

export async function probeConnection(timeoutMs = CONNECT_TIMEOUT) {
  const t = resolveTransportConfig()
  if (t.transport === 'serial') {
    return probeSerialConnection({ path: t.serialPath, baudRate: t.baudRate }, timeoutMs)
  }
  const { host, port } = t
  return new Promise(resolve => {
    const sock = new net.Socket()
    const timer = setTimeout(() => {
      sock.destroy()
      resolve({ ok: false, target: `${host}:${port}`, error: 'timeout' })
    }, timeoutMs)
    sock.once('error', err => {
      clearTimeout(timer)
      sock.destroy()
      resolve({ ok: false, target: `${host}:${port}`, error: err.message })
    })
    sock.connect(port, host, () => {
      clearTimeout(timer)
      sock.end()
      resolve({ ok: true, target: `${host}:${port}` })
    })
  })
}

export { formatDiagnosisReport, NANO_IP_DEFAULT, NANO_PORT_DEFAULT }

export async function diagnoseConnection(host, port) {
  const t = resolveTransportConfig()
  if (t.transport === 'serial') {
    const probe = await probeConnection(CONNECT_TIMEOUT)
    return {
      ok: probe.ok,
      transport: 'serial',
      target: t.target,
      serialPathConfigured: t.serialPathConfigured,
      probeError: probe.error || null,
    }
  }
  const resolvedHost = host ?? t.host
  const resolvedPort = port ?? t.port
  const subnet = subnetReachable(resolvedHost)
  let probe = { ok: false, error: subnet.ok ? 'not probed' : 'subnet mismatch' }
  if (subnet.ok) {
    probe = await probeConnection(CONNECT_TIMEOUT)
  }
  return buildConnectionDiagnosis(resolvedHost, resolvedPort, probe, subnet)
}

export function setReachable(value) {
  _reachable = !!value
}

export function isReachable() {
  return _reachable
}

export function isConnected() {
  return _reachable
}

export function getConnectionInfo() {
  const t = resolveTransportConfig()
  const sessionMode = t.transport === 'serial' ? 'persistent-serial' : 'request-response'
  return {
    role: 'master',
    slaveTarget: t.target,
    target: t.target,
    host: t.transport === 'tcp' ? t.host : undefined,
    port: t.transport === 'tcp' ? t.port : undefined,
    serialPath: t.transport === 'serial' ? (t.serialPath || null) : undefined,
    serialPathConfigured: t.serialPathConfigured,
    baudRate: t.transport === 'serial' ? t.baudRate : undefined,
    transport: t.transport,
    protocol: 'centring-dual-servo',
    sessionMode,
    connectTimeoutMs: CONNECT_TIMEOUT,
    connectRetries: CONNECT_RETRIES,
    connectRetryMs: CONNECT_RETRY_MS,
    cmdMaxLen: TCP_CMD_MAX_LEN,
    homing: { timeoutMs: HOME_TIMEOUT_MS, curlMaxTimeSec: Math.ceil(HOME_TIMEOUT_MS / 1000) },
    move: { timeoutMs: MOVE_TIMEOUT_MS },
  }
}

export async function ping() {
  const line = await sendCommand('PING', 'PONG', PING_TIMEOUT)
  return line.trim() === 'PONG'
}

export async function status() {
  return readStatusRaw()
}

export async function stop() {
  const line = await sendCommand('STOP', 'ANY', CMD_TIMEOUT)
  if (line.startsWith('ERR')) throw new Error(line.trim())
  return line.trim()
}

export async function emergencyStop() {
  const line = await sendCommand('ESTOP', 'ANY', CMD_TIMEOUT)
  if (line.startsWith('ERR')) throw new Error(line.trim())
  return line.trim()
}

export async function clearFault() {
  const line = await sendCommand('CLRFAULT', 'OK CLRFAULT', CMD_TIMEOUT)
  const st = await readStatusRaw()
  return { ok: true, reply: line.trim(), status: st }
}

export async function recover() {
  return clearFault()
}

export async function connectWithRetry() {
  let lastErr = 'unreachable'
  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
    const probe = await probeConnection()
    if (probe.ok) {
      await ping()
      setReachable(true)
      return
    }
    lastErr = probe.error || lastErr
    if (attempt < CONNECT_RETRIES) await sleep(CONNECT_RETRY_MS)
  }
  setReachable(false)
  throw new Error(connectErrorMessage(lastErr))
}

export async function waitIdle(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const s = await readStatusRaw()
    if (!s) { await sleep(POLL_INTERVAL); continue }
    if (s.estop) throw new Error('e-stop latched')
    if (s.fault) throw new Error('fault latched')
    if (!s.homing && s.asyncCmd === 0 && !s.busy) return s
    await sleep(POLL_INTERVAL)
  }
  throw new Error(`timeout waiting for idle (${timeoutMs}ms)`)
}

async function assertCanHome() {
  const s = await readStatusRaw()
  if (!s) throw new Error('home blocked: STATUS unavailable')
  if (s.estop) throw new Error('home blocked: e-stop latched')
  if (s.fault) throw new Error('home blocked: fault latched')
  if (s.homing) throw new Error('home blocked: homing in progress')
  if (s.busy) throw new Error('home blocked: motion in progress')
  if (s.asyncCmd) throw new Error('home blocked: async command active')
}

async function assertCanMove(axes = 'both') {
  const s = await readStatusRaw()
  if (!s) throw new Error('move blocked: STATUS unavailable')
  if (s.estop) throw new Error('move blocked: e-stop latched')
  if (s.fault) throw new Error('move blocked: fault latched')
  if (s.homing) throw new Error('move blocked: homing in progress')
  if (s.busy) throw new Error('move blocked: motion in progress')
  if (s.asyncCmd) throw new Error('move blocked: async command active')
  if (axes !== 'lower' && !s.homedUpper) throw new Error('move blocked: upper not homed')
  if (axes !== 'upper' && !s.homedLower) throw new Error('move blocked: lower not homed')
  return s
}

function normalizeAxis(axis) {
  const a = String(axis || 'both').toLowerCase()
  if (a === 'both' || a === 'upper' || a === 'lower') return a
  throw new Error(`invalid axis "${axis}" (use both, upper, or lower)`)
}

function assertHInRange(hMm, cfg = getCentringConfig()) {
  const h = Number(hMm)
  if (!Number.isFinite(h)) throw new Error('h must be a finite number (mm)')
  const range = getEffectiveHRangeMm(cfg)
  if (h < range.min || h > range.max) {
    throw new Error(`h ${h} mm outside band ${range.min}–${range.max} mm`)
  }
  return h
}

export async function homeBoth(opts = {}) {
  await assertCanHome()
  return sendAsyncCommand('HOME', opts.timeoutMs || HOME_TIMEOUT_MS)
}

export async function homeUpper(opts = {}) {
  await assertCanHome()
  return sendAsyncCommand('HOME_UPPER', opts.timeoutMs || HOME_TIMEOUT_MS)
}

export async function homeLower(opts = {}) {
  await assertCanHome()
  return sendAsyncCommand('HOME_LOWER', opts.timeoutMs || HOME_TIMEOUT_MS)
}

export async function seekTravelBoth(opts = {}) {
  await assertCanMove('both')
  return sendAsyncCommand('SEEK_TRAVEL', opts.timeoutMs || MOVE_TIMEOUT_MS)
}

/**
 * Move active axis/axes to travel-limit idle position after homing.
 * Both: firmware SEEK_TRAVEL (travel switches). Single axis: MOVE_*MM to travel gap.
 */
export async function seekTravelByAxis(axis = 'both', opts = {}) {
  const ax = normalizeAxis(axis)
  if (ax === 'both') {
    return seekTravelBoth(opts)
  }
  await assertCanMove(ax)
  const range = getEffectiveHRangeMm()
  const travelGapMm = range.max / 2
  return moveTo(travelGapMm, opts.speedDegS, ax)
}

export async function setMechOffsetMm(offsetMm) {
  const off = Number(offsetMm)
  if (!Number.isFinite(off)) throw new Error('setMechOffsetMm: offset must be finite')
  const line = await sendCommand(`SETMECHOFF ${formatWireNum(off)}`, 'OK SETMECHOFF', CMD_TIMEOUT)
  return line.trim()
}

/** Step 1: drive to home switches (HOME). Operator measures gap at home position. */
export async function calibrateSeekHome(opts = {}) {
  const done = await homeBoth(opts)
  const st = await status()
  return {
    done,
    status: st,
    modelGapMm: MODEL_H_RANGE_MM.max,
    position: 'home',
  }
}

/** Step 2: drive to travel switches (SEEK_TRAVEL). Operator measures gap at closed position. */
export async function calibrateSeekTravel(opts = {}) {
  const done = await seekTravelBoth(opts)
  const st = await status()
  return {
    done,
    status: st,
    modelGapMm: MODEL_H_RANGE_MM.min,
    position: 'travel',
  }
}

/**
 * Step 3: compute uniform offset from two measurements and persist to config + Nano.
 * Example: model 0/67.6, measured -2/65.6 → mechOffsetMm = -2.
 */
export async function applyMechCalibration({ measuredHomeMm, measuredClosedMm, pushToNano = true } = {}) {
  const mechOffsetMm = computeMechOffsetFromMeasurements({ measuredHomeMm, measuredClosedMm })
  const cfg = saveCentringConfig({ ...getCentringConfig(), mechOffsetMm })
  if (pushToNano) await setMechOffsetMm(mechOffsetMm)
  return {
    mechOffsetMm,
    hRangeMm: cfg.hRangeMm,
    calibration: getCalibrationInfo(mechOffsetMm),
  }
}

export function getCentringCalibrationInfo(cfg = getCentringConfig()) {
  return getCalibrationInfo(cfg.mechOffsetMm)
}

export {
  computeMechOffsetFromMeasurements,
  effectiveHRangeFromOffset,
  getCalibrationInfo,
  MODEL_H_RANGE_MM,
} from './centring_calibration.js'

function formatWireNum(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) throw new Error('invalid number')
  return String(Math.round(v * 1000) / 1000)
}

export async function homeByAxis(axis = 'both', opts = {}) {
  const ax = normalizeAxis(axis)
  if (ax === 'upper') return homeUpper(opts)
  if (ax === 'lower') return homeLower(opts)
  return homeBoth(opts)
}

function assertMoveReachable(hMm, moveCommand, status, cfg = getCentringConfig()) {
  try {
    gapMmToMoveTarget({
      gapMm: hMm,
      moveCommand,
      uNow: status.u,
      lNow: status.l,
      mechOffsetMm: cfg.mechOffsetMm,
    })
  } catch (err) {
    throw new Error(`${moveCommand} ${hMm} mm unreachable at u=${status.u} l=${status.l}: ${err.message}`)
  }
}

export async function moveBoth(hMm, speedDegS) {
  const cfg = getCentringConfig()
  const s = await assertCanMove('both')
  const h = assertHInRange(hMm, cfg)
  assertMoveReachable(h, 'MOVEBOTHMM', s, cfg)
  const spd = speedDegS ?? cfg.movementSpeedDegS
  return sendAsyncCommand(`MOVEBOTHMM ${formatWireNum(h)} ${formatWireNum(spd)}`, MOVE_TIMEOUT_MS)
}

export async function moveUpper(hMm, speedDegS) {
  const cfg = getCentringConfig()
  const s = await assertCanMove('upper')
  const h = assertHInRange(hMm, cfg)
  assertMoveReachable(h, 'MOVE_UPPERMM', s, cfg)
  const spd = speedDegS ?? cfg.movementSpeedDegS
  return sendAsyncCommand(`MOVE_UPPERMM ${formatWireNum(h)} ${formatWireNum(spd)}`, MOVE_TIMEOUT_MS)
}

export async function moveLower(hMm, speedDegS) {
  const cfg = getCentringConfig()
  const s = await assertCanMove('lower')
  const h = assertHInRange(hMm, cfg)
  assertMoveReachable(h, 'MOVE_LOWERMM', s, cfg)
  const spd = speedDegS ?? cfg.movementSpeedDegS
  return sendAsyncCommand(`MOVE_LOWERMM ${formatWireNum(h)} ${formatWireNum(spd)}`, MOVE_TIMEOUT_MS)
}

export async function moveTo(hMm, speedDegS, axis = 'both') {
  const ax = normalizeAxis(axis)
  const cfg = getCentringConfig()
  const spd = speedDegS ?? cfg.movementSpeedDegS
  if (ax === 'upper') return moveUpper(hMm, spd)
  if (ax === 'lower') return moveLower(hMm, spd)
  return moveBoth(hMm, spd)
}

loadCentringConfig()

export default {
  ping,
  status,
  stop,
  emergencyStop,
  clearFault,
  recover,
  homeBoth,
  homeUpper,
  homeLower,
  homeByAxis,
  seekTravelBoth,
  seekTravelByAxis,
  setMechOffsetMm,
  calibrateSeekHome,
  calibrateSeekTravel,
  applyMechCalibration,
  getCentringCalibrationInfo,
  moveBoth,
  moveUpper,
  moveLower,
  moveTo,
  connectWithRetry,
  waitIdle,
  probeConnection,
  diagnoseConnection,
  getConnectionInfo,
  isReachable,
  isConnected,
  setReachable,
  loadCentringConfig,
  getCentringConfig,
  saveCentringConfig,
  getConfigPath,
  normalizeMoveAxis,
  resolveGapMove,
  applyGap,
  loadGap,
  applyShrinkTubeGapPhase,
  DEFAULT_HRANGE_MM,
  getEffectiveHRangeMm,
  getGapMoveSpeedDegS,
  getModelHeightRangeMm,
  computeMechOffsetFromMeasurements,
  effectiveHRangeFromOffset,
  getCalibrationInfo,
  MODEL_H_RANGE_MM,
  resolveTransportConfig,
  applyCentringTransportFromConfig,
}
