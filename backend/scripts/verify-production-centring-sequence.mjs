#!/usr/bin/env node
/**
 * End-to-end verification of production centring sequence.
 * Run: node backend/scripts/verify-production-centring-sequence.mjs
 * (Loads backend/.env automatically — no need to `source .env` first.)
 */
import path from 'path'
import { fileURLToPath } from 'url'
import { loadBackendEnv } from '../lib/loadBackendEnv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envLoad = loadBackendEnv(path.join(__dirname, '..', '.env'))

const { resolveShrinkTubeCentring, DEFAULT_FRAME, normalizeCentringFrameConfig } =
  await import('../lib/centring_frame_model.js')
const {
  gapMmToMoveTarget,
  H_PRODUCTION_PARK_MM,
  H_TOTAL_MAX,
  H_TOTAL_MIN,
  S_MAX,
  S_MIN,
} = await import('../lib/centringMaster/centring_height_model.js')
const { resolveGapMove } =
  await import('../lib/centringMaster/centring_reference.js')
const { buildProductionSteps } = await import('../lib/productionSequence.mjs')
const origCentring = await import('../lib/centring.mjs')

let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    const msg = detail ? `${name}: ${detail}` : name
    failures.push(msg)
    console.error(`  ✗ ${msg}`)
  }
}

const SAMPLE_TUBE = {
  diameter_mm: 4,
  length_mm: 100,
  diameter_closing_gap_mm: 3,
  diameter_opening_gap_mm: 6,
  centring_length_tolerance_mm: 0,
  centring_mechanism: 'upper',
}

const SAMPLE_SETTINGS = {
  centering_input_start_mm: 50,
  centering_input_offset_mm: 2,
  centring_frame_config: { ...DEFAULT_FRAME },
}

if (envLoad.loaded) {
  console.log(`\n[env] Loaded ${envLoad.keys} keys from ${envLoad.path}`)
} else {
  console.warn(`\n[env] No .env at ${envLoad.path} — live probe may be skipped`)
}

console.log('\n=== 1. Geometry resolution (resolveShrinkTubeCentring) ===\n')

const resolved = resolveShrinkTubeCentring(SAMPLE_TUBE, SAMPLE_SETTINGS)
const expectedTravel = 200 * (300 - 100) / (300 - 55)

check('h_pre from profile closing gap', resolved.h_pre_mm === 3)
check('h_post from profile opening gap', resolved.h_post_mm === 6)
check('L_eff = length + tolerance', resolved.L_eff_mm === 100)
check('centering_travel_mm formula', Math.abs(resolved.centering_travel_mm - expectedTravel) < 0.001)
check('centering_input_mm includes offset', resolved.centering_input_mm === 52)
check(
  'centering_output_mm = start + travel (offset does not shift exit)',
  Math.abs(resolved.centering_output_mm - (50 + expectedTravel)) < 0.001,
)
check(
  'centering_move_travel_mm = output - input',
  Math.abs(resolved.centering_move_travel_mm - (expectedTravel - 2)) < 0.001,
)
check('centring_axis upper for upper mechanism', resolved.centring_axis === 'upper')
check('centring_mechanism normalized', resolved.centring_mechanism === 'upper')

const bothResolved = resolveShrinkTubeCentring(
  { ...SAMPLE_TUBE, centring_mechanism: 'upper_and_lower' },
  SAMPLE_SETTINGS,
)
check('both mechanism → centring_axis both', bothResolved.centring_axis === 'both')

try {
  resolveShrinkTubeCentring({ ...SAMPLE_TUBE, length_mm: 10 }, SAMPLE_SETTINGS)
  check('L_eff below frame min throws', false)
} catch (e) {
  check('L_eff below frame min throws', /outside/.test(e.message))
}

try {
  resolveShrinkTubeCentring({ ...SAMPLE_TUBE, length_mm: 400 }, SAMPLE_SETTINGS)
  check('L_eff above frame max throws', false)
} catch (e) {
  check('L_eff above frame max throws', /outside/.test(e.message))
}

