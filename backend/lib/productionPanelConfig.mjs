/**
 * Panel + production gate configuration — sourced only from backend `.env`.
 *
 *   PANEL_TWO_HAND_MODE=sequential|single
 *   PANEL_TWO_HAND_DISABLE=1          → forces single
 *   CLAMP_TRIGGER_MODE=off|di10|di9|both (legacy alias di11→di9)
 *
 * `canStartProduction` / `canEnqueueProduction` honour clamp mode from `.env`
 * (skipped when off). Two-hand mode affects DI0/DI1 panel mapping only — it
 * never blocks production enqueue.
 */

import { getPanelTwoHandMode } from './panelModes.mjs'
import { getClampTriggerMode } from './clampTriggerMode.mjs'

/**
 * @returns {{
 *   panelTwoHandMode: 'sequential'|'single',
 *   clampTriggerMode: 'off'|'di10'|'di9'|'both',
 *   twoHandGatesProduction: false,
 *   clampGatesProduction: boolean,
 * }}
 */
export function getProductionPanelConfig() {
  const panelTwoHandMode = getPanelTwoHandMode()
  const clampTriggerMode = getClampTriggerMode()
  return {
    panelTwoHandMode,
    clampTriggerMode,
    twoHandGatesProduction: false,
    clampGatesProduction: clampTriggerMode !== 'off',
  }
}

/** True when CLAMP_TRIGGER_MODE != off — DI10/DI9 gate canStartProduction. */
export function isClampTriggerProductionGateActive() {
  return getClampTriggerMode() !== 'off'
}
