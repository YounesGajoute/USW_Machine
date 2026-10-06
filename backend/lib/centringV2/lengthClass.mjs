/**
 * Version 2 centring length class (requirements §7, V2-REQ-001 / 002 / 005).
 *
 * L_eff is the shrink-tube length (`l_eff_mm`). It is not the frame guide
 * spacing (40 mm / 300 mm) and is only used to pick Class A or Class B.
 *
 *   Class A: 40 ≤ L_eff ≤ 55 mm (55 is Class A)
 *   Class B: 55 < L_eff ≤ 100 mm
 *
 * Anything else is rejected. There is no default class.
 */

export const LENGTH_CLASS_A = 'A'
export const LENGTH_CLASS_B = 'B'

export const L_EFF_MIN_MM = 40
export const L_EFF_CLASS_A_MAX_MM = 55
export const L_EFF_MAX_MM = 100

/** `l_eff_mm` from a persisted tube row, or `L_eff_mm` from a resolved recipe. */
export function lEffFromRecipe(recipe) {
  return recipe?.l_eff_mm ?? recipe?.L_eff_mm
}

/**
 * @param {number} lEffMm
 * @returns {{ ok: true, class: 'A' | 'B', lEffMm: number }
 *   | { ok: false, code: string, message: string }}
 */
export function classifyLengthClass(lEffMm) {
  if (lEffMm == null || lEffMm === '') {
    return {
      ok: false,
      code: 'LEFF_MISSING',
      message: 'The reference has no effective tube length (l_eff_mm). Save the shrink tube again.',
    }
  }
  const l = Number(lEffMm)
  if (!Number.isFinite(l)) {
    return {
      ok: false,
      code: 'LEFF_MISSING',
      message: 'The reference effective tube length (l_eff_mm) is not a number. Save the shrink tube again.',
    }
  }
  if (l < L_EFF_MIN_MM || l > L_EFF_MAX_MM) {
    return {
      ok: false,
      code: 'LEFF_OUT_OF_RANGE',
      message: `Effective tube length ${l} mm is outside ${L_EFF_MIN_MM}–${L_EFF_MAX_MM} mm. Change the tube length or tolerance.`,
    }
  }
  return {
    ok: true,
    class: l <= L_EFF_CLASS_A_MAX_MM ? LENGTH_CLASS_A : LENGTH_CLASS_B,
    lEffMm: l,
  }
}
