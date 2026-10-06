#!/usr/bin/env node
/**
 * Centring MASTER — TCP client for Double_Actuator_Centring_Slave_Firmware.
 *
 * Contract:
 *   Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/MASTER_CONTROL.md
 *   Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/TCP_MASTER_SLAVE.md
 *   Master 192.168.10.1 → Slave 192.168.10.55:8177
 *   Connect banner READY + PING + live STATUS on every accept
 *   One socket. A dropped socket is opened again until the Nano answers.
 *   KILL is flushed before destroy. Reconnect does not send KILL.
 *   Cal is RAM-only — Master persists slaveCal and restores with SETCAL
 *   MOVE gate: cal=1; HOME success: moveEnd=ok
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
import { DEFAULT_HEIGHT_CURVE, getModelHRangeMm, gapMmToMoveTarget } from './centring_height_model.js'
import { initializeCentring } from '../centringV2/initialize.mjs'
import { singleAxisRefusal } from '../centringV2/production.mjs'
import { validateCentringV2Recipe } from '../centringV2/recipeGate.mjs'
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
  resolveTcpLocalAddress,
} from './lib/network_diag.mjs'

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

const CONNECT_TIMEOUT = Number(process.env.CENTRING_CONNECT_TIMEOUT_MS || 5000)
const CONNECT_RETRIES = Number(process.env.CENTRING_CONNECT_RETRIES || 3)
const CONNECT_RETRY_MS = Number(process.env.CENTRING_CONNECT_RETRY_MS || 2000)
const STATUS_TIMEOUT = Number(process.env.CENTRING_STATUS_TIMEOUT_MS || 5000)
/** FW HOME/CAL/MOVE budgets are 60 s — allow small host margin. */
const HOME_TIMEOUT_MS = Number(process.env.CENTRING_HOME_TIMEOUT_MS || 70000)
const MOVE_TIMEOUT_MS = Number(process.env.CENTRING_MOVE_TIMEOUT_MS || 70000)
const PING_TIMEOUT = Number(process.env.CENTRING_PING_TIMEOUT_MS || 5000)
const POLL_INTERVAL = 200
const TCP_CMD_MAX_LEN = 128
const MOVE_TOL_MM = Number(process.env.CENTRING_MOVE_TOL_MM || 1.0)
const BOOT_DRAIN_MS = Number(process.env.CENTRING_BOOT_DRAIN_MS || 2500)
/** Idle keepalive (slave closes the socket after 10 s with no RX, move continues). */
const KEEPALIVE_MS = Number(process.env.CENTRING_KEEPALIVE_MS || 3000)
/** Pause between connect attempts while the Nano still holds the previous socket. */
const SESSION_RETRY_MS = Number(process.env.CENTRING_SESSION_RETRY_MS || 250)
/** No RX for this long means the socket is half-open. Must stay under the Nano's 10 s kill. */
const RX_STALE_MS = Number(process.env.CENTRING_RX_STALE_MS || 8000)
/** How long to wait for KILL to reach the kernel before the socket is destroyed. */
const KILL_FLUSH_MS = Number(process.env.CENTRING_KILL_FLUSH_MS || 250)
/** Silent-socket replacements inside one command. Each one opens a new session. */
const SESSION_REPLACE_LIMIT = Number(process.env.CENTRING_SESSION_REPLACE_LIMIT || 3)

/** STATUS moveEnd tokens (MASTER_CONTROL §5.3). */
export const MOVE_END = Object.freeze({
  NONE: 'none',
  OK: 'ok',
  LIMIT: 'limit',
  STALL: 'stall',
  TIMEOUT: 'timeout',
  HOME_FAIL: 'home_fail',
  CAL_FAIL: 'cal_fail',
  LINK_LOST: 'link_lost',
  ESTOP: 'estop',
  BOTH_LIMITS: 'both_limits',
  RANGE: 'range',
})

const MOVE_END_FAULTS = new Set([
  MOVE_END.LIMIT,
  MOVE_END.STALL,
  MOVE_END.TIMEOUT,
  MOVE_END.HOME_FAIL,
  MOVE_END.CAL_FAIL,
  MOVE_END.LINK_LOST,
  MOVE_END.ESTOP,
  MOVE_END.BOTH_LIMITS,
  MOVE_END.RANGE,
])

/** Switch stops: valid for HOME / SEEK_TRAVEL, never for a height move. */
const LIMIT_STOPS = new Set([MOVE_END.LIMIT, MOVE_END.BOTH_LIMITS])

export const DEFAULT_HRANGE_MM = getModelHRangeMm()

export const DEFAULT_CENTRING_TCP = {
  host: NANO_IP_DEFAULT,
  port: NANO_PORT_DEFAULT,
}

export const DEFAULT_CENTRING_CONFIG = {
  transport: 'tcp',
  tcp: { ...DEFAULT_CENTRING_TCP },
  movementSpeedDegS: 45,
  homingSpeedDegS: 90,
  gapMoveSpeedDegS: 90,
  mechOffsetMm: 0,
  hRangeMm: { ...DEFAULT_HRANGE_MM },
  /** Persisted slave RAM cal — restored with SETCAL after connect/reboot. */
  slaveCal: null,
}

let configCached = null
let externalConfigStore = null
let cmdSendChain = Promise.resolve()
/** Serializes TCP connect/open so parallel callers cannot open two clients (§3.1). */
let sessionOpenChain = Promise.resolve()
/** Guards SETCAL-on-connect so the restore command does not open a second session. */
let restoringCalOnConnect = false
let _reachable = false

/** @type {{ sock: net.Socket, buf: string, handshaken: boolean, openedAt: number, localPort: number|null, openCount: number } | null} */
let _session = null
let _connectingSock = null
let _sessionOpenCount = 0
let _sendCmdCount = 0
/** @type {ReturnType<typeof setInterval> | null} */
let _keepaliveTimer = null
/** @type {ReturnType<typeof setTimeout> | null} */
let _restoreTimer = null
/** True while an operator kill owns the drop. Unexpected closes must not reopen over it. */
let _intentionalDrop = false
/** Bumped by kill so an in-flight connect stops and does not reopen over the kill. */
let _sessionEpoch = 0
let _restoreDelay = SESSION_RETRY_MS

class SessionSuperseded extends Error {
  constructor() {
    super('centring session connect superseded')
    this.name = 'SessionSuperseded'
  }
}
/** Last CAL_RESULT payload seen on the socket (cleared on read). */
let _pendingCalResult = null

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

function validateSlaveCal(raw) {
  if (raw == null) return null
  if (typeof raw !== 'object') return null
  const calId = String(raw.calId ?? '').trim()
  const hu = Number(raw.hu)
  const tu = Number(raw.tu)
  const hl = Number(raw.hl)
  const tl = Number(raw.tl)
  if (!calId || calId.length > 15) return null
  if (![hu, tu, hl, tl].every(Number.isFinite)) return null
  if (!(hu > tu) || !(hl > tl)) return null
  if ((hu - tu) < 80 || (hl - tl) < 80) return null
  const out = {
    calId,
    hu: Math.round(hu),
    tu: Math.round(tu),
    hl: Math.round(hl),
    tl: Math.round(tl),
  }
  for (const key of ['A', 'B', 'C', 'sHome', 'sTravel']) {
    if (raw[key] != null && raw[key] !== '') {
      const n = Number(raw[key])
      if (Number.isFinite(n)) out[key] = n
    }
  }
  return out
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
    transport: 'tcp',
    tcp: validateTcpSettings(raw ?? out),
    movementSpeedDegS: move,
    homingSpeedDegS: home,
    gapMoveSpeedDegS: gap,
    mechOffsetMm,
    hRangeMm: effectiveHRangeFromOffset(mechOffsetMm),
    slaveCal: validateSlaveCal(raw?.slaveCal ?? out.slaveCal),
  }
}

/** Resolved wire transport (always TCP for Double_Actuator slave). */
export function resolveTransportConfig(cfg = getCentringConfig()) {
  const envHost = process.env.CENTRING_HOST?.trim()
  const envPort = process.env.CENTRING_PORT
  const host = envHost || cfg.tcp?.host || DEFAULT_CENTRING_TCP.host
  const port = envPort != null && envPort !== ''
    ? Number(envPort)
    : Number(cfg.tcp?.port ?? DEFAULT_CENTRING_TCP.port)
  return {
    transport: 'tcp',
    host,
    port,
    serialPath: null,
    serialPathConfigured: false,
    target: `${host}:${port}`,
  }
}

/** No-op kept for API compatibility (serial path retired). */
export function applyCentringTransportFromConfig(_cfg) {
  /* TCP-only */
}

/** Alias for closeSession — serial transport retired. */
export function closeSerialSession() {
  closeSession()
}

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

function tcpEndpointChanged(prev, next) {
  if (!prev?.tcp || !next?.tcp) return false
  return (
    String(prev.tcp.host) !== String(next.tcp.host)
    || Number(prev.tcp.port) !== Number(next.tcp.port)
  )
}

function adoptConfig(next) {
  if (configCached && tcpEndpointChanged(configCached, next)) {
    closeSession()
    setReachable(false)
  }
  configCached = next
  return {
    ...configCached,
    tcp: { ...configCached.tcp },
    hRangeMm: { ...configCached.hRangeMm },
    slaveCal: configCached.slaveCal ? { ...configCached.slaveCal } : null,
  }
}

export function loadCentringConfig() {
  if (externalConfigStore) {
    try {
      return adoptConfig(validateConfig(externalConfigStore.load()))
    } catch (err) {
      console.warn('[centring] config load failed:', err.message)
    }
  } else {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        return adoptConfig(validateConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))))
      }
    } catch (err) {
      console.warn('[centring] config load failed:', err.message)
    }
  }
  return adoptConfig(validateConfig({ ...DEFAULT_CENTRING_CONFIG }))
}

export function getCentringConfig() {
  return configCached ? { ...configCached } : loadCentringConfig()
}

