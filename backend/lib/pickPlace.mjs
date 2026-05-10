/**
 * Pick & Place TCP client
 * ──────────────────────────────
 * Matches pick_place_controller.ino (mm / mm/s; TCP port 8177).
 * Override host/port with PICK_PLACE_HOST / PICK_PLACE_PORT.
 *
 * Protocol: newline-terminated text. PING → "PONG <ip> gw <gw>".
 * MOVE / MOVE_TO use millimetres and mm/s; STATUS/DONE positions are mm.
 */

import net from 'net'
import { EventEmitter } from 'events'

// ── Config ────────────────────────────────────────────────────────────────────
const HOST            = process.env.PICK_PLACE_HOST || '192.168.10.5'
const PORT            = Number(process.env.PICK_PLACE_PORT || 8177)
const CONNECT_TIMEOUT = 3000
const CMD_TIMEOUT     = 15000
const RECONNECT_DELAY = 5000

// ── Internal state ────────────────────────────────────────────────────────────
let   socket       = null
let   connected    = false
let   rxBuf        = ''
let   reconnTimer  = null
const emitter      = new EventEmitter()
const pendingQueue = []

/** Serialize TCP commands so responses never interleave (matches single pending + avoids device TX buffer overflow). */
let cmdSendChain = Promise.resolve()

// ─────────────────────────────────────────────────────────────────────────────
//  Connection management
// ─────────────────────────────────────────────────────────────────────────────
function scheduleReconnect() {
    if (reconnTimer) return
    reconnTimer = setTimeout(() => { reconnTimer = null; connect().catch(() => {}) }, RECONNECT_DELAY)
}

export function connect() {
    return new Promise((resolve, reject) => {
        if (connected) { resolve(); return }

        const sock = new net.Socket()
        sock.setTimeout(CONNECT_TIMEOUT)

        let settled = false
        const once = fn => (...a) => { if (!settled) { settled = true; fn(...a) } }

        sock.connect(PORT, HOST, () => {
            settled  = true
            socket   = sock; connected = true; rxBuf = ''
            try {
                sock.setNoDelay(true)
            } catch { /* ignore */ }
            console.log(`[pick-place] connected to ${HOST}:${PORT}`)
            emitter.emit('connect')
            resolve()
        })

        sock.on('data', chunk => {
            rxBuf += chunk.toString('ascii')
            let nl
            while ((nl = rxBuf.indexOf('\n')) !== -1) {
                const line = rxBuf.slice(0, nl).replace(/\r$/, '')
                rxBuf = rxBuf.slice(nl + 1)
                _onLine(line)
            }
        })

        sock.on('timeout', once(() => {
            sock.destroy()
            reject(new Error('connect timeout'))
            scheduleReconnect()
        }))

        sock.on('error', err => {
            if (!connected) {
                once(() => {
                    console.warn(`[pick-place] connect error: ${err.message}`)
                    reject(err); scheduleReconnect()
                })()
            } else {
                console.warn(`[pick-place] error: ${err.message}`)
                _teardown(); scheduleReconnect()
            }
        })

        sock.on('close', () => {
            if (connected) {
                console.warn('[pick-place] disconnected')
                _teardown(); scheduleReconnect()
            }
        })
    })
}

function _teardown() {
    if (!connected && !socket) return
    connected = false; socket = null
    for (const p of pendingQueue) p.reject(new Error('Pick & Place disconnected'))
    pendingQueue.length = 0
    cmdSendChain = Promise.resolve()
    emitter.emit('disconnect')
}

function _normLine(line) {
    return typeof line === 'string' ? line.replace(/^\s+/, '') : line
}

