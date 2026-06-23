import { settingsApi } from '@/services/settingsApi'
import { apiFetch } from '@/services/apiClient'
import type {
  PickPlaceConfig,
  PickPlaceConfigUpdate,
  PickPlaceMoveMode,
  PickPlaceMoveResult,
  PickPlaceStatus,
} from '@/types/pickPlace.types'

const MOVE_ENDPOINTS: Record<PickPlaceMoveMode, string> = {
  move_a: '/api/pick-place/move_a',
  move_b: '/api/pick-place/move_b',
  move_a_t2: '/api/pick-place/move_a_t2',
}

const DEFAULTS: PickPlaceConfig = {
  movementSpeedMmS: 80,
  homingSpeedMmS: 80,
  backoffMmA: 0.5,
  backoffMmB: 0.8,
  referenceAxis: 'a',
}

function normalizePickPlaceConfig(raw: unknown): PickPlaceConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
  const o = raw as Record<string, unknown>
  const ref = String(o.referenceAxis ?? 'a').toLowerCase()
  return {
    movementSpeedMmS: Number(o.movementSpeedMmS) || DEFAULTS.movementSpeedMmS,
    homingSpeedMmS: Number(o.homingSpeedMmS) || DEFAULTS.homingSpeedMmS,
    backoffMmA: Number(o.backoffMmA) || DEFAULTS.backoffMmA,
    backoffMmB: Number(o.backoffMmB) || DEFAULTS.backoffMmB,
    referenceAxis: ref === 'b' ? 'b' : 'a',
  }
}

export async function getPickPlaceConfig(): Promise<PickPlaceConfig> {
  const settings = await settingsApi.getSystemSettings(true)
  return normalizePickPlaceConfig(settings.pick_place_config)
}

export async function savePickPlaceConfig(update: PickPlaceConfigUpdate): Promise<PickPlaceConfig> {
  const current = await getPickPlaceConfig()
  const next = { ...current, ...update }
  await settingsApi.updateSystemSettings({ pick_place_config: next })
  return next
}

export async function getPickPlaceStatus(): Promise<PickPlaceStatus> {
  const res = await apiFetch('/api/pick-place/status')
  const json = (await res.json()) as PickPlaceStatus
  if (!res.ok) {
    throw new Error(json.error ?? `Status failed (${res.status})`)
  }
  return json
}

function currentPositionForMode(status: PickPlaceStatus, mode: PickPlaceMoveMode): number {
  if (mode === 'move_b') {
    return Number(status.positionB ?? status.positions?.B ?? 0)
  }
  return Number(status.positionA ?? status.position ?? status.positions?.A ?? 0)
}

export async function jogPickPlaceRelative(opts: {
  mode: PickPlaceMoveMode
  direction: 'forward' | 'backward'
  stepMm: number
  speedMmS: number
}): Promise<PickPlaceMoveResult> {
  const status = await getPickPlaceStatus()
  if (!status.connected && status.ok === false) {
    throw new Error(status.error ?? 'Pick & place controller not connected')
  }
  const current = currentPositionForMode(status, opts.mode)
  const delta = opts.direction === 'forward' ? opts.stepMm : -opts.stepMm
  const target = current + delta

  const res = await apiFetch(MOVE_ENDPOINTS[opts.mode], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position: target, speed: opts.speedMmS }),
  })
  const json = (await res.json()) as PickPlaceMoveResult & { message?: string }
  if (!res.ok) {
    throw new Error(json.error ?? json.message ?? `Move failed (${res.status})`)
  }
  return json
}
