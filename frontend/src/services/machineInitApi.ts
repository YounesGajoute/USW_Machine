import { apiFetch } from '@/services/apiClient'

import type { LifecycleState } from '@/types/machineLifecycle.types'

/** Emergency root-cause codes (mirror backend SAFETY_ROOT_CAUSE in doorInterlock.mjs). */
export type SafetyRootCauseCode =
  | 'EMERGENCY_STOP'
  | 'DOOR_RIGHT_1'
  | 'DOOR_RIGHT_2'
  | 'DOOR_BACK'

export interface SafetyRootCause {
  codes: SafetyRootCauseCode[]
  primary: SafetyRootCauseCode
  doorStates?: { right1: boolean; right2: boolean; back: boolean }
  source?: 'CH1' | 'CH2'
  at?: number
}

/** Fault categories (mirror backend FAULT_CATEGORY in faultClassifier.mjs). */
export type FaultCategory = 'SAFETY' | 'CONNECTIVITY' | 'INIT' | 'PRODUCTION'

/** All fault codes (mirror backend FAULT_CODE in faultClassifier.mjs). */
export type FaultCode =
  | SafetyRootCauseCode
  | 'ETHERCAT_DISCONNECTED'
  | 'PNOZ_FEEDBACK_TIMEOUT'
  | 'PICK_PLACE_HOMING'
  | 'CENTRING_INIT'
  | 'INIT_BUTTON_NOT_PRESSED'
  | 'INIT_GENERIC'
  | 'VISION_FAIL'
  | 'PNEUMATIC_FAULT'
  | 'PICK_PLACE_MOVE'
  | 'CENTRING_CYCLE'
  | 'START_BUTTON_NOT_PRESSED'
  | 'SHRINK_TUBE_INVALID'
  | 'PRODUCTION_GENERIC'

export interface ActiveFault {
  category: FaultCategory
  severity: 'critical' | 'error'
  codes: FaultCode[]
  primary: FaultCode
  message?: string
}

export interface ProductionJobSummary {
  id: string
  source: 'panel' | 'hmi' | 'api'
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  enqueuedAt: number
  startedAt?: number | null
  finishedAt?: number | null
  error?: string | null
}

export interface PickPlaceInitResult {
  ok: boolean
  skipped?: boolean
  procedure?: string
  homedA?: boolean
  homedB?: boolean | null
  positionA?: number
  positionB?: number | null
  backoffMmA?: number
  backoffMmB?: number | null
}

export interface ProductionSequenceResult {
  ok: boolean
  phases?: Array<{ phase: string; [key: string]: unknown }>
  timing?: Record<string, number>
  pickPlace?: {
    skipped?: boolean
    moveToPick?: { command?: string; positionA?: number }
    moveToBackoff?: { command?: string; positionA?: number }
  }
}

/** Maintenance-mode targets (mirror backend MAINTENANCE_TARGET in panelModes.mjs). */
export type MaintenanceTarget =
  | 'pickplace'
  | 'centering_home'
  | 'centering_travel'
  | 'centering_run'
  | 'vision'
  | 'step'

export interface MaintenanceState {
  active: boolean
  target: MaintenanceTarget | null
  since?: number | null
}

/** Panel context labels (mirror backend PANEL_CONTEXT in panelModes.mjs). */
export type PanelContext =
  | 'OFFLINE'
  | 'LOCKOUT'
  | 'MAINTENANCE'
  | 'BUSY_INIT'
  | 'RUNNING'
  | 'NO_REFERENCE'
  | 'NEEDS_INIT'
  | 'READY'
  | 'READY_BLOCKED'
  | 'FAULTED'

/** Per-button action ids (mirror backend PANEL_ACTION in panelModes.mjs). */
export type PanelAction =
  | 'NONE'
  | 'SETUP'
  | 'INITIALIZE'
  | 'REARM'
  | 'RECOVER'
  | 'START'
  | 'STOP'
  | 'JOG_FWD'
  | 'JOG_REV'
  | 'CENTERING_HOME'
  | 'CENTERING_TRAVEL'
  | 'CENTERING_RUN'
  | 'VISION_RUN_ONCE'
  | 'VISION_CAPTURE_MASTER'
  | 'VISION_REGISTER_MASTER'
  | 'STEP_ADVANCE'
  | 'STEP_ABORT'

export type ButtonTrigger = 'edge' | 'hold' | 'longpress'
export type LedState = 'off' | 'on' | 'flash'
export type TwoHandMode = 'simultaneous' | 'sequential' | 'single'
export type PanelFocus = 'vision-master' | null

export interface PanelButtonDescriptor {
  action: PanelAction
  trigger: ButtonTrigger
}

