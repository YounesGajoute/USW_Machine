/**
 * Version 2 centring initialization (requirements §6.1, control-file decision 6).
 *
 * One sequence, used by E-stop clear:
 *   1. HOME both axes (the Nano skips an axis whose HOME switch is pressed).
 *   2. Read STATUS. cal=0 → apply the saved slaveCal with master.setCal.
 *      No valid saved relation → stop at HOME, no height move.
 *   3. Reference loaded and recipe gate passed → one MOVE*MM to h_pre_mm on
 *      centring_axis. No SEEK_TRAVEL, no h_post_mm.
 *   4. No reference → stop after HOME.
 * After the height move each centring_axis axis must classify as H_PRE.
 * Anything else is a failure and the jaws are not sent anywhere else.
 *
 * The master is injected, so this module opens no socket and reads no database.
 * The caller loads the reference and the saved calibration and runs
 * validateCentringV2Recipe when a reference is present.
 */
import {
  centringAxesOf,
  classifyAxisPosition,
  expectedReferencePoses,
  moveCommandForCentringAxis,
  normalizeSlaveCal,
  H_PRE,
} from './position.mjs'

const MOVE_METHOD_BY_COMMAND = Object.freeze({
  MOVEBOTHMM: 'moveBoth',
  MOVE_UPPERMM: 'moveUpper',
  MOVE_LOWERMM: 'moveLower',
})

function errorText(err) {
  return err instanceof Error ? err.message : String(err)
}

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

/** Pulse, angle, and side height of each axis from a completion STATUS. */
export function lastMoveFromStatus(st, command) {
  if (!st) return null
  return {
    command,
    upper: { pulseUs: st.pu, angleDeg: st.u, sideHeightMm: st.puMm },
    lower: { pulseUs: st.pl, angleDeg: st.l, sideHeightMm: st.plMm },
  }
}

/**
 * @param {object} master — `{ homeBoth(), status(), setCal(cal), moveBoth(h), moveUpper(h), moveLower(h) }`
 * @param {object} [context]
 * @param {object|null} [context.reference] — loaded recipe (`h_pre_mm`, `h_post_mm`, `centring_axis`, `l_eff_mm`)
 * @param {object|null} [context.recipeGate] — result of validateCentringV2Recipe for that reference
 * @param {object|null} [context.slaveCal] — saved pulse–angle relation
 * @param {number} [context.mechOffsetMm=0]
 * @param {number} [context.toleranceDeg] — position match tolerance, default 0.5°
 * @param {{ info: Function, warn: Function }} [context.log=console]
 * @returns {Promise<{ ok: true, outcome: 'home'|'h_pre', status: object, positions?: object }
 *   | { ok: false, code: string, message: string, status?: object, positions?: object }>}
 */
