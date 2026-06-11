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
import { ensureReferenceHasVisionProgram, referenceUsesVision } from '@/lib/referenceVisionProgram'

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

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async (data: ReferenceCreateRequest) => {
    const visionEnabled = referenceUsesVision(data as Reference)
    const useSpecific = data.tool_config_mode === 'specific'

    let specificTools = data.specific_tools ?? null
    if (visionEnabled && useSpecific && !specificTools?.length) {
      const { loadGeneralTools } = await import('@/lib/referenceToolConfig')
      specificTools = await loadGeneralTools()
    }

    let created = await createReference({
      ...data,
      vision_program_id: null,
      specific_tools: useSpecific ? specificTools : null,
      specific_tool_template_id: useSpecific ? data.specific_tool_template_id : null,
    })

    if (visionEnabled) {
      try {
        const ensured = await ensureReferenceHasVisionProgram(created)
        created = ensured.reference
        await load()
        showSuccess(
          ensured.created
            ? `Reference "${data.name}" created — Vision program #${ensured.programId} linked`
            : `Reference "${data.name}" created — Vision program #${ensured.programId} linked`,
        )
        return
      } catch {
        await load()
        showSuccess(
          `Reference "${data.name}" created (Vision Pi offline — open Settings → Vision after the Pi is online to create the program)`,
        )
        return
      }
    }

    await load()
    showSuccess(`Reference "${data.name}" created`)
  }

  const handleUpdate = async (id: string, data: ReferenceUpdateRequest) => {
    const existing = references.find(r => r.id === id)
    let updated = await updateReference(id, data)

    const visionEnabled = referenceUsesVision(updated)
    if (visionEnabled) {
      try {
        const ensured = await ensureReferenceHasVisionProgram({
          ...updated,
          specific_tools: updated.specific_tools ?? existing?.specific_tools ?? null,
        })
        updated = ensured.reference
      } catch {
        /* keep DB row */
      }
    }

    if (activeReference?.id === id) {
      setActiveReference(updated)
    }

    await load()
    showSuccess('Reference updated successfully')
  }

  const handleLoad = async (ref: Resource) => {
    setError(null)
    try {
      const out = await broadcastReference(ref.name)
      let loadedRef: Reference | undefined
      if (out.reference) {
        loadedRef = out.reference
        if (referenceUsesVision(loadedRef)) {
          try {
            const ensured = await ensureReferenceHasVisionProgram(loadedRef)
            loadedRef = ensured.reference
          } catch {
            /* reference loaded — program link can be fixed in Vision settings */
          }
        }
        setActiveReference(loadedRef)
      } else {
        clearActiveReference()
      }
      const serialNote = out.serialSkipped
        ? ' (serial ports not configured — not sent to machines)'
        : ''
      const pid = loadedRef?.vision_program_id
      const progNote = pid != null ? ` · Vision program #${pid}` : ''
      showSuccess(`Reference "${out.name}" loaded${progNote}${serialNote}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load reference'
      setError(msg)
      throw err
    }
  }

  const handleDelete = async (id: string) => {
    const ref = references.find(r => r.id === id)

    const result = await deleteReference(id)

    if (activeReference?.id === id) {
      clearActiveReference()
    }

    await load()

    const name = ref?.name ?? id
    const v = result.vision
    if (v?.programDeleted) {
      const tpl =
        v.templatesDeleted.length > 0
          ? `, ${v.templatesDeleted.length} tool template(s) removed`
          : ''
      showSuccess(`Reference "${name}" deleted — Vision program #${v.programId} removed${tpl}`)
    } else if (v?.programId != null && v.warnings.length > 0) {
      setError(
        `Reference "${name}" deleted from database, but Vision Pi cleanup had issues: ${v.warnings.join('; ')}`,
      )
    } else {
      showSuccess(`Reference "${name}" deleted`)
    }
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
          render: value => String(value ?? 'RBK1').replace('RBK', 'RBK '),
        },
        {
          key: 'tool_config_mode',
          label: 'Tools',
          render: value => (value === 'specific' ? 'Specific' : 'General'),
        },
        {
          key: 'vision_inspection_enabled',
          label: 'Vision',
          render: value => (value !== false ? 'On' : 'Off'),
        },
        {
          key: 'vision_program_id',
          label: 'Vision #',
          render: value => (value != null ? String(value) : '—'),
        },
        {
          key: 'send_barcode_weld_enabled',
          label: 'Weld',
          render: value => (value !== false ? 'On' : 'Off'),
        },
        {
          key: 'send_barcode_shrink_enabled',
          label: 'Shrink',
          render: value => (value !== false ? 'On' : 'Off'),
        },
      ]}
      renderExtraFormFields={(form, onChange) => (
        <ReferenceOptionsFields form={form} onChange={onChange} />
      )}
    />
  )
}
