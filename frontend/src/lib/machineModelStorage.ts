import type { MachineModel } from '@/types/settings.types'
import { apiFetch } from '@/services/apiClient'
import {
  getCachedSystemSettings,
  setCachedSystemSettings,
  getMachineModelCache,
  setMachineModelCache,
} from '@/lib/settingsCacheState'
import type { SystemSettings } from '@/types/settings.types'

function isValidModel(v: unknown): v is MachineModel {
  return v === 'STCS-CS19' || v === 'STCS-evo500'
}

/** Synchronous read from in-memory cache (populated from SQLite on app launch). */
export function readStoredMachineModel(): MachineModel | null {
  const cached = getMachineModelCache()
  if (cached) return cached
  const fromSettings = getCachedSystemSettings()?.machine_model
  return isValidModel(fromSettings) ? fromSettings : null
}

export { setMachineModelCache }

/** Load machine_model from the API and update the in-memory cache. */
export async function loadMachineModelFromApi(): Promise<MachineModel | null> {
  const settings = getCachedSystemSettings()
  if (settings) {
    const v = settings.machine_model
    if (isValidModel(v)) {
      setMachineModelCache(v)
      return v
    }
    return readStoredMachineModel()
  }
  try {
    const res = await apiFetch('/api/settings/system')
    if (res.ok) {
      const data = (await res.json()) as { settings?: { machine_model?: unknown } }
      const v = data.settings?.machine_model
      if (isValidModel(v)) {
        setMachineModelCache(v)
        return v
      }
    }
  } catch {
    /* fall through */
  }
  return readStoredMachineModel()
}

/** Persist machine_model to SQLite and update the in-memory cache. */
export async function writeStoredMachineModel(model: MachineModel): Promise<void> {
  setMachineModelCache(model)
  window.dispatchEvent(new CustomEvent('machineModelChanged', { detail: model }))
  const res = await apiFetch('/api/settings/system', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_model: model }),
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('not_authenticated')
    }
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  const data = (await res.json()) as { settings?: SystemSettings }
  if (data.settings) {
    setCachedSystemSettings(data.settings)
  } else {
    const cur = getCachedSystemSettings()
    if (cur) setCachedSystemSettings({ ...cur, machine_model: model })
  }
  window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: { type: 'system' } }))
}