export function saveCentringConfig(cfg) {
  const hadTcpPatch = !!(cfg && typeof cfg === 'object' && cfg.tcp && typeof cfg.tcp === 'object')
  const next = validateConfig(cfg)
  adoptConfig(next)
  // Settings / explicit TCP saves must drop the live socket so the next PING rebinds —
  // even when CENTRING_HOST/PORT env keeps the effective target unchanged (C6).
  if (hadTcpPatch && hasOpenSession()) {
    closeSession()
    setReachable(false)
  }
  if (externalConfigStore) {
    const saved = adoptConfig(validateConfig(externalConfigStore.save(configCached)))
    // Keep JSON fallback in sync so scripts / cold starts without SQLite use last cal.
    try {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(configCached, null, 2))
    } catch (err) {
      console.warn('[centring] JSON mirror skipped:', err.message)
    }
    return saved
  }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configCached, null, 2))
  return {
    ...configCached,
    tcp: { ...configCached.tcp },
    hRangeMm: { ...configCached.hRangeMm },
    slaveCal: configCached.slaveCal ? { ...configCached.slaveCal } : null,
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

function isSlaveStatusLine(line) {
  return typeof line === 'string' && line.startsWith('u=') && line.includes('busy=')
}

function normalizeMoveEnd(raw) {
  if (raw == null || raw === '') return MOVE_END.NONE
  const t = String(raw).toLowerCase()
  if (Object.values(MOVE_END).includes(t)) return t
  return t
}

function parseFiniteOrNan(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).toLowerCase()
  if (s === 'nan') return Number.NaN
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse a STATUS key=value map (or full STATUS line) into the master status object.
 * Double_Actuator: cal/estop/reason; no homed* (optional soft-compat keep as undefined/false).
 * @param {string|Record<string,string>} lineOrKv
 */
export function mapFirmwareStatus(lineOrKv) {
  const kv = typeof lineOrKv === 'string' ? parseKvLine(lineOrKv) : (lineOrKv || {})
  const busy = flag(kv, 'busy')
  const cal = flag(kv, 'cal') || flag(kv, 'calValid')
  const estop = flag(kv, 'estop')
  const accepted = kv.accepted != null ? flag(kv, 'accepted') : true
  const targetH = kv.targetH != null ? Number(kv.targetH) : null
  const moveEnd = normalizeMoveEnd(kv.moveEnd)
  const reason = kv.reason != null ? String(kv.reason) : null
  const h = parseFiniteOrNan(kv.h)
  // Legacy compat only — Double_Actuator does not publish homed*; never gate on these.
  const homedUpper = kv.homedUpper != null ? flag(kv, 'homedUpper') : false
  const homedLower = kv.homedLower != null ? flag(kv, 'homedLower') : false
  return {
    u: Number(kv.u),
    l: Number(kv.l),
    h,
    hMin: kv.hmin != null ? Number(kv.hmin) : null,
    hMax: kv.hmax != null ? Number(kv.hmax) : null,
    mechOff: kv.mechOff != null ? Number(kv.mechOff) : null,
    busy,
    cal,
    calValid: cal,
    estop,
    reason,
    accepted,
    lastCmd: kv.lastCmd != null ? String(kv.lastCmd) : null,
    calId: kv.calId != null ? String(kv.calId) : null,
    hu: kv.hu != null ? Number(kv.hu) : null,
    tu: kv.tu != null ? Number(kv.tu) : null,
    hl: kv.hl != null ? Number(kv.hl) : null,
    tl: kv.tl != null ? Number(kv.tl) : null,
    puMm: parseFiniteOrNan(kv.puMm),
    plMm: parseFiniteOrNan(kv.plMm),
    pu: kv.pu != null ? Number(kv.pu) : null,
    pl: kv.pl != null ? Number(kv.pl) : null,
    uh: flag(kv, 'uh'),
    ut: flag(kv, 'ut'),
    lh: flag(kv, 'lh'),
    lt: flag(kv, 'lt'),
    targetH: Number.isFinite(targetH) ? targetH : null,
    moveEnd,
    sess: kv.sess != null ? Number(kv.sess) : null,
    homedUpper,
    homedLower,
    homedU: homedUpper,
    homedL: homedLower,
    ready: cal && !estop && !busy && moveEnd !== MOVE_END.HOME_FAIL && moveEnd !== MOVE_END.LINK_LOST,
    raw: kv,
  }
}

/**
 * HOME completion: success = busy=0 + moveEnd=ok (Double_Actuator).
 * @param {ReturnType<typeof mapFirmwareStatus>} st
 * @param {{ needUpper?: boolean, needLower?: boolean, cmd?: string }} [opts]
 */
function switchOn(v) {
  return v === true || v === 1 || v === '1'
}

/** HOME is done when each requested axis has its HOME switch pressed. */
export function homeSwitchesDone(st, { needUpper = true, needLower = true } = {}) {
  if (!st || st.busy) return false
  if (needUpper && !switchOn(st.uh)) return false
  if (needLower && !switchOn(st.lh)) return false
  return true
}

/** TRAVEL is done when each requested axis has its TRAVEL switch pressed. */
export function travelSwitchesDone(st, { needUpper = true, needLower = true } = {}) {
  if (!st || st.busy) return false
  if (needUpper && !switchOn(st.ut)) return false
  if (needLower && !switchOn(st.lt)) return false
  return true
}

function commandLimitSwitchesDone(verb, st) {
  if (verb === 'HOME') return homeSwitchesDone(st)
  if (verb === 'HOME_UPPER') return homeSwitchesDone(st, { needUpper: true, needLower: false })
  if (verb === 'HOME_LOWER') return homeSwitchesDone(st, { needUpper: false, needLower: true })
  if (verb === 'SEEK_TRAVEL') return travelSwitchesDone(st)
  if (verb === 'SEEK_TRAVEL_UPPER') return travelSwitchesDone(st, { needUpper: true, needLower: false })
  if (verb === 'SEEK_TRAVEL_LOWER') return travelSwitchesDone(st, { needUpper: false, needLower: true })
  return false
}

export function assertHomeMoveEnd(st, opts = {}) {
  const cmd = opts.cmd || st?.lastCmd || 'HOME'
  if (!st) throw new Error(`${cmd} failed: STATUS unavailable`)
  if (st.busy) throw new Error(`${cmd} failed: still busy after completion`)
  if (st.accepted === false) {
    throw new Error(
      `${cmd} rejected (accepted=0) reason=${st.reason ?? '?'} lastCmd=${st.lastCmd ?? '?'}`,
    )
  }
  const needUpper = opts.needUpper !== false
  const needLower = opts.needLower !== false
  if (homeSwitchesDone(st, { needUpper, needLower })) return st
  throw new Error(
    `${cmd} stopped before the HOME switch was reached — `
    + `uh=${st.uh ? 1 : 0} lh=${st.lh ? 1 : 0} moveEnd=${st.moveEnd ?? 'none'}`,
  )
}

/**
 * MOVE / SEEK completion: honour moveEnd + reason; optional |h−target|≤tol.
 * @param {ReturnType<typeof mapFirmwareStatus>} st
 * @param {number|null} [hMm]
 * @param {string} [cmd]
 */
export function assertMotionMoveEnd(st, hMm = null, cmd = 'MOVE') {
  if (!st) throw new Error(`${cmd}: STATUS unavailable`)
  if (st.accepted === false) {
    const reason = st.reason ?? '?'
    const hint = reason === 'nocal'
      ? ' — SETCAL required (cal=0)'
      : reason === 'estop'
        ? ' — CLEARESTOP then HOME'
        : reason === 'range'
          ? ' — height outside hmin/hmax'
          : ''
    throw new Error(
      `${cmd} rejected (accepted=0) reason=${reason} busy=${st.busy ? 1 : 0} cal=${st.cal ? 1 : 0}${hint}`,
    )
  }
  if (st.busy) throw new Error(`${cmd}: completion STATUS missing busy=0`)
  const mend = st.moveEnd || MOVE_END.NONE
  if (mend === MOVE_END.HOME_FAIL) {
    throw new Error(`${cmd}: unexpected home_fail on motion STATUS`)
  }
  // A switch stop is never a reached height, even when h happens to be in tolerance.
  if (LIMIT_STOPS.has(mend) || LIMIT_STOPS.has(st.reason)) {
    throw new Error(
      `${cmd} ended early on a limit switch: moveEnd=${mend}${st.reason ? ` reason=${st.reason}` : ''}`,
    )
  }
  if (mend !== MOVE_END.OK && mend !== MOVE_END.NONE) {
    throw new Error(`${cmd} ended early: moveEnd=${mend}`)
  }
  if (hMm != null && Number.isFinite(hMm)) {
    if (!Number.isFinite(st.h)) {
      throw new Error(`${cmd}: completion STATUS missing finite h (got ${st.h}) — cal=${st.cal ? 1 : 0}`)
    }
    const ref = Number.isFinite(st.targetH) ? st.targetH : hMm
    if (Math.abs(st.h - hMm) > MOVE_TOL_MM) {
      throw new Error(
        `height out of tol: h=${st.h} target=${hMm} targetH=${ref} (tol ${MOVE_TOL_MM} mm) moveEnd=${mend}`,
      )
    }
  }
  return st
}

function connectErrorMessage(cause) {
  const t = resolveTransportConfig()
  const base = `TCP connect failed (${t.target})`
  const hint = [
    'Verify Nano is powered and flashed with Double_Actuator_Centring_Slave_Firmware (TCP 8177).',
    'Bot/master must be on 192.168.10.0/24 (typically 192.168.10.1); centring Nano is 192.168.10.55.',
    'From bot: ping 192.168.10.55  then  nc -zv 192.168.10.55 8177.',
    'Check ENC28J60 cable, switch, and power.',
    'Override host: CENTRING_HOST / CENTRING_PORT env on us-machine-headless-web.service.',
  ].join(' ')
  return cause ? `${base}: ${cause}. ${hint}` : `${base}. ${hint}`
}

function logSession(level, message, extra = {}) {
  const line = `[centring] ${message} ${JSON.stringify({
    component: 'centring-session',
    target: resolveTransportConfig().target,
    ...extra,
  })}`
  if (level === 'warn') console.warn(line)
  else console.info(line)
}

function sessionAlive(sess = _session) {
  const sock = sess?.sock
  return !!(sock && !sock.destroyed && sock.readyState === 'open')
}

function stopKeepalive() {
  if (_keepaliveTimer != null) {
    clearInterval(_keepaliveTimer)
    _keepaliveTimer = null
  }
}

function cancelRestore() {
  if (_restoreTimer != null) {
    clearTimeout(_restoreTimer)
    _restoreTimer = null
  }
}

/**
 * Keep opening the one Nano socket until it answers.
 * A timer is used so this never calls ensureSession from inside ensureSession.
 */
function scheduleSessionRestore(reason) {
  if (_intentionalDrop || _restoreTimer) return
  if (
    process.env.PRODUCTION_SKIP_CENTRING === '1'
    || process.env.CENTRING_SKIP_INIT === '1'
  ) return
  const delay = _restoreDelay
  const epoch = _sessionEpoch
  _restoreTimer = setTimeout(() => {
    _restoreTimer = null
    if (epoch !== _sessionEpoch || _intentionalDrop || sessionAlive()) {
      _restoreDelay = SESSION_RETRY_MS
      return
    }
    ensureSession().then(() => {
      _restoreDelay = SESSION_RETRY_MS
      if (sessionAlive()) {
        setReachable(true)
        logSession('info', 'TCP session restored', { reason, recovery: 'connected' })
      }
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      logSession('warn', 'TCP session restore failed', { reason, error: message, recovery: 'retry' })
      _restoreDelay = Math.min(_restoreDelay * 2, 2000)
      scheduleSessionRestore(reason)
    })
  }, delay)
  if (typeof _restoreTimer.unref === 'function') _restoreTimer.unref()
}

function startKeepalive() {
  stopKeepalive()
  if (KEEPALIVE_MS <= 0) return
  _keepaliveTimer = setInterval(() => {
    const sess = _session
    if (!sessionAlive(sess)) {
      stopKeepalive()
      scheduleSessionRestore('keepalive-down')
      return
    }
    const lastRx = sess.lastRxAt || sess.openedAt || 0
    // Idle and silent: the Nano may already have dropped this half-open socket.
    // A command reader owns recovery while it is waiting for a reply.
    if (!sess.awaitingReply && lastRx > 0 && Date.now() - lastRx > RX_STALE_MS) {
      logSession('warn', 'TCP session silent', { ageMs: Date.now() - lastRx, recovery: 'reconnect' })
      _intentionalDrop = true
      closeSession()
      _intentionalDrop = false
      scheduleSessionRestore('rx-stale')
      return
    }
    // During any in-flight command, write PING on the open socket.
    // The command reader skips that STATUS. The queue is not used, so a
    // move cannot block keepalive.
    if (sess.awaitingReply && sess.sock && !sess.sock.destroyed) {
      try { sess.sock.write('PING\n') } catch { /* reader sees the close */ }
      return
    }
    sendCmdQueued('PING', PING_TIMEOUT).catch(() => {
      /* link loss handled in sendCmd */
    })
  }, KEEPALIVE_MS)
  if (typeof _keepaliveTimer.unref === 'function') _keepaliveTimer.unref()
}

function flushLine(sock, line, timeoutMs) {
  return new Promise((resolve) => {
    if (!sock || sock.destroyed) {
      resolve(false)
      return
    }
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    try {
      sock.write(line, 'utf8', () => finish(true))
    } catch {
      finish(false)
    }
  })
}

/**
 * Abort the Nano event and drop the socket.
 * KILL is flushed before destroy so the Nano sees it and frees the one client slot.
 * The link stays down until the next connect or reconnect. An unexpected close
 * is different: that path opens the socket again by itself.
 */
export async function killCentringSession() {
  _sessionEpoch += 1
  _intentionalDrop = true
  cancelRestore()
  if (_connectingSock && !_connectingSock.destroyed) {
    try { _connectingSock.destroy() } catch { /* already dead */ }
  }
  _connectingSock = null
  const sock = _session?.sock
  const had = sessionAlive()
  let flushed = false
  if (had) flushed = await flushLine(sock, 'KILL\n', KILL_FLUSH_MS)
  closeSession()
  setReachable(false)
  logSession('info', 'TCP session killed', { killed: had, flushed, recovery: 'wait-for-reconnect' })
  return { ok: true, killed: had, flushed }
}

/**
 * Open a new socket without stopping a move.
 * Does not send KILL. The Nano sends READY, PING, then a live STATUS of the
 * move in progress. That STATUS is the result and is returned immediately.
 * Connect is retried until the Nano answers or the attempt budget is spent.
 * A failed budget still schedules another open, so the link is not left down.
 */
export async function reconnectCentringSession() {
  _intentionalDrop = true
  cancelRestore()
  closeSession()
  _intentionalDrop = false
  try {
    await ensureSession()
  } catch (err) {
    if (!(err instanceof SessionSuperseded)) scheduleSessionRestore('reconnect')
    throw err
  }
  let st = takeBufferedStatus()
  if (!st) {
    const line = await readStatusLine(STATUS_TIMEOUT)
    st = mapFirmwareStatus(parseKvLine(line))
  }
  if (st?.accepted !== false) setReachable(true)
  else scheduleSessionRestore('reconnect-status')
  logSession('info', 'TCP session reconnected', {
    busy: !!st?.busy,
    lastCmd: st?.lastCmd ?? null,
    recovery: 'connected',
  })
  return {
    ok: st?.accepted !== false,
    status: st,
    moveContinues: !!st?.busy,
    session: getCentringTcpSessionInfo(),
  }
}

function closeSession() {
  stopKeepalive()
  const sess = _session
  _session = null
  if (!sess?.sock) return
  const rejectRead = sess.rejectRead
  sess.rejectRead = null
  // Drop handlers before destroy so this close is not treated as a peer drop.
  sess.sock.removeAllListeners('data')
  sess.sock.removeAllListeners('error')
  sess.sock.removeAllListeners('close')
  if (rejectRead) {
    try { rejectRead(new Error('TCP closed before reply')) } catch { /* already settled */ }
  }
  try { sess.sock.destroy() } catch { /* ignore */ }
}

/** True while the persistent TCP client to the one-client slave is open (§3.1). */
export function hasOpenSession() {
  return sessionAlive()
}

/**
 * While true, health must not PING the Centring socket (production owns the session).
 * Same role as Pick & Place productionTcpHold — avoids markLinkLoss mid-cycle.
 */
let productionTcpHold = false

/** @param {boolean} on */
export function setCentringProductionTcpHold(on) {
  productionTcpHold = !!on
  // #region agent log
  fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b7dbac'},body:JSON.stringify({sessionId:'b7dbac',hypothesisId:'A',location:'centring_master.js:setCentringProductionTcpHold',message:'centring production hold changed',data:{hold:productionTcpHold,open:hasOpenSession()},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
}

export function getCentringProductionTcpHold() {
  return productionTcpHold
}

/** Runtime snapshot for production TCP session verification. */
export function getCentringTcpSessionInfo() {
  const connected = hasOpenSession()
  return {
    mode: 'persistent-tcp',
    connected,
    localPort: connected ? (_session.localPort ?? _session.sock?.localPort ?? null) : null,
    remote: resolveTransportConfig().target,
    openCount: _sessionOpenCount,
    sendCmdCount: _sendCmdCount,
    handshaken: connected ? !!_session.handshaken : false,
    openedAt: connected ? _session.openedAt : null,
  }
}

function markLinkLoss(reason, sock = null) {
  // #region agent log
  fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b7dbac'},body:JSON.stringify({sessionId:'b7dbac',hypothesisId:'B',location:'centring_master.js:markLinkLoss',message:'centring markLinkLoss',data:{reason:String(reason).slice(0,160),hold:productionTcpHold,wasOpen:!!_session},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  const live = _session?.sock
  const dropLive = !sock || !live || live === sock
  if (!dropLive) return reason
  _intentionalDrop = true
  closeSession()
  _intentionalDrop = false
  setReachable(false)
  scheduleSessionRestore(String(reason).slice(0, 80))
  return reason
}

function sessionReadLine(timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!sessionAlive()) {
      reject(new Error('no TCP session'))
      return
    }
    const sess = _session
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null
    let settled = false

    const cleanup = () => {
      if (timer != null) clearTimeout(timer)
      timer = null
      if (sess.rejectRead === fail) sess.rejectRead = null
      sess.sock.off('data', onData)
      sess.sock.off('error', onError)
      sess.sock.off('close', onClose)
    }

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    const fail = (err) => finish(reject, err instanceof Error ? err : new Error(String(err)))

    const tryBuf = () => {
      const nl = sess.buf.indexOf('\n')
      if (nl !== -1) {
        const line = sess.buf.slice(0, nl).replace(/\r$/, '')
        sess.buf = sess.buf.slice(nl + 1)
        finish(resolve, line)
        return true
      }
      return false
    }

    const onData = () => {
      if (tryBuf()) return
      if (Date.now() >= deadline) finish(reject, new Error('timeout waiting for line'))
    }
    const onError = (err) => {
      if (_session && _session.sock === sess.sock) {
        _intentionalDrop = true
        closeSession()
        _intentionalDrop = false
        scheduleSessionRestore('read-error')
      }
      fail(new Error(connectErrorMessage(err.message)))
    }
    const onClose = () => {
      if (_session && _session.sock === sess.sock) {
        _intentionalDrop = true
        closeSession()
        _intentionalDrop = false
        scheduleSessionRestore('read-close')
      }
      fail(new Error('TCP closed before reply'))
    }

    const deadline = Date.now() + timeoutMs
    sess.rejectRead = fail
    if (tryBuf()) return

    timer = setTimeout(() => {
      finish(reject, new Error('timeout waiting for line'))
    }, timeoutMs)

    sess.sock.on('data', onData)
    sess.sock.once('error', onError)
    sess.sock.once('close', onClose)
  })
}

