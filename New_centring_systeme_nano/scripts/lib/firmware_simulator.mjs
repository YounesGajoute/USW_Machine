/**
 * Offline Nano slave simulator — mirrors centring_systeme_nano/src/main.cpp command logic.
 * Used by mock TCP server for master/HTTP integration tests (no hardware).
 */
import {
  S_HOME,
  S_TRAVEL,
  gapMmToMoveTarget,
  getModelHRangeMm,
  heightFromSigned,
} from '../../master/centring_height_model.js'

const SPEED_MAX = 120
const ASYNC_TAGS = new Set([
  'HOME', 'HOME_UPPER', 'HOME_LOWER', 'SEEK_TRAVEL',
  'MOVEBOTHMM', 'MOVE_UPPERMM', 'MOVE_LOWERMM',
])

export class NanoSimulator {
  constructor() {
    this.reset()
  }

  reset() {
    this.u = S_HOME
    this.l = S_HOME
    this.mechOff = 0
    this.homedUpper = false
    this.homedLower = false
    this.fault = false
    this.estop = false
    this.enabled = true
    this.busy = false
    this.asyncTag = null
    this.pu = 1200
    this.pl = 1600
  }

  hModel() {
    return heightFromSigned(this.u) + heightFromSigned(this.l)
  }

  hPhysical() {
    return this.hModel() + this.mechOff
  }

  band() {
    return getModelHRangeMm(this.mechOff)
  }

  heightInRange(h) {
    const b = this.band()
    return Number.isFinite(h) && h >= b.min && h <= b.max
  }

  ready() {
    return this.enabled && !this.estop && this.homedUpper && this.homedLower && !this.busy
  }

  readyMove(cmd) {
    if (!this.enabled || this.estop || this.busy) return false
    if (cmd === 'MOVE_UPPERMM') return this.homedUpper
    if (cmd === 'MOVE_LOWERMM') return this.homedLower
    return this.homedUpper && this.homedLower
  }

  fmtStatus() {
    const b = this.band()
    const asyncN = this.asyncTag ? ASYNC_TAGS.has(this.asyncTag) ? 1 : 0 : 0
    const asyncVal = this.asyncTag
      ? ['HOME', 'HOME_UPPER', 'HOME_LOWER', 'SEEK_TRAVEL', 'MOVEBOTHMM', 'MOVE_UPPERMM', 'MOVE_LOWERMM'].indexOf(this.asyncTag) + 1
      : 0
    return [
      `u=${this.u.toFixed(1)}`,
      `l=${this.l.toFixed(1)}`,
      `h=${this.hPhysical().toFixed(1)}`,
      `busy=${this.busy ? 1 : 0}`,
      `homeSt=0`,
      `homedUpper=${this.homedUpper ? 1 : 0}`,
      `homedLower=${this.homedLower ? 1 : 0}`,
      `async=${asyncVal}`,
      `fault=${this.fault ? 1 : 0}`,
      `estop=${this.estop ? 1 : 0}`,
      `hmin=${b.min.toFixed(1)}`,
      `hmax=${b.max.toFixed(1)}`,
      `mechOff=${this.mechOff.toFixed(2)}`,
    ].join(' ')
  }

  fmtDone(tag) {
    return `DONE ${tag} u=${this.u.toFixed(1)} l=${this.l.toFixed(1)} h=${this.hPhysical().toFixed(1)} homedUpper=${this.homedUpper ? 1 : 0} homedLower=${this.homedLower ? 1 : 0} pu=${this.pu} pl=${this.pl}`
  }

  parseMoveArg(arg) {
    if (!arg) return null
    const sp = arg.lastIndexOf(' ')
    if (sp < 0) return null
    const h = Number(arg.slice(0, sp).trim().replace(',', '.'))
    const s = Number(arg.slice(sp + 1).trim().replace(',', '.'))
    if (!Number.isFinite(h) || !Number.isFinite(s)) return null
    if (s <= 0 || s > SPEED_MAX) return null
    return { h, s }
  }

  preempt(tag) {
    if (this.estop) return `ERR ${tag} estop`
    this.busy = false
    this.asyncTag = null
    return null
  }

