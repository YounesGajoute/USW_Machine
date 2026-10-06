/**
 * Version 2 height-calibration cycles. Bypass HMI only.
 * Pulse ends are measured with CALDRV. The quadratic is fitted from
 * operator-measured openings. MOVE_UPPERMM, MOVE_LOWERMM, and MOVEBOTHMM
 * use the stored slaveCal relation after SETCAL.
 */
import * as master from './centringMaster/centring_master.js'
import {
  CURVE_CYCLE,
  DEFAULT_CURVE,
  PULSE_END_CYCLE,
  curveFromEndpoints,
  curveSummary,
  fitQuadratic,
  validatePulseEnds,
} from './centringHeightCalibration.mjs'

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
  const cal = master.getCentringConfig()?.slaveCal || null
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
    curveCycle: CURVE_CYCLE,
  }
}

export async function sendSavedSetCal(actor) {
  const saved = master.getCentringConfig()?.slaveCal
  if (!saved) throw new Error('No slaveCal is stored. Measure pulse ends first.')
  validatePulseEnds(saved)
  const curve = curveSummary(storedCurve(saved))
  if (!(curve.C > 0) || !(curve.hHomeMm > curve.hTravelMm)) {
    throw new Error('Stored curve is not valid for SETCAL.')
  }
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
  if (!(curve.C > 0) || !(curve.sTravel > curve.sHome) || !(curve.hHomeMm > curve.hTravelMm)) {
    throw new Error('Backup curve is not valid.')
  }
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

export async function runPulseEndCycle() {
  await master.connectWithRetry()
  const measured = {}
  const steps = []
  for (const step of PULSE_END_CYCLE) {
    const st = await master.calDrive(step.end, step.axis)
    if (!switchOn(st, step)) {
      throw new Error(`${step.command} finished but the ${step.switch} switch is not pressed.`)
    }
    const pulseUs = livePulse(st, step.axis)
    measured[step.field] = pulseUs
    steps.push({ ...step, pulseUs, moveEnd: st.moveEnd || null })
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

export async function driveCurvePose(pose) {
  await master.connectWithRetry()
  if (pose === 'home') {
    await master.calDrive('open', 'both')
  } else if (pose === 'travel') {
    await master.calDrive('close', 'both')
  } else if (pose === 'mid') {
    const cal = master.getCentringConfig()?.slaveCal
    const curve = curveSummary(storedCurve(cal))
    const target = (curve.hHomeMm + curve.hTravelMm)
    await master.moveBoth(target)
  } else {
    throw new Error('Pose must be home, travel, or mid.')
  }
  const st = await master.status()
  return {
    pose,
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
}

export function buildCurve(body) {
  const sHome = Number(body?.sHome ?? DEFAULT_CURVE.sHome)
  const sTravel = Number(body?.sTravel ?? DEFAULT_CURVE.sTravel)
  const samples = Array.isArray(body?.samples) ? body.samples : []
  if (samples.length >= 3) {
    const fitted = fitQuadratic(samples)
    const summary = curveSummary({ ...fitted, sHome, sTravel })
    if (!(summary.hHomeMm > summary.hTravelMm)) {
      throw new Error('The fitted HOME height must be greater than the TRAVEL height.')
    }
    return summary
  }
  const hHomeMm = Number(body?.hHomeMm)
  const hTravelMm = Number(body?.hTravelMm)
  const C = Number(body?.C ?? DEFAULT_CURVE.C)
  return curveSummary(curveFromEndpoints(hHomeMm, hTravelMm, sHome, sTravel, C))
}

export async function applyCurve(curve, actor) {
  const summary = curveSummary(curve)
  if (!(summary.C > 0) || !(summary.hHomeMm > summary.hTravelMm) || !(summary.sTravel > summary.sHome)) {
    throw new Error('Curve is not valid. C must be > 0, sTravel > sHome, and HOME height > TRAVEL height.')
  }
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