function isBannerOrNonStatus(line) {
  if (!line) return true
  if (line === 'READY' || line === 'PING' || line === 'SERIAL_ONLY' || line === 'CAL_FW') return true
  if (line.startsWith('CAL_RESULT')) return true
  return false
}

function noteCalResultLine(line) {
  if (typeof line === 'string' && line.startsWith('CAL_RESULT')) {
    _pendingCalResult = parseKvLine(line.replace(/^CAL_RESULT\s*/, ''))
  }
}

/** Reply path retired — Double_Actuator banners are drain-only (READY/PING). */
async function replyHandshakeMechOff(_mechOffMm) {
  void _mechOffMm
  if (_session) _session.handshaken = true
}

/**
 * Read next STATUS. Drain connect banners and CAL_RESULT; treat reason=link as link loss.
 */
async function readStatusLine(timeoutMs = STATUS_TIMEOUT) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const remaining = Math.max(50, deadline - Date.now())
    const line = await sessionReadLine(remaining)
    if (!line) continue
    if (line.startsWith('CAL_RESULT')) {
      noteCalResultLine(line)
      continue
    }
    if (line === 'READY' || line === 'PING' || line === 'SERIAL_ONLY' || line === 'CAL_FW') {
      continue
    }
    if (isSlaveStatusLine(line)) {
      const st = mapFirmwareStatus(parseKvLine(line))
      if (st.reason === 'link') {
        markLinkLoss('slave keepalive / reason=link')
        throw new Error('TCP link lost (slave reason=link)')
      }
      return line
    }
  }
  throw new Error('timeout waiting for STATUS')
}

/** STATUS reader used inside boot drain (does not recurse). */
async function readStatusLineRaw(timeoutMs = STATUS_TIMEOUT) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const remaining = Math.max(50, deadline - Date.now())
    const line = await sessionReadLine(remaining)
    if (!line) continue
    if (line.startsWith('CAL_RESULT')) {
      noteCalResultLine(line)
      continue
    }
    if (isBannerOrNonStatus(line)) continue
    if (isSlaveStatusLine(line)) return line
  }
  throw new Error('timeout waiting for STATUS')
}

/**
 * Every accept: slave sends READY, PING, then a live STATUS.
 * The session is not usable until that STATUS is in hand. A timeout or a
 * dropped socket throws so the caller can open again.
 */