function _onLine(line) {
    if (!line) return
    const trimmed = _normLine(line)
    // Match command replies before EVENT/HELLO so DONE / OK are never skipped.
    if (pendingQueue.length > 0) {
        const p = pendingQueue[0]
        if (trimmed.startsWith(p.terminator)) {
            pendingQueue.shift(); clearTimeout(p.timer); p.resolve(trimmed); return
        }
        if (trimmed.startsWith('ERR')) {
            pendingQueue.shift(); clearTimeout(p.timer); p.reject(new Error(trimmed)); return
        }
    }
    if (trimmed.startsWith('EVENT') || trimmed.startsWith('HELLO')) {
        emitter.emit('event', trimmed)
        console.log(`[pick-place] ${trimmed}`)
        return
    }
    emitter.emit('line', trimmed)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Low-level send (one in flight at a time — EtherCard TX buffer is small)
// ─────────────────────────────────────────────────────────────────────────────
function sendCmdImpl(cmd, terminator, timeout) {
    return new Promise((resolve, reject) => {
        if (!connected || !socket) return reject(new Error('Pick & Place not connected'))
        const timer = setTimeout(() => {
            const idx = pendingQueue.findIndex(p => p.resolve === resolve)
            if (idx !== -1) pendingQueue.splice(idx, 1)
            const tail = rxBuf.length > 120 ? `${rxBuf.slice(0, 120)}…` : rxBuf
            const hint = tail ? ` (rx buffer: ${JSON.stringify(tail)})` : ''
            reject(new Error(`timeout waiting for ${terminator} (cmd: "${cmd}")${hint}`))
        }, timeout)
        pendingQueue.push({ resolve, reject, terminator, timer })
        if (cmd) socket.write(cmd + '\n')
    })
}

function sendCmd(cmd, terminator = 'OK', timeout = CMD_TIMEOUT) {
    const p = cmdSendChain.then(() => sendCmdImpl(cmd, terminator, timeout))
    cmdSendChain = p.catch(() => {})
    return p
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────────────
export async function ping() {
    const line = await sendCmd('PING', 'PONG', 2000)
    return line.startsWith('PONG')
}

/**
 * @returns Status — position/speed in mm / mm/s.
 * Firmware may append per-motor bits: errA errB minA maxA minB maxB (indices 8–13).
 */
export async function status() {
    const line = await sendCmd('STATUS', 'STATUS')
    const p = line.split(' ').filter(Boolean)
    const out = {
        state:    p[1] || 'UNKNOWN',
        position: parseFloat(p[2] || '0'),
        speed:    parseFloat(p[3] || '0'),
        enabled:  p[4] === '1',
        motorErr: p[5] === '1',
        limMin:   p[6] === '1',
        limMax:   p[7] === '1',
    }
    if (p.length >= 14) {
        out.motorErrA = p[8] === '1'
        out.motorErrB = p[9] === '1'
        out.limMinA = p[10] === '1'
        out.limMaxA = p[11] === '1'
        out.limMinB = p[12] === '1'
        out.limMaxB = p[13] === '1'
    }
    return out
}

export async function enable()  { await sendCmd('ENABLE',  'OK') }
export async function disable() { await sendCmd('DISABLE', 'OK') }
export async function stop()    { await sendCmd('STOP',    'OK') }
export async function resetPosition() { await sendCmd('RST_POS', 'OK') }

export async function setAccel(v) { await sendCmd(`SET_ACCEL ${Number(v)}`, 'OK') }
export async function setSpeed(v) { await sendCmd(`SET_SPEED ${Number(v)}`, 'OK') }

/**
 * CONFIG line (firmware v2+):
 * defaultSpeed defaultAccel homeApproach maxSpeed softMin softMax
 *   homeReleaseSpeed homeCreep homeAccel homeReleaseMm homeLatchMm [moveToDefault]
 * Older firmware: first 7 fields only — extra homing tune defaults are inferred.
 */
export async function fetchConfig() {
    const line = await sendCmd('CONFIG', 'CONFIG', 5000)
    const parts = line.trim().split(/\s+/).filter(Boolean)
    if (parts[0] !== 'CONFIG' || parts.length < 7) throw new Error(`bad CONFIG: ${line}`)
    const homeApproach = parseFloat(parts[3])
    const legacy = parts.length < 12
    const maxSp = parseFloat(parts[4])
    return {
        defaultSpeedMm: parseFloat(parts[1]),
        defaultAccelMm: parseFloat(parts[2]),
        /** Phase 0: fast approach (SET_HOME_SPEED) */
        homeSpeedMm: homeApproach,
        maxSpeedMm: maxSp,
        softMinMm: parseFloat(parts[5]),
        softMaxMm: parseFloat(parts[6]),
        homeReleaseSpeedMm: legacy ? Math.min(Math.max(homeApproach * 0.65, 2), maxSp) : parseFloat(parts[7]),
        homeCreepSpeedMm: legacy ? Math.min(Math.max(homeApproach * 0.2, 1), maxSp) : parseFloat(parts[8]),
        homeAccelMm: legacy ? 60 : parseFloat(parts[9]),
        homeReleaseMm: legacy ? 4 : parseFloat(parts[10]),
        homeLatchMm: legacy ? 0.35 : parseFloat(parts[11]),
        /** MOVE_TO when speed omitted; CONFIG13th field on firmware v3+ */
        moveToDefaultSpeedMm: parts.length >= 13 ? parseFloat(parts[12]) : 3000,
    }
}

export async function setDefaultSpeed(v) { await sendCmd(`SET_DEFAULT_SPEED ${Number(v)}`, 'OK') }
export async function setDefaultAccel(v) { await sendCmd(`SET_DEFAULT_ACCEL ${Number(v)}`, 'OK') }
export async function setHomeSpeed(v) { await sendCmd(`SET_HOME_SPEED ${Number(v)}`, 'OK') }
export async function setHomeReleaseSpeed(v) { await sendCmd(`SET_HOME_RELEASE_SPEED ${Number(v)}`, 'OK') }
export async function setHomeCreepSpeed(v) { await sendCmd(`SET_HOME_CREEP_SPEED ${Number(v)}`, 'OK') }
export async function setHomeAccel(v) { await sendCmd(`SET_HOME_ACCEL ${Number(v)}`, 'OK') }
export async function setHomeReleaseMm(v) { await sendCmd(`SET_HOME_RELEASE_MM ${Number(v)}`, 'OK') }
export async function setHomeLatchMm(v) { await sendCmd(`SET_HOME_LATCH_MM ${Number(v)}`, 'OK') }
export async function setSpeedCap(v) { await sendCmd(`SET_SPEED_CAP ${Number(v)}`, 'OK') }
export async function setMoveToDefaultSpeed(v) { await sendCmd(`SET_MOVE_TO_DEFAULT_SPEED ${Number(v)}`, 'OK') }
export async function setSoftMin(v) { await sendCmd(`SET_SOFT_MIN ${Number(v)}`, 'OK') }
export async function setSoftMax(v) { await sendCmd(`SET_SOFT_MAX ${Number(v)}`, 'OK') }
export async function saveConfig() { await sendCmd('SAVE_CONFIG', 'OK') }
export async function loadConfig() { await sendCmd('LOAD_CONFIG', 'OK') }
export async function clearError() { await sendCmd('CLEAR_ERROR', 'OK') }

/** SET_ACCEL + SET_SPEED from current CONFIG (runtime motion matches defaults). */
export async function applyMotionFromDefaults() {
    const c = await fetchConfig()
    await setAccel(c.defaultAccelMm)
    await setSpeed(c.defaultSpeedMm)
}

export async function home() {
    await sendCmd('HOME', 'OK')
    // Homing can take a long time; firmware sends DONE only after motion completes (TCP flush at end of loop).
    const line = await sendCmd('', 'DONE', 180_000)
    return parseFloat(line.split(' ')[1] || '0')
}

/** @param speedMmS jog speed in mm/s */
export async function jogFwd(speedMmS = 80) { await sendCmd(`JOG_FWD ${Number(speedMmS)}`, 'OK') }
export async function jogRev(speedMmS = 80) { await sendCmd(`JOG_REV ${Number(speedMmS)}`, 'OK') }
export async function jogStop()            { await sendCmd('JOG_STOP', 'OK') }

/** Relative move: distanceMm in mm, speed in mm/s */
export async function move(distanceMm, speedMmS = 80) {
    await sendCmd(`MOVE ${Number(distanceMm)} ${Number(speedMmS)}`, 'OK')
    const spd = Math.max(0.01, Number(speedMmS))
    const extra = Math.abs(Number(distanceMm)) / spd * 1000 + 3000
    const line  = await sendCmd('', 'DONE', CMD_TIMEOUT + extra)
    return parseFloat(line.split(' ')[1] || '0')
}

/** Absolute move: positionMm and speedMmS */
export async function moveTo(positionMm, speedMmS = 3000) {
    await sendCmd(`MOVE_TO ${Number(positionMm)} ${Number(speedMmS)}`, 'OK')
    const spd = Math.max(0.01, Number(speedMmS))
    const line = await sendCmd('', 'DONE', CMD_TIMEOUT + 30_000 + Math.abs(Number(positionMm)) / spd * 1000)
    return parseFloat(line.split(' ')[1] || '0')
}

export function isConnected() { return connected }
export function onEvent(fn)   { emitter.on('event', fn) }
export function offEvent(fn)  { emitter.off('event', fn) }

export default {
    connect, ping, status,
    enable, disable, stop, resetPosition,
    setAccel, setSpeed,
    fetchConfig, setDefaultSpeed, setDefaultAccel, setHomeSpeed, setHomeReleaseSpeed, setHomeCreepSpeed,
    setHomeAccel, setHomeReleaseMm, setHomeLatchMm, setSpeedCap, setMoveToDefaultSpeed,
    setSoftMin, setSoftMax, saveConfig, loadConfig, clearError, applyMotionFromDefaults,
    home, jogFwd, jogRev, jogStop,
    move, moveTo,
    isConnected, onEvent, offEvent,
    host: HOST, port: PORT,
}
