/**
 * Pick & Place production preflight — mirrors manual terminal flow before MOVEAMMT2.
 */
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const opsUrl = pathToFileURL(
  path.join(__dirname, '..', '..', 'New_version_pick&place', 'master', 'lib', 'pick_place_ops.mjs'),
).href
const masterUrl = pathToFileURL(
  path.join(__dirname, '..', '..', 'New_version_pick&place', 'master', 'pick_place_master.js'),
).href

const ops = await import(opsUrl)
const master = await import(masterUrl)

let _testDeps = null
/**
 * @param {{
 *   preparePickPlaceTcp?: Function,
 *   remediatePickPlace?: Function,
 *   getPickPlaceConfig?: Function,
 *   INIT_BACKOFF_TOLERANCE_MM?: number,
 *   isPickPlaceAtInitRest?: Function,
 *   moveAmmT2?: Function,
 *   initializePickPlace?: Function,
 *   homeA?: Function,
 *   homeB?: Function,
 *   homeCommand?: Function,
 * }|null} deps
 */
export function __setPickPlaceProductionTestDeps(deps) {
  _testDeps = deps
}
export function __clearPickPlaceProductionTestDeps() {
  _testDeps = null
}

function deps() {
  if (_testDeps) return _testDeps
  return {
    preparePickPlaceTcp: ops.preparePickPlaceTcp,
    remediatePickPlace: ops.remediatePickPlace,
    getPickPlaceConfig: master.getPickPlaceConfig,
    INIT_BACKOFF_TOLERANCE_MM: master.INIT_BACKOFF_TOLERANCE_MM,
    isPickPlaceAtInitRest: master.isPickPlaceAtInitRest,
    moveAmmT2: master.moveAmmT2,
    initializePickPlace: master.initializePickPlace,
    homeA: master.homeA,
    homeB: master.homeB,
    homeCommand: master.homeCommand,
    setPickPlaceProductionTcpHold: master.setPickPlaceProductionTcpHold,
    getPickPlaceProductionTcpHold: master.getPickPlaceProductionTcpHold,
    disconnect: master.disconnect,
  }
}

function benchSingleMotor() {
  return Number(process.env.PICK_PLACE_SINGLE_MOTOR || process.env.PICK_PLACE_BENCH_AXIS || 0) === 1
}

/**
 * Validate a centring-related absolute position on pick-place axis A.
 * @param {number} targetMm
 * @param {'centering input'|'centering output'} label
 */
export function validatePickPlaceCentringTargetMm(targetMm, label) {
  const cfg = deps().getPickPlaceConfig()
  const min = cfg.backoffMmA
  const max = cfg.maxPositionMm
  const t = Number(targetMm)
  if (!Number.isFinite(t)) {
    throw new Error(`Pick & Place ${label}: invalid position`)
  }
  if (label === 'centering input' && t <= min) {
    throw new Error(
      'centering_input_start_mm not configured for production — set in Settings → Centring (must be > pick-place backoff)',
    )
  }
  if (t < min || t > max) {
    throw new Error(
      `Pick & Place ${label} ${t} mm outside travel window [${min}, ${max}] mm`,
    )
  }
  return t
}

function pickPlaceMoveToleranceMm() {
  const n = Number(process.env.PICK_PLACE_MOVE_TOLERANCE_MM)
  return Number.isFinite(n) && n > 0 ? n : 0.5
}

/**
 * Verify axis A reached target after MOVEAMMT2.
 * @param {number} targetMm
 * @param {object} moveResult return value from moveAmmT2
 * @param {'centering input'|'centering output'} label
 */
export function assertPickPlaceAtTargetMm(targetMm, moveResult, label) {
  const tol = pickPlaceMoveToleranceMm()
  const pos = Number(moveResult?.positionA ?? moveResult?.position)
  const target = Number(targetMm)
  if (!Number.isFinite(pos)) {
    throw new Error(`Pick & Place ${label}: position unavailable after move`)
  }
  if (Math.abs(pos - target) > tol) {
    throw new Error(
      `Pick & Place ${label}: did not reach ${target} mm (pos=${pos} mm, tol=${tol} mm)`,
    )
  }
  return pos
}

/**
 * Preflight before production MOVEAMMT2: probe TCP, CLRFAULT if needed, verify homed + at rest.
 * @returns {Promise<{ status: object, returnPositionMm: number }>}
 */
