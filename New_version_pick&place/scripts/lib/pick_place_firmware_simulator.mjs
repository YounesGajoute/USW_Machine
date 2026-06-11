/**
 * Offline pick-place Nano slave simulator — mirrors src/main.cpp wire protocol (instant motion).
 */
export const MM_PER_PULSE_MILLI = 300
export const MM_PER_PULSE = 0.3
export const STEPS_PER_MM = 10 / 3

const ASYNC = {
  NONE: 0,
  HOME: 1,
  HOMEA: 2,
  HOMEB: 3,
  MOVEAMM: 4,
  MOVEBMM: 5,
}

function parseMilli(s) {
  if (!s) return null
  const t = String(s).trim().replace(',', '.')
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 1000)
}

function mmMilliToSteps(mmMilli) {
  const bias = mmMilli >= 0 ? 150 : -150
  return Math.trunc((mmMilli + bias) / MM_PER_PULSE_MILLI)
}

export function stepsToMm(steps) {
  return (steps * MM_PER_PULSE_MILLI) / 1000
}

function parseBkCs(s) {
  const m = parseMilli(s)
  if (m == null || m < 10 || m > 50000) return null
  const cs = Math.round((m + 5) / 10)
  if (cs < 1 || cs > 5000) return null
  return cs
}

function bkCsToSteps(cs) {
  return mmMilliToSteps(cs * 10)
}

function fmtMm3(steps) {
  const m = Math.round(stepsToMm(steps) * 1000)
  const sign = m < 0 ? -1 : 1
  const a = Math.abs(m)
  return `${sign < 0 ? '-' : ''}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, '0')}`
}

function fmtBk(cs) {
  const m = cs * 10
  return `${Math.floor(m / 1000)}.${String(m % 1000).padStart(3, '0')}`
}

export class PickPlaceNanoSimulator {
  constructor() {
    this.reset()
  }

  reset() {
    this.stepsA = 0
    this.stepsB = 0
    this.homedA = false
    this.homedB = false
    this.fault = false
    this.estop = false
    this.busy = false
    this.homeSt = 0
    this.asyncCmd = ASYNC.NONE
    this.latchedBkA = 0
    this.latchedBkB = 0
  }

  fmtStatus() {
    return [
      `stepA=${this.stepsA}`,
      `stepB=${this.stepsB}`,
      `busy=${this.busy ? 1 : 0}`,
      `homeSt=${this.homeSt}`,
      `homedA=${this.homedA ? 1 : 0}`,
      `homedB=${this.homedB ? 1 : 0}`,
      `async=${this.asyncCmd}`,
      `fault=${this.fault ? 1 : 0}`,
      `estop=${this.estop ? 1 : 0}`,
      `pulseMm=${MM_PER_PULSE_MILLI}`,
      `enA=0`,
      `enB=0`,
    ].join(' ')
  }

  fmtDone(tag) {
    return `DONE ${tag} posA=${fmtMm3(this.stepsA)} posB=${fmtMm3(this.stepsB)} homedA=${this.homedA ? 1 : 0} homedB=${this.homedB ? 1 : 0} bkA=${fmtBk(this.latchedBkA)} bkB=${fmtBk(this.latchedBkB)}`
  }

  reject(tag) {
    if (this.busy || this.asyncCmd !== ASYNC.NONE) return `ERR ${tag} busy`
    if (this.fault) return `ERR ${tag} fault`
    if (this.estop) return `ERR ${tag} estop`
    return null
  }

  parseHomeArgs(arg, mode) {
    if (!arg) return null
    const parts = arg.trim().split(/\s+/)
    if (mode === 'both') {
      if (parts.length < 3) return null
      const [mmA, mmB, _spd] = parts
      const csA = parseBkCs(mmA)
      const csB = parseBkCs(mmB)
      if (!csA || !csB) return null
      return { csA, csB }
    }
    if (parts.length < 2) return null
    const cs = parseBkCs(parts[0])
    if (!cs) return null
    return { cs }
  }