export async function initializeCentring(master, context = {}) {
  const {
    reference = null,
    recipeGate = null,
    slaveCal = null,
    mechOffsetMm = 0,
    toleranceDeg,
    log = console,
  } = context

  try {
    await master.homeBoth()
  } catch (err) {
    const first = errorText(err)
    if (!/timeout waiting for line/i.test(first)) {
      log.warn(`[centring] initialization HOME failed: ${first}`)
      return fail(
        'HOME_FAILED',
        `Initialization failed. HOME did not finish: ${first}. `
        + 'Check the HOME switches and that nothing blocks the jaws, then clear the E-stop again.',
      )
    }
    log.warn(`[centring] initialization HOME got no reply (${first}); retrying once`)
    try {
      await master.homeBoth()
    } catch (err2) {
      const second = errorText(err2)
      log.warn(`[centring] initialization HOME failed: ${second}`)
      return fail(
        'HOME_FAILED',
        `Initialization failed. HOME did not finish: ${second}. `
        + 'Check the HOME switches and that nothing blocks the jaws, then clear the E-stop again.',
      )
    }
  }

  let st = await master.status()
  if (!st) {
    return fail(
      'STATUS_UNAVAILABLE',
      'Initialization failed. The centring controller did not answer STATUS after HOME. '
      + 'Check the centring network link, then clear the E-stop again.',
    )
  }

  if (!st.cal) {
    if (!normalizeSlaveCal(slaveCal)) {
      log.warn('[centring] initialization stopped at HOME: cal=0 and no valid saved calibration')
      return fail(
        'NO_CALIBRATION',
        'Initialization stopped at HOME. The centring controller has no height calibration and '
        + 'no valid saved calibration exists, so no height move can be sent. '
        + 'Run Settings → Height calibration.',
        { status: st },
      )
    }
    try {
      st = await master.setCal(slaveCal)
    } catch (err) {
      log.warn(`[centring] initialization SETCAL failed: ${errorText(err)}`)
      return fail(
        'CAL_APPLY_FAILED',
        `Initialization stopped at HOME. The saved calibration was not accepted: ${errorText(err)}. `
        + 'Run Settings → Height calibration.',
        { status: st },
      )
    }
  }

  if (!reference) {
    log.info('[centring] initialization stopped at HOME (no reference loaded)')
    return { ok: true, outcome: 'home', status: st }
  }

  if (!recipeGate?.ok) {
    const why = recipeGate?.message || 'the recipe was not validated'
    log.warn(`[centring] initialization stopped at HOME: recipe rejected (${recipeGate?.code ?? 'NO_GATE'})`)
    return fail(
      'RECIPE_REJECTED',
      `Initialization stopped at HOME. The loaded reference cannot be used for centring: ${why}`,
      { status: st, recipeGate },
    )
  }

  const command = moveCommandForCentringAxis(reference.centring_axis)
  const hPreMm = Number(reference.h_pre_mm)
  let moved
  try {
    moved = await master[MOVE_METHOD_BY_COMMAND[command]](hPreMm)
  } catch (err) {
    log.warn(`[centring] initialization ${command} ${hPreMm} mm failed: ${errorText(err)}`)
    return fail(
      'MOVE_FAILED',
      `Initialization failed. The move to the closing height ${hPreMm} mm did not finish: ${errorText(err)}. `
      + 'Check the jaws and the saved height calibration, then clear the E-stop again.',
      { status: st },
    )
  }
  st = moved?.status ?? moved

  const lastCompletedMove = lastMoveFromStatus(st, command)
  const positions = {}
  for (const axis of centringAxesOf(reference.centring_axis)) {
    positions[axis] = classifyAxisPosition({
      axis,
      status: st,
      lastCompletedMove,
      reference,
      slaveCal,
      toleranceDeg,
      mechOffsetMm,
    })
  }

  const wrong = Object.entries(positions).filter(([, p]) => p !== H_PRE)
  // #region agent log
  fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'50eb1b'},body:JSON.stringify({sessionId:'50eb1b',hypothesisId:'C',location:'initialize.mjs:afterMove',message:'initialization pose after height move',data:{command,hPreMm,positions,wrong:wrong.map(([a,p])=>`${a}:${p}`),u:st?.u??null,l:st?.l??null,h:st?.h??null,pu:st?.pu??null,pl:st?.pl??null,puMm:st?.puMm??null,plMm:st?.plMm??null,uh:st?.uh??null,ut:st?.ut??null,lh:st?.lh??null,lt:st?.lt??null,cal:st?.cal??null,moveEnd:st?.moveEnd??null,lastCmd:st?.lastCmd??null},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  if (wrong.length) {
    let expected = null
    try {
      expected = expectedReferencePoses({ reference, slaveCal, mechOffsetMm }).h_pre
    } catch { /* expected pose unavailable; positions still name the failure */ }
    const named = wrong.map(([axis, p]) => `${axis} is ${p}`).join(', ')
    log.warn(`[centring] initialization ${command} ${hPreMm} mm ended off H_PRE: ${named}`)
    return fail(
      'NOT_AT_H_PRE',
      `Initialization failed. After the move to the closing height ${hPreMm} mm, ${named} instead of H_PRE. `
      + 'The last move does not match the reference in pulse, angle, and height. '
      + 'Check the saved height calibration (Settings → Height calibration), then clear the E-stop again.',
      { status: st, positions, expected },
    )
  }

  log.info(`[centring] initialization HOME then ${command} ${hPreMm} mm — ${Object.keys(positions).join(', ')} at H_PRE`)
  return { ok: true, outcome: 'h_pre', status: st, positions }
}
