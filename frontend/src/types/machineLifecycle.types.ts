/**
 * Machine lifecycle — **frontend ↔ backend contract**
 *
 * The backend should publish a single canonical state (string and/or numeric code 0–10).
 * The UI maps it to {@link StatusControl} / {@link StatusBar} via `lifecycleState` and shared
 * `resolveMachineStatusPresentation` in `@/lib/machineStatusPresentation` (optional `phaseTitle` / `detailMessage`).
 *
 * ## Main sequence (happy path)
 *
 * `POWER_OFF` → `INIT` → `IDLE` → `PRECHECK` → `CYCLE_START` → `RUN` → `COMPLETE` → `UNLOAD` → `RESET` → `IDLE`
 *
 * ## Safety interrupt (any time)
 *
 * Any state → `SAFETY_LOCKOUT` (E-stop / safety chain). Recovery: E-stop released → operator manual reset →
 * `REARM` (power restore, pneumatics, validation) → `INIT` → `IDLE`.
 *
 * Recovery sub-steps may be modeled as substates or the same `SAFETY_LOCKOUT` until transition to `REARM`.
 *
 * ## Lifecycle codes (numeric wire format 0–10)
 *
 * | Code | State             | Typical meaning                          |
 * |------|-------------------|------------------------------------------|
 * | 0    | POWER_OFF         | De-energized                             |
 * | 1    | INIT              | Boot, I/O, homing, ready check           |
 * | 2    | IDLE              | Wait trigger (Start / external)          |
 * | 3    | PRECHECK          | Safety, part, tool readiness             |
 * | 4    | CYCLE_START       | Enable drives / pneumatics / actuators   |
 * | 5    | RUN               | Core motion / process                    |
 * | 6    | COMPLETE          | Stop actuators, end signals              |
 * | 7    | UNLOAD            | Safe position, eject, optional clean     |
 * | 8    | RESET             | Internal flags, prepare next cycle       |
 * | 9    | SAFETY_LOCKOUT    | E-stop / safety lockout                  |
 * | 10   | REARM             | Power restore, re-pressurize, validate   |
 */

export const LIFECYCLE_STATE = {
  POWER_OFF: 'POWER_OFF',
  INIT: 'INIT',
  IDLE: 'IDLE',
  PRECHECK: 'PRECHECK',
  CYCLE_START: 'CYCLE_START',
  RUN: 'RUN',
  COMPLETE: 'COMPLETE',
  UNLOAD: 'UNLOAD',
  RESET: 'RESET',
  SAFETY_LOCKOUT: 'SAFETY_LOCKOUT',
  REARM: 'REARM',
} as const

export type LifecycleState = (typeof LIFECYCLE_STATE)[keyof typeof LIFECYCLE_STATE]

/** Integer code 0–10 → canonical `LifecycleState`. */
export const LIFECYCLE_CODE_TO_STATE: Record<number, LifecycleState> = {
  0: LIFECYCLE_STATE.POWER_OFF,
  1: LIFECYCLE_STATE.INIT,
  2: LIFECYCLE_STATE.IDLE,
  3: LIFECYCLE_STATE.PRECHECK,
  4: LIFECYCLE_STATE.CYCLE_START,
  5: LIFECYCLE_STATE.RUN,
  6: LIFECYCLE_STATE.COMPLETE,
  7: LIFECYCLE_STATE.UNLOAD,
  8: LIFECYCLE_STATE.RESET,
  9: LIFECYCLE_STATE.SAFETY_LOCKOUT,
  10: LIFECYCLE_STATE.REARM,
}

const LIFECYCLE_STATE_TO_CODE = Object.fromEntries(
  Object.entries(LIFECYCLE_CODE_TO_STATE).map(([code, state]) => [state, Number(code)]),
) as Record<LifecycleState, number>

/** Numeric lifecycle code (0–10) for a canonical state. */
export function lifecycleStateCode(state: LifecycleState): number {
  return LIFECYCLE_STATE_TO_CODE[state]
}