async function drainBootAndHandshake(_mechOffMm) {
  void _mechOffMm
  if (!_session) throw new Error(connectErrorMessage('session dropped during banner'))
  if (_session.handshaken) return
  const sess = _session
  const deadline = Date.now() + BOOT_DRAIN_MS
  let sawStatus = false
  while (Date.now() < deadline && !sawStatus) {
    const line = await sessionReadLine(Math.min(400, Math.max(50, deadline - Date.now())))
    if (!line) continue
    if (line === 'READY' || line === 'PING' || line === 'SERIAL_ONLY' || line === 'CAL_FW') continue
    if (line.startsWith('CAL_RESULT')) {
      noteCalResultLine(line)
      continue
    }
    if (isSlaveStatusLine(line)) {
      sess.connectStatus = mapFirmwareStatus(parseKvLine(line))
      sawStatus = true
    }
  }
  if (!sawStatus || _session !== sess || !sessionAlive(sess)) {
    throw new Error(connectErrorMessage('no STATUS after connect'))
  }
  sess.handshaken = true
  startKeepalive()
}

function openSession() {
  const { host, port } = resolveTransportConfig()
  const localAddress = resolveTcpLocalAddress(host, 'CENTRING_LOCAL_ADDRESS')
  return new Promise((resolve, reject) => {
    const sock = new net.Socket()
    _connectingSock = sock
    let settled = false
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      if (_connectingSock === sock) _connectingSock = null
      if (timer != null) clearTimeout(timer)
      fn(value)
    }
    const failConnect = (err) => {
      try { sock.destroy() } catch { /* ignore */ }
      finish(reject, err instanceof Error ? err : new Error(connectErrorMessage(String(err))))
    }
    timer = setTimeout(() => {
      if (settled) return
      failConnect(new Error(connectErrorMessage('connect timeout')))
    }, CONNECT_TIMEOUT)

    sock.once('error', err => {
      if (settled) return
      failConnect(new Error(connectErrorMessage(err.message)))
    })
    const onConnected = () => {
      try { sock.setNoDelay(true) } catch { /* ignore */ }
      // Kernel probes so a dead ENC28J60 peer is not "open" for hours.
      try { sock.setKeepAlive(true, 1000) } catch { /* ignore */ }
      _sessionOpenCount += 1
      const sess = {
        sock,
        buf: '',
        handshaken: false,
        openedAt: Date.now(),
        lastRxAt: 0,
        localPort: sock.localPort ?? null,
        openCount: _sessionOpenCount,
        awaitingReply: false,
        rejectRead: null,
        connectStatus: null,
      }
      _session = sess
      sock.on('data', chunk => {
        if (_session?.sock !== sock) return
        _session.buf += chunk.toString('utf8')
        _session.lastRxAt = Date.now()
      })
      sock.on('error', (err) => {
        if (_session?.sock !== sock || _intentionalDrop) return
        logSession('warn', 'TCP socket error', {
          error: err instanceof Error ? err.message : String(err),
          recovery: 'reconnect',
        })
        _intentionalDrop = true
        closeSession()
        _intentionalDrop = false
        scheduleSessionRestore('socket-error')
      })
      sock.on('close', () => {
        if (_session?.sock !== sock || _intentionalDrop) return
        logSession('warn', 'TCP socket closed', { recovery: 'reconnect' })
        _intentionalDrop = true
        closeSession()
        _intentionalDrop = false
        scheduleSessionRestore('peer-close')
      })
      finish(resolve, sess)
    }
    // Bind to machine LAN (end0 / eth0 docs name → 192.168.10.1), same as Pick & Place.
    if (localAddress) {
      sock.connect({ port, host, localAddress }, onConnected)
    } else {
      sock.connect(port, host, onConnected)
    }
  })
}

/**
 * Saved pulses, plus the default curve when the record has no A/B/C.
 * A stored custom curve is sent as stored.
 */
function savedCalForNano(saved) {
  if (!saved) return null
  const nums = [saved.A, saved.B, saved.C, saved.sHome, saved.sTravel].map(Number)
  if (nums.every(Number.isFinite)) return saved
  return { ...saved, ...DEFAULT_HEIGHT_CURVE }
}

/**
 * Nano RAM loses calibration on power-up (cal=0). Every new socket checks
 * that and sends the saved relation. It does not move the jaws.
 */
async function restoreSavedCalOnNewSession() {
  if (restoringCalOnConnect) return
  if (
    process.env.PRODUCTION_SKIP_CENTRING === '1'
    || process.env.CENTRING_SKIP_INIT === '1'
  ) return
  restoringCalOnConnect = true
  try {
    let st = takeBufferedStatus()
    if (!st && _session?.sock && !_session.sock.destroyed) {
      _session.sock.write('PING\n')
      const line = await readStatusLine(PING_TIMEOUT)
      st = mapFirmwareStatus(parseKvLine(line))
    }
    if (!st || st.accepted === false || st.cal || st.busy || st.estop) {
      if (st && _session) _session.connectStatus = st
      return
    }
    const saved = savedCalForNano(getCentringConfig().slaveCal)
    if (!saved) {
      console.warn('[centring] Nano reported cal=0 and no saved calibration is stored')
      if (_session) _session.connectStatus = st
      return
    }
    _session.sock.write(`${formatSetCalCommand(saved)}\n`)
    const line = await readStatusLine(STATUS_TIMEOUT)
    const next = mapFirmwareStatus(parseKvLine(line))
    if (_session) _session.connectStatus = next
    if (next.accepted === false || !next.cal) {
      console.warn('[centring] Nano reported cal=0 — SETCAL was not accepted', {
        reason: next.reason ?? null,
        cal: !!next.cal,
      })
      return
    }
    console.info('[centring] Nano powered on with cal=0 — saved calibration sent', {
      calId: next.calId ?? saved.calId ?? null,
      cal: true,
    })
  } catch (err) {
    console.warn(
      '[centring] Nano reported cal=0 — saved calibration was not sent:',
      err instanceof Error ? err.message : err,
    )
  } finally {
    restoringCalOnConnect = false
  }
}

async function openSessionWithRetries() {
  const epoch = _sessionEpoch
  cancelRestore()
  if (sessionAlive() && _session.handshaken) return _session
  const attempts = Math.max(1, CONNECT_RETRIES)
  let lastErr = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (epoch !== _sessionEpoch) throw new SessionSuperseded()
    if (sessionAlive() && _session.handshaken) return _session
    _intentionalDrop = true
    closeSession()
    _intentionalDrop = false
    try {
      await openSession()
      const mechOff = getCentringConfig().mechOffsetMm
      await drainBootAndHandshake(mechOff)
      await restoreSavedCalOnNewSession()
      if (!sessionAlive() || !_session?.handshaken) {
        throw new Error(connectErrorMessage('session dropped during handshake'))
      }
      setReachable(true)
      _restoreDelay = SESSION_RETRY_MS
      logSession('info', 'TCP session open', {
        attempt,
        localPort: _session.localPort ?? null,
        recovery: 'connected',
      })
      return _session
    } catch (err) {
      if (epoch !== _sessionEpoch || err instanceof SessionSuperseded) throw new SessionSuperseded()
      lastErr = err
      const message = err instanceof Error ? err.message : String(err)
      logSession('warn', 'TCP connect attempt failed', {
        attempt,
        attempts,
        error: message,
        recovery: attempt < attempts ? 'retry' : 'give-up-this-budget',
      })
      _intentionalDrop = true
      closeSession()
      _intentionalDrop = false
      cancelRestore()
      if (attempt < attempts) await sleep(SESSION_RETRY_MS)
    }
  }
  if (epoch !== _sessionEpoch) throw new SessionSuperseded()
  setReachable(false)
  scheduleSessionRestore('connect-budget')
  throw lastErr instanceof Error ? lastErr : new Error(connectErrorMessage(String(lastErr)))
}

async function ensureSession() {
  if (sessionAlive() && _session.handshaken) return _session
  const openPromise = sessionOpenChain.then(() => openSessionWithRetries())
  sessionOpenChain = openPromise.catch(() => {})
  return openPromise
}

/**
 * PING/STATUS replies that belong to session keepalive, not to the command
 * the host is waiting on. Skipped so keepalive can run during a move.
 */
export function isForeignSessionStatus(st, verb) {
  if (verb === 'PING' || verb === 'STATUS') return false
  const lc = String(st?.lastCmd || '')
  return lc === 'PING' || lc === 'STATUS' || lc === 'keepalive'
}

function discardBufferedKeepalive(verb) {
  const sess = _session
  if (!sess?.buf) return
  for (;;) {
    const nl = sess.buf.indexOf('\n')
    if (nl < 0) return
    const line = sess.buf.slice(0, nl).replace(/\r$/, '')
    if (!isSlaveStatusLine(line)) return
    const st = mapFirmwareStatus(parseKvLine(line))
    if (!isForeignSessionStatus(st, verb)) return
    sess.buf = sess.buf.slice(nl + 1)
  }
}

/** STATUS the Nano pushed at accept. Left in the buffer by the banner drain. */
function takeBufferedStatus() {
  const sess = _session
  if (!sess) return null
  if (sess.connectStatus) {
    const st = sess.connectStatus
    sess.connectStatus = null
    return st
  }
  if (!sess.buf) return null
  const nl = sess.buf.indexOf('\n')
  if (nl < 0) return null
  const line = sess.buf.slice(0, nl).replace(/\r$/, '')
  if (!isSlaveStatusLine(line)) return null
  sess.buf = sess.buf.slice(nl + 1)
  return mapFirmwareStatus(parseKvLine(line))
}

/**
 * A move that continued across reconnect may finish before the next command.
 * Park that completion so it is not mistaken for the new command's reply.
 */
function parkPreviousCompletion(verb) {
  const sess = _session
  if (!sess?.buf) return
  const nl = sess.buf.indexOf('\n')
  if (nl < 0) return
  const line = sess.buf.slice(0, nl).replace(/\r$/, '')
  if (!isSlaveStatusLine(line)) return
  const st = mapFirmwareStatus(parseKvLine(line))
  if (st.busy) return
  if (String(st.lastCmd || '') === verb) return
  sess.buf = sess.buf.slice(nl + 1)
  sess.pendingCompletion = st
}

/**
 * The socket went silent while a command was in flight.
 * Drop it without KILL and open another. KILL would abort the move. A silent
 * socket does not. The new socket's first STATUS is the move still running.
 * @param {string} verb
 */
