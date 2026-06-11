/**
 * Panel button monitor — DI0 INIT_BUTTON → initialization, DI1 START_BUTTON → production.
 *
 * Rising-edge detection runs on the server so momentary panel buttons work reliably
 * (no HTTP round-trip re-check while the button is already released).
 */

import { readInitButton, runMachineInitialization, getMachineInitStatus } from './machineInit.mjs'
import {
  readStartButton,
  runProductionSequence,
  canStartProduction,
  isProductionRunning,
} from './productionSequence.mjs'

const POLL_MS = 50

let _timer = null
let _prevInit = false
let _prevStart = false
let _initLock = false
let _productionLock = false

function envPanelButtonsEnabled() {
  return process.env.ETHERCAT_DISABLE_PANEL_BUTTONS !== '1'
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
async function pollOnce(ecm) {
  if (!ecm.isInitialized) return

  let initPressed = false
  let startPressed = false
  try {
    initPressed = await readInitButton(ecm)
    startPressed = await readStartButton(ecm)
  } catch {
    return
  }

  const initRising = initPressed && !_prevInit
  const startRising = startPressed && !_prevStart
  _prevInit = initPressed
  _prevStart = startPressed

  if (initRising && !_initLock) {
    const status = getMachineInitStatus()
    if (status.referenceLoaded && !status.initialized && !status.initInProgress) {
      _initLock = true
      console.log('[PanelButtons] DI0 INIT_BUTTON — starting initialization sequence')
      try {
        await runMachineInitialization(ecm, { requireButton: false, source: 'panel' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[PanelButtons] Initialization failed: ${msg}`)
      } finally {
        _initLock = false
      }
    }
  }

  if (startRising && !_productionLock) {
    if (canStartProduction() && !isProductionRunning()) {
      _productionLock = true
      console.log('[PanelButtons] DI1 START_BUTTON — starting production sequence')
      try {
        await runProductionSequence(ecm, { requireButton: false, source: 'panel' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[PanelButtons] Production failed: ${msg}`)
      } finally {
        _productionLock = false
      }
    }
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export function startPanelButtonMonitor(ecm) {
  if (!envPanelButtonsEnabled()) return
  stopPanelButtonMonitor()
  _prevInit = false
  _prevStart = false
  _timer = setInterval(() => {
    void pollOnce(ecm)
  }, POLL_MS)
  if (typeof _timer.unref === 'function') _timer.unref()
  console.log('[PanelButtons] Monitoring DI0 (init) and DI1 (production)')
}

export function stopPanelButtonMonitor() {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
}
