/**
 * Pick & Place TCP master — New_version_pick&place (master ↔ Nano slave 192.168.10.5:8177)
 *
 * Wire protocol (src/main.cpp):
 *   HOMEA <backoff> <speed>   HOMEB <backoff> <speed>   HOME <mmA> <mmB> <speed>
 *   MOVEAMM <pos_mm> <speed>  MOVEBMM <pos_mm> <speed>
 *   MOVEAMMT1 / MOVEAMMT2 — diagnostic moves (enable pin test modes)
 *
 * Env: PICK_PLACE_HOST, PICK_PLACE_PORT, PICK_PLACE_CONFIG_PATH, PICK_PLACE_SINGLE_MOTOR
 */

import fs from 'fs'
import http from 'http'
import net from 'net'
import path from 'path'
import { EventEmitter } from 'events'
import { fileURLToPath } from 'url'
import {
  buildConnectionDiagnosis,
  formatDiagnosisReport,
  NANO_IP_DEFAULT,
  NANO_PORT_DEFAULT,
  subnetReachable,
} from './lib/network_diag.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── Configuration (persisted JSON) ─────────────────────────────────────────

const CONFIG_PATH = process.env.PICK_PLACE_CONFIG_PATH
  || path.join(__dirname, 'data', 'pick_place_config.json')

export const DEFAULT_PICK_PLACE_CONFIG = {
  movementSpeedMmS: 80,
  homingSpeedMmS: 80,
  backoffMmA: 0.5,
  backoffMmB: 0.8,
  referenceAxis: 'a',
}

let configCached = null

function ensureConfigDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function validatePickPlaceConfig(raw) {
  const out = { ...DEFAULT_PICK_PLACE_CONFIG, ...raw }
  const move = Number(out.movementSpeedMmS)
  const home = Number(out.homingSpeedMmS)
  const bkA = Number(out.backoffMmA)
  const bkB = Number(out.backoffMmB)
  const ref = String(out.referenceAxis || 'a').toLowerCase()
  const maxSpd = STEP_MAX_HZ / DEFAULT_SPMM

  if (!Number.isFinite(move) || move <= 0 || move > maxSpd) {
    throw new Error(`movementSpeedMmS must be 0.01–${maxSpd}`)
  }
  if (!Number.isFinite(home) || home <= 0 || home > maxSpd) {
    throw new Error(`homingSpeedMmS must be 0.01–${maxSpd}`)
  }
  if (!Number.isFinite(bkA) || bkA < HOME_BACKOFF_MM_MIN || bkA > HOME_BACKOFF_MM_MAX) {
    throw new Error(`backoffMmA must be ${HOME_BACKOFF_MM_MIN}–${HOME_BACKOFF_MM_MAX}`)
  }
  if (!Number.isFinite(bkB) || bkB < HOME_BACKOFF_MM_MIN || bkB > HOME_BACKOFF_MM_MAX) {
    throw new Error(`backoffMmB must be ${HOME_BACKOFF_MM_MIN}–${HOME_BACKOFF_MM_MAX}`)
  }
  if (ref !== 'a' && ref !== 'b') throw new Error('referenceAxis must be a or b')

  return {
    movementSpeedMmS: move,
    homingSpeedMmS: home,
    backoffMmA: bkA,
    backoffMmB: bkB,
    referenceAxis: ref,
  }
}

export function loadPickPlaceConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      configCached = validatePickPlaceConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')))
      return { ...configCached }
    }
  } catch (err) {
    console.warn(`[pick-place] config load failed (${CONFIG_PATH}): ${err.message}`)
  }
  configCached = { ...DEFAULT_PICK_PLACE_CONFIG }
  return { ...configCached }
}

export function getPickPlaceConfig() {
  if (!configCached) loadPickPlaceConfig()
  return { ...configCached }
}

export function savePickPlaceConfig(partial) {
  const next = validatePickPlaceConfig({ ...getPickPlaceConfig(), ...partial })
  ensureConfigDir(CONFIG_PATH)
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  configCached = next
  return { ...configCached }
}

export function getConfigPath() {
  return CONFIG_PATH
}

// ─── TCP client (Nano @ 192.168.10.5:8177) ──────────────────────────────────

const HOST            = process.env.PICK_PLACE_HOST || '192.168.10.5'
const PORT            = Number(process.env.PICK_PLACE_PORT || 8177)
/** 1 = only motor A fitted (HOME/HOMEB alias to A); 0 = dual motor */
const SINGLE_MOTOR    = Number(process.env.PICK_PLACE_SINGLE_MOTOR || process.env.PICK_PLACE_BENCH_AXIS || 0)
const CONNECT_TIMEOUT = Number(process.env.PICK_PLACE_CONNECT_TIMEOUT_MS || 10_000)
const CONNECT_RETRIES   = Number(process.env.PICK_PLACE_CONNECT_RETRIES || 3)
const CONNECT_RETRY_MS  = Number(process.env.PICK_PLACE_CONNECT_RETRY_MS || 2000)
const CMD_TIMEOUT     = 15000
const STATUS_TIMEOUT  = 5000
const PING_TIMEOUT    = 2000
const TCP_CMD_MAX_LEN = 79
const REPLY_MAX_LEN   = 224
const POLL_INTERVAL   = 300

const STEP_MIN_HZ       = 200
const STEP_MAX_HZ       = 40000
const HOMING_SEARCH_HZ  = 800
const HOMING_BACKOFF_HZ = 400
const HOME_TIMEOUT_MS   = 120_000
const HOME_TIMEOUT_RECOVERABLE = 226
/** Default homing backoff (mm) — master must send on every HOME/HOMEA/HOMEB */
export const DEFAULT_HOME_BACKOFF_MM_A = 0.5
export const DEFAULT_HOME_BACKOFF_MM_B = 0.8
/** @deprecated use DEFAULT_HOME_BACKOFF_MM_A */
export const DEFAULT_HOME_BACKOFF_MM = DEFAULT_HOME_BACKOFF_MM_A
/** Reference axis for dual logical coordinates (HOME both → posA=posB=backoffA). */
export const REFERENCE_AXIS = 'a'
export const HOME_BACKOFF_MM_MIN = 0.01
export const HOME_BACKOFF_MM_MAX = 50
const RAMP_HZ_PER_SEC   = 8000
const JOG_SEGMENT_MM    = 5
const DEFAULT_BELT_PITCH_MM = 2
const DEFAULT_PPR       = 400
const DEFAULT_TEETH     = 20
const DEFAULT_SPR       = 200
/** Fixed in firmware — STATUS emits pulseMm=300 (0.3 mm/pulse → 10/3 steps/mm). */
export const FIRMWARE_STEPS_PER_MM = 10 / 3
export const FIRMWARE_PULSE_MM_MILLI = 300
const DEFAULT_SPMM = FIRMWARE_STEPS_PER_MM

const HOME_WAIT_MS = { both: 270_000, a: 150_000, b: 150_000 }

const HOME_STATE = {
  0: 'IDLE', 1: 'HOME_A_SEEK', 2: 'HOME_A_BACKOFF', 3: 'HOME_B_SEEK', 4: 'HOME_B_BACKOFF',
  5: 'HOME_BOTH_SEEK',
}

const REMOVED_CMD = 'command removed from minimal firmware'

export const FIRMWARE_ERR_HINTS = {
  busy: 'async or motion in progress — wait for DONE/idle or send STOP',
  fault: 'fault latched — call recover() or POST /api/pick-place/recover, then HOME*',
  estop: 'e-stop latched — call recover() or POST /api/pick-place/recover after safe',
  hw_alarm: 'drive AL− asserted — fix drive hardware',
  blocked: 'move rejected by master backend (homed/fault/busy/limit)',
  zero: 'move distance rounds to zero steps',
  fail: 'move/homing start failed on Nano',
  not_homed: 'axis not homed — run HOME/HOMEA/HOMEB first',
  stopped: 'cancelled by STOP (homed flags kept unless ESTOP)',
  timeout: 'homing seek timeout (0xE2 — recover() then retry HOME*)',
  backoff: 'backoff mm out of range (0.01–50)',
  'backoff range': 'backoff mm out of range (0.01–50)',
  args: 'missing or invalid command arguments (backoff/speed mm/s)',
  'args required': 'backoff mm and homing speed mm/s required on wire',
}

export const ALARM_CODES = {
  226: 'home seek timeout (0xE2 — call recover() on master, then retry HOME*)',
  241: 'axis A TRAVEL limit hit during positive move (0xF1)',
  242: 'axis B TRAVEL limit hit during positive move (0xF2)',
  243: 'axis A HOME limit hit during negative move (0xF3)',
  244: 'axis B HOME limit hit during negative move (0xF4)',
  161: 'ESS57 drive alarm — motor A (0xA1)',
  162: 'ESS57 drive alarm — motor B (0xA2)',
  163: 'ESS57 drive alarm — both motors (0xA3)',
}

const emitter = new EventEmitter()
let cmdSendChain = Promise.resolve()

loadPickPlaceConfig()

const sleep = ms => new Promise(r => setTimeout(r, ms))

function clientError(msg) {
  const e = new Error(msg)
  e.statusCode = 400
  return e
}

