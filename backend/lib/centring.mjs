/**
 * Centring backend adapter — loads New_version_centring_systeme master with SQLite-backed config.
 * Wire commands stay inside centring_master.js / centring_reference.js only.
 */
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { createCentringConfigStore } from './centringConfigStore.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const centringRoot = path.join(__dirname, '..', '..', 'New_version_centring_systeme')

if (!process.env.CENTRING_CONFIG_PATH) {
  process.env.CENTRING_CONFIG_PATH = path.join(centringRoot, 'data', 'centring_config.json')
}

const masterUrl = pathToFileURL(path.join(centringRoot, 'centring_master.js')).href
const httpUrl = pathToFileURL(path.join(centringRoot, 'centring_http.js')).href

const centringMaster = await import(masterUrl)
const centringHttp = await import(httpUrl)

/** Wire centring master to SQLite `system_settings.centring_config`. Call once after DB open. */
export function initCentringSqliteConfig(db) {
  const store = createCentringConfigStore(db)
  store.migrateFromJson()
  centringMaster.registerCentringConfigStore({
    load: () => store.load(),
    save: config => store.save(config),
    path: () => store.storagePath(),
  })
  centringMaster.loadCentringConfig()
}

export const {
  ping,
  status,
  stop,
  emergencyStop,
  clearFault,
  recover,
  homeBoth,
  homeUpper,
  homeLower,
  homeByAxis,
  seekTravelBoth,
  seekTravelByAxis,
  setMechOffsetMm,
  calibrateSeekHome,
  calibrateSeekTravel,
  applyMechCalibration,
  getCentringCalibrationInfo,
  moveBoth,
  moveUpper,
  moveLower,
  moveTo,
  connectWithRetry,
  waitIdle,
  probeConnection,
  getConnectionInfo,
  loadCentringConfig,
  getCentringConfig,
  saveCentringConfig,
  getConfigPath,
  getEffectiveHRangeMm,
  getGapMoveSpeedDegS,
  getModelHeightRangeMm,
  normalizeMoveAxis,
  resolveGapMove,
  gapMmForCentringAxis,
  applyGap,
  loadGap,
  applyShrinkTubeGapPhase,
  DEFAULT_HRANGE_MM,
  DEFAULT_CENTRING_CONFIG,
  computeMechOffsetFromMeasurements,
  effectiveHRangeFromOffset,
  getCalibrationInfo,
  MODEL_H_RANGE_MM,
  registerCentringConfigStore,
} = centringMaster

export const { handleCentringHttpRequest, startCentringApi } = centringHttp

export default centringMaster.default
