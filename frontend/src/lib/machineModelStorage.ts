import type { MachineModel } from '@/types/settings.types'
import { apiFetch } from '@/services/apiClient'

const LS_KEY = 'machine_model'

function isValidModel(v: unknown): v is MachineModel {
  return v === 'STCS-CS19' || v === 'STCS-evo500'
}

/** Synchronous read from localStorage — returns null if not set. */
export function readStoredMachineModel(): MachineModel | null {
  try {
    const v = localStorage.getItem(LS_KEY)
    return isValidModel(v) ? v : null
  } catch {
    return null
  }
}

/** Load machine_model from the API and sync to localStorage. */
export async function loadMachineModelFromApi(): Promise<MachineModel | null> {
  try {
    const res = await apiFetch('/api/settings/system')
    if (res.ok) {
      const data = (await res.json()) as { settings?: { machine_model?: unknown } }
      const v = data.settings?.machine_model
      if (isValidModel(v)) {
        localStorage.setItem(LS_KEY, v)
        return v
      }
    }
  } catch {
    /* fall through — return cached value */
  }
  return readStoredMachineModel()
}

/** Persist machine_model to localStorage immediately, then sync to API (best-effort). */
export async function writeStoredMachineModel(model: MachineModel): Promise<void> {
  localStorage.setItem(LS_KEY, model)
  window.dispatchEvent(new CustomEvent('machineModelChanged', { detail: model }))
  try {
    await apiFetch('/api/settings/system', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine_model: model }),
    })
    window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: { type: 'system' } }))
  } catch {
    /* non-critical — localStorage already updated */
  }
}
