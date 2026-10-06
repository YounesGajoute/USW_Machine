/**
 * Version 2 centring recipe gate. Pure validation of a loaded reference before
 * it can drive Version 2 centring. No socket, no database.
 *
 * Checks, in order:
 *   - match tolerance in 0.1° … 2.0° (V2-REQ-018)
 *   - L_eff gives Class A or Class B (V2-REQ-001 / 002 / 005)
 *   - centring_axis is upper, lower or both
 *   - finite h_pre_mm and h_post_mm
 *   - single-axis h_pre_mm reachable with the other axis at HOME (V2-REQ-043)
 *   - both heights inside the height model
 *   - on every moving axis, the expected pulse, angle and height at h_pre_mm and
 *     at h_post_mm each differ by more than 2 × tolerance, so one last move can
 *     never match both references (V2-REQ-015). Pulse is checked only when a
 *     valid saved calibration is given.
 */
import {
  H_PRODUCTION_PARK_MM,
  MECH_OFFSET_MM_DEFAULT,
} from '../centringMaster/centring_height_model.js'
import { classifyLengthClass, lEffFromRecipe } from './lengthClass.mjs'
import {
  centringAxesOf,
  expectedReferencePoses,
  matchTolerances,
  normalizeSlaveCal,
  validateMatchToleranceDeg,
} from './position.mjs'

function reject(code, message, details) {
  return details ? { ok: false, code, message, details } : { ok: false, code, message }
}

/**
 * @param {object} recipe — `l_eff_mm` (or `L_eff_mm`), `h_pre_mm`, `h_post_mm`, `centring_axis`
 * @param {object} [opts]
 * @param {number} [opts.toleranceDeg=0.5]
 * @param {object|null} [opts.slaveCal]
 * @param {number} [opts.mechOffsetMm=0]
 * @returns {{ ok: true, class: 'A'|'B', centringAxes: string[] }
 *   | { ok: false, code: string, message: string, details?: string[] }}
 */
export function validateCentringV2Recipe(recipe, { toleranceDeg, slaveCal = null, mechOffsetMm = MECH_OFFSET_MM_DEFAULT } = {}) {
  const tolCheck = validateMatchToleranceDeg(toleranceDeg)
  if (!tolCheck.ok) return tolCheck
  const tolDeg = tolCheck.toleranceDeg

  const lengthClass = classifyLengthClass(lEffFromRecipe(recipe))
  if (!lengthClass.ok) return lengthClass

  const axes = centringAxesOf(recipe?.centring_axis)
  if (!axes) {
    return reject('CENTRING_AXIS_INVALID', `centring_axis must be upper, lower or both (got ${recipe?.centring_axis}).`)
  }

  const hPre = Number(recipe.h_pre_mm)
  const hPost = Number(recipe.h_post_mm)
  if (recipe.h_pre_mm == null || recipe.h_pre_mm === '' || !Number.isFinite(hPre)) {
    return reject('H_PRE_MISSING', 'The reference has no closing height (h_pre_mm). Save the shrink tube again.')
  }
  if (recipe.h_post_mm == null || recipe.h_post_mm === '' || !Number.isFinite(hPost)) {
    return reject('H_POST_MISSING', 'The reference has no opening height (h_post_mm). Save the shrink tube again.')
  }

  if (axes.length === 1) {
    // Moving axis at TRAVEL + other axis at HOME. About 32.3 mm + mechOff on today's default curve.
    const minOpeningMm = H_PRODUCTION_PARK_MM + (Number(mechOffsetMm) || 0)
    if (hPre < minOpeningMm) {
      return reject(
        'H_PRE_BELOW_SINGLE_AXIS_MIN',
        `Closing height ${hPre} mm is below ${minOpeningMm.toFixed(2)} mm, the smallest opening one ${axes[0]} jaw can reach with the other jaw at HOME. Use centring_axis both or a larger closing gap.`,
      )
    }
  }

  const cal = normalizeSlaveCal(slaveCal)
  let poses
  try {
    poses = expectedReferencePoses({ reference: recipe, slaveCal: cal, mechOffsetMm })
  } catch (e) {
    return reject('HEIGHT_UNREACHABLE', `A reference height cannot be reached with the height model: ${e.message}`)
  }

  const details = []
  for (const axis of axes) {
    const pre = poses.h_pre[axis]
    const post = poses.h_post[axis]
    const tPre = matchTolerances(axis, pre.angleDeg, tolDeg, cal)
    const tPost = matchTolerances(axis, post.angleDeg, tolDeg, cal)
    const fields = [
      ['angle', 'angleDeg', 'angleDeg', '°'],
      ['height', 'sideHeightMm', 'heightMm', ' mm'],
      ...(cal ? [['pulse', 'pulseUs', 'pulseUs', ' µs']] : []),
    ]
    for (const [label, poseKey, tolKey, unit] of fields) {
      const diff = Math.abs(pre[poseKey] - post[poseKey])
      const need = 2 * Math.max(tPre[tolKey], tPost[tolKey])
      if (!(diff > need)) {
        details.push(`${axis} ${label}: h_pre and h_post differ by ${diff.toFixed(3)}${unit}, need more than ${need.toFixed(3)}${unit}`)
      }
    }
  }
  if (details.length) {
    return reject(
      'H_PRE_H_POST_TOO_CLOSE',
      `Closing height ${hPre} mm and opening height ${hPost} mm are too close for a ${tolDeg}° match tolerance. Increase the gap between them or lower the tolerance.`,
      details,
    )
  }

  return { ok: true, class: lengthClass.class, centringAxes: axes }
}