function parseKvLine(line) {
  const kv = {}
  for (const part of line.trim().split(/\s+/)) {
    const eq = part.indexOf('=')
    if (eq > 0) kv[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return kv
}

function num(kv, key, fallback = 0) {
  const v = parseFloat(kv[key])
  return Number.isFinite(v) ? v : fallback
}

function flag(kv, key) {
  return kv[key] === '1'
}

function resolveStepsPerMm(kv) {
  const pulseMm = num(kv, 'pulseMm', FIRMWARE_PULSE_MM_MILLI)
  if (pulseMm > 0) return 1000 / pulseMm
  const parsed = parseFloat(kv.spmm)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  const ppr = num(kv, 'ppr', DEFAULT_PPR)
  const teeth = num(kv, 'teeth', DEFAULT_TEETH)
  if (ppr > 0 && teeth > 0) return ppr / (teeth * DEFAULT_BELT_PITCH_MM)
  return DEFAULT_SPMM
}

/** Map firmware ERR tag to async command tag (ERR MOVEMM → MOVEAMM/MOVEBMM). */
export function errLineMatchesTag(line, tag) {
  const m = /^ERR\s+(\S+)/.exec(String(line || '').trim())
  if (!m) return false
  const errTag = m[1]
  if (errTag === tag) return true
  if (errTag === 'MOVEMM' && (tag === 'MOVEAMM' || tag === 'MOVEBMM' || tag === 'MOVEAMMT1' || tag === 'MOVEAMMT2')) {
    return true
  }
  return false
}

function decodeAlarmCode(code) {
  const n = Number(code) || 0
  if (n === 0) return null
  const hex = `0x${n.toString(16).toUpperCase()}`
  return ALARM_CODES[n] ? `${hex}: ${ALARM_CODES[n]}` : `${hex}: unknown fault`
}

function formatFirmwareErr(line) {
  const trimmed = line.trim()
  const m = /^ERR\s+(\S+)(?:\s+(.+))?$/.exec(trimmed)
  if (!m) return trimmed
  const [, cmd, reason] = m
  if (reason) {
    const hint = FIRMWARE_ERR_HINTS[reason]
      || (/^0x[0-9A-F]+$/i.test(reason) ? decodeAlarmCode(parseInt(reason, 16)) : null)
    if (hint) return `${trimmed} (${hint})`
  }
  if (/^HOME/.test(cmd) && !reason) {
    return `${trimmed} (canRun=false — clear fault or retry if 0xE2)`
  }
  return trimmed
}

function isRecoverableHomingFault(alarmCode, fault) {
  /* almCode (0xE2 = 226) is not in minimal STATUS — only set when firmware emits it. */
  return !!fault && Number(alarmCode) === HOME_TIMEOUT_RECOVERABLE
}

function hasLimitSwitchFields(kv) {
  return 'homeA' in kv || 'travA' in kv || 'homeB' in kv || 'travB' in kv
}

function buildSwitches(kv) {
  return {
    A: { home: flag(kv, 'homeA'), travel: flag(kv, 'travA'), alarm: flag(kv, 'almA'),
      pins: { home: 'D3', travel: 'A5', alarm: 'A2' } },
    B: { home: flag(kv, 'homeB'), travel: flag(kv, 'travB'), alarm: flag(kv, 'almB'),
      pins: { home: 'D4', travel: 'A4', alarm: 'A3' } },
  }
}

function mapFirmwareStatus(kv) {
  /* Minimal firmware STATUS (src/main.cpp):
     stepA stepB busy homeSt homedA homedB async fault estop — limit switches and almCode are not on the wire. */
  const cfg = getPickPlaceConfig()
  const spmm = resolveStepsPerMm(kv)
  const stepA = num(kv, 'stepA')
  const stepB = num(kv, 'stepB')
  const homeSt = Number(kv.homeSt || 0)
  const busy = flag(kv, 'busy')
  const fault = flag(kv, 'fault')
  const homedA = flag(kv, 'homedA')
  const homedB = flag(kv, 'homedB')
  const asyncCmd = Number(kv.async || 0)
  const switchesAvailable = hasLimitSwitchFields(kv)
  const switches = switchesAvailable ? buildSwitches(kv) : null
  const statusTruncated = !('spmm' in kv) || !switchesAvailable

  const estop = 'estop' in kv ? flag(kv, 'estop') : false
  const almFlt = 'almFlt' in kv ? flag(kv, 'almFlt') : false
  const hwAlm = switchesAvailable
    ? (flag(kv, 'almA') || flag(kv, 'almB'))
    : false
  const alarmCode = Number(kv.almCode || 0)
  const canRun = kv.run != null ? flag(kv, 'run') : (!fault && !estop)
  const curHz = 'curHz' in kv ? num(kv, 'curHz') : 0

  let state = 'IDLE'
  if (fault || estop) state = 'ERROR'
  else if (homeSt !== 0) state = 'HOMING'
  else if (busy) state = 'MOVING'

  const positions = { A: stepA / spmm, B: stepB / spmm }
  const backoffA = 'homeBkA' in kv ? num(kv, 'homeBkA') : cfg.backoffMmA
  const backoffB = 'homeBkB' in kv ? num(kv, 'homeBkB') : cfg.backoffMmB

  return {
    state,
    position: positions.A,
    speed: curHz > 0 ? curHz / spmm : null,
    enabled: 'enA' in kv ? (flag(kv, 'enA') || flag(kv, 'enB')) : null,
    enabledA: 'enA' in kv ? flag(kv, 'enA') : null,
    enabledB: 'enB' in kv ? flag(kv, 'enB') : null,
    enableLatchA: 'enLatchA' in kv ? flag(kv, 'enLatchA') : null,
    enableLatchB: 'enLatchB' in kv ? flag(kv, 'enLatchB') : null,
    busy: busy ? 1 : 0,
    motorErr: almFlt || hwAlm,
    fault, estop, alarmFault: almFlt, hwAlarmActive: hwAlm,
    limMin: switches ? (switches.A.home || switches.B.home) : null,
    limMax: switches ? (switches.A.travel || switches.B.travel) : null,
    limMinA: switches ? switches.A.home : null,
    limMaxA: switches ? switches.A.travel : null,
    limMinB: switches ? switches.B.home : null,
    limMaxB: switches ? switches.B.travel : null,
    switchesAvailable,
    positionA: positions.A,
    positionB: positions.B,
    positions,
    stepsPerMm: spmm,
    beltPitchMm: DEFAULT_BELT_PITCH_MM,
    ethReady: 'eth' in kv ? flag(kv, 'eth') : null,
    canRun,
    homedA,
    homedB,
    homed: { A: homedA, B: homedB },
    asyncCmd,
    asyncBusy: asyncCmd !== 0,
    homeSt,
    homeState: HOME_STATE[homeSt] || `HOME_${homeSt}`,
    alarmCode,
    remainingSteps: 'rem' in kv ? num(kv, 'rem') : null,
    moveHz: 'hz' in kv ? num(kv, 'hz') : null,
    currentHz: curHz > 0 ? curHz : null,
    homeBackoffMmA: backoffA,
    homeBackoffMmB: backoffB,
    homeBackoffMm: backoffA,
    alarmText: alarmCode ? decodeAlarmCode(alarmCode) : null,
    recoverableHomingFault: isRecoverableHomingFault(alarmCode, fault),
    homing: {
      state: HOME_STATE[homeSt] || `HOME_${homeSt}`,
      homeSt,
      homedA,
      homedB,
      backoffMm: backoffA,
      backoffMmA: backoffA,
      backoffMmB: backoffB,
    },
    switches,
    raw: kv,
    statusTruncated,
  }
}

function normalizeAxis(axis) {
  const a = String(axis || 'both').toLowerCase()
  if (a === 'a' || a === 'b' || a === 'both') return a
  throw clientError(`invalid axis "${axis}" (use a, b, or both)`)
}

function validateSpeedMmS(mmps, label = 'speed') {
  const n = Number(mmps)
  const max = STEP_MAX_HZ / DEFAULT_SPMM
  if (!Number.isFinite(n) || n <= 0 || n > max) {
    throw clientError(`${label} must be 0.01–${max} mm/s`)
  }
  return n
}

function formatWireNum(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return String(Number(v.toFixed(3)))
}

function validateBackoffMm(mm, label = 'backoff') {
  const n = Number(mm)
  if (!Number.isFinite(n) || n < HOME_BACKOFF_MM_MIN || n > HOME_BACKOFF_MM_MAX) {
    throw clientError(`${label} must be ${HOME_BACKOFF_MM_MIN}–${HOME_BACKOFF_MM_MAX} mm`)
  }
  return n
}

export function parseDoneLine(line) {
  const trimmed = String(line || '').trim()
  const kv = parseKvLine(trimmed)
  const parts = trimmed.split(/\s+/)
  const tag = parts[1] || parts[0]?.replace(/^DONE/, '') || ''
  const out = { tag, raw: trimmed, ok: trimmed.startsWith('DONE') }
  if ('posA' in kv) out.positionA = Number(kv.posA)
  if ('posB' in kv) out.positionB = Number(kv.posB)
  if ('homedA' in kv) out.homedA = kv.homedA === '1'
  if ('homedB' in kv) out.homedB = kv.homedB === '1'
  if ('bkA' in kv) out.backoffA = Number(kv.bkA)
  if ('bkB' in kv) out.backoffB = Number(kv.bkB)
  if (out.positionA != null && out.positionB != null) {
    out.positions = { A: out.positionA, B: out.positionB }
    out.position = out.positionA
  }
  return out
}

export function buildHomingResult(done, status, axis, referenceAxis) {
  const ax = normalizeAxis(axis)
  const cfg = getPickPlaceConfig()
  const ref = ax === 'both' ? normalizeRefAxis(referenceAxis ?? cfg.referenceAxis) : ax
  const s = status || {}
  const posA = done?.positionA ?? s.positionA ?? 0
  const posB = done?.positionB ?? s.positionB ?? 0
  const homedA = done?.homedA ?? s.homedA ?? false
  const homedB = done?.homedB ?? s.homedB ?? false
  /* bkA/bkB from DONE = physical backoff mm (always mmA/mmB wire values, e.g. 0.5 / 0.8). */
  const bkA = done?.backoffA ?? s.homeBackoffMmA ?? cfg.backoffMmA
  const bkB = done?.backoffB ?? s.homeBackoffMmB ?? cfg.backoffMmB
  const logicalRefMm = ref === 'b' ? posB : posA
  const result = {
    ok: true,
    axis: ax,
    referenceAxis: ax === 'both' ? ref : undefined,
    positionA: posA,
    positionB: posB,
    positions: { A: posA, B: posB },
    homed: { A: homedA, B: homedB },
    homedA,
    homedB,
    physicalBackoff: { a: bkA, b: bkB, mmA: bkA, mmB: bkB },
    backoff: { a: bkA, b: bkB, mmA: bkA, mmB: bkB },
    logicalPositionMm: logicalRefMm,
    doneLine: done?.raw,
  }
  if (ax === 'a') result.position = posA
  else if (ax === 'b') result.position = posB
  else result.position = logicalRefMm
  return result
}

export function buildMoveResult(done, status, axis, referenceAxis) {
  const ax = normalizeAxis(axis)
  const cfg = getPickPlaceConfig()
  const ref = ax === 'both' ? normalizeRefAxis(referenceAxis ?? cfg.referenceAxis) : ax
  const s = status || {}
  const posA = done?.positionA ?? s.positionA ?? 0
  const posB = done?.positionB ?? s.positionB ?? 0
  const result = {
    ok: true,
    axis: ax,
    referenceAxis: ax === 'both' ? ref : undefined,
    positionA: posA,
    positionB: posB,
    positions: { A: posA, B: posB },
    homedA: done?.homedA ?? s.homedA,
    homedB: done?.homedB ?? s.homedB,
    homed: { A: done?.homedA ?? s.homedA, B: done?.homedB ?? s.homedB },
    physicalBackoff: {
      a: done?.backoffA ?? s.homeBackoffMmA ?? cfg.backoffMmA,
      b: done?.backoffB ?? s.homeBackoffMmB ?? cfg.backoffMmB,
    },
    doneLine: done?.raw,
  }
  const logicalRefMm = ref === 'b' ? posB : posA
  if (ax === 'a') result.position = posA
  else if (ax === 'b') result.position = posB
  else result.position = logicalRefMm
  return result
}

function benchSingleMotor() {
  return SINGLE_MOTOR === 1
}

export function axisHomed(s, axis = 'both') {
  if (!s) return false
  if (axis === 'a') return !!s.homedA
  if (axis === 'b') return benchSingleMotor() ? !!s.homedA : !!s.homedB
  if (benchSingleMotor()) return !!s.homedA
  return !!s.homedA && !!s.homedB
}

function mmToHz(mmps, spmm) {
  const hz = Math.round(Math.max(0.01, Number(mmps)) * spmm)
  return Math.max(STEP_MIN_HZ, Math.min(STEP_MAX_HZ, hz))
}

function hzToMm(hz, spmm) {
  return Number(hz) / spmm
}

function validateCmd(cmd) {
  if (!cmd || cmd.length > TCP_CMD_MAX_LEN) {
    throw new Error(`command exceeds ${TCP_CMD_MAX_LEN} chars (firmware CMD_LINE_MAX)`)
  }
}

function connectErrorMessage(cause) {
  const base = `TCP connect failed (${HOST}:${PORT})`
  const hint = [
    'Verify Nano is powered and flashed with env `nano` (Ethernet TCP 8177).',
    'Bot/master must be on 192.168.10.0/24 (typically 192.168.10.1); Nano is 192.168.10.5.',
    `From bot: ping 192.168.10.5  then  nc -zv 192.168.10.5 8177  (or telnet).`,
    'Check ENC28J60 cable, switch, and RGB on Nano (magenta = gateway/ETH fault).',
    `Override host: PICK_PLACE_HOST / PICK_PLACE_PORT env on us-machine-headless-web.service.`,
  ].join(' ')
  return cause ? `${base}: ${cause}. ${hint}` : `${base}. ${hint}`
}

/** One TCP transaction (request-response). Used by PickPlaceTcpSession. */
class PickPlaceTcpSession {
  constructor(host = HOST, port = PORT) {
    this.host = host
    this.port = port
  }

  transact(cmd, terminator, timeout, errTag = null) {
    return tcpTransactOn(this.host, this.port, cmd, terminator, timeout, errTag)
  }
}

function tcpTransactOn(host, port, cmd, terminator, timeout, errTag = null) {
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

    sock.on('error', err => {
      finish(reject, new Error(connectErrorMessage(err.message)))
    })

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
          if (errTag && !errLineMatchesTag(line, errTag)) {
            emitter.emit('line', line)
            continue
          }
          finish(reject, new Error(formatFirmwareErr(line)))
          return
        }
        if (line.startsWith('EVENT') || line.startsWith('HELLO')) {
          emitter.emit('event', line)
          continue
        }
        emitter.emit('line', line)
      }
    })

    sock.on('close', () => {
      if (!settled) {
        finish(reject, new Error(`TCP closed before reply (cmd: "${cmd}")`))
      }
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

function tcpTransact(cmd, terminator, timeout, errTag = null) {
  return tcpTransactOn(HOST, PORT, cmd, terminator, timeout, errTag)
}

/** Probe Nano TCP without keeping session (for health checks). */
export { formatDiagnosisReport, NANO_IP_DEFAULT, NANO_PORT_DEFAULT }

export async function diagnoseConnection(host = HOST, port = PORT) {
  const subnet = subnetReachable(host)
  let probe = { ok: false, error: subnet.ok ? 'not probed' : 'subnet mismatch' }
  if (subnet.ok) {
    probe = await probeConnection(CONNECT_TIMEOUT)
  }
  return buildConnectionDiagnosis(host, port, probe, subnet)
}

export async function probeConnection(timeoutMs = CONNECT_TIMEOUT) {
  return new Promise(resolve => {
    const sock = new net.Socket()
    const timer = setTimeout(() => {
      sock.destroy()
      resolve({ ok: false, target: `${HOST}:${PORT}`, error: 'timeout' })
    }, timeoutMs)
    sock.once('error', err => {
      clearTimeout(timer)
      sock.destroy()
      resolve({ ok: false, target: `${HOST}:${PORT}`, error: err.message })
    })
    sock.connect(PORT, HOST, () => {
      clearTimeout(timer)
      sock.end()
      resolve({ ok: true, target: `${HOST}:${PORT}` })
    })
  })
}

/** No-op — each command opens its own TCP socket. Kept for API compatibility. */
export function connect() {
  return Promise.resolve()
}

export async function connectWithRetry() {
  const probe = await probeConnection()
  if (!probe.ok) throw new Error(connectErrorMessage(probe.error || 'unreachable'))
}

export function disconnect() {
  /* transient TCP — nothing to tear down */
}

async function sendCommand(cmd, terminator = 'OK', timeout = CMD_TIMEOUT, errTag = null) {
  const p = cmdSendChain.then(() => tcpTransact(cmd, terminator, timeout, errTag))
  cmdSendChain = p.catch(() => {})
  return p
}

/**
 * Async motion/homing — returns parsed DONE fields (posA, posB, homed*, bk*).
 */
async function sendAsyncCommand(cmd, timeoutMs, opts = {}) {
  const tag = cmd.split(/\s+/)[0]
  const isHome = /^HOME/i.test(tag)
  const {
    busyRetries = 3,
    busyWaitMs = 60_000,
    timeoutRetries = isHome ? 1 : 0,
  } = opts

  for (let timeoutAttempt = 0; timeoutAttempt <= timeoutRetries; timeoutAttempt++) {
    for (let attempt = 0; attempt < busyRetries; attempt++) {
      try {
        if (attempt > 0) await stop().catch(() => {})
        if (timeoutAttempt > 0) {
          console.warn(`[pick-place] ${cmd} timeout — retry ${timeoutAttempt}/${timeoutRetries}`)
          await sleep(500)
          await waitIdle(Math.min(busyWaitMs, timeoutMs)).catch(() => {})
        }
        const line = await sendCommand(cmd, `DONE ${tag}`, timeoutMs, tag)
        return parseDoneLine(line.trim())
      } catch (err) {
        const msg = String(err.message)
        if (msg.includes(' busy') && attempt < busyRetries - 1) {
          console.warn(`[pick-place] ${cmd} busy — waiting for idle (${attempt + 1}/${busyRetries})`)
          await waitIdle(Math.min(busyWaitMs, timeoutMs))
          continue
        }
        const isTimeout = /\btimeout\b/i.test(msg)
        if (isHome && isTimeout && timeoutAttempt < timeoutRetries) break
        throw err
      }
    }
  }
  throw new Error(`${cmd} failed after retries`)
}

async function readStatusRaw() {
  try {
    const line = await sendCommand('STATUS', 'stepA=', STATUS_TIMEOUT)
    return mapFirmwareStatus(parseKvLine(line))
  } catch (err) {
    if (String(err.message).includes('STATUS')) return null
    throw err
  }
}

function faultDuringWait(s) {
  if (!s.fault && !s.estop && !s.alarmFault && !s.hwAlarmActive) return null
  if (isRecoverableHomingFault(s.alarmCode, s.fault)) {
    return new Error(`homing timeout (${s.alarmText || '0xE2'})`)
  }
  const detail = s.alarmText || `almCode=${s.alarmCode}`
  return new Error(`fault during operation (${detail}, homeSt=${s.homeState})`)
}

export async function waitIdle(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const s = await readStatusRaw()
    if (!s) { await sleep(POLL_INTERVAL); continue }
    const err = faultDuringWait(s)
    if (err) throw err
    if (!s.busy && s.homeSt === 0 && s.state !== 'HOMING' && s.state !== 'MOVING') {
      return s
    }
    await sleep(POLL_INTERVAL)
  }
  throw new Error(`timeout waiting for idle (${timeoutMs}ms)`)
}

function homingBlockedReason(s) {
  if (s.estop) return 'e-stop latched — call recover() or POST /api/pick-place/recover after safe'
  if (s.fault) return 'fault latched — call recover() or POST /api/pick-place/recover, then HOME*'
  if (s.alarmFault || s.hwAlarmActive) return 'drive alarm active — fix hardware, then recover()'
  if (s.asyncBusy) return `async command in progress (async=${s.asyncCmd})`
  if (s.busy) return 'motion in progress'
  if (s.homeSt !== 0) return 'homing in progress'
  return null
}

async function assertCanHome() {
  const s = await readStatusRaw()
  if (!s) throw clientError('home blocked: STATUS unavailable')
  const reason = homingBlockedReason(s)
  if (reason) throw clientError(`home blocked: ${reason}`)
  return s
}

function motionBlockedReason(s, axes = 'both') {
  if (s.fault) return 'fault latched — call recover() or POST /api/pick-place/recover, then HOME*'
  if (s.estop) return 'e-stop latched — call recover() or POST /api/pick-place/recover after safe'
  if (s.alarmFault || s.hwAlarmActive) return 'drive alarm active'
  if (s.asyncBusy) return `async command in progress (async=${s.asyncCmd})`
  if (s.busy) return 'motion in progress'
  if (s.homeSt !== 0) return 'homing in progress'
  if (axes !== 'b' && !s.homedA) return 'axis A not homed — run HOMEA or HOME first'
  if (axes !== 'a' && !benchSingleMotor() && !s.homedB) {
    return 'axis B not homed — run HOMEB or HOME first'
  }
  /* Limit switches are not in minimal STATUS — Nano enforces at runtime via motionSafetyCheck(). */
  if (s.switchesAvailable) {
    if (axes !== 'b' && s.limMaxA) return 'axis A TRAVEL limit active (+move blocked)'
    if (axes !== 'a' && s.limMaxB) return 'axis B TRAVEL limit active (+move blocked)'
    if (axes !== 'b' && s.limMinA) return 'axis A HOME limit active (−move blocked)'
    if (axes !== 'a' && s.limMinB) return 'axis B HOME limit active (−move blocked)'
  }
  return null
}

async function assertCanMove(axes = 'both') {
  const s = await readStatusRaw()
  if (!s) throw clientError('move blocked: STATUS unavailable')
  const reason = motionBlockedReason(s, axes)
  if (reason) throw clientError(`move blocked: ${reason}`)
  return s
}

export function getConnectionInfo() {
  return {
    role: 'master',
    slaveTarget: `${HOST}:${PORT}`,
    transport: 'tcp',
    target: `${HOST}:${PORT}`,
    host: HOST,
    port: PORT,
    protocol: 'ess57-dual',
    sessionMode: 'request-response',
    connectTimeoutMs: CONNECT_TIMEOUT,
    connectRetries: CONNECT_RETRIES,
    cmdMaxLen: TCP_CMD_MAX_LEN,
    replyMaxLen: REPLY_MAX_LEN,
    implemented: true,
    homing: {
      timeoutMs: HOME_TIMEOUT_MS,
      requiresHomedForMove: true,
      requiresBackoffMm: true,
      defaultBackoffMmA: DEFAULT_HOME_BACKOFF_MM_A,
      defaultBackoffMmB: DEFAULT_HOME_BACKOFF_MM_B,
      defaultBackoffMm: DEFAULT_HOME_BACKOFF_MM_A,
      backoffRangeMm: { min: HOME_BACKOFF_MM_MIN, max: HOME_BACKOFF_MM_MAX },
      doneFormat: {
        done: 'DONE <tag> posA=… posB=… homedA=… homedB=… bkA=… bkB=…',
        doneExampleHome: 'DONE HOME posA=0.800 posB=0.800 homedA=1 homedB=1 bkA=0.500 bkB=0.800',
        doneExampleMove: 'DONE MOVEAMM posA=45.000 posB=45.000 homedA=1 homedB=1 bkA=0.500 bkB=0.800',
        homeBoth: 'HOME <mmA> <mmB> <speed>',
        moveBoth: 'MOVEAMM + MOVEBMM (same target mm, sequential)',
      },
      physicalBackoffMmA: DEFAULT_HOME_BACKOFF_MM_A,
      physicalBackoffMmB: DEFAULT_HOME_BACKOFF_MM_B,
      referenceAxisFromConfig: true,
      singleMotor: SINGLE_MOTOR === 1,
      parallelBothSeek: true,
      curlMaxTimeSec: {
        home_a: Math.ceil(HOME_WAIT_MS.a / 1000),
        home_b: Math.ceil(HOME_WAIT_MS.b / 1000),
        home: Math.ceil(HOME_WAIT_MS.both / 1000),
      },
    },
  }
}

export function isConnected() { return false }
export function onEvent(fn) { emitter.on('event', fn) }
export function offEvent(fn) { emitter.off('event', fn) }

export async function ping(retries = 1) {
  let lastErr
  for (let i = 0; i < Math.max(1, retries); i++) {
    try {
      const line = await sendCommand('PING', 'PONG', PING_TIMEOUT)
      if (line.trim() === 'PONG') return true
    } catch (err) {
      lastErr = err
      if (i < retries - 1) await sleep(200)
    }
  }
  if (lastErr) throw lastErr
  return false
}

export async function help() { throw clientError(REMOVED_CMD) }
export async function status() { return readStatusRaw() }

export async function switches() {
  try {
    const line = await sendCommand('SWITCHES', 'homeA=', STATUS_TIMEOUT)
    const kv = parseKvLine(line)
    return {
      connected: true,
      raw: line,
      switches: buildSwitches(kv),
      enabledA: flag(kv, 'enA'),
      enabledB: flag(kv, 'enB'),
      enA_pin: flag(kv, 'enA_pin'),
      enB_pin: flag(kv, 'enB_pin'),
      enActLo: flag(kv, 'enActLo'),
    }
  } catch {
    const s = await readStatusRaw()
    return { connected: false, switches: s?.switches, positions: s?.positions }
  }
}

/** Read limit/enable pin snapshot (SWITCHES wire command). */
export async function readSwitchPins() {
  return switches()
}

export function decodeAlarm(code) { return decodeAlarmCode(code) }
export async function almInfo() { throw clientError(REMOVED_CMD) }

export async function enable()  { throw clientError(REMOVED_CMD) }
export async function enableA() { throw clientError(REMOVED_CMD) }
export async function enableB() { throw clientError(REMOVED_CMD) }
export async function disable() { throw clientError(REMOVED_CMD) }
export async function disableA(){ throw clientError(REMOVED_CMD) }
export async function disableB(){ throw clientError(REMOVED_CMD) }
/** STOP halts motion; during async HOME/MOVE firmware replies ERR <tag> stopped (not OK STOP). */
export async function stop() {
  const line = await sendCommand('STOP', 'ANY', CMD_TIMEOUT)
  if (line.startsWith('ERR')) throw new Error(formatFirmwareErr(line))
  return line.trim()
}
/** ESTOP halts motion, disables both drives, latches fault+e-stop, clears homed (same as panel long-press). */
export async function emergencyStop() {
  const line = await sendCommand('ESTOP', 'ANY', CMD_TIMEOUT)
  if (line.startsWith('ERR')) throw new Error(formatFirmwareErr(line))
  return line.trim()
}

/** Clear fault+e-stop latches on Nano (CLRFAULT). Master recover must propagate here before HOME/MOVE. */
export async function clearError() {
  const line = await sendCommand('CLRFAULT', 'OK CLRFAULT', CMD_TIMEOUT)
  const hwAlarmStillActive = line.includes('hw_alarm_still_active')
  const st = await readStatusRaw()
  return {
    ok: true,
    reply: line.trim(),
    hwAlarmStillActive,
    cleared: !!(st && !st.fault && !st.estop),
    status: st,
  }
}

/** Minimal firmware: same as clearError() (CLRFAULT clears software alarm latch when AL− released). */
export async function clearAlarm() {
  return clearError()
}

/** Operator acknowledge after e-stop/fault — clears Nano latches; drives stay disabled until HOME/MOVE. */
export async function recover() {
  return clearError()
}

export async function resetPosition() {
  throw clientError('No RST_POS in firmware — run HOME/HOMEA/HOMEB to zero and set homed flags')
}

export async function isHomed(axis = 'both') {
  const s = await readStatusRaw()
  return axisHomed(s, axis)
}

/** Firmware uses fixed move speed; SPEED command removed from minimal build. */
export async function setSpeedHz(_hz) { /* no-op */ }

export async function setSpeed(_mmps) { /* no-op */ }

export async function setHomeBackoff(_mm, _axis) { throw clientError(REMOVED_CMD + ' — pass backoff on HOME* command') }

export async function getHomeBackoff(axis) {
  const ax = axis ? String(axis).toLowerCase() : ''
  if (ax === 'a') return DEFAULT_HOME_BACKOFF_MM_A
  if (ax === 'b') return DEFAULT_HOME_BACKOFF_MM_B
  return { a: DEFAULT_HOME_BACKOFF_MM_A, b: DEFAULT_HOME_BACKOFF_MM_B }
}

/** Resolve backoff mm for HOME/HOMEA/HOMEB — master always sends mm on the wire. */
export function resolveHomeBackoff(backoff, axis) {
  const ax = normalizeAxis(axis)
  if (typeof backoff === 'object' && backoff != null && !Array.isArray(backoff)) {
    const shared = backoff.mm
    const a = backoff.a ?? backoff.A ?? backoff.backoffA ?? backoff.backoff_a ?? shared ?? DEFAULT_HOME_BACKOFF_MM_A
    const b = backoff.b ?? backoff.B ?? backoff.backoffB ?? backoff.backoff_b ?? shared ?? DEFAULT_HOME_BACKOFF_MM_B
    if (ax === 'both') {
      return {
        a: validateBackoffMm(a, 'backoffA'),
        b: validateBackoffMm(b, 'backoffB'),
      }
    }
    if (ax === 'a') return validateBackoffMm(a, 'backoffA')
    return validateBackoffMm(b, 'backoffB')
  }
  const fallback = ax === 'b' ? DEFAULT_HOME_BACKOFF_MM_B : DEFAULT_HOME_BACKOFF_MM_A
  const mm = backoff != null && backoff !== undefined ? backoff : fallback
  if (ax === 'both') {
    return { a: validateBackoffMm(mm, 'backoffA'), b: validateBackoffMm(mm, 'backoffB') }
  }
  return validateBackoffMm(mm, ax === 'b' ? 'backoffB' : 'backoffA')
}

export function homeCommand(tag, axis, backoff, speedMmS) {
  const cfg = getPickPlaceConfig()
  const ax = normalizeAxis(axis)
  const speed = validateSpeedMmS(speedMmS ?? cfg.homingSpeedMmS, 'homingSpeed')
  const resolved = resolveHomeBackoff(backoff, ax)
  if (ax === 'both' && typeof resolved === 'object') {
    const { a, b } = resolved
    return `${tag} ${formatWireNum(a)} ${formatWireNum(b)} ${formatWireNum(speed)}`
  }
  return `${tag} ${formatWireNum(resolved)} ${formatWireNum(speed)}`
}

export function moveCommandA(positionMm, speedMmS) {
  const cfg = getPickPlaceConfig()
  const speed = validateSpeedMmS(speedMmS ?? cfg.movementSpeedMmS)
  return `MOVEAMM ${formatWireNum(positionMm)} ${formatWireNum(speed)}`
}

export function moveCommandB(positionMm, speedMmS) {
  const cfg = getPickPlaceConfig()
  const speed = validateSpeedMmS(speedMmS ?? cfg.movementSpeedMmS)
  return `MOVEBMM ${formatWireNum(positionMm)} ${formatWireNum(speed)}`
}

export function moveCommandAT1(positionMm, speedMmS) {
  const cfg = getPickPlaceConfig()
  const speed = validateSpeedMmS(speedMmS ?? cfg.movementSpeedMmS)
  return `MOVEAMMT1 ${formatWireNum(positionMm)} ${formatWireNum(speed)}`
}

export function moveCommandAT2(positionMm, speedMmS) {
  const cfg = getPickPlaceConfig()
  const speed = validateSpeedMmS(speedMmS ?? cfg.movementSpeedMmS)
  return `MOVEAMMT2 ${formatWireNum(positionMm)} ${formatWireNum(speed)}`
}

export async function fetchConfig() {
  const s = await readStatusRaw()
  if (!s) throw new Error('STATUS unavailable')
  const kv = s.raw
  const cfg = getPickPlaceConfig()
  const spmm = s.stepsPerMm
  const moveHz = s.moveHz ?? mmToHz(cfg.movementSpeedMmS, spmm)
  return {
    defaultSpeedMm: s.statusTruncated ? cfg.movementSpeedMmS : hzToMm(moveHz, spmm),
    defaultAccelMm: RAMP_HZ_PER_SEC / spmm,
    homeSpeedMm: s.statusTruncated ? cfg.homingSpeedMmS : hzToMm(HOMING_SEARCH_HZ, spmm),
    homeBackoffSpeedMm: hzToMm(HOMING_BACKOFF_HZ, spmm),
    maxSpeedMm: hzToMm(STEP_MAX_HZ, spmm),
    homeReleaseMm: s.homeBackoffMmA,
    homeLatchMm: s.homeBackoffMmA,
    homeBackoffMmA: s.homeBackoffMmA,
    homeBackoffMmB: s.homeBackoffMmB,
    pulsesPerRev: num(kv, 'ppr', DEFAULT_PPR),
    motorStepsPerRev: num(kv, 'spr', DEFAULT_SPR),
    stepsPerMm: spmm,
    homeTimeoutMs: HOME_TIMEOUT_MS,
    statusTruncated: s.statusTruncated,
    homing: s.homing,
    pickPlaceConfig: cfg,
  }
}

async function finishHoming(axis, done, referenceAxis) {
  const s = await readStatusRaw()
  if (!s) throw new Error('STATUS unavailable after homing')
  if (!axisHomed(s, axis)) {
    throw new Error(
      `homing finished but homed flag unset (homedA=${s.homedA ? 1 : 0} homedB=${s.homedB ? 1 : 0})`
    )
  }
  return buildHomingResult(done, s, axis, referenceAxis)
}

async function finishMove(axis, done, referenceAxis) {
  const s = await readStatusRaw()
  if (!s) throw new Error('STATUS unavailable after move')
  return buildMoveResult(done, s, axis, referenceAxis)
}

export async function home(backoffMm, speedMmS, referenceAxis) {
  await assertCanHome()
  const cfg = getPickPlaceConfig()
  const backoff = backoffMm ?? { a: cfg.backoffMmA, b: cfg.backoffMmB }
  const ref = normalizeRefAxis(referenceAxis ?? cfg.referenceAxis)
  const timeout = benchSingleMotor() ? HOME_WAIT_MS.a : HOME_WAIT_MS.both
  const cmd = homeCommand('HOME', 'both', backoff, speedMmS ?? cfg.homingSpeedMmS)
  const done = await sendAsyncCommand(cmd, timeout)
  return {
    ...await finishHoming(benchSingleMotor() ? 'a' : 'both', done, ref),
    referenceAxis: ref,
    command: cmd,
  }
}

export async function homeA(backoffMm, speedMmS) {
  await assertCanHome()
  const cfg = getPickPlaceConfig()
  const cmd = homeCommand('HOMEA', 'a', backoffMm ?? cfg.backoffMmA, speedMmS ?? cfg.homingSpeedMmS)
  const done = await sendAsyncCommand(cmd, HOME_WAIT_MS.a)
  return { ...await finishHoming('a', done), command: cmd }
}

export async function homeB(backoffMm, speedMmS) {
  await assertCanHome()
  const cfg = getPickPlaceConfig()
  const timeout = benchSingleMotor() ? HOME_WAIT_MS.a : HOME_WAIT_MS.b
  const cmd = homeCommand('HOMEB', 'b', backoffMm ?? cfg.backoffMmB, speedMmS ?? cfg.homingSpeedMmS)
  const done = await sendAsyncCommand(cmd, timeout)
  return { ...await finishHoming(benchSingleMotor() ? 'a' : 'b', done), command: cmd }
}

function normalizeRefAxis(axis) {
  const a = String(axis).toLowerCase()
  if (a === 'a' || a === 'b') return a
  throw clientError(`reference axis must be a or b (got "${axis}")`)
}

function requireRefAxis(axis, context = 'moveBothMm') {
  if (axis == null || axis === '') {
    throw clientError(`referenceAxis required for ${context} (a or b)`)
  }
  return normalizeRefAxis(axis)
}

export async function moveBothMm(positionMm, referenceAxis, speedMmS) {
  const target = Number(positionMm)
  if (!Number.isFinite(target)) throw clientError('position must be a number')
  const cfg = getPickPlaceConfig()
  const ref = normalizeRefAxis(referenceAxis ?? cfg.referenceAxis)
  const speed = validateSpeedMmS(speedMmS ?? cfg.movementSpeedMmS)
  await assertCanMove('both')
  const mvA = await moveAmm(target, speed)
  const mvB = await moveBmm(target, speed)
  return {
    ...mvB,
    axis: 'both',
    referenceAxis: ref,
    positionA: mvA.positionA,
    positionB: mvB.positionB,
    positions: { A: mvA.positionA, B: mvB.positionB },
    command: `${mvA.command}; ${mvB.command}`,
    homedA: mvA.homedA,
    homedB: mvB.homedB,
  }
}

export async function moveAmm(positionMm, speedMmS) {
  const target = Number(positionMm)
  if (!Number.isFinite(target)) throw clientError('position must be a number')
  const cfg = getPickPlaceConfig()
  const speed = validateSpeedMmS(speedMmS ?? cfg.movementSpeedMmS)
  const s = await assertCanMove('a')
  const cur = s.positionA ?? 0
  const travelMs = Math.abs(target - cur) / Math.max(0.01, speed) * 1000
  const cmd = moveCommandA(target, speed)
  const done = await sendAsyncCommand(cmd, CMD_TIMEOUT + travelMs + 5000)
  return { ...await finishMove('a', done), command: cmd }
}

export async function moveBmm(positionMm, speedMmS) {
  const target = Number(positionMm)
  if (!Number.isFinite(target)) throw clientError('position must be a number')
  const cfg = getPickPlaceConfig()
  const speed = validateSpeedMmS(speedMmS ?? cfg.movementSpeedMmS)
  const s = await assertCanMove('b')
  const cur = s.positionB ?? 0
  const travelMs = Math.abs(target - cur) / Math.max(0.01, speed) * 1000
  const cmd = moveCommandB(target, speed)
  const done = await sendAsyncCommand(cmd, CMD_TIMEOUT + travelMs + 5000)
  return { ...await finishMove('b', done), command: cmd }
}

async function moveAmmDiag(tag, positionMm, speedMmS) {
  const target = Number(positionMm)
  if (!Number.isFinite(target)) throw clientError('position must be a number')
  const cfg = getPickPlaceConfig()
  const speed = validateSpeedMmS(speedMmS ?? cfg.movementSpeedMmS)
  const s = await assertCanMove('a')
  const cur = s.positionA ?? 0
  const travelMs = Math.abs(target - cur) / Math.max(0.01, speed) * 1000
  const cmd = tag === 'MOVEAMMT2' ? moveCommandAT2(target, speed) : moveCommandAT1(target, speed)
  const done = await sendAsyncCommand(cmd, CMD_TIMEOUT + travelMs + 5000)
  return { ...await finishMove('a', done), command: cmd }
}

export async function moveAmmT1(positionMm, speedMmS) {
  return moveAmmDiag('MOVEAMMT1', positionMm, speedMmS)
}

export async function moveAmmT2(positionMm, speedMmS) {
  return moveAmmDiag('MOVEAMMT2', positionMm, speedMmS)
}

export async function move(positionMm, speedMmS, referenceAxis) {
  const cfg = getPickPlaceConfig()
  const speed = speedMmS ?? cfg.movementSpeedMmS
  const r = benchSingleMotor()
    ? await moveAmm(positionMm, speed)
    : await moveBothMm(positionMm, referenceAxis ?? cfg.referenceAxis, speed)
  return r.position
}

/** Absolute move (mm). axis both → MOVEAMM + MOVEBMM to same target. */
export async function moveTo(positionMm, speedMmS, axis = 'both', referenceAxis) {
  const ax = normalizeAxis(axis)
  const target = Number(positionMm)
  if (!Number.isFinite(target)) throw clientError('position must be a number')
  const cfg = getPickPlaceConfig()
  const speed = validateSpeedMmS(speedMmS ?? cfg.movementSpeedMmS)

  if (ax === 'a') return moveAmm(target, speed)
  if (ax === 'b') return moveBmm(target, speed)
  return moveBothMm(target, referenceAxis ?? cfg.referenceAxis, speed)
}

export async function homeByAxis(axis = 'both', backoffMm, speedMmS, referenceAxis) {
  const ax = normalizeAxis(axis)
  const cfg = getPickPlaceConfig()
  if (ax === 'a') return homeA(backoffMm ?? cfg.backoffMmA, speedMmS ?? cfg.homingSpeedMmS)
  if (ax === 'b') return homeB(backoffMm ?? cfg.backoffMmB, speedMmS ?? cfg.homingSpeedMmS)
  return home(
    backoffMm ?? { a: cfg.backoffMmA, b: cfg.backoffMmB },
    speedMmS ?? cfg.homingSpeedMmS,
    referenceAxis ?? cfg.referenceAxis,
  )
}

/** Allowed deviation from configured backoff after successful HOMEA/HOMEB. */
export const INIT_BACKOFF_TOLERANCE_MM = 0.2

/**
 * Pick & Place Nano initialization — HOMEA then HOMEB (dual motor), each ending at backoff.
 * Single-motor bench: HOMEA only.
 */
export async function initializePickPlace(opts = {}) {
  const cfg = getPickPlaceConfig()
  const homingSpeed = opts.homingSpeed ?? cfg.homingSpeedMmS
  const backoffA = opts.backoffMmA ?? cfg.backoffMmA
  const backoffB = opts.backoffMmB ?? cfg.backoffMmB
  const tolerance = opts.toleranceMm ?? INIT_BACKOFF_TOLERANCE_MM
  const single = benchSingleMotor()

  await connectWithRetry()

  let st = await status()
  if (!st) throw new Error('Pick & Place init failed: STATUS unavailable')
  if (st.fault || st.estop) {
    await recover()
    st = await status()
    if (!st) throw new Error('Pick & Place init failed: STATUS unavailable after recover')
  }

  const homeAResult = await homeA(backoffA, homingSpeed)
  if (!homeAResult.homedA) {
    throw new Error('Pick & Place init failed: axis A not homed after HOMEA')
  }
  if (Math.abs(homeAResult.positionA - backoffA) > tolerance) {
    throw new Error(
      `Pick & Place init failed: axis A not at backoff (pos=${homeAResult.positionA} mm, expected=${backoffA} mm)`,
    )
  }

  let homeBResult = null
  if (!single) {
    homeBResult = await homeB(backoffB, homingSpeed)
    if (!homeBResult.homedB) {
      throw new Error('Pick & Place init failed: axis B not homed after HOMEB')
    }
    if (Math.abs(homeBResult.positionB - backoffB) > tolerance) {
      throw new Error(
        `Pick & Place init failed: axis B not at backoff (pos=${homeBResult.positionB} mm, expected=${backoffB} mm)`,
      )
    }
  }

  const finalStatus = await status()
  return {
    ok: true,
    procedure: single ? 'HOMEA → backoff A' : 'HOMEA → backoff A, then HOMEB → backoff B',
    steps: single
      ? [{ axis: 'A', command: homeAResult.command, homed: true, positionMm: homeAResult.positionA, backoffMm: backoffA }]
      : [
          { axis: 'A', command: homeAResult.command, homed: true, positionMm: homeAResult.positionA, backoffMm: backoffA },
          { axis: 'B', command: homeBResult.command, homed: true, positionMm: homeBResult.positionB, backoffMm: backoffB },
        ],
    homedA: finalStatus?.homedA ?? homeAResult.homedA,
    homedB: single ? null : (finalStatus?.homedB ?? homeBResult.homedB),
    positionA: finalStatus?.positionA ?? homeAResult.positionA,
    positionB: single ? null : (finalStatus?.positionB ?? homeBResult.positionB),
    backoffMmA: backoffA,
    backoffMmB: single ? null : backoffB,
    homeA: homeAResult,
    homeB: homeBResult,
    status: finalStatus,
  }
}

export async function jogFwd(speedMmS, referenceAxis) {
  const s = await readStatusRaw()
  if (!s) throw new Error('STATUS unavailable')
  const cfg = getPickPlaceConfig()
  const ref = requireRefAxis(referenceAxis ?? cfg.referenceAxis, 'jogFwd')
  const speed = speedMmS ?? cfg.movementSpeedMmS
  const cur = ref === 'b' ? (s.positionB ?? 0) : (s.positionA ?? 0)
  const r = await moveBothMm(cur + JOG_SEGMENT_MM, ref, speed)
  return r.position
}
export async function jogRev(speedMmS, referenceAxis) {
  const s = await readStatusRaw()
  if (!s) throw new Error('STATUS unavailable')
  const cfg = getPickPlaceConfig()
  const ref = requireRefAxis(referenceAxis ?? cfg.referenceAxis, 'jogRev')
  const speed = speedMmS ?? cfg.movementSpeedMmS
  const cur = ref === 'b' ? (s.positionB ?? 0) : (s.positionA ?? 0)
  const r = await moveBothMm(cur - JOG_SEGMENT_MM, ref, speed)
  return r.position
}
export async function jogStop() { return stop() }

const API_PORT = Number(process.env.PICK_PLACE_API_PORT || 3333)

const SETTINGS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pick Place Configuration</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #1a1a1a; background: #f4f4f5; }
    body { max-width: 32rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    p.sub { color: #555; font-size: 0.9rem; margin-top: 0; }
    form { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1.25rem; }
    label { display: block; font-size: 0.85rem; font-weight: 600; margin: 1rem 0 0.35rem; }
    input, select { width: 100%; box-sizing: border-box; padding: 0.5rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 4px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    button { margin-top: 1.25rem; width: 100%; padding: 0.65rem; font-size: 1rem; background: #2563eb; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    #status { margin-top: 1rem; font-size: 0.9rem; min-height: 1.2rem; }
    #status.ok { color: #15803d; }
    #status.err { color: #b91c1c; }
    .path { font-size: 0.75rem; color: #666; margin-top: 1rem; word-break: break-all; }
  </style>
</head>
<body>
  <h1>Pick Place Configuration</h1>
  <p class="sub">Settings → Pick Place — movement, homing, backoff, reference axis</p>
  <form id="cfg">
    <label for="movementSpeedMmS">Movement speed (mm/s)</label>
    <input id="movementSpeedMmS" name="movementSpeedMmS" type="number" step="0.1" min="0.01" required>
    <label for="homingSpeedMmS">Homing speed (mm/s)</label>
    <input id="homingSpeedMmS" name="homingSpeedMmS" type="number" step="0.1" min="0.01" required>
    <div class="row">
      <div><label for="backoffMmA">Backoff A (mm)</label><input id="backoffMmA" name="backoffMmA" type="number" step="0.01" min="0.01" max="50" required></div>
      <div><label for="backoffMmB">Backoff B (mm)</label><input id="backoffMmB" name="backoffMmB" type="number" step="0.01" min="0.01" max="50" required></div>
    </div>
    <label for="referenceAxis">Reference axis (dual moves)</label>
    <select id="referenceAxis" name="referenceAxis" required><option value="a">A</option><option value="b">B</option></select>
    <button type="submit">Save configuration</button>
  </form>
  <div id="status"></div>
  <div class="path" id="path"></div>
  <script>
    const statusEl = document.getElementById('status'), pathEl = document.getElementById('path'), form = document.getElementById('cfg')
    function setStatus(msg, ok) { statusEl.textContent = msg; statusEl.className = ok ? 'ok' : 'err' }
    async function load() {
      const data = await (await fetch('/api/pick-place/config')).json()
      if (!data.ok) throw new Error(data.error || 'load failed')
      pathEl.textContent = data.path ? 'Config file: ' + data.path : ''
      for (const key of ['movementSpeedMmS','homingSpeedMmS','backoffMmA','backoffMmB','referenceAxis'])
        if (key in data.config) form.elements[key].value = data.config[key]
      setStatus('Configuration loaded.', true)
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); setStatus('Saving…', true)
      const body = { movementSpeedMmS: Number(form.movementSpeedMmS.value), homingSpeedMmS: Number(form.homingSpeedMmS.value),
        backoffMmA: Number(form.backoffMmA.value), backoffMmB: Number(form.backoffMmB.value), referenceAxis: form.referenceAxis.value }
      try {
        const res = await fetch('/api/pick-place/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error || 'save failed')
        setStatus('Saved. Master commands will use these values.', true)
      } catch (err) { setStatus(err.message, false) }
    })
    load().catch(err => setStatus(err.message, false))
  </script>
</body>
</html>`

// ─── HTTP API (New_version_pick&place — shared by Express backend + standalone) ───

function apiRoutePath(req) {
  const raw = req.originalUrl || req.url || '/'
  return new URL(raw, 'http://127.0.0.1').pathname.replace(/\/+$/, '') || '/'
}

function apiQuery(req) {
  const raw = req.originalUrl || req.url || '/'
  return new URL(raw, 'http://127.0.0.1').searchParams
}

async function apiReadBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
    return req.body
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('invalid JSON body')) }
    })
    req.on('error', reject)
  })
}

function apiSendJson(res, code, obj) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(code).json(obj)
    return
  }
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function apiSendHtml(res, code, html) {
  if (typeof res.status === 'function' && typeof res.send === 'function') {
    res.status(code).type('html').send(html)
    return
  }
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

function apiParseAxis(value, fallback = 'both') {
  const v = (value ?? fallback).toString().toLowerCase()
  if (v === 'a' || v === 'b' || v === 'both') return v
  throw new Error(`invalid axis "${value}" (use a, b, or both)`)
}

function apiAxisFromPath(p) {
  if (p.endsWith('/home_a')) return 'a'
  if (p.endsWith('/home_b')) return 'b'
  return 'both'
}

function apiParseHomeBackoff(body, query, axis) {
  const backoffA = body.backoffA ?? body.backoff_a ?? query.get('backoffA') ?? query.get('backoff_a')
  const backoffB = body.backoffB ?? body.backoff_b ?? query.get('backoffB') ?? query.get('backoff_b')
  const single = body.backoff ?? query.get('backoff')
  if (backoffA != null || backoffB != null) {
    return resolveHomeBackoff(
      { a: backoffA != null ? Number(backoffA) : undefined, b: backoffB != null ? Number(backoffB) : undefined },
      axis,
    )
  }
  if (single != null && single !== '') return resolveHomeBackoff(Number(single), axis)
  const cfg = getPickPlaceConfig()
  if (axis === 'a') return resolveHomeBackoff(cfg.backoffMmA, axis)
  if (axis === 'b') return resolveHomeBackoff(cfg.backoffMmB, axis)
  return resolveHomeBackoff({ a: cfg.backoffMmA, b: cfg.backoffMmB }, axis)
}

function apiFormatStatus(s) {
  if (!s) return { ok: false, error: 'STATUS unavailable' }
  return {
    ok: true, state: s.state, canRun: s.canRun, homeSt: s.homeSt, homeState: s.homeState,
    homedA: s.homedA, homedB: s.homedB, homed: s.homed, asyncCmd: s.asyncCmd, asyncBusy: s.asyncBusy,
    position: s.position, positionA: s.positionA, positionB: s.positionB, positions: s.positions,
    homeBackoffMmA: s.homeBackoffMmA, homeBackoffMmB: s.homeBackoffMmB,
    switches: s.switches, switchesAvailable: s.switchesAvailable, statusTruncated: s.statusTruncated,
    fault: s.fault, estop: s.estop, alarmCode: s.alarmCode, alarmText: s.alarmText,
    recoverableHomingFault: s.recoverableHomingFault, stepsPerMm: s.stepsPerMm, busy: s.busy, homing: s.homing,
  }
}

function apiConnectionError(err) {
  const info = getConnectionInfo()
  return {
    ok: false, error: err?.message || String(err), target: info.target, host: info.host, port: info.port,
    connected: isConnected(),
    hint: 'Ensure bot is 192.168.10.1/24, Nano 192.168.10.5, port 8177 open.',
  }
}

function apiParseRefAxis(value) {
  const v = (value ?? '').toString().toLowerCase()
  if (v === 'a' || v === 'b') return v
  throw new Error(`invalid referenceAxis "${value}" (use a or b)`)
}

async function apiHandleHome(axis, backoff, homingSpeed, referenceAxis) {
  await connect()
  const cfg = getPickPlaceConfig()
  const t0 = Date.now()
  const result = await homeByAxis(
    axis,
    backoff,
    homingSpeed ?? cfg.homingSpeedMmS,
    referenceAxis ?? cfg.referenceAxis,
  )
  const st = await status()
  return { ...result, elapsedMs: Date.now() - t0, pickPlaceConfig: cfg, status: apiFormatStatus(st) }
}

async function apiHandleMoveTo(body, query) {
  const cfg = getPickPlaceConfig()
  const position = body.position ?? query.get('position')
  const speed = body.speed ?? query.get('speed') ?? cfg.movementSpeedMmS
  const axis = apiParseAxis(body.axis ?? query.get('axis'), 'both')
  const referenceAxis = body.referenceAxis ?? body.reference_axis ?? query.get('referenceAxis') ?? cfg.referenceAxis
  if (position == null || position === '') {
    const err = new Error('position required (absolute mm from home reference)')
    err.statusCode = 400
    throw err
  }
  await connect()
  const t0 = Date.now()
  const result = await moveTo(Number(position), Number(speed), axis, referenceAxis)
  const st = await status()
  return {
    ok: true,
    axis,
    referenceAxis: axis === 'both' ? apiParseRefAxis(referenceAxis) : undefined,
    target: Number(position),
    speed: Number(speed),
    ...result,
    reached: result.positions,
    elapsedMs: Date.now() - t0,
    status: apiFormatStatus(st),
  }
}

/** Shared HTTP handler — mount in Express or standalone http server. Returns true if handled. */
export async function handlePickPlaceHttpRequest(req, res, { apiPort = API_PORT } = {}) {
  const routePath = apiRoutePath(req)
  if (!routePath.startsWith('/api/pick-place') && routePath !== '/settings/pick-place') {
    return false
  }
  const query = apiQuery(req)
  try {
    if (req.method === 'GET' && routePath === '/api/pick-place/status') {
      await connect()
      const st = await status()
      apiSendJson(res, 200, st ? { connected: true, ...apiFormatStatus(st) } : { connected: true, ok: false, error: 'STATUS unavailable' })
      return true
    }
    if (req.method === 'GET' && routePath === '/api/pick-place/ping') {
      const info = getConnectionInfo()
      try {
        const ok = await ping()
        apiSendJson(res, ok ? 200 : 503, { ok, connected: ok, session: isConnected(), ...info })
      } catch (err) {
        apiSendJson(res, 503, { ok: false, connected: false, session: isConnected(), error: err.message, ...info })
      }
      return true
    }
    if (req.method === 'GET' && routePath === '/api/pick-place/ping-nano') {
      const probe = await probeConnection()
      apiSendJson(res, probe.ok ? 200 : 503, { ok: probe.ok, ...probe, connected: isConnected() })
      return true
    }
    if (req.method === 'GET' && routePath === '/api/pick-place/connection') {
      apiSendJson(res, 200, { connected: isConnected(), ...getConnectionInfo() })
      return true
    }
    if (req.method === 'GET' && routePath === '/api/pick-place/config') {
      try {
        const c = await fetchConfig()
        apiSendJson(res, 200, { ok: true, config: getPickPlaceConfig(), path: getConfigPath(), ...c })
      } catch (err) {
        apiSendJson(res, 503, apiConnectionError(err))
      }
      return true
    }
    if (req.method === 'PUT' && routePath === '/api/pick-place/config') {
      const body = await apiReadBody(req)
      const config = savePickPlaceConfig(body)
      apiSendJson(res, 200, { ok: true, config, path: getConfigPath() })
      return true
    }
    if (req.method === 'GET' && routePath === '/settings/pick-place') {
      apiSendHtml(res, 200, SETTINGS_HTML)
      return true
    }
    if (req.method === 'GET' && routePath === '/api/pick-place/info') {
      const probe = await probeConnection()
      const cfg = getPickPlaceConfig()
      apiSendJson(res, 200, {
        ok: true,
        pickPlaceConfig: cfg,
        configPath: getConfigPath(),
        settingsUrl: `http://127.0.0.1:${apiPort}/settings/pick-place`,
        nanoReachable: probe.ok,
        nanoProbe: probe,
        ...getConnectionInfo(),
      })
      return true
    }
    if (req.method === 'GET' && routePath === '/api/pick-place/help') {
      apiSendJson(res, 410, { ok: false, error: REMOVED_CMD })
      return true
    }
    if (req.method === 'GET' && routePath === '/api/pick-place/alminfo') {
      apiSendJson(res, 410, { ok: false, error: REMOVED_CMD })
      return true
    }
    if (req.method === 'GET' && routePath === '/api/pick-place/home_backoff') {
      apiSendJson(res, 200, { ok: true, mm: await getHomeBackoff() })
      return true
    }
    if (req.method === 'GET' && routePath === '/api/pick-place/switches') {
      apiSendJson(res, 200, await switches())
      return true
    }
    if (req.method === 'GET' && routePath === '/api/pick-place/alarm_codes') {
      const info = getConnectionInfo()
      apiSendJson(res, 200, {
        protocol: 'async-DONE/ERR',
        requiresHomedForMove: true,
        homeTimeoutMs: HOME_TIMEOUT_MS,
        curlMaxTimeSec: info.homing?.curlMaxTimeSec,
        firmwareErrHints: FIRMWARE_ERR_HINTS,
        alarmCodes: ALARM_CODES,
      })
      return true
    }
    if (req.method === 'POST' && [
      '/api/pick-place/enable', '/api/pick-place/enable_a', '/api/pick-place/enable_b',
      '/api/pick-place/disable', '/api/pick-place/disable_a', '/api/pick-place/disable_b',
      '/api/pick-place/set_accel', '/api/pick-place/set_speed', '/api/pick-place/set_default_speed',
      '/api/pick-place/set_default_accel', '/api/pick-place/set_home_speed',
      '/api/pick-place/set_home_release_speed', '/api/pick-place/set_home_creep_speed',
      '/api/pick-place/set_home_accel', '/api/pick-place/set_home_release_mm',
      '/api/pick-place/set_home_latch_mm', '/api/pick-place/set_speed_cap',
      '/api/pick-place/set_move_to_default_speed', '/api/pick-place/set_soft_min',
      '/api/pick-place/set_soft_max', '/api/pick-place/save_config',
      '/api/pick-place/load_config', '/api/pick-place/apply_motion_defaults',
    ].includes(routePath)) {
      apiSendJson(res, 410, { ok: false, error: REMOVED_CMD })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/initialize') {
      const body = req.headers['content-type']?.includes('json') ? await apiReadBody(req) : {}
      const homingSpeed = body.homingSpeed ?? body.homing_speed ?? query.get('homingSpeed')
      const backoffA = body.backoffA ?? body.backoff_a ?? query.get('backoffA')
      const backoffB = body.backoffB ?? body.backoff_b ?? query.get('backoffB')
      const t0 = Date.now()
      const result = await initializePickPlace({
        homingSpeed: homingSpeed != null && homingSpeed !== '' ? Number(homingSpeed) : undefined,
        backoffMmA: backoffA != null && backoffA !== '' ? Number(backoffA) : undefined,
        backoffMmB: backoffB != null && backoffB !== '' ? Number(backoffB) : undefined,
      })
      apiSendJson(res, 200, { ...result, elapsedMs: Date.now() - t0, pickPlaceConfig: getPickPlaceConfig() })
      return true
    }
    if (req.method === 'POST' && (
      routePath === '/api/pick-place/home' || routePath === '/api/pick-place/home_a' || routePath === '/api/pick-place/home_b'
    )) {
      const body = req.headers['content-type']?.includes('json') ? await apiReadBody(req) : {}
      const axis = apiParseAxis(body.axis ?? query.get('axis'), apiAxisFromPath(routePath))
      const backoff = apiParseHomeBackoff(body, query, axis)
      const homingSpeed = body.homingSpeed ?? body.homing_speed ?? query.get('homingSpeed') ?? query.get('speed')
      const referenceAxis = body.referenceAxis ?? body.reference_axis ?? query.get('referenceAxis')
      const out = await apiHandleHome(
        axis,
        backoff,
        homingSpeed != null && homingSpeed !== '' ? Number(homingSpeed) : undefined,
        referenceAxis != null && referenceAxis !== '' ? String(referenceAxis) : undefined,
      )
      apiSendJson(res, 200, out)
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/move_to') {
      const body = await apiReadBody(req)
      apiSendJson(res, 200, await apiHandleMoveTo(body, query))
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/move') {
      const body = await apiReadBody(req)
      const cfg = getPickPlaceConfig()
      const position = body.position ?? body.distanceMm ?? body.steps
      const speed = body.speed ?? cfg.movementSpeedMmS
      const referenceAxis = body.referenceAxis ?? body.reference_axis ?? cfg.referenceAxis
      if (position == null || position === '') {
        const err = new Error('position required (absolute mm from home reference)')
        err.statusCode = 400
        throw err
      }
      const pos = await move(Number(position), Number(speed), referenceAxis)
      apiSendJson(res, 200, { ok: true, position: pos, referenceAxis })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/move_a') {
      const body = await apiReadBody(req)
      const cfg = getPickPlaceConfig()
      const position = body.position ?? body.distanceMm ?? 0
      const speed = body.speed ?? cfg.movementSpeedMmS
      apiSendJson(res, 200, await moveAmm(Number(position), Number(speed)))
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/move_b') {
      const body = await apiReadBody(req)
      const cfg = getPickPlaceConfig()
      const position = body.position ?? body.distanceMm ?? 0
      const speed = body.speed ?? cfg.movementSpeedMmS
      apiSendJson(res, 200, await moveBmm(Number(position), Number(speed)))
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/move_both') {
      const body = await apiReadBody(req)
      const cfg = getPickPlaceConfig()
      const position = body.position ?? body.distanceMm ?? 0
      const speed = body.speed ?? cfg.movementSpeedMmS
      const referenceAxis = body.referenceAxis ?? body.reference_axis ?? cfg.referenceAxis
      apiSendJson(res, 200, await moveBothMm(Number(position), referenceAxis, Number(speed)))
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/jog') {
      const body = await apiReadBody(req)
      const cfg = getPickPlaceConfig()
      const speed = body.speed ?? cfg.movementSpeedMmS
      const ref = body.referenceAxis ?? body.reference_axis ?? cfg.referenceAxis
      if (body.direction === 'rev') await jogRev(Number(speed), ref)
      else await jogFwd(Number(speed), ref)
      apiSendJson(res, 200, { ok: true, direction: body.direction || 'fwd', speed: Number(speed), referenceAxis: ref })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/jog/stop') {
      await jogStop()
      apiSendJson(res, 200, { ok: true })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/stop') {
      await connect()
      const line = await stop()
      const st = await status()
      apiSendJson(res, 200, { ok: true, reply: line, status: apiFormatStatus(st) })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/estop') {
      await connect()
      const line = await emergencyStop()
      const st = await status()
      apiSendJson(res, 200, { ok: true, reply: line, status: apiFormatStatus(st) })
      return true
    }
    if (req.method === 'POST' && (
      routePath === '/api/pick-place/recover' ||
      routePath === '/api/pick-place/clear-fault' ||
      routePath === '/api/pick-place/clear_error'
    )) {
      await connect()
      const result = await recover()
      apiSendJson(res, 200, {
        ok: result.ok,
        reply: result.reply,
        cleared: result.cleared,
        hwAlarmStillActive: result.hwAlarmStillActive,
        status: apiFormatStatus(result.status),
      })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/clear_alarm') {
      const result = await clearAlarm()
      const st = await status()
      apiSendJson(res, 200, { ...result, status: apiFormatStatus(st) })
      return true
    }
    if (req.method === 'POST' && routePath === '/api/pick-place/reset_position') {
      await resetPosition()
      apiSendJson(res, 200, { ok: true })
      return true
    }
    apiSendJson(res, 404, { ok: false, error: 'not found', path: routePath })
    return true
  } catch (err) {
    const msg = err?.message || String(err)
    const code = err?.statusCode === 400 ? 400 : /TCP connect failed/i.test(msg) ? 503 : 500
    console.error(`[pick-place-api] ${req.method} ${routePath}: ${msg}`)
    apiSendJson(res, code, apiConnectionError(err))
    return true
  }
}