console.log('\n=== 2. Gap command mapping (resolveGapMove + gapMmToMoveTarget) ===\n')

const centringIdleSrc = await import('fs').then(fs =>
  fs.readFileSync(path.join(__dirname, '..', 'lib', 'centringIdle.mjs'), 'utf8'),
)

for (const [axis, cmd] of [
  ['both', 'MOVEBOTHMM'],
  ['upper', 'MOVE_UPPERMM'],
  ['lower', 'MOVE_LOWERMM'],
]) {
  const r = resolveGapMove({ gapMm: 6, axis })
  check(`${axis} → ${cmd}`, r.moveCommand === cmd && r.gapMm === 6)
}

const preTarget = gapMmToMoveTarget({
  gapMm: 3,
  moveCommand: 'MOVE_UPPERMM',
  uNow: 0,
  lNow: 90,
})
check('MOVE_UPPERMM h_pre: upper moves to ~3mm side', Math.abs(preTarget.expectedH - 3) < 0.1)

const parkModelH = gapMmToMoveTarget({
  gapMm: H_PRODUCTION_PARK_MM,
  moveCommand: 'MOVE_UPPERMM',
  uNow: S_MAX,
  lNow: S_MAX,
})
check(
  'model: open+closed posture totals H_PRODUCTION_PARK (park itself uses HOME_*)',
  Math.abs(parkModelH.expectedH - H_PRODUCTION_PARK_MM) < 0.2 && Math.abs(parkModelH.deg - S_MIN) < 0.5,
  `expectedH=${parkModelH.expectedH} deg=${parkModelH.deg}`,
)

