/**
 * Version 2 height-calibration cycles. Bypass HMI only.
 * Pulse ends are measured with CALDRV. The quadratic is fitted from
 * operator-measured openings. MOVE_UPPERMM, MOVE_LOWERMM, and MOVEBOTHMM
 * use the stored slaveCal relation after SETCAL.
 */
import * as centringMaster from './centringMaster/centring_master.js'
import * as machineLifecycle from './machineLifecycle.mjs'

let master = centringMaster
let lifecycle = machineLifecycle

/** @internal tests only */
export function __setHeightCalibrationDepsForTest(overrides = {}) {
  master = overrides.master ?? centringMaster
  lifecycle = overrides.lifecycle ?? machineLifecycle
}

/** @internal tests only */
export function __resetHeightCalibrationDepsForTest() {
  master = centringMaster
  lifecycle = machineLifecycle
}
import {
  CURVE_CYCLE,
  DEFAULT_CURVE,
  PULSE_END_CYCLE,
  assertInteriorSpread,
  assertOpeningFalls,
  assertPulseInRange,
  curveCycleFor,
  curveFromEndpoints,
  curveSummary,
  fitQuadratic,
  heightAtAngle,
  interiorOpeningMm,
  interiorPose,
  maxSampleResidualMm,
  MAX_FIT_RESIDUAL_MM,
  poseSampleAngle,
  pulseEndStep,
  validatePulseEnds,
} from './centringHeightCalibration.mjs'
import {
  assertNudgeAccepted,
  assertNudgeMotionReady,
  buildNudgeCommand,
  manualMovePayload,
  parseNudgeBody,
  relativeNudgeClamped,
} from './centringHeightCalibrationManual.mjs'

function storedCurve(cal) {
  return {
    A: Number.isFinite(Number(cal?.A)) ? Number(cal.A) : DEFAULT_CURVE.A,
    B: Number.isFinite(Number(cal?.B)) ? Number(cal.B) : DEFAULT_CURVE.B,
    C: Number.isFinite(Number(cal?.C)) ? Number(cal.C) : DEFAULT_CURVE.C,
    sHome: Number.isFinite(Number(cal?.sHome)) ? Number(cal.sHome) : DEFAULT_CURVE.sHome,
    sTravel: Number.isFinite(Number(cal?.sTravel)) ? Number(cal.sTravel) : DEFAULT_CURVE.sTravel,
  }
}

function livePulse(st, axis) {
  const value = axis === 'upper' ? Number(st?.pu) : Number(st?.pl)
  if (!Number.isFinite(value)) {
    throw new Error(
      'The Nano did not report the live pulse (pu/pl). Upload the centring firmware that includes those STATUS fields, then run the cycle again.',
    )
  }
  return value
}

function switchOn(st, step) {
  if (step.axis === 'upper' && step.switch === 'HOME') return !!st?.uh
  if (step.axis === 'upper' && step.switch === 'TRAVEL') return !!st?.ut
  if (step.axis === 'lower' && step.switch === 'HOME') return !!st?.lh
  if (step.axis === 'lower' && step.switch === 'TRAVEL') return !!st?.lt
  return false
}

export function formatSetCal(cal) {
  if (!cal) return null
  return [
    'SETCAL',
    cal.calId || 'v2-cal',
    cal.hu, cal.tu, cal.hl, cal.tl,
    cal.A, cal.B, cal.C,
    cal.sHome, cal.sTravel,
  ].join(' ')
}

export function calibrationSnapshot() {
  const cfg = master.getCentringConfig() || {}
  const cal = cfg.slaveCal || null
  const curve = curveSummary(storedCurve(cal))
  const saved = cal
    ? {
      calId: cal.calId ?? null,
      hu: cal.hu ?? null,
      tu: cal.tu ?? null,
      hl: cal.hl ?? null,
      tl: cal.tl ?? null,
      A: curve.A,
      B: curve.B,
      C: curve.C,
      sHome: curve.sHome,
      sTravel: curve.sTravel,
    }
    : null
  return {
    saved,
    setcal: formatSetCal(saved),
    curve,
    heightMoves: ['MOVE_UPPERMM', 'MOVE_LOWERMM', 'MOVEBOTHMM'],
    carriage: {
      command: 'MOVEAMMT2',
      target: 'centering_output_mm',
      when: 'Class B centring step, after the jaws are at h_pre_mm and before the move to h_post_mm. No stop at the centring input.',
      usesHeightCalibration: false,
    },
    pulseEnds: cal
      ? { hu: cal.hu ?? null, tu: cal.tu ?? null, hl: cal.hl ?? null, tl: cal.tl ?? null }
      : null,
    pulseCycle: PULSE_END_CYCLE,
    curveCycle: curveCycleFor(curve, cfg.mechOffsetMm),
    mechOffsetMm: Number(cfg.mechOffsetMm) || 0,
  }
}

