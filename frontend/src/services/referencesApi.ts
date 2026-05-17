/**
 * References API — CRUD for product references stored in SQLite (maindata.db).
 *
 * Each reference carries a `vision_program_id` that links it to a program
 * on the Vision Pi. When a reference is created, the caller should first
 * create a Vision program and pass its ID here.
 */

import { apiFetch } from '@/services/apiClient'
import type { Reference, ReferenceCreateRequest, ReferenceUpdateRequest } from '@/types/reference.types'

export async function listReferences(): Promise<Reference[]> {
  const res = await apiFetch('/api/references')
  if (!res.ok) throw new Error(`Failed to load references (${res.status})`)
  return res.json()
}

export async function createReference(data: ReferenceCreateRequest): Promise<Reference> {
  const res = await apiFetch('/api/references', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.message ?? `Create failed (${res.status})`)
  return json
}

export async function updateReference(id: string, data: ReferenceUpdateRequest): Promise<Reference> {
  const res = await apiFetch(`/api/references/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.message ?? `Update failed (${res.status})`)
  return json
}

export async function deleteReference(id: string): Promise<void> {
  const res = await apiFetch(`/api/references/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.message ?? `Delete failed (${res.status})`)
  }
}

/** Validate scan against DB and send canonical name to welding + shrink machines over USB serial (backend). */
export async function broadcastReference(code: string): Promise<{
  ok: boolean
  name: string
  reference?: Reference
  sentTo: string[]
  serialSkipped?: boolean
}> {
  const res = await apiFetch('/api/references/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim() }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    message?: string
    name?: string
    reference?: Reference
    sentTo?: string[]
    serialSkipped?: boolean
  }
  if (!res.ok) throw new Error(json.message ?? `Broadcast failed (${res.status})`)
  return json as { ok: boolean; name: string; reference?: Reference; sentTo: string[]; serialSkipped?: boolean }
}