  rejectHome(tag) {
    return this.preempt(tag)
  }

  rejectMove(tag) {
    const p = this.preempt(tag)
    if (p) return p
    if (this.fault) return `ERR ${tag} fault`
    return null
  }

  applyMoveTarget(cmd, hMm) {
    const t = gapMmToMoveTarget({
      gapMm: hMm,
      moveCommand: cmd,
      uNow: this.u,
      lNow: this.l,
      mechOffsetMm: this.mechOff,
    })
    if (cmd === 'MOVE_UPPERMM') this.u = t.deg
    else if (cmd === 'MOVE_LOWERMM') this.l = t.deg
    else {
      this.u = t.deg
      this.l = t.deg
    }
  }

  /** @returns {string|null} reply line */
  handle(line) {
    const trimmed = line.trim()
    if (!trimmed) return null
    const upper = trimmed.toUpperCase()
    const sp = upper.indexOf(' ')
    const cmd = sp >= 0 ? upper.slice(0, sp) : upper
    const arg = sp >= 0 ? trimmed.slice(sp + 1).trim() : ''

    if (cmd === 'PING') return 'PONG'

    if (cmd === 'STATUS') return this.fmtStatus()

    if (cmd === 'CLRFAULT') {
      this.fault = false
      this.estop = false
      return 'OK CLRFAULT'
    }

    if (cmd === 'STOP') {
      this.busy = false
      this.asyncTag = null
      return 'OK STOP'
    }

    if (cmd === 'ESTOP') {
      this.estop = true
      this.enabled = false
      this.homedUpper = false
      this.homedLower = false
      this.busy = false
      this.asyncTag = null
      return 'OK ESTOP'
    }

    if (cmd === 'SETMECHOFF') {
      this.preempt('SETMECHOFF')
      const off = Number(String(arg).replace(',', '.'))
      if (!Number.isFinite(off)) return 'ERR SETMECHOFF args'
      this.mechOff = off
      return 'OK SETMECHOFF'
    }

    if (cmd === 'HOME') {
      const rej = this.rejectHome('HOME')
      if (rej) return rej
      this.enabled = true
      this.fault = false
      this.u = S_HOME
      this.l = S_HOME
      this.homedUpper = true
      this.homedLower = true
      this.busy = false
      this.asyncTag = null
      return this.fmtDone('HOME')
    }

    if (cmd === 'HOME_UPPER') {
      const rej = this.rejectHome('HOME_UPPER')
      if (rej) return rej
      this.enabled = true
      this.u = S_HOME
      this.homedUpper = true
      return this.fmtDone('HOME_UPPER')
    }

    if (cmd === 'HOME_LOWER') {
      const rej = this.rejectHome('HOME_LOWER')
      if (rej) return rej
      this.enabled = true
      this.l = S_HOME
      this.homedLower = true
      return this.fmtDone('HOME_LOWER')
    }

    if (cmd === 'SEEK_TRAVEL') {
      const rej = this.rejectMove('SEEK_TRAVEL')
      if (rej) return rej
      if (!this.ready()) return 'ERR SEEK_TRAVEL not_ready'
      this.u = S_TRAVEL
      this.l = S_TRAVEL
      return this.fmtDone('SEEK_TRAVEL')
    }

    if (cmd === 'MOVEBOTHMM' || cmd === 'MOVE_UPPERMM' || cmd === 'MOVE_LOWERMM') {
      const rej = this.rejectMove(cmd)
      if (rej) return rej
      if (!this.readyMove(cmd)) return `ERR ${cmd} not_ready`
      const mv = this.parseMoveArg(arg)
      if (!mv) return `ERR ${cmd} args`
      if (!this.heightInRange(mv.h)) return `ERR ${cmd} h_out_of_range`
      try {
        this.applyMoveTarget(cmd, mv.h)
      } catch {
        return `ERR ${cmd} h_unreachable`
      }
      return this.fmtDone(cmd)
    }

    return 'ERR UNKNOWN'
  }
}

export function createNanoSimulator() {
  return new NanoSimulator()
}