async function replaceSilentSession(verb) {
  const hadSocket = sessionAlive()
  _intentionalDrop = true
  cancelRestore()
  closeSession()
  _intentionalDrop = false
  await ensureSession()
  let st = takeBufferedStatus()
  if (!st && sessionAlive()) {
    const line = await readStatusLine(STATUS_TIMEOUT)
    st = mapFirmwareStatus(parseKvLine(line))
  }
  if (_session) _session.awaitingReply = true
  // #region agent log
  fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'50eb1b'},body:JSON.stringify({sessionId:'50eb1b',runId:'kill-reconnect',hypothesisId:'F',location:'centring_master.js:replaceSilentSession',message:'replaced silent session without KILL',data:{verb,hadSocket,busy:st?.busy??null,lastCmd:st?.lastCmd??null,moveEnd:st?.moveEnd??null,h:st?.h??null,u:st?.u??null,l:st?.l??null,pu:st?.pu??null,pl:st?.pl??null,uh:st?.uh??null,ut:st?.ut??null,lh:st?.lh??null,lt:st?.lt??null,reason:st?.reason??null},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  logSession('warn', 'TCP session replaced after silence', {
    verb,
    busy: !!st?.busy,
    lastCmd: st?.lastCmd ?? null,
    recovery: 'reconnected-without-kill',
  })
  return st
}

/**
 * Send one command; return final STATUS (after busy→0 if motion).
 * Keepalive PING lines that arrive during the wait are ignored.
 * A silent socket during the move is replaced without KILL, and the wait continues.
 * @returns {Promise<ReturnType<typeof mapFirmwareStatus>>}
 */
async function sendCmd(cmd, timeoutMs = MOVE_TIMEOUT_MS) {
  validateCmd(cmd)
  await ensureSession()
  let sock = _session.sock
  const verb = String(cmd).trim().split(/\s+/)[0]
  discardBufferedKeepalive(verb)
  parkPreviousCompletion(verb)
  _sendCmdCount += 1
  _session.awaitingReply = true
  const motionBudget = Math.max(Number(timeoutMs) || 0, STATUS_TIMEOUT)
  let deadline = Date.now() + motionBudget
  let sessionReplaces = 0
  const watchLower = verb === 'SEEK_TRAVEL_UPPER' || verb === 'HOME_UPPER'
    || verb === 'SEEK_TRAVEL_LOWER' || verb === 'HOME_LOWER'
    || verb === 'MOVE_LOWERMM' || verb === 'MOVE_UPPERMM'
  let nextLowerProbe = 0
  let seenBusy = false
  try {
    sock.write(cmd + '\n')

    let st = null
    while (Date.now() < deadline) {
      const remaining = Math.max(50, deadline - Date.now())
      let line
      try {
        line = await readStatusLine(Math.min(remaining, STATUS_TIMEOUT))
      } catch (readErr) {
        const readMsg = readErr instanceof Error ? readErr.message : String(readErr)
        const linkLostMidMove = /timeout waiting for line|timeout waiting for STATUS|TCP closed|no TCP session|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|ENETUNREACH|ECONNREFUSED/i.test(readMsg)
        if (sessionReplaces < SESSION_REPLACE_LIMIT && linkLostMidMove && Date.now() < deadline) {
          sessionReplaces += 1
          try {
            st = await replaceSilentSession(verb)
          } catch (reErr) {
            if (!(reErr instanceof SessionSuperseded)) scheduleSessionRestore('move-replace')
            throw reErr
          }
          sock = _session?.sock || sock
          const sameCmd = String(st?.lastCmd || '') === verb
          const switchesDone = !!(st && !st.busy && commandLimitSwitchesDone(verb, st))
          if (st && !st.busy && (switchesDone || (sameCmd && !isForeignSessionStatus(st, verb)))) {
            // #region agent log
            if (verb === 'HOME' || verb.startsWith('MOVE')) {
              fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'50eb1b'},body:JSON.stringify({sessionId:'50eb1b',runId:'kill-reconnect',hypothesisId:'G',location:'centring_master.js:sendCmd:done',message:'motion command completed',data:{verb,cmd:String(cmd).slice(0,48),sessionReplaces,busy:!!st.busy,lastCmd:st.lastCmd??null,moveEnd:st.moveEnd??null,h:st.h??null,u:st.u??null,l:st.l??null,pu:st.pu??null,pl:st.pl??null,puMm:st.puMm??null,plMm:st.plMm??null,uh:!!st.uh,ut:!!st.ut,lh:!!st.lh,lt:!!st.lt,reason:st.reason??null},timestamp:Date.now()})}).catch(()=>{})
            }
            // #endregion
            return st
          }
          if (st?.busy) deadline = Date.now() + motionBudget
          continue
        }
        throw readErr
      }
      st = mapFirmwareStatus(parseKvLine(line))
      if (watchLower) {
        // #region agent log
        fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'50eb1b'},body:JSON.stringify({sessionId:'50eb1b',runId:'axis-move',hypothesisId:'L',location:'centring_master.js:sendCmd:partnerSwitches',message:'partner switches during single-axis move',data:{verb,busy:!!st.busy,uh:!!st.uh,ut:!!st.ut,lh:!!st.lh,lt:!!st.lt,pu:st.pu??null,pl:st.pl??null,u:st.u??null,l:st.l??null,lastCmd:st.lastCmd??null,moveEnd:st.moveEnd??null},timestamp:Date.now()})}).catch(()=>{})
        // #endregion
        if (Date.now() >= nextLowerProbe && _session?.sock && !_session.sock.destroyed && st.busy) {
          try { _session.sock.write('PING\n') } catch { /* next read reports the close */ }
          nextLowerProbe = Date.now() + (verb === 'MOVE_LOWERMM' || verb === 'MOVE_UPPERMM' ? 80 : 400)
        }
      }
      if (st.busy) {
        seenBusy = true
        deadline = Date.now() + motionBudget
      }
      if (!st.busy && commandLimitSwitchesDone(verb, st)) {
        // #region agent log
        fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'50eb1b'},body:JSON.stringify({sessionId:'50eb1b',runId:'switch-done',hypothesisId:'H',location:'centring_master.js:sendCmd:switches',message:'limit move done on pressed switches',data:{verb,uh:!!st.uh,ut:!!st.ut,lh:!!st.lh,lt:!!st.lt,pu:st.pu??null,pl:st.pl??null,h:st.h??null,moveEnd:st.moveEnd??null,lastCmd:st.lastCmd??null},timestamp:Date.now()})}).catch(()=>{})
        // #endregion
        return st
      }
      if (seenBusy && !st.busy) return st
      if (isForeignSessionStatus(st, verb)) continue
      if (st.busy) continue
      // #region agent log
      if (verb === 'HOME' || verb.startsWith('MOVE')) {
              fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'50eb1b'},body:JSON.stringify({sessionId:'50eb1b',runId:'kill-reconnect',hypothesisId:'G',location:'centring_master.js:sendCmd:done',message:'motion command completed',data:{verb,cmd:String(cmd).slice(0,48),sessionReplaces,busy:!!st.busy,lastCmd:st.lastCmd??null,moveEnd:st.moveEnd??null,h:st.h??null,u:st.u??null,l:st.l??null,pu:st.pu??null,pl:st.pl??null,puMm:st.puMm??null,plMm:st.plMm??null,uh:!!st.uh,ut:!!st.ut,lh:!!st.lh,lt:!!st.lt,reason:st.reason??null},timestamp:Date.now()})}).catch(()=>{})
      }
      // #endregion
      return st
    }
    throw new Error(`completion STATUS missing busy=0 (cmd: "${cmd}")`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Motion/command timeouts (e.g. jaws already on a limit switch) must NOT
    // tear down TCP — that falsely surfaces as CENTRING_UNREACHABLE on the HMI.
    // Only real link failures close the session.
    const linkDead =
      /TCP closed/i.test(msg) ||
      /no TCP session/i.test(msg) ||
      /link lost/i.test(msg) ||
      /EHOSTUNREACH|ECONNREFUSED|ENETUNREACH|ECONNRESET|ETIMEDOUT/i.test(msg) ||
      /connect (timeout|failed)/i.test(msg)
    if (linkDead || /timeout waiting for (line|STATUS)/i.test(msg)) {
      // #region agent log
      fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ee2fa'},body:JSON.stringify({sessionId:'1ee2fa',runId:'limit-switch',hypothesisId:'L2',location:'centring_master.js:sendCmd:markLinkLoss',message:'markLinkLoss for true link failure',data:{cmd:String(cmd).slice(0,40),msg:String(msg).slice(0,180)},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      markLinkLoss(msg, sock)
    } else if (/timeout/i.test(msg)) {
      // #region agent log
      fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ee2fa'},body:JSON.stringify({sessionId:'1ee2fa',runId:'limit-switch',hypothesisId:'L1',location:'centring_master.js:sendCmd:timeoutKeepSession',message:'motion/cmd timeout — keep TCP session',data:{cmd:String(cmd).slice(0,40),msg:String(msg).slice(0,180)},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
    }
    throw err
  } finally {
    if (_session && _session.sock === sock) _session.awaitingReply = false
  }
}

async function sendCmdQueued(cmd, timeoutMs = MOVE_TIMEOUT_MS) {
  const p = cmdSendChain.then(() => sendCmd(cmd, timeoutMs))
  cmdSendChain = p.catch(() => {})
  return p
}

/**
 * Reachability probe — never opens a second client while a session is open (§3.1).
 * Always uses the one persistent socket. Never opens a second client.
 */
export async function probeConnection(timeoutMs = CONNECT_TIMEOUT) {
  const target = resolveTransportConfig().target
  // #region agent log
  fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',hypothesisId:'B',location:'centring_master.js:probeConnection:entry',message:'centring TCP probe start',data:{target,timeoutMs,openSession:hasOpenSession(),hold:productionTcpHold},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  // One client only. A second throwaway socket is refused by the Nano and can
  // drop the session the master just opened. Probe on the persistent socket.
  let timer = null
  try {
    const ok = await Promise.race([
      (async () => {
        if (!sessionAlive()) await ensureSession()
        return !!(await ping())
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
      }),
    ])
    // #region agent log
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ee2fa'},body:JSON.stringify({sessionId:'1ee2fa',runId:'init-55',hypothesisId:'C',location:'centring_master.js:probeConnection:session',message:'centring probe via open session',data:{target,ok:!!ok},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    return { ok: !!ok, target, via: 'session' }
  } catch (err) {
    if (!sessionAlive()) scheduleSessionRestore('probe')
    // #region agent log
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ee2fa'},body:JSON.stringify({sessionId:'1ee2fa',runId:'init-55',hypothesisId:'C',location:'centring_master.js:probeConnection:sessionFail',message:'centring session probe failed',data:{target,error:err instanceof Error?err.message:String(err)},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    return {
      ok: false,
      target,
      via: 'session',
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    if (timer != null) clearTimeout(timer)
  }
}

export { formatDiagnosisReport, NANO_IP_DEFAULT, NANO_PORT_DEFAULT }