export async function sendSavedSetCal(actor) {
  const saved = master.getCentringConfig()?.slaveCal
  if (!saved) throw new Error('No slaveCal is stored. Measure pulse ends first.')
  validatePulseEnds(saved)
  const curve = curveSummary(storedCurve(saved))
  assertOpeningFalls(curve)
  await master.connectWithRetry()
  const st = await master.setCal({ ...saved, ...storedCurve(saved) })
  console.info('[centring] SETCAL sent from calibration UI', {
    actor: actor?.username || 'unknown',
    calId: saved.calId || null,
    cal: !!st?.cal,
  })
  return { setcal: formatSetCal({ ...saved, ...storedCurve(saved) }), status: { cal: !!st?.cal } }
}

export async function restoreBackup(body, actor) {
  const ends = validatePulseEnds(body || {})
  const curve = curveSummary({
    A: Number(body.A),
    B: Number(body.B),
    C: Number(body.C),
    sHome: Number(body.sHome),
    sTravel: Number(body.sTravel),
  })
  assertOpeningFalls(curve)
  const previous = master.getCentringConfig()?.slaveCal || null
  const next = {
    calId: String(body.calId || 'v2-backup').slice(0, 15),
    ...ends,
    A: curve.A,
    B: curve.B,
    C: curve.C,
    sHome: curve.sHome,
    sTravel: curve.sTravel,
  }
  master.saveSlaveCal(next)
  await master.connectWithRetry()
  const st = await master.setCal(next)
  console.info('[centring] calibration backup restored', {
    actor: actor?.username || 'unknown',
    previous: previous ? { calId: previous.calId, hu: previous.hu, tu: previous.tu } : null,
    applied: { calId: next.calId, hu: next.hu, tu: next.tu, hl: next.hl, tl: next.tl },
    cal: !!st?.cal,
  })
  return { saved: next, status: { cal: !!st?.cal } }
}

function assertJawsFree() {
  if (master.getCentringProductionTcpHold() || lifecycle.isProductionActive()) {
    const error = new Error(
      'A production cycle is using the centring jaws. Wait until the cycle finishes, then drive this position again.',
    )
    error.statusCode = 409
    throw error
  }
  if (lifecycle.isInitInProgress()) {
    const error = new Error(
      'Machine initialization is moving the jaws. Wait until initialization finishes, then drive this position again.',
    )
    error.statusCode = 409
    throw error
  }
}

function readingFromStatus(step, st, action) {
  if (!st) {
    throw new Error('The centring Nano did not answer STATUS. Check the link, then drive this position again.')
  }
  if (!switchOn(st, step)) {
    const why = action === 'read'
      ? `The ${step.jaw} ${step.switch} switch is not pressed. ${step.field} was not saved. Drive the ${step.jaw} jaw to ${step.place}, then save again.`
      : `${step.command} finished, but the ${step.jaw} ${step.switch} switch is not pressed. ${step.field} was not saved. Clear the jaw path and drive the ${step.jaw} jaw to ${step.place} again.`
    throw new Error(why)
  }
  const pulseUs = assertPulseInRange(step.field, livePulse(st, step.axis))
  return {
    id: step.id,
    field: step.field,
    axis: step.axis,
    position: step.position,
    command: step.command,
    jaw: step.jaw,
    place: step.place,
    switchName: step.switch,
    pulseUs,
    switchOn: true,
    moveEnd: st.moveEnd || null,
  }
}

/**
 * Drive one jaw to one switch. Does not write slaveCal.
 * The operator saves the returned pulse only after checking the position.
 */
export async function drivePulseEnd(axis, position) {
  assertJawsFree()
  const step = pulseEndStep(axis, position)
  await master.connectWithRetry()
  const st = await master.calDrive(step.end, step.axis)
  return readingFromStatus(step, st, 'drive')
}

function statusReading(step, st) {
  const pulseUs = assertPulseInRange(step.field, livePulse(st, step.axis))
  return {
    id: step.id,
    field: step.field,
    axis: step.axis,
    position: step.position,
    command: step.command,
    jaw: step.jaw,
    place: step.place,
    switchName: step.switch,
    pulseUs,
    switchOn: switchOn(st, step),
    uh: !!st?.uh,
    ut: !!st?.ut,
    lh: !!st?.lh,
    lt: !!st?.lt,
    moveEnd: st.moveEnd || null,
  }
}

/**
 * Manual pulse jog for Pulse ends. One 4 µs step on one jaw; does not save.
 * @param {'open'|'close'} direction — toward HOME or TRAVEL
 */