export interface PanelResolved {
  context: PanelContext
  twoHand: boolean
  twoHandMode?: TwoHandMode
  di0: PanelButtonDescriptor
  di1: PanelButtonDescriptor
  leds: { init: LedState; start: LedState }
  focus?: PanelFocus
  vision?: { captureSeq: number; registerSeq: number }
}

export interface SubsystemConnectivity {
  reachable: boolean
  lastOk: number | null
  lastError: string | null
  consecutiveFailures?: number
  reconnecting?: boolean
  bridgeRunning?: boolean
  slaveOp?: boolean
}

export interface MachineConnectivity {
  vision: SubsystemConnectivity
  pickPlace: SubsystemConnectivity
  centring: SubsystemConnectivity
  ethercat: SubsystemConnectivity
}

export interface MachineInitStatus {
  ok?: boolean
  connected: boolean
  connectivity?: MachineConnectivity
  maintenance?: MaintenanceState
  panel?: PanelResolved
  referenceLoaded: boolean
  referenceId: string | null
  initialized: boolean
  initInProgress: boolean
  initButton: boolean
  startButton?: boolean
  canStartProduction?: boolean
  canEnqueueProduction?: boolean
  productionRunning?: boolean
  productionPhase?: string | null
  lifecycleState?: LifecycleState
  lifecycleCode?: number
  previousLifecycleState?: LifecycleState | null
  lifecycleEnteredAt?: number
  lastError?: string | null
  activeJobId?: string | null
  activeJobSource?: 'panel' | 'hmi' | 'api' | null
  isProductionActive?: boolean
  isSafetyLockout?: boolean
  doorRight1Open?: boolean
  doorRight2Open?: boolean
  doorBackOpen?: boolean
  anyDoorOpen?: boolean
  blockingDoorOpen?: boolean
  do6Asserted?: boolean
  pnozArmed?: boolean
  pnozCircuitRestored?: boolean
  pnozFeedbackRaw?: boolean
  pnozConfirmed?: boolean
  pnozInRelease?: boolean
  safetyRootCause?: SafetyRootCause | null
  activeFault?: ActiveFault | null
  canRecover?: boolean
  recoveryBlockReason?: string | null
  recoveryInProgress?: boolean
  canRunSetup?: boolean
  setupBlockReason?: string | null
  setupInProgress?: boolean
  setupMode?: 'full' | 'production_light' | 'ready'
  canInitialize?: boolean
  initBlockReason?: string | null
  queueDepth?: number
  queueMaxDepth?: number
  workerRunning?: boolean
  pendingJobs?: ProductionJobSummary[]
  runningJob?: ProductionJobSummary | null
  recentJobs?: ProductionJobSummary[]
  pickPlace?: PickPlaceInitResult
  error?: string
  productionBlockReason?: string | null
}

/** Thrown by runMachineRecover / runMachineInitialize when the API returns a machine snapshot on error. */
export interface MachineActionError extends Error {
  snapshot?: MachineInitStatus
}

function machineActionError(
  message: string,
  snapshot?: MachineInitStatus,
): MachineActionError {
  const err = new Error(message) as MachineActionError
  err.snapshot = snapshot
  return err
}

export async function fetchMachineInitStatus(): Promise<MachineInitStatus> {
  const res = await apiFetch('/api/machine/init-status')
  const json = (await res.json().catch(() => ({}))) as MachineInitStatus & { error?: string }
  if (!res.ok) {
    throw new Error(json.error ?? `Init status failed (${res.status})`)
  }
  return json
}

export async function runMachineSetup(
  referenceId?: string,
  opts?: { requireButton?: boolean },
): Promise<MachineInitStatus> {
  const res = await apiFetch('/api/machine/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(referenceId ? { referenceId } : {}),
      requireButton: opts?.requireButton !== false,
    }),
  })
  const json = (await res.json().catch(() => ({}))) as MachineInitStatus & { error?: string }
  if (!res.ok) {
    throw machineActionError(json.error ?? `Setup failed (${res.status})`, json)
  }
  return json
}

/** @deprecated Use runMachineSetup */
export async function runMachineInitialize(
  referenceId?: string,
  opts?: { requireButton?: boolean },
): Promise<MachineInitStatus> {
  return runMachineSetup(referenceId, opts)
}

/** @deprecated Use runMachineSetup */
export async function runMachineRecover(
  referenceId?: string,
  opts?: { requireButton?: boolean },
): Promise<MachineInitStatus> {
  return runMachineSetup(referenceId, opts)
}