export async function diagnoseConnection(host, port) {
  const t = resolveTransportConfig()
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
  return {
    role: 'master',
    slaveTarget: t.target,
    target: t.target,
    host: t.host,
    port: t.port,
    transport: 'tcp',
    protocol: 'double-actuator-centring-v1',
    sessionMode: 'persistent-tcp',
    connectTimeoutMs: CONNECT_TIMEOUT,
    connectRetries: CONNECT_RETRIES,
    connectRetryMs: CONNECT_RETRY_MS,
    cmdMaxLen: TCP_CMD_MAX_LEN,
    keepaliveMs: KEEPALIVE_MS,
    homing: { timeoutMs: HOME_TIMEOUT_MS },
    move: { timeoutMs: MOVE_TIMEOUT_MS, tolMm: MOVE_TOL_MM },
  }
}

export async function ping() {
  if (
    process.env.PRODUCTION_SKIP_CENTRING === '1' ||
    process.env.CENTRING_SKIP_INIT === '1'
  ) {
    return true
  }
  // After busy-drain, lastCmd may be the prior MOVE — link OK if STATUS returned.
  const st = await sendCmdQueued('PING', PING_TIMEOUT)
  return !!st && st.accepted !== false
}

/**
 * Health probe that respects production TCP hold (one-client slave).
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, error?: string }>}
 */
export async function healthProbeCentring() {
  // Offline / bench: do not hammer ARP/TCP when production intentionally skips centring.
  if (
    process.env.PRODUCTION_SKIP_CENTRING === '1' ||
    process.env.CENTRING_SKIP_INIT === '1'
  ) {
    // #region agent log
    fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',hypothesisId:'C',location:'centring_master.js:healthProbeCentring:skip',message:'centring health skipped by env',data:{skipProd:process.env.PRODUCTION_SKIP_CENTRING,skipInit:process.env.CENTRING_SKIP_INIT},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    return { ok: true, skipped: true, reason: 'PRODUCTION_SKIP_CENTRING' }
  }
  if (productionTcpHold) {
    if (hasOpenSession()) {
      const last = _session.lastRxAt || _session.openedAt || 0
      const stale = !_session.awaitingReply && last > 0 && Date.now() - last > RX_STALE_MS
      if (!stale) {
        setReachable(true)
        return { ok: true, skipped: true, reason: 'production_hold' }
      }
      try {
        await reconnectCentringSession()
        setReachable(true)
        return { ok: true, reconnected: true, hold: true, reason: 'rx-stale' }
      } catch (e) {
        setReachable(false)
        const err = e instanceof Error ? e.message : String(e)
        scheduleSessionRestore('hold-stale')
        return { ok: false, error: err }
      }
    }
    try {
      await connectWithRetry()
      setReachable(true)
      return { ok: true, reconnected: true, hold: true }
    } catch (e) {
      setReachable(false)
      const err = e instanceof Error ? e.message : String(e)
      scheduleSessionRestore('hold-reconnect')
      // #region agent log
      fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',hypothesisId:'D',location:'centring_master.js:healthProbeCentring:holdReconnectFail',message:'production hold reconnect failed',data:{error:err,openSession:hasOpenSession(),target:resolveTransportConfig().target},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      return { ok: false, error: err }
    }
  }
  try {
    const pong = await ping()
    if (!pong) {
      setReachable(false)
      // #region agent log
      fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',hypothesisId:'D',location:'centring_master.js:healthProbeCentring:pongFalse',message:'PING returned falsy',data:{openSession:hasOpenSession(),hold:productionTcpHold,target:resolveTransportConfig().target},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      return { ok: false, error: 'PING/STATUS failed' }
    }
    setReachable(true)
    return { ok: true }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    if (!hasOpenSession()) {
      setReachable(false)
      scheduleSessionRestore('health-ping')
    }
    // #region agent log
    fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',hypothesisId:'A',location:'centring_master.js:healthProbeCentring:catch',message:'PING threw',data:{error:err,code:e?.code,openSession:hasOpenSession(),hold:productionTcpHold,target:resolveTransportConfig().target},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    return { ok: hasOpenSession(), error: hasOpenSession() ? undefined : err }
  }
}

export async function status() {
  if (
    process.env.PRODUCTION_SKIP_CENTRING === '1' ||
    process.env.CENTRING_SKIP_INIT === '1'
  ) {
    return {
      accepted: true,
      busy: false,
      estop: false,
      cal: true,
      skipped: true,
      u: null,
      l: null,
      h: null,
    }
  }
  try {
    return await sendCmdQueued('STATUS', STATUS_TIMEOUT)
  } catch {
    return null
  }
}

/**
 * Soft stop — wait for idle (Double_Actuator has no STOP wire command).
 * @param {{ timeoutMs?: number }} [opts] — override wait budget (production abort uses a short timeout)
 */
export async function stop(opts = {}) {
  const timeoutMs =
    opts && Number.isFinite(Number(opts.timeoutMs)) && Number(opts.timeoutMs) > 0
      ? Number(opts.timeoutMs)
      : MOVE_TIMEOUT_MS
  const st = await waitIdle(timeoutMs)
  return { ok: true, soft: true, status: st }
}

/**
 * Soft e-stop — close TCP session. Panel latch is firmware-side (`estop=`).
 * Callers must reconnect + CLEARESTOP / ensureReady before resuming.
 */
export async function emergencyStop() {
  const killed = await killCentringSession()
  return {
    ok: true,
    soft: true,
    killed: killed.killed,
    reply: 'session killed — reconnect, then CLEARESTOP if the panel latch is set',
  }
}

/** Clear software E-stop latch (CLEARESTOP). Requires button released ≥200 ms.
 *  Then runs the Version 2 initialization (centringV2/initialize.mjs): HOME both
 *  axes, SETCAL if cal=0, and MOVE*MM to h_pre_mm when a reference is loaded and
 *  its recipe passes the gate. Throws with the operator message on failure.
 *  A loaded reference with centring_axis upper or lower: the latch is cleared,
 *  no motion is sent, and it throws code SINGLE_AXIS_UNDECIDED (`err.status`
 *  holds the CLEARESTOP STATUS).
 */
export async function clearEstop() {
  const st = await sendCmdQueued('CLEARESTOP', STATUS_TIMEOUT)
  if (st.accepted === false || st.estop) {
    throw new Error(
      `CLEARESTOP failed: accepted=${st.accepted ? 1 : 0} estop=${st.estop ? 1 : 0} reason=${st.reason ?? '?'}`,
    )
  }
  return initializeCentringAfterEstop(st)
}

/**
 * Persisted recipe of the loaded reference, or null when no reference is loaded.
 * A loaded reference without a usable recipe returns a failed gate with the reason.
 */
async function loadInitializationReference() {
  const { getMachineInitStatus } = await import('../machineInit.mjs')
  const init = getMachineInitStatus()
  if (!init?.referenceLoaded || !init.referenceId) return null
  const referenceId = String(init.referenceId)
  const { validateReferenceShrinkTube } = await import('../productionContext.mjs')
  const ctx = validateReferenceShrinkTube(referenceId)
  if (!ctx.ok) {
    return {
      reference: { referenceId },
      recipeGate: { ok: false, code: 'REFERENCE_RECIPE_MISSING', message: ctx.error },
    }
  }
  return { reference: { ...ctx.centringContext.resolved, referenceId } }
}

/** E-stop clear → the single Version 2 initialization. */
async function initializeCentringAfterEstop(st) {
  if (
    process.env.PRODUCTION_SKIP_CENTRING === '1'
    || process.env.CENTRING_SKIP_INIT === '1'
  ) {
    return st
  }
  const cfg = getCentringConfig()
  const loaded = await loadInitializationReference()
  const reference = loaded?.reference ?? null
  const refusal = reference ? singleAxisRefusal(reference) : null
  if (refusal) {
    console.warn(`[centring] E-stop cleared, initialization not run: ${refusal.message}`)
    const err = new Error(refusal.message)
    err.code = refusal.code
    err.initialization = refusal
    err.status = st
    throw err
  }
  const recipeGate = loaded
    ? loaded.recipeGate ?? validateCentringV2Recipe(reference, {
      slaveCal: cfg.slaveCal,
      mechOffsetMm: cfg.mechOffsetMm,
    })
    : null
  const result = await initializeCentring(
    { homeBoth, status, setCal, moveBoth, moveUpper, moveLower },
    { reference, recipeGate, slaveCal: cfg.slaveCal, mechOffsetMm: cfg.mechOffsetMm },
  )
  if (!result.ok) {
    const err = new Error(result.message)
    err.code = result.code
    err.initialization = result
    throw err
  }
  return result.status
}

/** Alias — clear software E-stop (no CLRFAULT on Double_Actuator). */
export async function clearFault() {
  const st = await clearEstop()
  return { ok: true, soft: false, reply: 'CLEARESTOP', status: st }
}