/** Accept backend string (case-insensitive) and common aliases. */
const LIFECYCLE_ALIASES: Record<string, LifecycleState> = {
  POWER_OFF: LIFECYCLE_STATE.POWER_OFF,
  INITIALIZATION: LIFECYCLE_STATE.INIT,
  INITIALIZE: LIFECYCLE_STATE.INIT,
  INIT: LIFECYCLE_STATE.INIT,
  IDLE: LIFECYCLE_STATE.IDLE,
  WAIT_TRIGGER: LIFECYCLE_STATE.IDLE,
  IDLE_WAIT_TRIGGER: LIFECYCLE_STATE.IDLE,
  PRECHECK: LIFECYCLE_STATE.PRECHECK,
  CYCLE_START: LIFECYCLE_STATE.CYCLE_START,
  RUN: LIFECYCLE_STATE.RUN,
  EXECUTION: LIFECYCLE_STATE.RUN,
  COMPLETE: LIFECYCLE_STATE.COMPLETE,
  CYCLE_COMPLETE: LIFECYCLE_STATE.COMPLETE,
  UNLOAD: LIFECYCLE_STATE.UNLOAD,
  POST_PROCESS: LIFECYCLE_STATE.UNLOAD,
  UNLOAD_POST_PROCESS: LIFECYCLE_STATE.UNLOAD,
  RESET: LIFECYCLE_STATE.RESET,
  SAFETY_LOCKOUT: LIFECYCLE_STATE.SAFETY_LOCKOUT,
  E_STOP: LIFECYCLE_STATE.SAFETY_LOCKOUT,
  ESTOP: LIFECYCLE_STATE.SAFETY_LOCKOUT,
  REARM: LIFECYCLE_STATE.REARM,
  REARM_POWER_RESTORE: LIFECYCLE_STATE.REARM,
}

/**
 * Parse API / wire payload into a canonical lifecycle state.
 * Returns `undefined` if the value cannot be mapped (caller may keep previous state or show unknown).
 */
export function parseLifecycleState(raw: unknown): LifecycleState | undefined {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 10) {
    return LIFECYCLE_CODE_TO_STATE[raw]
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (/^\d+$/.test(trimmed)) {
      const n = Number.parseInt(trimmed, 10)
      if (n >= 0 && n <= 10) return LIFECYCLE_CODE_TO_STATE[n]
    }
    const key = trimmed.toUpperCase().replace(/\s+/g, '_')
    if (key in LIFECYCLE_ALIASES) return LIFECYCLE_ALIASES[key]
    if (key in LIFECYCLE_STATE) return LIFECYCLE_STATE[key as keyof typeof LIFECYCLE_STATE]
  }
  return undefined
}

export const LIFECYCLE_DEFAULT_TITLE: Record<LifecycleState, string> = {
  [LIFECYCLE_STATE.POWER_OFF]: 'Power off',
  [LIFECYCLE_STATE.INIT]: 'Initialization',
  [LIFECYCLE_STATE.IDLE]: 'Idle — wait for trigger',
  [LIFECYCLE_STATE.PRECHECK]: 'Pre-check',
  [LIFECYCLE_STATE.CYCLE_START]: 'Cycle start',
  [LIFECYCLE_STATE.RUN]: 'Running',
  [LIFECYCLE_STATE.COMPLETE]: 'Cycle complete',
  [LIFECYCLE_STATE.UNLOAD]: 'Unload / post-process',
  [LIFECYCLE_STATE.RESET]: 'Reset',
  [LIFECYCLE_STATE.SAFETY_LOCKOUT]: 'Safety lockout (E-stop)',
  [LIFECYCLE_STATE.REARM]: 'Rearm — power restore',
}

export const LIFECYCLE_DEFAULT_DETAIL: Record<LifecycleState, string> = {
  [LIFECYCLE_STATE.POWER_OFF]: 'Machine de-energized — no electrical or pneumatic power.',
  [LIFECYCLE_STATE.INIT]: 'Controller boot, I/O check, axis homing, system ready check.',
  [LIFECYCLE_STATE.IDLE]: 'Ready — waiting for Start or external trigger.',
  [LIFECYCLE_STATE.PRECHECK]: 'Doors/guards, part presence, tool and system readiness.',
  [LIFECYCLE_STATE.CYCLE_START]: 'Enabling drives, pneumatics, and actuators.',
  [LIFECYCLE_STATE.RUN]: 'Core operation — motion, processing, inspection.',
  [LIFECYCLE_STATE.COMPLETE]: 'Stopping actuators and process finished signals.',
  [LIFECYCLE_STATE.UNLOAD]: 'Safe position, release or eject, optional cleaning.',
  [LIFECYCLE_STATE.RESET]: 'Clearing internal flags — preparing next cycle.',
  [LIFECYCLE_STATE.SAFETY_LOCKOUT]:
    'Immediate stop — power/pneumatic cut, sequence frozen. Release E-stop, then reset when safe.',
  [LIFECYCLE_STATE.REARM]:
    'Restoring electrical and pneumatic power — safety validation before init.',
}