export function startPickPlaceApi(port = API_PORT) {
  const server = http.createServer(async (req, res) => {
    const handled = await handlePickPlaceHttpRequest(req, res, { apiPort: port })
    if (!handled) apiSendJson(res, 404, { ok: false, error: 'not found', path: apiRoutePath(req) })
  })
  server.listen(port, '127.0.0.1', () => {
    const info = getConnectionInfo()
    console.log(`[pick-place] API http://127.0.0.1:${port}`)
    console.log(`[pick-place] Nano TCP → ${info.target}`)
    console.log(`[pick-place] Config → ${getConfigPath()}`)
    console.log(`[pick-place] Settings → http://127.0.0.1:${port}/settings/pick-place`)
  })
  return server
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) startPickPlaceApi()

export default {
  connect, disconnect, ping, help, status, switches, almInfo, decodeAlarm,
  getConnectionInfo, enable, enableA, enableB, disable, disableA, disableB,
  stop, emergencyStop, resetPosition, setSpeed, setSpeedHz, setHomeBackoff,
  getHomeBackoff, fetchConfig, clearError, clearAlarm, recover,
  home, homeA, homeB, homeByAxis, initializePickPlace, INIT_BACKOFF_TOLERANCE_MM,
  isHomed, axisHomed, waitIdle,
  moveBothMm, moveAmm, moveBmm, jogFwd, jogRev, jogStop,
  move, moveTo, isConnected, onEvent, offEvent, host: HOST, port: PORT,
  DEFAULT_HOME_BACKOFF_MM, HOME_BACKOFF_MM_MIN, HOME_BACKOFF_MM_MAX, REFERENCE_AXIS, FIRMWARE_STEPS_PER_MM,
  parseDoneLine, buildHomingResult, buildMoveResult, resolveHomeBackoff, homeCommand,
  moveCommandA, moveCommandB, moveCommandAT1, moveCommandAT2,
  moveAmmT1, moveAmmT2, errLineMatchesTag, PickPlaceTcpSession,
  readSwitchPins, diagnoseConnection, formatDiagnosisReport,
  getPickPlaceConfig, loadPickPlaceConfig, savePickPlaceConfig, getConfigPath,
  DEFAULT_PICK_PLACE_CONFIG, startPickPlaceApi, handlePickPlaceHttpRequest,
  probeConnection, connectWithRetry,
}
