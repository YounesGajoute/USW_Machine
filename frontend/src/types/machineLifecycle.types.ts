/**
 * Machine lifecycle — **frontend ↔ backend contract**
 *
 * The backend should publish a single canonical state (string and/or numeric code 0–10).
 * The UI maps it to {@link StatusControl} / {@link StatusBar} via `lifecycleState` and shared
 * `resolveMachineStatusPresentation` in `@/lib/machineStatusPresentation` (optional `phaseTitle` / `detailMessage`).
 *
 * ## Main sequence (happy path)
 *
 * `INIT` (app boot) → EtherCAT connect → `ERROR` → Setup → `IDLE` → `RUN` → `PRECHECK` →
 * `CYCLE_START` → `COMPLETE` → `RESET` → `IDLE`/`RUN`
 *
 * - `INIT` = **application boot resting state** (not yet initialized) and active Setup
 *   (release ESTOP2 → arm PNOZ → enable air → home). **No reference required.**
 * - EtherCAT **connect** forces `ERROR` (awaiting Initialization) until Setup completes.
 * - `POWER_OFF` = de-energized resting after safety inputs clear (post-`SAFETY_LOCKOUT`).
 *   Left by Setup → `INIT`. Not the app-boot or post-connect resting state.
 * - `IDLE` = **machine initialized, no reference required** — awaiting a reference scan.
 * - `RUN` = **reference loaded + initialized** — ready to produce (resting/ready, not the
 *   running cycle). Loading a reference goes `IDLE` → `RUN`; clearing it goes `RUN` → `IDLE`.
 * - Start dequeues a job (`RUN`/`IDLE` → `PRECHECK`); the **entire** production cycle
 *   maps to `CYCLE_START`, settling through `IDLE` (reconciled to `RUN` when a reference
 *   is still loaded). `UNLOAD` is reserved but never published.
 *
 * ## Interrupts (any time)
 *
 * - Any state → `SAFETY_LOCKOUT` (E-stop / door). Cancels the queue and clears
 *   machine-init, but **keeps the loaded reference**. Recovery: release E-stop (auto →
 *   `POWER_OFF` when doors are clear) → **Setup** (`POWER_OFF`/`SAFETY_LOCKOUT` → `INIT`
 *   → `IDLE` → `RUN`).
 * - Non-safety faults → `ERROR` (unified; no soft/heavy L1/L2 split). Always clears
 *   machine-init. Recovery: **Setup** (`ERROR` → `INIT` → `IDLE` → `RUN`). EtherCAT
 *   disconnect/reconnect also rests in `ERROR` until Setup.
 *
 * ## Lifecycle codes (numeric wire format 0–10)
 *
 * | Code | State             | Typical meaning                                  |
 * |------|-------------------|--------------------------------------------------|
 * | 0    | POWER_OFF         | De-energized after safety clear (post-lockout)   |
 * | 1    | INIT              | App boot / Setup running (no ref required)       |
 * | 2    | IDLE              | Initialized, no reference — awaiting a scan       |
 * | 3    | PRECHECK          | Safety, part, tool readiness                     |
 * | 4    | CYCLE_START       | Running cycle — pneumatics prep + centring + pick|
 * | 5    | RUN               | Reference loaded + initialized — ready to produce|
 * | 6    | COMPLETE          | Stop actuators, end signals                      |
 * | 7    | UNLOAD            | Reserved; unused (safe position, eject, clean)   |
 * | 8    | RESET             | Internal flags, prepare next cycle               |
 * | 9    | SAFETY_LOCKOUT    | E-stop / safety lockout                          |
 * | 10   | ERROR             | Non-safety fault / post-connect (await Setup)    |
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
  ERROR: 'ERROR',
} as const

export type LifecycleState = (typeof LIFECYCLE_STATE)[keyof typeof LIFECYCLE_STATE]

/** Integer code 0–10 → canonical `LifecycleState`. Code 10 = ERROR. */
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
  10: LIFECYCLE_STATE.ERROR,
}

const LIFECYCLE_STATE_TO_CODE = Object.fromEntries(
  Object.entries(LIFECYCLE_CODE_TO_STATE)
    .filter(([code]) => Number(code) <= 10)
    .map(([code, state]) => [state, Number(code)]),
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
  ERROR: LIFECYCLE_STATE.ERROR,
  FAULT: LIFECYCLE_STATE.ERROR,
  FAULTED: LIFECYCLE_STATE.ERROR,
  /** @deprecated legacy wire alias — maps to INIT */
  REARM: LIFECYCLE_STATE.INIT,
  REARM_POWER_RESTORE: LIFECYCLE_STATE.INIT,
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
  [LIFECYCLE_STATE.IDLE]: 'Idle — no reference',
  [LIFECYCLE_STATE.PRECHECK]: 'Pre-check',
  [LIFECYCLE_STATE.CYCLE_START]: 'Running',
  [LIFECYCLE_STATE.RUN]: 'Ready',
  [LIFECYCLE_STATE.COMPLETE]: 'Cycle complete',
  [LIFECYCLE_STATE.UNLOAD]: 'Unload / post-process',
  [LIFECYCLE_STATE.RESET]: 'Reset',
  [LIFECYCLE_STATE.SAFETY_LOCKOUT]: 'Emergency stop',
  [LIFECYCLE_STATE.ERROR]: 'Error',
}

export const LIFECYCLE_DEFAULT_DETAIL: Record<LifecycleState, string> = {
  [LIFECYCLE_STATE.POWER_OFF]:
    'Machine is powered down after a safety stop — main air and drive power are off. Press Initialization to power up.',
  [LIFECYCLE_STATE.INIT]:
    'Preparing the machine — powering up and moving axes to their start position. No reference required.',
  [LIFECYCLE_STATE.IDLE]: 'Initialized — no reference. Scan a reference to get ready.',
  [LIFECYCLE_STATE.PRECHECK]: 'Checking doors, part presence, tooling and readiness.',
  [LIFECYCLE_STATE.CYCLE_START]: 'Production cycle in progress.',
  [LIFECYCLE_STATE.RUN]: 'Reference loaded and initialized — ready to start production.',
  [LIFECYCLE_STATE.COMPLETE]: 'Finishing the cycle.',
  [LIFECYCLE_STATE.UNLOAD]: 'Safe position, release or eject, optional cleaning.',
  [LIFECYCLE_STATE.RESET]: 'Preparing for the next cycle.',
  [LIFECYCLE_STATE.SAFETY_LOCKOUT]:
    'Machine stopped for safety — power and air are cut. Release the emergency button, then press Initialization when it is safe.',
  [LIFECYCLE_STATE.ERROR]:
    'Machine not ready — run Setup (Initialization) after resolving the fault or after connecting EtherCAT.',
}
