/**
 * Test support: a centring STATUS at the loaded reference's H_PRE, for tests
 * that need the Version 2 rest gate open without exercising centring.
 * Not imported by production code.
 */
import { S_MAX } from '../centringMaster/centring_height_model.js'
import { registerCentringConfigStore, loadCentringConfig } from '../centring.mjs'
import { loadCentringV2Reference } from '../centringV2Production.mjs'
import { centringAxesOf, expectedReferencePoses } from '../centringV2/position.mjs'

export const TEST_SLAVE_CAL = Object.freeze({ calId: 'T1', hu: 2200, tu: 900, hl: 2150, tl: 850 })

const SWITCH = Object.freeze({ upper: ['uh', 'ut'], lower: ['lh', 'lt'] })
const KEYS = Object.freeze({ upper: ['u', 'pu', 'puMm'], lower: ['l', 'pl', 'plMm'] })
const TRAVEL_PULSE = Object.freeze({ upper: 'tu', lower: 'tl' })

/** Saved calibration for the centring config (no file on disk is read). */
export function useTestSlaveCal() {
  registerCentringConfigStore({
    load: () => ({ slaveCal: { ...TEST_SLAVE_CAL }, mechOffsetMm: 0 }),
    save: () => {},
    path: () => ':memory:',
  })
  loadCentringConfig()
}

/**
 * STATUS with every centring_axis jaw at the reference h_pre and an unused jaw
 * at TRAVEL. Needs useTestSlaveCal() and the production context for referenceId.
 */
export function statusAtHPre(referenceId) {
  const loaded = loadCentringV2Reference(referenceId)
  if (!loaded.ok) throw new Error(`statusAtHPre: ${loaded.message}`)
  const reference = loaded.reference
  const axes = centringAxesOf(reference.centring_axis)
  const partnerArgs = axes.length === 1 ? { partnerAngleDeg: S_MAX } : {}
  let poses
  try {
    poses = expectedReferencePoses({ reference, slaveCal: TEST_SLAVE_CAL, ...partnerArgs })
  } catch {
    poses = expectedReferencePoses({ reference: { ...reference, h_post_mm: reference.h_pre_mm }, slaveCal: TEST_SLAVE_CAL, ...partnerArgs })
  }
  const st = { busy: false, estop: false, cal: true, moveEnd: 'ok', uh: false, ut: false, lh: false, lt: false, ...TEST_SLAVE_CAL }
  for (const axis of ['upper', 'lower']) {
    const [angle, pulse, height] = KEYS[axis]
    if (axes.includes(axis)) {
      const p = poses.h_pre[axis]
      Object.assign(st, { [angle]: p.angleDeg, [pulse]: p.pulseUs, [height]: p.sideHeightMm })
    } else {
      Object.assign(st, { [angle]: S_MAX, [pulse]: TEST_SLAVE_CAL[TRAVEL_PULSE[axis]], [height]: null, [SWITCH[axis][1]]: true })
    }
  }
  return st
}