const { productionPostureSigned } = await import('../lib/centringIdle.mjs')
const upperPosture = productionPostureSigned('upper')
const preFromPosture = gapMmToMoveTarget({
  gapMm: resolved.h_pre_mm,
  moveCommand: 'MOVE_UPPERMM',
  uNow: upperPosture.u,
  lNow: upperPosture.l,
})
check(
  'upper production posture allows h_pre gap move',
  preFromPosture.expectedH > resolved.h_pre_mm - 0.5,
)
check(
  'init/homing uses runCentringHomingSequence then SEEK_TRAVEL to closed idle',
  /runCentringHomingSequence/.test(centringIdleSrc) &&
    /initializeCentringTravelIdle[\s\S]*?await seekTravelBoth\(\)/.test(centringIdleSrc),
)
check(
  'prepareCentringProductionPosture parks via homeByAxis (not MOVE to synthetic H)',
  /ensureBothHomed/.test(centringIdleSrc) &&
    /await homeByAxis\(active\)/.test(centringIdleSrc) &&
    !/moveTo\(H_PRODUCTION_PARK/.test(centringIdleSrc),
)
check(
  'restoreCentringTravelIdle closes via SEEK_TRAVEL',
  /restoreCentringTravelIdle[\s\S]*?await seekTravelBoth\(\)/.test(centringIdleSrc),
)

check(
  'gaps within mechanical band',
  resolved.h_pre_mm >= H_TOTAL_MIN &&
    resolved.h_post_mm >= H_TOTAL_MIN &&
    resolved.h_pre_mm <= H_TOTAL_MAX &&
    resolved.h_post_mm <= H_TOTAL_MAX,
)

console.log('\n=== 3. runCentringCycle orchestration (real module) ===\n')

const { runCentringCycle, __setProductionCentringTestDeps, __clearProductionCentringTestDeps } =
  await import('../lib/productionCentringSequence.mjs')

const phaseLog = []
const ppMoves = []
const gapPhases = []

__setProductionCentringTestDeps({
  connectWithRetry: async () => {},
  ensureCentringReadyForProduction: async () => ({
    status: { u: S_MIN, l: S_MAX, h: H_PRODUCTION_PARK_MM, cal: true, estop: false },
    atClosedIdle: false,
    atProductionPosture: true,
  }),
  ensurePickPlaceReadyForProduction: async () => ({
    status: { positionA: 0.5 },
    returnPositionMm: 0.5,
  }),
  centringStatus: async () => ({ u: S_MIN, l: S_MAX, h: 3, cal: true, estop: false }),
  readCentringStatusAfterMove: async (phase, gap) => ({ u: S_MIN, l: S_MAX, h: gap, cal: true, estop: false }),
  prepareCentringProductionPosture: async () => ({
    parked: true,
    inactive_axis: 'lower',
    parked_at: 'home',
    status: { u: S_MIN, l: S_MAX, h: H_PRODUCTION_PARK_MM, cal: true, estop: false },
  }),
  pickPlaceStatus: async () => ({ positionA: 0.5 }),
  moveAmmT2: async (mm) => {
    ppMoves.push({ mm })
    return { command: 'MOVEAMMT2', positionA: mm }
  },
  applyShrinkTubeGapPhase: async (opts) => {
    gapPhases.push({ phase: opts.phase, gap: opts.phase === 'pre' ? resolved.h_pre_mm : resolved.h_post_mm, axis: opts.axis })
    return { phase: opts.phase, moveCommand: 'MOVE_UPPERMM', done: { h: opts.phase === 'pre' ? 3 : 6 } }
  },
})

try {
  await runCentringCycle({
    shrinkTube: SAMPLE_TUBE,
    systemSettings: SAMPLE_SETTINGS,
    onPhase: (n) => phaseLog.push(n),
  })
} finally {
  __clearProductionCentringTestDeps()
}

check(
  'full cycle phase order',
  phaseLog.join(',') ===
    'centring_park_inactive,centring_h_pre,move_centering_travel,centring_h_post',
)
check('single P&P MOVE to output (no input stop)', ppMoves.length === 1 && ppMoves[0]?.mm === resolved.centering_output_mm)
check('gap pre/post values', gapPhases[0]?.gap === 3 && gapPhases[1]?.gap === 6)
check('gap phases use upper axis', gapPhases.every((g) => g.axis === 'upper'))

ppMoves.length = 0
gapPhases.length = 0
__setProductionCentringTestDeps({
  connectWithRetry: async () => {},
  ensureCentringReadyForProduction: async () => ({
    status: { u: S_MIN, l: S_MAX, h: H_PRODUCTION_PARK_MM, cal: true, estop: false },
    atProductionPosture: true,
  }),
  centringStatus: async () => ({ u: S_MIN, l: S_MAX, h: 3, cal: true, estop: false }),
  readCentringStatusAfterMove: async (_p, gap) => ({ h: gap, cal: true, estop: false }),
  prepareCentringProductionPosture: async () => ({
    parked: true,
    inactive_axis: 'lower',
    status: { u: S_MIN, l: S_MAX, h: H_PRODUCTION_PARK_MM, cal: true, estop: false },
  }),
  moveAmmT2: async (mm) => {
    ppMoves.push({ mm })
    return { positionA: mm }
  },
  applyShrinkTubeGapPhase: async (opts) => {
    gapPhases.push({ phase: opts.phase, gap: opts.phase === 'pre' ? 3 : 6, axis: opts.axis })
    return { done: { h: opts.phase === 'pre' ? 3 : 6 } }
  },
})
try {
  await runCentringCycle({
    shrinkTube: SAMPLE_TUBE,
    systemSettings: SAMPLE_SETTINGS,
    skipCentringPickPlace: true,
  })
} finally {
  __clearProductionCentringTestDeps()
}
check('skipCentringPickPlace: zero P&P moves', ppMoves.length === 0)
check('skipCentringPickPlace: gap moves still run', gapPhases.length === 2)

console.log('\n=== 4. Production sequence integration (buildProductionSteps) ===\n')

const mockEcm = { isInitialized: true }
const mockCtx = {
  timing: {
    moveSpeedMmS: 80,
    delayAfterClampCloseMs: 0,
    delayAfterLeverUpMs: 0,
    delayAfterPpClampCloseMs: 0,
    delayAfterClampOpenMs: 0,
    delayAfterLeverDownMs: 0,
    delayAfterPickClampOpenMs: 0,
    movePositionMm: 320,
    movePositionEvoMm: 320,
    armDelayBeforeMs: 0,
    armPulseMs: 0,
    armDelayAfterMs: 0,
  },
  skipPickTail: false,
  skipCentringPickPlace: false,
  skipCentring: false,
  skipVision: true,
  init: { referenceId: 'REF-1' },
  centringContext: { shrinkTube: SAMPLE_TUBE, systemSettings: SAMPLE_SETTINGS },
  visionChecks: { welding_splice: { enabled: false }, heat_shrink_tube: { enabled: false } },
}
const phases = []
const state = { centring: null, moveToPick: null, moveToBackoff: null }
const steps = buildProductionSteps(mockEcm, mockCtx, phases, state)
const stepNames = steps.map((s) => s.name)

check('production steps include centring', stepNames.includes('centring'))
check(
  'production steps include centring_restore_idle after pick tail',
  (() => {
    const ci = stepNames.indexOf('centring')
    const pt = stepNames.indexOf('pick_place_tail')
    const ri = stepNames.indexOf('centring_restore_idle')
    return ci >= 0 && pt >= 0 && ri > pt
  })(),
)
check('centring step precedes pick_place_tail', stepNames.indexOf('centring') < stepNames.indexOf('pick_place_tail'))
check(
  'PRODUCTION_SKIP_CENTRING removes centring step',
  (() => {
    const skipCtx = { ...mockCtx, skipCentring: true }
    const skipSteps = buildProductionSteps(mockEcm, skipCtx, [], state).map((s) => s.name)
    return !skipSteps.includes('centring') && skipSteps.includes('centring_skipped')
  })(),
)

console.log('\n=== 5. Contract consistency checks ===\n')

const fsSync = await import('fs')
const setupSrcForContract = fsSync.readFileSync(
  path.join(__dirname, '..', 'lib', 'machineSetup.mjs'),
  'utf8',
)
const setupSeqSrcForContract = fsSync.readFileSync(
  path.join(__dirname, '..', 'lib', 'machineSetupSequence.mjs'),
  'utf8',
)

check(
  'backend centring_frame_model uses profile gaps (not diameter formula)',
  resolved.h_pre_mm === SAMPLE_TUBE.diameter_closing_gap_mm,
)
check(
  'applyShrinkTubeGapPhase / resolveGapMove pass total H (MOVE*MM)',
  resolveGapMove({ gapMm: resolved.h_pre_mm, axis: 'upper' }).gapMm === resolved.h_pre_mm &&
    resolveGapMove({ gapMm: resolved.h_pre_mm, axis: 'upper' }).moveCommand === 'MOVE_UPPERMM',
)
check(
  'production-light recovery uses shared subsystem homing (not centring recover SEEK_TRAVEL)',
  /recoverProductionFault[\s\S]*?runSubsystemHomingSequence/.test(setupSrcForContract) &&
    !/recoverProductionFault[\s\S]*?centringRecover/.test(setupSrcForContract) &&
    /runSubsystemHomingSequence[\s\S]*?initializeCentringTravelIdle/.test(setupSeqSrcForContract) &&
    !/runSubsystemHomingSequence[\s\S]*?seekTravelBoth/.test(setupSeqSrcForContract),
)
check('CENTRING_HOST available after .env load', !!process.env.CENTRING_HOST, process.env.CENTRING_HOST || 'unset')
check(
  'CENTRING_TRANSPORT=tcp (Double_Actuator slave)',
  (process.env.CENTRING_TRANSPORT || 'tcp').trim().toLowerCase() === 'tcp',
  process.env.CENTRING_TRANSPORT || 'tcp (default)',
)

const centringIdleSrcForContract = centringIdleSrc
check(
  'prepareCentringProductionPosture calls connectWithRetry (init parity)',
  /prepareCentringProductionPosture[\s\S]*?await connectWithRetry\(\)/.test(centringIdleSrcForContract),
)
check(
  'restoreCentringTravelIdle calls connectWithRetry (init parity)',
  /restoreCentringTravelIdle[\s\S]*?await connectWithRetry\(\)/.test(centringIdleSrcForContract),
)
check(
  'initializeCentringTravelIdle calls connectWithRetry',
  /initializeCentringTravelIdle[\s\S]*?await connectWithRetry\(\)/.test(centringIdleSrcForContract),
)

console.log('\n=== 6. Live subsystem probe (best-effort) ===\n')

async function probeBackendCentringReachable() {
  const port = Number(process.env.PORT || 3333)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/machine/init-status`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const body = await res.json()
    return body?.connectivity?.centring ?? null
  } catch {
    return null
  }
}

async function probeBackendCentringStatus() {
  const port = Number(process.env.PORT || 3333)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/centring/status`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const body = await res.json()
    return body?.status ?? null
  } catch {
    return null
  }
}