export async function stepPulseEnd(axis, direction) {
  assertJawsFree()
  if (axis !== 'upper' && axis !== 'lower') {
    throw new Error('Choose the upper or lower jaw.')
  }
  if (direction !== 'open' && direction !== 'close') {
    throw new Error('Direction must be open (toward HOME) or close (toward TRAVEL).')
  }
  await master.connectWithRetry()
  const st = await master.calStep(direction, axis)
  const field = axis === 'upper' ? 'hu' : 'hl'
  const pulseUs = assertPulseInRange(field, livePulse(st, axis))
  return {
    axis,
    direction,
    pulseUs,
    uh: !!st?.uh,
    ut: !!st?.ut,
    lh: !!st?.lh,
    lt: !!st?.lt,
    moveEnd: st.moveEnd || null,
  }
}

export async function pulseEndLiveStatus(axis, position) {
  assertJawsFree()
  const step = pulseEndStep(axis, position)
  await master.connectWithRetry()
  const st = await master.status()
  return statusReading(step, st)
}

/**
 * Re-read the live pulse while the named switch is still pressed.
 * Does not move the jaw and does not write slaveCal.
 */
export async function readPulseEnd(axis, position) {
  assertJawsFree()
  const step = pulseEndStep(axis, position)
  await master.connectWithRetry()
  const st = await master.status()
  return readingFromStatus(step, st, 'read')
}

export async function runPulseEndCycle() {
  assertJawsFree()
  await master.connectWithRetry()
  const measured = {}
  const steps = []
  for (const step of PULSE_END_CYCLE) {
    const st = await master.calDrive(step.end, step.axis)
    const reading = readingFromStatus(step, st, 'drive')
    measured[step.field] = reading.pulseUs
    steps.push(reading)
  }
  const ends = validatePulseEnds(measured)
  return { ends, steps }
}

export async function applyPulseEnds(ends, actor) {
  const clean = validatePulseEnds(ends)
  const previous = master.getCentringConfig()?.slaveCal || null
  const curve = storedCurve(previous)
  const next = {
    calId: String(previous?.calId || 'v2-pulse').slice(0, 15),
    ...clean,
    ...curve,
  }
  master.saveSlaveCal(next)
  await master.connectWithRetry()
  const st = await master.setCal(next)
  console.info('[centring] height calibration pulse ends applied', {
    actor: actor?.username || 'unknown',
    previous: previous ? { hu: previous.hu, tu: previous.tu, hl: previous.hl, tl: previous.tl } : null,
    applied: clean,
    cal: !!st?.cal,
  })
  return { saved: next, status: { cal: !!st?.cal, hu: st?.hu, tu: st?.tu, hl: st?.hl, tl: st?.tl } }
}

function totalOpeningMmAtFraction(curve, fraction) {
  const angle = curve.sHome + fraction * (curve.sTravel - curve.sHome)
  const perJaw = heightAtAngle(angle, curve)
  return perJaw * 2
}

export async function driveCurvePose(pose) {
  await master.connectWithRetry()
  const cfg = master.getCentringConfig()
  const curve = curveSummary(storedCurve(cfg?.slaveCal))
  let targetMm = null
  if (pose === 'home' || pose === 'travel') {
    await master.calDrive(pose === 'home' ? 'open' : 'close', 'both')
  } else {
    const interior = interiorPose(pose)
    if (interior) {
      targetMm = interiorOpeningMm(curve, interior.fraction, cfg?.mechOffsetMm)
      await master.moveBoth(targetMm)
    } else {
      const cycle = CURVE_CYCLE.find((row) => row.pose === pose)
      if (cycle && typeof cycle.fraction === 'number') {
        targetMm = totalOpeningMmAtFraction(curve, cycle.fraction)
        await master.moveBoth(targetMm)
      } else if (pose === 'mid') {
        targetMm = totalOpeningMmAtFraction(curve, 0.5)
        await master.moveBoth(targetMm)
      } else {
        throw new Error('Pose must be home, travel, third-1, third-2, mid, or m1–m4.')
      }
    }
  }
  const st = await master.status()
  console.info('[centring] height calibration pose', {
    pose,
    targetMm,
    u: st?.u ?? null,
    l: st?.l ?? null,
    uh: !!st?.uh,
    ut: !!st?.ut,
    lh: !!st?.lh,
    lt: !!st?.lt,
  })
  const base = {
    pose,
    targetMm,
    u: st?.u ?? null,
    l: st?.l ?? null,
    h: st?.h ?? null,
    pu: st?.pu ?? null,
    pl: st?.pl ?? null,
    uh: !!st?.uh,
    ut: !!st?.ut,
    lh: !!st?.lh,
    lt: !!st?.lt,
  }
  try {
    const sample = poseSampleAngle(pose, curve, st)
    return {
      ...base,
      angleDeg: sample.angleDeg,
      commandedAngleDeg: sample.commandedAngleDeg,
      offCommand: sample.offCommand,
    }
  } catch {
    return base
  }
}

