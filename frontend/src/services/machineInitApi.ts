import { apiFetch } from '@/services/apiClient'

import type { LifecycleState } from '@/types/machineLifecycle.types'

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

export interface MachineInitStatus {
  ok?: boolean
  connected: boolean
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

export async function fetchMachineInitStatus(): Promise<MachineInitStatus> {
  const res = await apiFetch('/api/machine/init-status')
  const json = (await res.json().catch(() => ({}))) as MachineInitStatus & { error?: string }
  if (!res.ok) {
    throw new Error(json.error ?? `Init status failed (${res.status})`)
  }
  return json
}

export async function runMachineInitialize(
  referenceId?: string,
  opts?: { requireButton?: boolean },
): Promise<MachineInitStatus> {
  const res = await apiFetch('/api/machine/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(referenceId ? { referenceId } : {}),
      requireButton: opts?.requireButton !== false,
    }),
  })
  const json = (await res.json().catch(() => ({}))) as MachineInitStatus & { error?: string }
  if (!res.ok) {
    throw new Error(json.error ?? `Initialize failed (${res.status})`)
  }
  return json
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
