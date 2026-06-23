/**
 * Pick & Place backend adapter — loads New_version_pick&place master with SQLite-backed config.
 */
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { createPickPlaceConfigStore } from './pickPlaceConfigStore.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
if (!process.env.PICK_PLACE_CONFIG_PATH) {
  process.env.PICK_PLACE_CONFIG_PATH = path.join(__dirname, '..', 'data', 'pick_place_config.json')
}

const masterUrl = pathToFileURL(
  path.join(__dirname, '..', '..', 'New_version_pick&place', 'master', 'pick_place_master.js'),
).href

const pickPlace = await import(masterUrl)

/** Wire pick-place master to SQLite `system_settings.pick_place_config`. Call once after DB open. */
export function initPickPlaceSqliteConfig(db) {
  const store = createPickPlaceConfigStore(db)
  store.migrateFromJson()
  pickPlace.registerPickPlaceConfigStore({
    load: () => store.load(),
    save: config => store.save(config),
    path: () => store.storagePath(),
  })
  pickPlace.loadPickPlaceConfig()
}

export const {
  connect,
  disconnect,
  ping,
  help,
  status,
  switches,
  almInfo,
  decodeAlarm,
  getConnectionInfo,
  enable,
  enableA,
  enableB,
  disable,
  disableA,
  disableB,
  stop,
  emergencyStop,
  resetPosition,
  setSpeed,
  setSpeedHz,
  setHomeBackoff,
  getHomeBackoff,
  fetchConfig,
  clearError,
  clearAlarm,
  recover,
  home,
  homeA,
  homeB,
  homeByAxis,
  initializePickPlace,
  INIT_BACKOFF_TOLERANCE_MM,
  isHomed,
  axisHomed,
  waitIdle,
  moveBothMm,
  moveAmm,
  moveBmm,
  moveAmmT1,
  moveAmmT2,
  jogFwd,
  jogRev,
  jogStop,
  move,
  moveTo,
  isConnected,
  onEvent,
  offEvent,
  host,
  port,
  DEFAULT_HOME_BACKOFF_MM,
  HOME_BACKOFF_MM_MIN,
  HOME_BACKOFF_MM_MAX,
  REFERENCE_AXIS,
  FIRMWARE_STEPS_PER_MM,
  parseDoneLine,
  buildHomingResult,
  buildMoveResult,
  resolveHomeBackoff,
  homeCommand,
  moveCommandA,
  moveCommandB,
  moveCommandAT1,
  moveCommandAT2,
  errLineMatchesTag,
  PickPlaceTcpSession,
  readSwitchPins,
  diagnoseConnection,
  formatDiagnosisReport,
  getPickPlaceConfig,
  loadPickPlaceConfig,
  savePickPlaceConfig,
  getConfigPath,
  DEFAULT_PICK_PLACE_CONFIG,
  startPickPlaceApi,
  handlePickPlaceHttpRequest,
  probeConnection,
  connectWithRetry,
} = pickPlace

export default pickPlace.default