try {
  const { probeConnection, getConnectionInfo } = origCentring
  const info = getConnectionInfo()
  const probe = await probeConnection(2000)

  if (probe.ok) {
    check(`centring transport ${info.transport} probe (${info.target})`, true)
    let st = null
    let via = 'direct'
    try {
      st = await origCentring.status()
    } catch {
      st = null
    }
    if (!st) {
      // Exclusive TCP: headless backend already holds the Nano session.
      st = await probeBackendCentringStatus()
      via = 'backend-http'
    }
    check(`centring STATUS readable (${via})`, !!st)
    if (st) {
      check('centring idle (busy=0)', !st.busy, 'busy=1')
      check(
        'centring cal=1 and !estop (if init ran)',
        st.cal === true && st.estop === false,
        `cal=${st.cal} estop=${st.estop}`,
      )
    }
  } else {
    const viaBackend = await probeBackendCentringReachable()
    const stHttp = await probeBackendCentringStatus()
    if (stHttp?.cal === true) {
      check('centring STATUS via backend HTTP (direct TCP busy/down)', true)
      check('centring cal=1 and !estop (via HTTP)', stHttp.estop === false, `estop=${stHttp.estop}`)
    } else if (viaBackend?.reachable) {
      check(`centring reachable via backend supervisor (${viaBackend.lastError ? 'degraded' : 'ok'})`, true)
    } else {
      check(`centring transport ${info.transport} probe`, false, probe.error || 'unreachable')
    }
  }
} catch (e) {
  check('centring live probe', false, e.message)
}