export async function notifyReferenceCleared(): Promise<void> {
  await apiFetch('/api/machine/clear-reference', { method: 'POST' })
}

/** Tell backend which reference is active (e.g. restored from session after reload). */
export async function notifyReferenceLoaded(referenceId: string): Promise<void> {
  await apiFetch('/api/machine/reference-loaded', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ referenceId }),
  })
}

/** Run full production sequence (pneumatics + MOVEAMMT2). HMI: requireButton false. */
export async function runProductionStart(
  referenceId?: string,
  opts?: { requireButton?: boolean },
): Promise<MachineInitStatus & ProductionSequenceResult> {
  const res = await apiFetch('/api/machine/start-production', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(referenceId ? { referenceId } : {}),
      requireButton: opts?.requireButton !== false,
    }),
  })
  const json = (await res.json().catch(() => ({}))) as MachineInitStatus &
    ProductionSequenceResult & { error?: string }
  if (!res.ok) {
    throw new Error(json.error ?? `Production start failed (${res.status})`)
  }
  return json
}

/** @deprecated use runProductionStart */
export async function runMachineStartProduction(
  referenceId?: string,
): Promise<MachineInitStatus & ProductionSequenceResult> {
  return runProductionStart(referenceId, { requireButton: true })
}

export async function runMachineStopProduction(): Promise<MachineInitStatus> {
  const res = await apiFetch('/api/machine/stop-production', { method: 'POST' })
  const json = (await res.json().catch(() => ({}))) as MachineInitStatus & { error?: string }
  if (!res.ok) {
    throw new Error(json.error ?? `Stop production failed (${res.status})`)
  }
  return json
}

/** Enable/disable maintenance mode and/or set the active target for the panel buttons. */
export async function setMaintenanceMode(next: {
  active?: boolean
  target?: MaintenanceTarget | null
}): Promise<MachineInitStatus> {
  const res = await apiFetch('/api/machine/maintenance-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  })
  const json = (await res.json().catch(() => ({}))) as MachineInitStatus & { error?: string }
  if (!res.ok) {
    throw new Error(json.error ?? `Maintenance mode update failed (${res.status})`)
  }
  return json
}

export interface PanelFocusState {
  focus: PanelFocus
  captureSeq: number
  registerSeq: number
}

/**
 * Claim/release the physical buttons for a setup page. Currently only the Vision
 * master-image tab uses focus 'vision-master' (DI1 = capture, DI0 = register).
 */
export async function setPanelFocus(focus: PanelFocus): Promise<PanelFocusState> {
  const res = await apiFetch('/api/machine/panel-focus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ focus }),
  })
  const json = (await res.json().catch(() => ({}))) as { panelFocus?: PanelFocusState; error?: string }
  if (!res.ok) {
    throw new Error(json.error ?? `Panel focus update failed (${res.status})`)
  }
  return json.panelFocus ?? { focus, captureSeq: 0, registerSeq: 0 }
}

/** Current panel focus + capture/register counters (polled by the Vision page). */
export async function fetchPanelFocus(): Promise<PanelFocusState> {
  const res = await apiFetch('/api/machine/panel-focus')
  const json = (await res.json().catch(() => ({}))) as { panelFocus?: PanelFocusState; error?: string }
  if (!res.ok) {
    throw new Error(json.error ?? `Panel focus fetch failed (${res.status})`)
  }
  return json.panelFocus ?? { focus: null, captureSeq: 0, registerSeq: 0 }
}

export interface HardwareTestRequest {
  tower?: { red?: boolean; green?: boolean; yellow?: boolean; buzzer?: boolean }
  buttonLeds?: { init?: LedState; start?: LedState }
  pneumatics?: {
    clampRight?: boolean
    clampLeft?: boolean
    leverUp?: boolean
    ppClamp?: boolean
    puller?: boolean
  }
  clear?: boolean
}

/** Run a manual hardware self-test (maintenance mode must be active on the backend). */
export async function runHardwareTest(body: HardwareTestRequest): Promise<MachineInitStatus> {
  const res = await apiFetch('/api/machine/hardware-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as MachineInitStatus & { error?: string }
  if (!res.ok) {
    throw new Error(json.error ?? `Hardware test failed (${res.status})`)
  }
  return json
}

export interface IoSnapshot {
  ok: boolean
  connected: boolean
  inputs?: number[] | null
  outputs?: number[] | null
  error?: string
}

/** Read raw EtherCAT input/output state for diagnostics. */
export async function fetchIoSnapshot(): Promise<IoSnapshot> {
  const res = await apiFetch('/api/machine/io-snapshot')
  const json = (await res.json().catch(() => ({}))) as IoSnapshot
  return json
}
