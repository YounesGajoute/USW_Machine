#!/usr/bin/env node
/**
 * Run the real production centring cycle against live hardware.
 *
 * Usage:
 *   node backend/scripts/run-production-centring-live.mjs
 *   node backend/scripts/run-production-centring-live.mjs --reference NO-VISION
 *   node backend/scripts/run-production-centring-live.mjs --centring-only
 *   node backend/scripts/run-production-centring-live.mjs --dry-run
 *
 * Requires backend .env (CENTRING_HOST/PORT, PICK_PLACE_HOST, etc.).
 * Stop competing TCP clients first, or run via API when the backend holds the session.
 * Reference client: Double_Actuator_Centring_Slave_Firmware/scripts/slave_tcp.py
 */
import path from 'path'
import { fileURLToPath } from 'url'
import { loadBackendEnv } from '../lib/loadBackendEnv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envLoad = loadBackendEnv(path.join(__dirname, '..', '.env'))

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const centringOnly = args.includes('--centring-only')
const refFlag = args.find((a) => a.startsWith('--reference='))
const referenceCode = refFlag?.split('=')[1] ?? args[args.indexOf('--reference') + 1] ?? null

if (envLoad.loaded) {
  console.log(`[env] Loaded ${envLoad.keys} keys from ${envLoad.path}`)
}

const Database = (await import('better-sqlite3')).default
const { resolveShrinkTubeCentring, normalizeCentringFrameConfig } =
  await import('../lib/centring_frame_model.js')
const { runStyledCentringProductionCycle } = await import('../lib/centringMaintenance.mjs')
const { status: centringStatus } = await import('../lib/centring.mjs')
const { status: ppStatus } = await import('../lib/pickPlace.mjs')

const dbPath = path.join(__dirname, '..', 'data', 'maindata.db')
const db = new Database(dbPath, { readonly: true })

function loadContext(referenceCodeArg) {
  const settings = JSON.parse(db.prepare('SELECT json FROM system_settings WHERE id=1').get().json)
  const sys = {
    ...settings,
    centring_frame_config: normalizeCentringFrameConfig(settings.centring_frame_config),
  }
  let ref = null
  if (referenceCodeArg) {
    ref = db
      .prepare('SELECT * FROM product_references WHERE id = ? OR name = ?')
      .get(referenceCodeArg, referenceCodeArg)
  } else {
    ref = db
      .prepare(
        `SELECT pr.* FROM product_references pr
         JOIN shrink_tubes st ON st.id = pr.shrink_tube_id AND st.is_active = 1
         WHERE pr.shrink_tube_id IS NOT NULL
         ORDER BY pr.id LIMIT 1`,
      )
      .get()
  }
  if (!ref?.shrink_tube_id) {
    throw new Error('No reference with shrink tube — pass --reference CODE')
  }
  const tube = db.prepare('SELECT * FROM shrink_tubes WHERE id = ? AND is_active = 1').get(ref.shrink_tube_id)
  if (!tube) throw new Error(`Shrink tube ${ref.shrink_tube_id} missing or inactive`)
  return { ref, shrinkTube: tube, systemSettings: sys }
}

const { ref, shrinkTube, systemSettings } = loadContext(referenceCode)
const resolved = resolveShrinkTubeCentring(shrinkTube, systemSettings)

console.log('\n=== Production centring — live run ===\n')
console.log(`Reference: ${ref.id} (${ref.name ?? 'unnamed'})`)
console.log(`Shrink tube: ${shrinkTube.id} mechanism=${shrinkTube.centring_mechanism}`)
console.log(`L_eff=${resolved.L_eff_mm} mm  h_pre=${resolved.h_pre_mm} mm  h_post=${resolved.h_post_mm} mm`)
console.log(`P&P input=${resolved.centering_input_mm} mm  output=${resolved.centering_output_mm} mm  travel=${resolved.centering_travel_mm} mm`)
console.log(`Centring axis: ${resolved.centring_axis}`)

if (dryRun) {
  console.log('\n[dry-run] Geometry only — no hardware motion.\n')
  db.close()
  process.exit(0)
}

console.log('\n--- Before ---')
try {
  const cs = await centringStatus()
  console.log(`Centring: u=${cs?.u} l=${cs?.l} h=${cs?.h} cal=${cs?.cal} estop=${cs?.estop} reason=${cs?.reason} moveEnd=${cs?.moveEnd}`)
} catch (e) {
  console.warn(`Centring STATUS failed: ${e.message}`)
}
try {
  const ps = await ppStatus()
  console.log(`Pick&Place: posA=${ps?.positionA} homedA=${ps?.homedA} homedB=${ps?.homedB}`)
} catch (e) {
  console.warn(`Pick&Place STATUS failed: ${e.message}`)
}

const phases = []
const started = Date.now()

try {
  const result = await runStyledCentringProductionCycle({
    referenceId: ref.id,
    shrinkTube,
    systemSettings,
    resolved,
    skipPickPlace: centringOnly,
    restoreIdle: true,
    onPhase: (name) => {
      phases.push(name)
      console.log(`  → phase: ${name}`)
    },
  })
  if (result.shortTubeEstablish) {
    console.log(`Short-tube establish: ${result.shortTubeEstablish.mode}`)
  }
  console.log(`\n--- Complete (${((Date.now() - started) / 1000).toFixed(1)}s) ---`)
  console.log(`Phases: ${phases.join(' → ')}`)
  for (const p of result.phases) {
    if (p.resultH != null) console.log(`  ${p.name}: h=${p.resultH} u=${p.u} l=${p.l}`)
    if (p.positionA != null) console.log(`  ${p.name}: posA=${p.positionA}`)
  }
  const cs = await centringStatus()
  console.log(`Final centring: u=${cs?.u} l=${cs?.l} h=${cs?.h}`)
} catch (err) {
  console.error('\nFAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
} finally {
  db.close()
}

console.log('\nLive production centring cycle OK.\n')
process.exit(0)