console.log('\n=== 7. Live DB profile resolution (maindata.db) ===\n')

try {
  const Database = (await import('better-sqlite3')).default
  const dbPath = path.join(__dirname, '..', 'data', 'maindata.db')
  const db = new Database(dbPath, { readonly: true })
  const settings = JSON.parse(db.prepare('SELECT json FROM system_settings WHERE id=1').get().json)
  const sys = { ...settings, centring_frame_config: normalizeCentringFrameConfig(settings.centring_frame_config) }
  const tubes = db.prepare('SELECT * FROM shrink_tubes WHERE is_active=1').all()
  check('at least one active shrink tube', tubes.length > 0)
  for (const t of tubes) {
    const r = resolveShrinkTubeCentring(t, sys)
    check(`${t.id} resolves gaps and travel`, r.h_pre_mm > 0 && r.h_post_mm > 0 && r.centering_travel_mm > 0)
    check(`${t.id} P&P input > backoff`, r.centering_input_mm > 0.5)
    check(`${t.id} P&P output within 470mm`, r.centering_output_mm <= 470, `${r.centering_output_mm}`)
  }
  db.close()
} catch (e) {
  check('DB profile resolution', false, e.message)
}

console.log('\n=== Summary ===\n')
console.log(`Passed: ${pass}`)
console.log(`Failed: ${fail}`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('\nAll verification checks passed.\n')
process.exit(0)
