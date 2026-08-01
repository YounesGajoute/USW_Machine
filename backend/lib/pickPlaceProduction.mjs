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
 *   moveCommandAT2?: Function,
 *   initializePickPlace?: Function,
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
    moveCommandAT2: master.moveCommandAT2,
    initializePickPlace: master.initializePickPlace,
    setPickPlaceProductionTcpHold: master.setPickPlaceProductionTcpHold,
    getPickPlaceProductionTcpHold: master.getPickPlaceProductionTcpHold,
    disconnect: master.disconnect,
  }
}

/** @param {string|undefined|null} axis */
function normalizeReferenceAxis(axis) {
  return String(axis || 'a').toLowerCase() === 'b' ? 'b' : 'a'
}

/**
 * Rest target for dual-motor return: Backoff of the configured reference axis.
 * Settings → Pick & Place → Config (Reference axis, Backoff A/B).
 * @param {{ referenceAxis?: string, backoffMmA: number, backoffMmB: number }} cfg
 */
export function pickPlaceBackoffTargetMm(cfg) {
  const ref = normalizeReferenceAxis(cfg.referenceAxis)
  return {
    referenceAxis: ref,
    targetMm: ref === 'b' ? Number(cfg.backoffMmB) : Number(cfg.backoffMmA),
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
    // Soft-stop / mid-cycle abort often leaves the carriage off backoff while still
    // homed. Re-arm to rest here so the next Start does not require full Initialization.
    console.warn(
      `[PickPlace] Off backoff (posA=${posA} mm, expected ~${cfg.backoffMmA} mm) — returning to rest before production`,
    )
    try {
      const rearm = await rearmPickPlaceToBackoffBestEffort(cfg.movementSpeedMmS)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Pick & Place not ready: axis A not at rest (pos=${posA} mm, expected ~${cfg.backoffMmA} mm) — rearm failed (${msg}) — run Initialization`,
      )
    }
    const { status: st2 } = await remediatePickPlace()
    const posA2 = st2?.positionA ?? 0
    if (Math.abs(posA2 - cfg.backoffMmA) > INIT_BACKOFF_TOLERANCE_MM) {
      throw new Error(
        `Pick & Place not ready: axis A not at rest (pos=${posA2} mm, expected ~${cfg.backoffMmA} mm) — run Initialization`,
      )
    }
    return {
      status: st2,
      returnPositionMm: posA2,
    }
  }

  return {
    status: st,
    returnPositionMm: posA,
  }
}

/**
 * True when a MOVEAMMT2 / return failure looks like a HOME-limit collision
 * (0xF3) or related move abort that initializePickPlace can recover from.
 * @param {unknown} err
 */
function isPickPlaceHomeLimitError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return (
    /0xF3/i.test(msg) ||
    /HOME limit/i.test(msg) ||
    /home.?limit/i.test(msg)
  )
}

/**
 * After a failed MOVEAMMT2 return, disconnect + initializePickPlace (HOMEA/HOMEB → backoff).
 * @param {ReturnType<typeof deps>} d
 * @param {number} targetMm
 * @param {'a'|'b'} ref
 * @param {string} priorMsg
 */
async function recoverReturnViaInitialize(d, targetMm, ref, priorMsg) {
  console.warn(
    `[PickPlace] Return to backoff failed (${priorMsg}) — falling back to initializePickPlace`,
  )
  const initFn = d.initializePickPlace
  if (typeof initFn !== 'function') {
    throw new Error(priorMsg)
  }
  try {
    d.disconnect?.()
  } catch { /* ignore */ }
  d.setPickPlaceProductionTcpHold?.(true)
  await d.preparePickPlaceTcp?.()
  await initFn()
  const { status: st } = await d.remediatePickPlace()
  const posA = Number(st?.positionA ?? NaN)
  const posB = Number(st?.positionB ?? NaN)
  const single = benchSingleMotor()
  const logicalPos = ref === 'b' && !single
    ? (Number.isFinite(posB) ? posB : posA)
    : posA
  if (!Number.isFinite(logicalPos)) {
    throw new Error(
      `Pick & Place return failed: position unavailable after initialize fallback (${priorMsg})`,
    )
  }
  const tolerance = Math.max(d.INIT_BACKOFF_TOLERANCE_MM ?? 0.2, pickPlaceMoveToleranceMm())
  if (Math.abs(logicalPos - targetMm) > tolerance) {
    throw new Error(
      `Pick & Place return failed after initialize: not at backoff (ref=${ref.toUpperCase()} pos=${logicalPos} mm, expected=${targetMm} mm)`,
    )
  }
  return {
    ok: true,
    command: 'initializePickPlace',
    commands: ['initializePickPlace'],
    homeA: null,
    homeB: null,
    move: null,
    referenceAxis: ref,
    targetMm,
    positionA: Number.isFinite(posA) ? posA : logicalPos,
    positionB: Number.isFinite(posB) ? posB : null,
    position: logicalPos,
    alreadyHomed: false,
    via: 'initialize',
    procedure: `initializePickPlace → backoff ${ref.toUpperCase()} (${targetMm} mm) after MOVEAMMT2 failure`,
    steps: [
      {
        axis: 'both',
        referenceAxis: ref,
        command: 'initializePickPlace',
        positionMm: logicalPos,
        backoffMm: targetMm,
      },
    ],
    restPositionMmA: Number.isFinite(posA) ? posA : logicalPos,
  }
}

/**
 * Best-effort re-arm to configured backoff after soft-stop / abort.
 * Tries MOVEAMMT2 return first; on HOME-limit / move failure falls back to
 * initializePickPlace (HOMEA/HOMEB → backoff) so the next Start does not need
 * a full machine Initialization.
 *
 * @param {number} [moveSpeed]
 * @returns {Promise<{ ok: true, via: 'return'|'initialize' }>}
 */
export async function rearmPickPlaceToBackoffBestEffort(moveSpeed) {
  const d = deps()
  const cfg = d.getPickPlaceConfig()
  const speed = moveSpeed ?? cfg.movementSpeedMmS
  try {
    const r = await returnPickPlaceToHomePosition(speed)
    return { ok: true, via: r.via === 'initialize' ? 'initialize' : 'return' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const { referenceAxis: ref, targetMm } = pickPlaceBackoffTargetMm(cfg)
    const recovered = await recoverReturnViaInitialize(d, targetMm, ref, msg)
    return { ok: true, via: recovered.via || 'initialize' }
  }
}

/**
 * Return pick & place to configured backoff after the pick tail.
 * Uses MOVEAMMT2 to the Backoff of the configured Reference axis
 * (Settings → Pick & Place → Config: Reference axis A/B, Backoff A/B).
 * Axes must already be homed (Initialization); this path does not re-home
 * unless MOVEAMMT2 hits a HOME limit (0xF3), in which case it falls back to
 * initializePickPlace — same recovery as preflight / soft-stop rearm.
 *
 * @param {number} [moveSpeed] overrides config movement speed (mm/s)
 * @param {{ onPhase?: (name: string, command: string) => void }} [opts]
 */
export async function returnPickPlaceToHomePosition(moveSpeed, opts = {}) {
  const d = deps()
  const cfg = d.getPickPlaceConfig()
  const { referenceAxis: ref, targetMm } = pickPlaceBackoffTargetMm(cfg)
  if (!Number.isFinite(targetMm)) {
    throw new Error('Pick & Place return failed: invalid backoff target for reference axis')
  }
  const speed = moveSpeed ?? cfg.movementSpeedMmS
  const tolerance = Math.max(d.INIT_BACKOFF_TOLERANCE_MM ?? 0.2, pickPlaceMoveToleranceMm())
  const onPhase = opts.onPhase
  const single = benchSingleMotor()
  const moveFn = d.moveAmmT2 ?? master.moveAmmT2
  const moveCommandFn = d.moveCommandAT2 ?? master.moveCommandAT2

  await d.preparePickPlaceTcp()
  const { status: st0 } = await d.remediatePickPlace()
  if (st0.fault) {
    throw new Error('Pick & Place return failed: fault latched after CLRFAULT — check hardware')
  }
  if (st0.estop) {
    throw new Error('Pick & Place return failed: e-stop latched — clear and run Initialization')
  }
  if (!st0.homedA) {
    throw new Error('Pick & Place return failed: axis A not homed — run Initialization first')
  }
  if (!single && !st0.homedB) {
    throw new Error('Pick & Place return failed: axis B not homed — run Initialization first')
  }

  const cmd = moveCommandFn(targetMm, speed)
  onPhase?.('return_to_backoff_move', cmd)
  let moveResult
  try {
    moveResult = await moveFn(targetMm, speed, ref)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!isPickPlaceHomeLimitError(err)) throw err instanceof Error ? err : new Error(msg)
    onPhase?.('return_to_backoff_home_fallback', 'initializePickPlace')
    return recoverReturnViaInitialize(d, targetMm, ref, msg)
  }
  const command = moveResult?.command || cmd

  const posA = Number(moveResult?.positionA ?? moveResult?.position)
  const posB = single ? null : Number(moveResult?.positionB ?? NaN)
  const logicalPos = ref === 'b' && !single
    ? (Number.isFinite(posB) ? posB : Number(moveResult?.position))
    : posA
  if (!Number.isFinite(logicalPos)) {
    throw new Error('Pick & Place return failed: position unavailable after MOVEAMMT2')
  }
  if (Math.abs(logicalPos - targetMm) > tolerance) {
    throw new Error(
      `Pick & Place return failed: not at backoff (ref=${ref.toUpperCase()} pos=${logicalPos} mm, expected=${targetMm} mm)`,
    )
  }

  return {
    ok: true,
    command,
    commands: [command],
    homeA: null,
    homeB: null,
    move: moveResult,
    referenceAxis: ref,
    targetMm,
    positionA: Number.isFinite(posA) ? posA : logicalPos,
    positionB: Number.isFinite(posB) ? posB : null,
    position: logicalPos,
    alreadyHomed: true,
    via: 'return',
    procedure: `MOVEAMMT2 → backoff ${ref.toUpperCase()} (${targetMm} mm)`,
    steps: [
      {
        axis: 'both',
        referenceAxis: ref,
        command,
        positionMm: logicalPos,
        backoffMm: targetMm,
      },
    ],
    restPositionMmA: Number.isFinite(posA) ? posA : logicalPos,
  }
}

export {
  preparePickPlaceTcp,
  readPickPlaceStatus,
  clearPickPlaceFault,
  remediatePickPlace,
} from '../../New_version_pick&place/master/lib/pick_place_ops.mjs'
