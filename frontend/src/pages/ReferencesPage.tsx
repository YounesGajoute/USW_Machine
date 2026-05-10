import { useState, useEffect, useCallback } from 'react'
import { ReferenceManagementView } from '@/components/reference/ReferenceManagementView'
import type { Reference, ReferenceCreateRequest, ReferenceUpdateRequest } from '@/types/reference.types'
import {
  listReferences,
  createReference,
  updateReference,
  deleteReference,
} from '@/services/referencesApi'
import { createVisionProgram, deleteVisionProgram } from '@/services/visionService'

export default function ReferencesPage() {
  const [references, setReferences] = useState<Reference[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const showSuccess = (msg: string) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 4000)
  }

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listReferences()
      setReferences(data as Reference[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load references')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  /**
   * Create reference:
   * 1. Best-effort: create a Vision program on the Vision Pi
   * 2. Always create the reference in SQLite (with or without a linked Vision program)
   */
  const handleCreate = async (data: ReferenceCreateRequest) => {
    let visionProgramId: number | null = null

    try {
      const program = await createVisionProgram(data.name, data.description)
      visionProgramId = program.id
    } catch {
      // Vision Pi offline or unreachable — reference is still created without a linked program
    }

    await createReference({ ...data, vision_program_id: visionProgramId })
    await load()
    showSuccess(
      visionProgramId
        ? `Reference "${data.name}" created — Vision program #${visionProgramId} linked`
        : `Reference "${data.name}" created (Vision Pi offline — no program linked)`
    )
  }

  const handleUpdate = async (id: string, data: ReferenceUpdateRequest) => {
    await updateReference(id, data)
    await load()
    showSuccess('Reference updated successfully')
  }

  /**
   * Delete reference:
   * Deletes from SQLite first, then best-effort deletes the linked Vision program.
   */
  const handleDelete = async (id: string) => {
    const ref = references.find(r => r.id === id)

    // Delete from SQLite
    await deleteReference(id)

    // Best-effort delete the linked Vision program
    if (ref?.vision_program_id) {
      try {
        await deleteVisionProgram(ref.vision_program_id)
      } catch {
        // Non-fatal — Vision Pi may be offline; reference is already deleted
      }
    }

    await load()
    showSuccess(`Reference "${ref?.name ?? id}" deleted`)
  }

  return (
    <ReferenceManagementView
      title="References"
      resources={references}
      loading={loading}
      error={error}
      success={success}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
    />
  )
}
