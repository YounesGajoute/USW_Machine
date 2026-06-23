import { apiFetch } from '@/services/apiClient'
import type { ShrinkTube, ShrinkTubeCreateRequest, ShrinkTubeUpdateRequest } from '@/types/shrinkTube.types'

export async function listShrinkTubes(): Promise<ShrinkTube[]> {
  const res = await apiFetch('/api/shrink-tubes')
  if (!res.ok) throw new Error(`Failed to load shrink tubes (${res.status})`)
  return res.json()
}

export async function createShrinkTube(data: ShrinkTubeCreateRequest): Promise<ShrinkTube> {
  const res = await apiFetch('/api/shrink-tubes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.message ?? `Create failed (${res.status})`)
  return json
}

export async function updateShrinkTube(id: string, data: ShrinkTubeUpdateRequest): Promise<ShrinkTube> {
  const res = await apiFetch(`/api/shrink-tubes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.message ?? `Update failed (${res.status})`)
  return json
}

export async function deleteShrinkTube(id: string): Promise<void> {
  const res = await apiFetch(`/api/shrink-tubes/${id}`, { method: 'DELETE' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.message ?? `Delete failed (${res.status})`)
}
