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
/** @param {{ preparePickPlaceTcp?: Function, remediatePickPlace?: Function, getPickPlaceConfig?: Function, INIT_BACKOFF_TOLERANCE_MM?: number }|null} deps */
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

/**
 * Preflight before production MOVEAMMT2: probe TCP, CLRFAULT if needed, verify homed + at rest.
 * @returns {Promise<{ status: object, returnPositionMm: number }>}
 */
export async function ensurePickPlaceReadyForProduction() {
  const { preparePickPlaceTcp, remediatePickPlace, getPickPlaceConfig, INIT_BACKOFF_TOLERANCE_MM } = deps()
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
    throw new Error('Pick & Place not ready: axis A not homed — run Initialization (DI0)')
  }
  if (!single && !st.homedB) {
    throw new Error('Pick & Place not ready: axis B not homed — run Initialization (DI0)')
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

export {
  preparePickPlaceTcp,
  readPickPlaceStatus,
  clearPickPlaceFault,
  remediatePickPlace,
} from '../../New_version_pick&place/master/lib/pick_place_ops.mjs'