export async function ensurePickPlaceReadyForProduction() {
  const {
    preparePickPlaceTcp,
    remediatePickPlace,
    getPickPlaceConfig,
    INIT_BACKOFF_TOLERANCE_MM,
    setPickPlaceProductionTcpHold,
    getPickPlaceProductionTcpHold,
    disconnect,
  } = deps()
  // Fresh session only when not already under production hold (centring + main
  // sequence both call this — reconnecting mid-cycle is unnecessary).
  const alreadyHeld = !!getPickPlaceProductionTcpHold?.()
  if (!alreadyHeld) {
    try {
      disconnect?.()
    } catch { /* ignore */ }
    setPickPlaceProductionTcpHold?.(true)
  }
  await preparePickPlaceTcp()

  const { status: st } = await remediatePickPlace()

  if (st.fault) {
    throw new Error('Pick & Place not ready: fault latched after CLRFAULT — check hardware')
  }
  if (st.estop) {
    throw new Error('Pick & Place not ready: e-stop latched — clear and run Initialization')
  }

  const single = benchSingleMotor()
  if (!st.homedA) {
    throw new Error('Pick & Place not ready: axis A not homed — run Initialization first')
  }
  if (!single && !st.homedB) {
    throw new Error('Pick & Place not ready: axis B not homed — run Initialization first')
  }

  const cfg = getPickPlaceConfig()
  const posA = st.positionA ?? 0
  if (Math.abs(posA - cfg.backoffMmA) > INIT_BACKOFF_TOLERANCE_MM) {
    throw new Error(
      `Pick & Place not ready: axis A not at rest (pos=${posA} mm, expected ~${cfg.backoffMmA} mm) — run Initialization`,
    )
  }

  return {
    status: st,
    returnPositionMm: posA,
  }
}

/**
 * Return pick & place to the homed rest position after the pick tail.
 * Always: HOMEA → HOMEB (never MOVEAMMT2). Same order as Initialization.
 *
 * @param {number} [homingSpeed] overrides config speed for HOME
 * @param {{ onPhase?: (name: string, command: string) => void }} [opts]
 */
export async function returnPickPlaceToHomePosition(homingSpeed, opts = {}) {
  const d = deps()
  const cfg = d.getPickPlaceConfig()
  const speed = homingSpeed ?? cfg.homingSpeedMmS
  const backoffA = cfg.backoffMmA
  const backoffB = cfg.backoffMmB
  const tolerance = d.INIT_BACKOFF_TOLERANCE_MM
  const onPhase = opts.onPhase
  const single = benchSingleMotor()
  const homeAFn = d.homeA ?? master.homeA
  const homeBFn = d.homeB ?? master.homeB
  const homeCommandFn = d.homeCommand ?? master.homeCommand

  await d.preparePickPlaceTcp()
  const { status: st0 } = await d.remediatePickPlace()
  if (st0.fault) {
    throw new Error('Pick & Place return failed: fault latched after CLRFAULT — check hardware')
  }
  if (st0.estop) {
    throw new Error('Pick & Place return failed: e-stop latched — clear and run Initialization')
  }

  const cmdA = homeCommandFn('HOMEA', 'a', backoffA, speed)
  onPhase?.('return_to_backoff_home_a', cmdA)
  const homeAResult = await homeAFn(backoffA, speed)
  if (!homeAResult?.homedA) {
    throw new Error('Pick & Place return failed: axis A not homed after HOMEA')
  }
  if (Math.abs(homeAResult.positionA - backoffA) > tolerance) {
    throw new Error(
      `Pick & Place return failed: axis A not at backoff (pos=${homeAResult.positionA} mm, expected=${backoffA} mm)`,
    )
  }

  let homeBResult = null
  let cmdB = null
  if (!single) {
    cmdB = homeCommandFn('HOMEB', 'b', backoffB, speed)
    onPhase?.('return_to_backoff_home_b', cmdB)
    homeBResult = await homeBFn(backoffB, speed)
    if (!homeBResult?.homedB) {
      throw new Error('Pick & Place return failed: axis B not homed after HOMEB')
    }
    if (Math.abs(homeBResult.positionB - backoffB) > tolerance) {
      throw new Error(
        `Pick & Place return failed: axis B not at backoff (pos=${homeBResult.positionB} mm, expected=${backoffB} mm)`,
      )
    }
  }

  const commands = [homeAResult.command || cmdA]
  if (homeBResult) commands.push(homeBResult.command || cmdB)

  return {
    ok: true,
    command: commands.join(' ; '),
    commands,
    homeA: homeAResult,
    homeB: homeBResult,
    positionA: homeAResult.positionA,
    positionB: single ? null : homeBResult?.positionB,
    position: homeAResult.positionA,
    alreadyHomed: false,
    procedure: single ? 'HOMEA → backoff A' : 'HOMEA → backoff A, then HOMEB → backoff B',
    steps: [
      { axis: 'A', command: homeAResult.command || cmdA, homed: true, positionMm: homeAResult.positionA, backoffMm: backoffA },
      ...(homeBResult
        ? [{ axis: 'B', command: homeBResult.command || cmdB, homed: true, positionMm: homeBResult.positionB, backoffMm: backoffB }]
        : []),
    ],
    restPositionMmA: homeAResult.positionA,
  }
}

export {
  preparePickPlaceTcp,
  readPickPlaceStatus,
  clearPickPlaceFault,
  remediatePickPlace,
} from '../../New_version_pick&place/master/lib/pick_place_ops.mjs'
