import { useState, useEffect, useCallback } from 'react'
import { ReferenceManagementView } from '@/components/reference/ReferenceManagementView'
import { ReferenceOptionsFields } from '@/components/reference/ReferenceOptionsFields'
import type { Reference, ReferenceCreateRequest, ReferenceUpdateRequest, Resource } from '@/types/reference.types'
import {
  listReferences,
  createReference,
  updateReference,
  deleteReference,
  broadcastReference,
} from '@/services/referencesApi'
import { useActiveReference } from '@/contexts/ActiveReferenceContext'
import { createVisionProgram, deleteVisionProgram } from '@/services/visionService'
import { loadGeneralTools, syncReferenceVisionTools } from '@/lib/referenceToolConfig'

const REFERENCE_FORM_DEFAULTS = {
  vision_inspection_enabled: true,
  send_barcode_weld_enabled: true,
  send_barcode_shrink_enabled: true,
  rbk: 'RBK1' as const,
  tool_config_mode: 'general' as const,
}

export default function ReferencesPage() {
  const { activeReference, setActiveReference, clearActiveReference } = useActiveReference()
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

  const handleCreate = async (data: ReferenceCreateRequest) => {
    const visionEnabled = data.vision_inspection_enabled !== false
    const useSpecific = data.tool_config_mode === 'specific'
    let visionProgramId: number | null = null

    if (visionEnabled) {
      try {
        const program = await createVisionProgram(data.name, data.description)
        visionProgramId = program.id
      } catch {
        // Vision Pi offline — reference still created without a linked program
      }
    }

    let specificTools = data.specific_tools ?? null
    if (visionProgramId && useSpecific && !specificTools?.length) {
      specificTools = await loadGeneralTools()
    }

    let created = await createReference({
      ...data,
      vision_program_id: visionProgramId,
      specific_tools: useSpecific ? specificTools : null,
      specific_tool_template_id: useSpecific ? data.specific_tool_template_id : null,
    })

    if (visionProgramId && visionEnabled) {
      try {
        const sync = await syncReferenceVisionTools({
          ...created,
          vision_program_id: visionProgramId,
          tool_config_mode: created.tool_config_mode,
          specific_tools: created.specific_tools,
        })
        if (sync.specific_tools || sync.specific_tool_template_id !== undefined) {
          created = await updateReference(created.id, {
            specific_tools: sync.specific_tools ?? null,
            specific_tool_template_id: sync.specific_tool_template_id ?? null,
            tool_config_mode: 'specific',
          })
        }
      } catch {
        // Vision sync failed — reference row exists
      }
    }

    await load()
    showSuccess(
      visionProgramId
        ? `Reference "${data.name}" created — Vision program #${visionProgramId} linked`
        : visionEnabled
          ? `Reference "${data.name}" created (Vision Pi offline — no program linked)`
          : `Reference "${data.name}" created`,
    )
  }

  const handleUpdate = async (id: string, data: ReferenceUpdateRequest) => {
    const existing = references.find(r => r.id === id)
    let updated = await updateReference(id, data)

    const visionEnabled = updated.vision_inspection_enabled !== false
    const programId = updated.vision_program_id

    if (programId && visionEnabled) {
      try {
        const sync = await syncReferenceVisionTools({
          ...updated,
          name: updated.name,
          vision_program_id: programId,
          tool_config_mode: updated.tool_config_mode,
          specific_tools: updated.specific_tools ?? existing?.specific_tools ?? null,
        })
        if (
          sync.specific_tools !== undefined ||
          sync.specific_tool_template_id !== undefined
        ) {
          updated = await updateReference(id, {
            specific_tools: sync.specific_tools ?? updated.specific_tools,
            specific_tool_template_id:
              sync.specific_tool_template_id ?? updated.specific_tool_template_id,
            tool_config_mode: updated.tool_config_mode,
          })
        }
      } catch {
        // keep DB row as saved
      }
    }

    await load()
    showSuccess('Reference updated successfully')
  }

  const handleLoad = async (ref: Resource) => {
    setError(null)
    try {
      const out = await broadcastReference(ref.name)
      if (out.reference) {
        setActiveReference(out.reference)
        if (out.reference.vision_program_id && out.reference.vision_inspection_enabled) {
          try {
            const sync = await syncReferenceVisionTools(out.reference)
            if (sync.specific_tools || sync.specific_tool_template_id !== undefined) {
              setActiveReference({
                ...out.reference,
                specific_tools: sync.specific_tools ?? out.reference.specific_tools,
                specific_tool_template_id:
                  sync.specific_tool_template_id ?? out.reference.specific_tool_template_id,
              })
            }
          } catch {
            /* program tools sync failed — reference still loaded */
          }
        }
      } else {
        clearActiveReference()
      }
      const serialNote = out.serialSkipped
        ? ' (serial ports not configured — not sent to machines)'
        : ''
      showSuccess(`Reference "${out.name}" loaded${serialNote}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load reference'
      setError(msg)
      throw err
    }
  }

  const handleDelete = async (id: string) => {
    const ref = references.find(r => r.id === id)

    await deleteReference(id)

    if (ref?.vision_program_id) {
      try {
        await deleteVisionProgram(ref.vision_program_id)
      } catch {
        // Non-fatal — Vision Pi may be offline
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
      onLoad={handleLoad}
      activeResourceId={activeReference?.id ?? null}
      defaultFormValues={REFERENCE_FORM_DEFAULTS}
      extraColumns={[
        {
          key: 'rbk',
          label: 'RBK',
          render: (value) => String(value ?? 'RBK1').replace('RBK', 'RBK '),
        },
        {
          key: 'tool_config_mode',
          label: 'Tools',
          render: (value) => (value === 'specific' ? 'Specific' : 'General'),
        },
        {
          key: 'vision_inspection_enabled',
          label: 'Vision',
          render: (value) => (value !== false ? 'On' : 'Off'),
        },
        {
          key: 'send_barcode_weld_enabled',
          label: 'Weld',
          render: (value) => (value !== false ? 'On' : 'Off'),
        },
        {
          key: 'send_barcode_shrink_enabled',
          label: 'Shrink',
          render: (value) => (value !== false ? 'On' : 'Off'),
        },
      ]}
      renderExtraFormFields={(form, onChange) => (
        <ReferenceOptionsFields form={form} onChange={onChange} />
      )}
    />
  )
}
