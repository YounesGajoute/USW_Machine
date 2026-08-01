/**
 * Centring backend adapter — Double_Actuator master with SQLite-backed config.
 * Wire commands live in ./centringMaster/ (centring_master.js / centring_reference.js).
 */
import path from 'path'
import { fileURLToPath } from 'url'
import { createCentringConfigStore, migrateCentringTransportIfNeeded } from './centringConfigStore.mjs'
import * as centringMaster from './centringMaster/centring_master.js'
import { handleCentringHttpRequest, startCentringApi } from './centringMaster/centring_http.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const centringRoot = path.join(__dirname, 'centringMaster')

if (!process.env.CENTRING_CONFIG_PATH) {
  process.env.CENTRING_CONFIG_PATH = path.join(centringRoot, 'data', 'centring_config.json')
}

/** Wire centring master to SQLite `system_settings.centring_config`. Call once after DB open. */
export function initCentringSqliteConfig(db) {
  const store = createCentringConfigStore(db)
  store.migrateFromJson()
  migrateCentringTransportIfNeeded(db)
  centringMaster.registerCentringConfigStore({
    load: () => store.load(),
    save: config => store.save(config),
    path: () => store.storagePath(),
  })
  centringMaster.loadCentringConfig()
  const info = centringMaster.getConnectionInfo()
  console.log(`[centring] transport=${info.transport} → ${info.target}`)
}

export const {
  ping,
  status,
  stop,
  emergencyStop,
  clearFault,
  clearEstop,
  recover,
  ensureReady,
  ensureSlaveCal,
  setCal,
  saveSlaveCal,
  formatSetCalCommand,
  slaveCalMatchesLive,
  calibrate,
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
  hasOpenSession,
  getCentringTcpSessionInfo,
  setCentringProductionTcpHold,
  getCentringProductionTcpHold,
  healthProbeCentring,
  getConnectionInfo,
  closeSerialSession,
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
  diagnoseConnection,
  formatDiagnosisReport,
  isConnected,
  isReachable,
  setReachable,
  resolveTransportConfig,
  applyCentringTransportFromConfig,
  mapFirmwareStatus,
  assertHomeMoveEnd,
  assertMotionMoveEnd,
  MOVE_END,
} = centringMaster

export { handleCentringHttpRequest, startCentringApi }

export default centringMaster.default