export function buildCurve(body) {
  const sHome = Number(body?.sHome ?? DEFAULT_CURVE.sHome)
  const sTravel = Number(body?.sTravel ?? DEFAULT_CURVE.sTravel)
  const samples = Array.isArray(body?.samples) ? body.samples : []
  const home = samples.find((sample) => sample.pose === 'home')
  const travel = samples.find((sample) => sample.pose === 'travel')
  const midCount = samples.filter((sample) => interiorPose(sample.pose)).length
  if (midCount > 0 && midCount < 4) {
    throw new Error(`Store all four middle samples at different openings. ${midCount} of 4 are stored.`)
  }
  if (midCount === 4) {
    if (!home || !travel) {
      throw new Error('Add the open-end sample and the closed-end sample with the four middle samples.')
    }
    const used = [home, travel, ...samples.filter((sample) => interiorPose(sample.pose))]
    assertInteriorSpread(used, sHome, sTravel)
    const fitted = fitQuadratic(used)
    const summary = curveSummary({ ...fitted, sHome, sTravel })
    const maxResidualMm = maxSampleResidualMm(summary, used)
    if (maxResidualMm > MAX_FIT_RESIDUAL_MM) {
      throw new Error(
        `The quadratic misses a sample by ${maxResidualMm.toFixed(2)} mm per jaw. The six openings do not lie on one quadratic. Measure the middle openings again.`,
      )
    }
    assertOpeningFalls(summary, { fromSamples: true })
    return { ...summary, maxResidualMm }
  }
  const hHomeMm = home ? Number(home.hMm) : Number(body?.hHomeMm)
  const hTravelMm = travel ? Number(travel.hMm) : Number(body?.hTravelMm)
  const C = Number(body?.C ?? DEFAULT_CURVE.C)
  return { ...curveSummary(curveFromEndpoints(hHomeMm, hTravelMm, sHome, sTravel, C)), maxResidualMm: 0 }
}

export async function getManualMoveSnapshot() {
  const slaveCal = master.getCentringConfig()?.slaveCal || null
  const link = master.getCentringTcpSessionInfo()
  if (!link.connected || !link.handshaken) {
    master.requestSessionRestore('manual-snapshot')
    return manualMovePayload(null, slaveCal)
  }
  let st = null
  try {
    st = await master.status()
  } catch {
    st = null
  }
  return manualMovePayload(st, slaveCal)
}

export async function nudgeManualMove(body, actor) {
  const parsed = parseNudgeBody(body || {})
  assertJawsFree()
  const stBefore = await master.status()
  assertNudgeMotionReady(stBefore)
  const command = buildNudgeCommand(parsed)
  const stAfter = await master.nudge(command)
  assertNudgeAccepted(stAfter, command)
  const slaveCal = master.getCentringConfig()?.slaveCal || null
  const snapshot = manualMovePayload(stAfter, slaveCal)
  const clamped = relativeNudgeClamped(stBefore, stAfter, parsed)
  console.info('[centring] height calibration manual nudge', {
    actor: actor?.username || 'unknown',
    mode: parsed.mode,
    axis: parsed.axis,
    command,
    pu: stAfter?.pu ?? null,
    pl: stAfter?.pl ?? null,
  })
  return {
    ...parsed,
    command,
    clamped,
    snapshot,
  }
}

export async function applyCurve(curve, actor) {
  const summary = curveSummary(curve)
  assertOpeningFalls(summary)
  const previous = master.getCentringConfig()?.slaveCal
  if (!previous?.hu || !previous?.tu || !previous?.hl || !previous?.tl) {
    throw new Error('Measure and apply pulse ends before applying a curve.')
  }
  const next = {
    ...previous,
    A: summary.A,
    B: summary.B,
    C: summary.C,
    sHome: summary.sHome,
    sTravel: summary.sTravel,
    calId: String(previous.calId || 'v2-curve').slice(0, 15),
  }
  master.saveSlaveCal(next)
  await master.connectWithRetry()
  const st = await master.setCal(next)
  console.info('[centring] height calibration curve applied', {
    actor: actor?.username || 'unknown',
    previous: previous ? { A: previous.A, B: previous.B, C: previous.C } : null,
    applied: { A: summary.A, B: summary.B, C: summary.C, sHome: summary.sHome, sTravel: summary.sTravel },
    cal: !!st?.cal,
  })
  return { saved: next, curve: summary, status: { cal: !!st?.cal } }
}