  parseMoveSingle(arg) {
    if (!arg) return null
    const sp = arg.trim().lastIndexOf(' ')
    if (sp < 0) return null
    const pos = parseMilli(arg.slice(0, sp))
    if (pos == null) return null
    return { posMilli: pos }
  }

  setPosFromCs(mask, cs) {
    const steps = bkCsToSteps(cs)
    if (mask === 'A' || mask === 'both') this.stepsA = steps
    if (mask === 'B' || mask === 'both') this.stepsB = steps
  }

  /** @returns {string|null} */
  handle(line) {
    const trimmed = line.trim()
    if (!trimmed) return null
    const upper = trimmed.toUpperCase()
    const sp = upper.indexOf(' ')
    const cmd = sp >= 0 ? upper.slice(0, sp) : upper
    const arg = sp >= 0 ? trimmed.slice(sp + 1).trim() : ''

    if (cmd === 'PING') return 'PONG'
    if (cmd === 'STATUS') return this.fmtStatus()
    if (cmd === 'SWITCHES') return 'homeA=1 travelA=1 homeB=1 travelB=1 almA=1 almB=1 enA=0 enB=0 enA_pin=0 enB_pin=0 enActLo=0'

    if (cmd === 'CLRFAULT') {
      this.fault = false
      this.estop = false
      return 'OK CLRFAULT'
    }

    if (cmd === 'STOP') {
      this.busy = false
      this.asyncCmd = ASYNC.NONE
      this.homeSt = 0
      return 'OK STOP'
    }

    if (cmd === 'ESTOP') {
      this.estop = true
      this.fault = true
      this.homedA = false
      this.homedB = false
      this.busy = false
      this.asyncCmd = ASYNC.NONE
      this.homeSt = 0
      return 'OK ESTOP'
    }

    if (cmd === 'HOME') {
      const rej = this.reject('HOME')
      if (rej) return rej
      const p = this.parseHomeArgs(arg, 'both')
      if (!p) return 'ERR HOME args'
      this.latchedBkA = p.csA
      this.latchedBkB = p.csB
      this.setPosFromCs('A', p.csA)
      this.setPosFromCs('B', p.csB)
      this.homedA = true
      this.homedB = true
      this.asyncCmd = ASYNC.NONE
      return this.fmtDone('HOME')
    }

    if (cmd === 'HOMEA') {
      const rej = this.reject('HOMEA')
      if (rej) return rej
      const p = this.parseHomeArgs(arg, 'a')
      if (!p) return 'ERR HOMEA args'
      this.latchedBkA = p.cs
      this.setPosFromCs('A', p.cs)
      this.homedA = true
      return this.fmtDone('HOMEA')
    }

    if (cmd === 'HOMEB') {
      const rej = this.reject('HOMEB')
      if (rej) return rej
      const p = this.parseHomeArgs(arg, 'b')
      if (!p) return 'ERR HOMEB args'
      this.latchedBkB = p.cs
      this.setPosFromCs('B', p.cs)
      this.homedB = true
      return this.fmtDone('HOMEB')
    }

    if (cmd === 'MOVEAMM' || cmd === 'MOVEBMM') {
      const rej = this.reject(cmd)
      if (rej) return rej
      if (cmd === 'MOVEAMM' && !this.homedA) return 'ERR MOVEAMM fail'
      if (cmd === 'MOVEBMM' && !this.homedB) return 'ERR MOVEBMM fail'
      const mv = this.parseMoveSingle(arg)
      if (!mv) return `ERR ${cmd === 'MOVEAMM' ? 'MOVEMM' : 'MOVEMM'}`
      const target = mmMilliToSteps(mv.posMilli)
      if (cmd === 'MOVEAMM') this.stepsA = target
      else this.stepsB = target
      return this.fmtDone(cmd)
    }

    return 'ERR UNKNOWN'
  }
}