export async function recover() {
  // Does not wait on the command queue, so a move in flight cannot block it.
  // KILL is flushed first so the Nano frees the slot before the new socket.
  const killed = await killCentringSession()
  try {
    await ensureSession()
  } catch (err) {
    if (!(err instanceof SessionSuperseded)) scheduleSessionRestore('recover')
    throw err
  }
  let st = takeBufferedStatus()
  if (!st && _session?.sock && !_session.sock.destroyed) {
    const line = await readStatusLine(STATUS_TIMEOUT)
    st = mapFirmwareStatus(parseKvLine(line))
  }
  if (st?.accepted !== false) setReachable(true)
  // #region agent log
  fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'50eb1b'},body:JSON.stringify({sessionId:'50eb1b',runId:'kill-reconnect',hypothesisId:'F',location:'centring_master.js:recover',message:'kill and reconnect',data:{killed:killed.killed,busy:st?.busy??null,lastCmd:st?.lastCmd??null,moveEnd:st?.moveEnd??null,connected:hasOpenSession()},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  return {
    ok: st?.accepted !== false,
    reply: 'kill + reconnect',
    killed: killed.killed,
    status: st,
    moveContinues: !!st?.busy,
  }
}

/**
 * Apply mechOff and verify slave RAM matches. Retries after waitIdle if busy rejected apply.
 */
async function applyMechOffVerified(off) {
  let st = await sendCmdQueued(`STATUS mechOff=${formatWireNum(off)}`, STATUS_TIMEOUT)
  if (st.busy || st.accepted === false || st.mechOff == null || Math.abs(Number(st.mechOff) - off) > 1e-3) {
    if (st.busy) st = await waitIdle(MOVE_TIMEOUT_MS)
    st = await sendCmdQueued(`STATUS mechOff=${formatWireNum(off)}`, STATUS_TIMEOUT)
  }
  if (st.accepted === false || st.mechOff == null || Math.abs(Number(st.mechOff) - off) > 1e-3) {
    throw new Error(
      `mechOff apply failed: want ${off} got ${st.mechOff} accepted=${st.accepted ? 1 : 0} busy=${st.busy ? 1 : 0} reason=${st.reason ?? '?'}`,
    )
  }
  return st
}

/** Build SETCAL wire line from slaveCal object. */
export function formatSetCalCommand(cal) {
  const c = validateSlaveCal(cal)
  if (!c) throw new Error('SETCAL: invalid slaveCal (need calId, hu>tu, hl>tl, span≥80)')
  let cmd = `SETCAL ${c.calId} ${c.hu} ${c.tu} ${c.hl} ${c.tl}`
  if (
    Number.isFinite(c.A) && Number.isFinite(c.B) && Number.isFinite(c.C)
    && Number.isFinite(c.sHome) && Number.isFinite(c.sTravel)
  ) {
    cmd += ` ${formatWireNum(c.A)} ${formatWireNum(c.B)} ${formatWireNum(c.C)} ${formatWireNum(c.sHome)} ${formatWireNum(c.sTravel)}`
  }
  return cmd
}

/**
 * True when live STATUS pulse ends match persisted slaveCal (last CALIBRATE / SETCAL).
 * @param {object|null|undefined} cal
 * @param {object|null|undefined} st
 */
export function slaveCalMatchesLive(cal, st) {
  const c = validateSlaveCal(cal)
  if (!c || !st) return false
  const hu = Number(st.hu)
  const tu = Number(st.tu)
  const hl = Number(st.hl)
  const tl = Number(st.tl)
  if (![hu, tu, hl, tl].every(Number.isFinite)) return false
  return c.hu === hu && c.tu === tu && c.hl === hl && c.tl === tl
}

/**
 * Push persisted calibration into slave RAM (required when cal=0 before MOVE).
 * @param {object} [cal] defaults to config.slaveCal
 */
export async function setCal(cal) {
  const payload = cal != null ? cal : getCentringConfig().slaveCal
  if (!payload) {
    throw new Error('SETCAL: no slaveCal persisted — run CALIBRATE or commission pulses first')
  }
  const cmd = formatSetCalCommand(payload)
  const st = await sendCmdQueued(cmd, STATUS_TIMEOUT)
  if (st.accepted === false || !st.cal) {
    throw new Error(
      `SETCAL failed: accepted=${st.accepted ? 1 : 0} cal=${st.cal ? 1 : 0} reason=${st.reason ?? '?'}`,
    )
  }
  return st
}

/**
 * Persist slaveCal into config store (after CAL_RESULT or commissioning).
 */
export function saveSlaveCal(cal) {
  const next = validateSlaveCal(cal)
  if (!next) throw new Error('saveSlaveCal: invalid cal payload')
  return saveCentringConfig({ ...getCentringConfig(), slaveCal: next })
}

/**
 * Ensure slave RAM matches the last persisted calibration.
 * - cal=0 → SETCAL from config
 * - cal=1 but pulses ≠ config → SETCAL (use last CALIBRATE / commissioned ends)
 * - cal=1 and no config → persist live pulses for future reconnects
 */
export async function ensureSlaveCal(st = null) {
  let s = st
  if (!s) s = await sendCmdQueued('PING', PING_TIMEOUT)
  if (s.busy) s = await waitIdle(MOVE_TIMEOUT_MS)
  const cfg = getCentringConfig()

  if (s.cal) {
    if (cfg.slaveCal && !slaveCalMatchesLive(cfg.slaveCal, s)) {
      // #region agent log
      try {
        const fsDbg = await import('node:fs')
        const payload = {
          sessionId: '03ab89',
          runId: 'setcal-sync',
          hypothesisId: 'G',
          location: 'centring_master.js:ensureSlaveCal:mismatch',
          message: 'live cal differs from persisted — pushing last slaveCal',
          data: {
            persisted: cfg.slaveCal,
            live: { calId: s.calId, hu: s.hu, tu: s.tu, hl: s.hl, tl: s.tl },
          },
          timestamp: Date.now(),
        }
        fsDbg.appendFileSync('/home/bot/US Machine/.cursor/debug-03ab89.log', `${JSON.stringify(payload)}\n`)
        fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '03ab89' },
          body: JSON.stringify(payload),
        }).catch(() => {})
      } catch { /* ignore */ }
      // #endregion
      return setCal(cfg.slaveCal)
    }
    if (
      !cfg.slaveCal
      && [s.hu, s.tu, s.hl, s.tl].every(Number.isFinite)
      && s.hu > s.tu && s.hl > s.tl
    ) {
      try {
        saveSlaveCal({
          calId: String(s.calId || 'unit_01').slice(0, 15),
          hu: s.hu,
          tu: s.tu,
          hl: s.hl,
          tl: s.tl,
        })
      } catch (err) {
        console.warn('[centring] live cal persist skipped:', err.message)
      }
    }
    return s
  }

  if (!cfg.slaveCal) {
    throw new Error(
      'Centring cal=0 and no slaveCal in config — persist pulses (CALIBRATE / SETCAL) before MOVE',
    )
  }
  // #region agent log
  try {
    const fsDbg = await import('node:fs')
    const payload = {
      sessionId: '03ab89',
      runId: 'setcal-sync',
      hypothesisId: 'G',
      location: 'centring_master.js:ensureSlaveCal:cal0',
      message: 'cal=0 — SETCAL last persisted slaveCal',
      data: { persisted: cfg.slaveCal },
      timestamp: Date.now(),
    }
    fsDbg.appendFileSync('/home/bot/US Machine/.cursor/debug-03ab89.log', `${JSON.stringify(payload)}\n`)
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '03ab89' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  } catch { /* ignore */ }
  // #endregion
  return setCal(cfg.slaveCal)
}

/**
 * On-slave hardware CALIBRATE. Persists CAL_RESULT pulses when ok=1.
 * Dual-axis sequence can exceed a single MOVE timeout — default 180s.
 */
export async function calibrate(opts = {}) {
  _pendingCalResult = null
  const timeoutMs = Number(opts.timeoutMs)
  const waitMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : Number(process.env.CENTRING_CALIBRATE_TIMEOUT_MS || 180000)
  const st = await sendCmdQueued('CALIBRATE', waitMs)
  if (st.moveEnd === MOVE_END.CAL_FAIL || st.accepted === false) {
    throw new Error(
      `CALIBRATE failed: moveEnd=${st.moveEnd} reason=${st.reason ?? '?'} accepted=${st.accepted ? 1 : 0}`,
    )
  }
  const result = _pendingCalResult
  _pendingCalResult = null
  if (result && (result.ok === '1' || result.ok === 1 || result.ok === true)) {
    const cal = {
      calId: String(result.calId || 'meas-v1').slice(0, 15),
      hu: Number(result.hu),
      tu: Number(result.tu),
      hl: Number(result.hl),
      tl: Number(result.tl),
    }
    if (result.A != null) cal.A = Number(result.A)
    if (result.B != null) cal.B = Number(result.B)
    if (result.C != null) cal.C = Number(result.C)
    if (result.sHome != null) cal.sHome = Number(result.sHome)
    if (result.sTravel != null) cal.sTravel = Number(result.sTravel)
    try {
      saveSlaveCal(cal)
    } catch (err) {
      console.warn('[centring] CAL_RESULT persist skipped:', err.message)
    }
  }
  return { status: st, calResult: result }
}

/**
 * Cold-start / reconnect ready path:
 * PING → if estop, CLEARESTOP then initialization (HOME, SETCAL, h_pre when a reference is loaded).
 * Otherwise SETCAL if cal=0 and sync mechOff.
 */
export async function ensureReady(mechOffMm) {
  const off = mechOffMm != null ? Number(mechOffMm) : getCentringConfig().mechOffsetMm
  let st = await sendCmdQueued('PING', PING_TIMEOUT)
  if (st.busy) st = await waitIdle(MOVE_TIMEOUT_MS)

  if (st.estop) {
    st = await clearEstop()
  }

  st = await ensureSlaveCal(st)

  if (st.mechOff == null || Math.abs(Number(st.mechOff) - off) > 1e-3) {
    st = await applyMechOffVerified(off)
  }

  return st
}

export async function connectWithRetry() {
  if (
    process.env.PRODUCTION_SKIP_CENTRING === '1' ||
    process.env.CENTRING_SKIP_INIT === '1'
  ) {
    setReachable(true)
    return
  }
  let lastErr = 'unreachable'
  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
    try {
      if (!hasOpenSession()) {
        await ensureSession()
      }
      let st = await sendCmdQueued('PING', PING_TIMEOUT)
      if (st?.accepted !== false) {
        if (st.busy) {
          st = await waitIdle(MOVE_TIMEOUT_MS)
        }
        if (st.estop) {
          st = await clearEstop()
        }
        try {
          st = await ensureSlaveCal(st)
        } catch (calErr) {
          // Allow connect without cal for STATUS/PING diagnostics; MOVE still gated.
          console.warn('[centring] ensureSlaveCal deferred:', calErr.message)
        }
        await syncMechOffIfNeeded(st)
        setReachable(true)
        return
      }
      lastErr = 'PING not accepted'
      closeSession()
    } catch (err) {
      if (err instanceof SessionSuperseded) throw err
      lastErr = err instanceof Error ? err.message : String(err)
      _intentionalDrop = true
      closeSession()
      _intentionalDrop = false
    }
    if (attempt < CONNECT_RETRIES) await sleep(CONNECT_RETRY_MS)
  }
  setReachable(false)
  scheduleSessionRestore('connect-with-retry')
  throw new Error(/TCP connect failed/.test(lastErr) ? lastErr : connectErrorMessage(lastErr))
}

async function syncMechOffIfNeeded(st) {
  const off = getCentringConfig().mechOffsetMm
  if (st?.mechOff != null && Math.abs(Number(st.mechOff) - off) <= 1e-3) return st
  return applyMechOffVerified(off)
}

export async function waitIdle(timeoutMs = MOVE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const s = await status()
    if (!s) { await sleep(POLL_INTERVAL); continue }
    if (!s.busy) return s
    await sleep(POLL_INTERVAL)
  }
  throw new Error(`timeout waiting for idle (${timeoutMs}ms)`)
}

async function assertCanHome() {
  const s = await status()
  if (!s) throw new Error('home blocked: STATUS unavailable')
  if (s.busy) throw new Error('home blocked: motion in progress')
  if (s.estop) throw new Error('home blocked: estop=1 — CLEARESTOP first')
  return s
}

async function assertCanMove(_axes = 'both') {
  void _axes
  const s = await status()
  if (!s) throw new Error('move blocked: STATUS unavailable')
  if (s.busy) throw new Error('move blocked: motion in progress')
  if (s.estop) throw new Error('move blocked: estop=1 — CLEARESTOP then HOME')
  if (!s.cal) throw new Error('move blocked: cal=0 — SETCAL required')
  return s
}

async function assertCanSeek() {
  const s = await status()
  if (!s) throw new Error('seek blocked: STATUS unavailable')
  if (s.busy) throw new Error('seek blocked: motion in progress')
  if (s.estop) throw new Error('seek blocked: estop=1 — CLEARESTOP first')
  return s
}

function normalizeAxis(axis) {
  const a = String(axis || 'both').toLowerCase()
  if (a === 'both' || a === 'upper' || a === 'lower') return a
  throw new Error(`invalid axis "${axis}" (use both, upper, or lower)`)
}

function assertHInRange(hMm, cfg = getCentringConfig(), statusSnap = null, singleAxis = false) {
  const h = Number(hMm)
  if (!Number.isFinite(h)) throw new Error('h must be a finite number (mm)')
  const liveMin = statusSnap?.hMin
  const liveMax = statusSnap?.hMax
  if (Number.isFinite(liveMin) && Number.isFinite(liveMax)) {
    // A single jaw can open below the both-jaws minimum.
    const under = singleAxis ? 0.5 : 0
    if (h < liveMin - under || h > liveMax) {
      throw new Error(`h ${h} mm outside slave band ${liveMin}–${liveMax} mm`)
    }
    return h
  }
  const range = getEffectiveHRangeMm(cfg)
  if (h < range.min || h > range.max) {
    throw new Error(`h ${h} mm outside band ${range.min}–${range.max} mm`)
  }
  return h
}

function formatWireNum(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) throw new Error('invalid number')
  return String(Math.round(v * 1000) / 1000)
}

function assertAccepted(st, cmd) {
  if (st.accepted === false) {
    throw new Error(
      `${cmd} rejected (accepted=0) reason=${st.reason ?? '?'} busy=${st.busy ? 1 : 0} `
      + `cal=${st.cal ? 1 : 0} estop=${st.estop ? 1 : 0} moveEnd=${st.moveEnd ?? 'none'}`,
    )
  }
  return st
}

function assertMoveHeight(st, hMm, cmd) {
  return assertMotionMoveEnd(st, hMm, cmd)
}

function motionResult(st, tag) {
  return {
    tag,
    u: st.u,
    l: st.l,
    h: st.h,
    cal: st.cal,
    estop: st.estop,
    reason: st.reason,
    homedUpper: st.homedUpper,
    homedLower: st.homedLower,
    homedU: st.homedUpper,
    homedL: st.homedLower,
    accepted: st.accepted,
    moveEnd: st.moveEnd,
    targetH: st.targetH,
    status: st,
    raw: st.raw,
  }
}

/**
 * Version 2 calibration drive. CAL_OPEN* / CAL_CLOSE* step until the target
 * switch. They do not run the Version 1 HOME / SEEK_TRAVEL crawl.
 * @param {'open'|'close'} end
 * @param {'both'|'upper'|'lower'} axis
 */
export async function calDrive(end, axis = 'both', opts = {}) {
  const which = end === 'open' ? 'OPEN' : 'CLOSE'
  const ax = axis === 'upper' ? 'U' : axis === 'lower' ? 'L' : 'BOTH'
  const cmd = `CALDRV ${which} ${ax}`
  const st = await sendCmdQueued(cmd, opts.timeoutMs || 70000)
  if (!st) throw new Error(`${cmd}: no STATUS`)
  if (st.accepted === false) {
    throw new Error(`${cmd} rejected: reason=${st.reason || 'unknown'} moveEnd=${st.moveEnd || '?'}`)
  }
  if (st.busy) throw new Error(`${cmd}: still busy`)
  const mend = String(st.moveEnd || '')
  if (mend === 'timeout' || mend === 'estop' || mend === 'link_lost' || mend === 'stall') {
    throw new Error(`${cmd} failed: moveEnd=${mend}`)
  }
  return st
}

export async function homeBoth(opts = {}) {
  await assertCanHome()
  const st = assertHomeMoveEnd(
    await sendCmdQueued('HOME', opts.timeoutMs || HOME_TIMEOUT_MS),
    { needUpper: true, needLower: true, cmd: 'HOME' },
  )
  return motionResult(st, 'HOME')
}

export async function homeUpper(opts = {}) {
  await assertCanHome()
  const st = assertHomeMoveEnd(
    await sendCmdQueued('HOME_UPPER', opts.timeoutMs || HOME_TIMEOUT_MS),
    { needUpper: true, needLower: false, cmd: 'HOME_UPPER' },
  )
  return motionResult(st, 'HOME_UPPER')
}

export async function homeLower(opts = {}) {
  await assertCanHome()
  const st = assertHomeMoveEnd(
    await sendCmdQueued('HOME_LOWER', opts.timeoutMs || HOME_TIMEOUT_MS),
    { needUpper: false, needLower: true, cmd: 'HOME_LOWER' },
  )
  return motionResult(st, 'HOME_LOWER')
}

export async function seekTravelBoth(opts = {}) {
  await assertCanSeek()
  const st = await sendCmdQueued('SEEK_TRAVEL', opts.timeoutMs || MOVE_TIMEOUT_MS)
  if (!travelSwitchesDone(st)) {
    throw new Error(
      `SEEK_TRAVEL stopped before the TRAVEL switch was reached — `
      + `ut=${st?.ut ? 1 : 0} lt=${st?.lt ? 1 : 0} moveEnd=${st?.moveEnd ?? 'none'}`,
    )
  }
  return motionResult(st, 'SEEK_TRAVEL')
}

/**
 * Move to travel (closed) idle.
 * both → SEEK_TRAVEL. Single axis → SEEK_TRAVEL_UPPER / SEEK_TRAVEL_LOWER when available,
 * else close that axis via MOVE to S_MAX-equivalent height.
 */
export async function seekTravelByAxis(axis = 'both', opts = {}) {
  const ax = normalizeAxis(axis)
  if (ax === 'both') return seekTravelBoth(opts)
  await assertCanSeek()
  const cmd = ax === 'upper' ? 'SEEK_TRAVEL_UPPER' : 'SEEK_TRAVEL_LOWER'
  const st = await sendCmdQueued(cmd, opts.timeoutMs || MOVE_TIMEOUT_MS)
  const onSwitch = ax === 'upper'
    ? travelSwitchesDone(st, { needUpper: true, needLower: false })
    : travelSwitchesDone(st, { needUpper: false, needLower: true })
  if (!onSwitch) {
    const bit = ax === 'upper' ? 'ut' : 'lt'
    const on = ax === 'upper' ? st?.ut : st?.lt
    throw new Error(
      `${cmd} stopped before the TRAVEL switch was reached — ${bit}=${on ? 1 : 0} moveEnd=${st?.moveEnd ?? 'none'}`,
    )
  }
  return motionResult(st, cmd)
}

export async function setMechOffsetMm(offsetMm) {
  const off = Number(offsetMm)
  if (!Number.isFinite(off)) throw new Error('setMechOffsetMm: offset must be finite')
  const st = assertAccepted(
    await sendCmdQueued(`SETMECHOFF ${formatWireNum(off)}`, STATUS_TIMEOUT),
    'SETMECHOFF',
  )
  return st
}

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

export async function homeByAxis(axis = 'both', opts = {}) {
  const ax = normalizeAxis(axis)
  if (ax === 'upper') return homeUpper(opts)
  if (ax === 'lower') return homeLower(opts)
  return homeBoth(opts)
}

function assertMoveReachable(hMm, moveCommand, statusSnap, cfg = getCentringConfig()) {
  try {
    gapMmToMoveTarget({
      gapMm: hMm,
      moveCommand,
      uNow: statusSnap.u,
      lNow: statusSnap.l,
      mechOffsetMm: cfg.mechOffsetMm,
    })
  } catch (err) {
    throw new Error(`${moveCommand} ${hMm} mm unreachable at u=${statusSnap.u} l=${statusSnap.l}: ${err.message}`)
  }
}

export async function moveBoth(hMm, speedDegS) {
  const cfg = getCentringConfig()
  const s = await assertCanMove('both')
  const h = assertHInRange(hMm, cfg, s)
  assertMoveReachable(h, 'MOVEBOTHMM', s, cfg)
  const spd = speedDegS ?? cfg.movementSpeedDegS
  const cmd = `MOVEBOTHMM ${formatWireNum(h)} ${formatWireNum(spd)}`
  const st = assertMoveHeight(await sendCmdQueued(cmd, MOVE_TIMEOUT_MS), h, 'MOVEBOTHMM')
  return motionResult(st, 'MOVEBOTHMM')
}

export async function moveUpper(hMm, speedDegS) {
  const cfg = getCentringConfig()
  const s = await assertCanMove('upper')
  const h = assertHInRange(hMm, cfg, s, true)
  assertMoveReachable(h, 'MOVE_UPPERMM', s, cfg)
  const spd = speedDegS ?? cfg.movementSpeedDegS
  const wireH = formatWireNum(h)
  const cmd = `MOVE_UPPERMM ${wireH} ${formatWireNum(spd)}`
  // #region agent log
  try {
    const payload = {sessionId:'b7dbac',runId:'post-fix',hypothesisId:'F',location:'centring_master.js:moveUpper',message:'MOVE_UPPERMM dispatch',data:{hMm:h,wireH,u:s?.u,l:s?.l,statusH:s?.h,hMin:s?.hMin,hMax:s?.hMax},timestamp:Date.now()}
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b7dbac'},body:JSON.stringify(payload)}).catch(()=>{})
    fs.appendFileSync('/home/bot/US Machine/.cursor/debug-b7dbac.log', `${JSON.stringify(payload)}\n`)
  } catch (_) { /* ignore debug I/O */ }
  // #endregion
  const st = assertMoveHeight(await sendCmdQueued(cmd, MOVE_TIMEOUT_MS), h, 'MOVE_UPPERMM')
  return motionResult(st, 'MOVE_UPPERMM')
}

export async function moveLower(hMm, speedDegS) {
  const cfg = getCentringConfig()
  const s = await assertCanMove('lower')
  const h = assertHInRange(hMm, cfg, s, true)
  assertMoveReachable(h, 'MOVE_LOWERMM', s, cfg)
  const spd = speedDegS ?? cfg.movementSpeedDegS
  const cmd = `MOVE_LOWERMM ${formatWireNum(h)} ${formatWireNum(spd)}`
  const st = assertMoveHeight(await sendCmdQueued(cmd, MOVE_TIMEOUT_MS), h, 'MOVE_LOWERMM')
  return motionResult(st, 'MOVE_LOWERMM')
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
  clearEstop,
  recover,
  ensureReady,
  ensureSlaveCal,
  setCal,
  saveSlaveCal,
  formatSetCalCommand,
  slaveCalMatchesLive,
  calibrate,
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
  hasOpenSession,
  killCentringSession,
  reconnectCentringSession,
  getCentringTcpSessionInfo,
  setCentringProductionTcpHold,
  getCentringProductionTcpHold,
  healthProbeCentring,
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
  mapFirmwareStatus,
  assertHomeMoveEnd,
  assertMotionMoveEnd,
  MOVE_END,
}
