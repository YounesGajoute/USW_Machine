import { useState, useEffect, useCallback } from 'react'
import { ReferenceManagementView } from '@/components/reference/ReferenceManagementView'
import { ReferenceOptionsFields } from '@/components/reference/ReferenceOptionsFields'
import type { Reference, Resource, ResourceCreateRequest, ResourceUpdateRequest } from '@/types/reference.types'
import type { ShrinkTube } from '@/types/shrinkTube.types'
import { formatShrinkTubeLabel } from '@/types/shrinkTube.types'
import {
  listReferences,
  createReference,
  updateReference,
  deleteReference,
  broadcastReference,
} from '@/services/referencesApi'
import { listShrinkTubes } from '@/services/shrinkTubesApi'
import { fetchMachineInitStatus } from '@/services/machineInitApi'
import { useActiveReference } from '@/contexts/ActiveReferenceContext'
import { ensureReferenceHasVisionProgram, referenceUsesVision } from '@/lib/referenceVisionProgram'
import {
  REFERENCE_FORM_DEFAULTS,
  toReferenceCreatePayload,
  toReferenceUpdatePayload,
  validateReferenceForm,
} from '@/lib/referenceForm'

export default function ReferencesPage() {
  const { activeReference, setActiveReference, clearActiveReference } = useActiveReference()
  const [references, setReferences] = useState<Reference[]>([])
  const [shrinkTubes, setShrinkTubes] = useState<ShrinkTube[]>([])
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
      const [refs, tubes] = await Promise.all([listReferences(), listShrinkTubes()])
      setReferences(refs as Reference[])
      setShrinkTubes(tubes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load references')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Align session reference with backend (e.g. after server restart).
  useEffect(() => {
    let cancelled = false
    void fetchMachineInitStatus()
      .then((snap) => {
        if (cancelled || snap.referenceLoaded) return
        if (activeReference) clearActiveReference()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeReference, clearActiveReference])

  const activeShrinkTubes = shrinkTubes.filter(t => t.is_active !== false)

  const handleCreate = async (data: ResourceCreateRequest) => {
    const payload = toReferenceCreatePayload(data as Record<string, unknown>)
    const visionEnabled = referenceUsesVision(payload as Reference)
    const useSpecific = payload.tool_config_mode === 'specific'

    let specificTools = payload.specific_tools ?? null
    if (visionEnabled && useSpecific && !specificTools?.length) {
      const { loadGeneralTools } = await import('@/lib/referenceToolConfig')
      specificTools = await loadGeneralTools()
    }

    let created = await createReference({
      ...payload,
      vision_program_id: null,
      specific_tools: useSpecific ? specificTools : null,
      specific_tool_template_id: useSpecific ? payload.specific_tool_template_id : null,
    })

    if (visionEnabled) {
      const tube =
        shrinkTubes.find(t => t.id === created.shrink_tube_id) ??
        activeShrinkTubes.find(t => t.id === created.shrink_tube_id) ??
        null
      try {
        const ensured = await ensureReferenceHasVisionProgram(created, { shrinkTube: tube })
        created = ensured.reference
        await load()
        if (ensured.pending) {
          showSuccess(
            `Reference "${payload.name}" created — Vision sync pending${
              ensured.programId != null ? ` (program #${ensured.programId})` : ''
            }. Retry from Settings → Vision.`,
          )
          return
        }
        showSuccess(
          ensured.created
            ? `Reference "${payload.name}" created — Vision program #${ensured.programId} created and linked`
            : `Reference "${payload.name}" created — Vision program #${ensured.programId} linked`,
        )
        return
      } catch {
        await load()
        showSuccess(
          `Reference "${payload.name}" created (Vision Pi offline — open Settings → Vision after the Pi is online to create the program)`,
        )
        return
      }
    }

    await load()
    showSuccess(`Reference "${payload.name}" created`)
  }

  const handleUpdate = async (id: string, data: ResourceUpdateRequest) => {
    const existing = references.find(r => r.id === id)
    const merged = { ...existing, ...data } as Record<string, unknown>
    const payload = toReferenceUpdatePayload(merged)
    const visionEnabled = referenceUsesVision({ ...existing, ...payload } as Reference)

    if (payload.tool_config_mode === 'specific') {
      if (existing?.specific_tools?.length) {
        payload.specific_tools = existing.specific_tools
        payload.specific_tool_template_id =
          payload.specific_tool_template_id ?? existing.specific_tool_template_id ?? null
      } else if (visionEnabled && !payload.specific_tools?.length) {
        const { loadGeneralTools } = await import('@/lib/referenceToolConfig')
        payload.specific_tools = await loadGeneralTools()
      }
    }

    let updated = await updateReference(id, payload)

    let visionSyncNote = ''
    if (visionEnabled) {
      const tube =
        shrinkTubes.find(t => t.id === updated.shrink_tube_id) ??
        activeShrinkTubes.find(t => t.id === updated.shrink_tube_id) ??
        null
      try {
        const ensured = await ensureReferenceHasVisionProgram(
          {
            ...updated,
            specific_tools: updated.specific_tools ?? existing?.specific_tools ?? null,
          },
          { shrinkTube: tube },
        )
        updated = ensured.reference
        if (ensured.pending) {
          visionSyncNote = ' — Vision sync pending (retry from Settings → Vision)'
        } else if (ensured.synced) {
          visionSyncNote = ' — Vision inspection synced'
        }
      } catch {
        visionSyncNote = ' — Vision sync pending (Pi offline)'
      }
    }

    if (activeReference?.id === id) {
      setActiveReference(updated)
    }

    await load()
    showSuccess(`Reference "${updated.name}" updated${visionSyncNote}`)
  }

  const handleLoad = async (ref: Resource) => {
    setError(null)
    try {
      const out = await broadcastReference(ref.name)
      let loadedRef: Reference | undefined
      if (out.reference) {
        loadedRef = out.reference
        if (referenceUsesVision(loadedRef)) {
          const tube =
            shrinkTubes.find(t => t.id === loadedRef!.shrink_tube_id) ??
            activeShrinkTubes.find(t => t.id === loadedRef!.shrink_tube_id) ??
            null
          try {
            const ensured = await ensureReferenceHasVisionProgram(loadedRef, {
              shrinkTube: tube,
            })
            loadedRef = ensured.reference
          } catch {
            /* reference loaded — program link can be fixed in Vision settings */
          }
        }
        setActiveReference(loadedRef)
      } else {
        clearActiveReference()
      }
      const failedPorts = out.serialFailed ?? []
      const serialNote = out.serialSkipped
        ? ' (serial ports not configured — not sent to machines)'
        : failedPorts.length > 0
          ? ` (not sent to: ${failedPorts.map(f => f.port).join(', ')} — USB serial issue, check cable/adapter)`
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
      createDisabled={activeShrinkTubes.length === 0}
      createDisabledReason="Create at least one shrink tube profile in Settings → Shrink Tubes first."
      validateForm={validateReferenceForm}
      defaultFormValues={REFERENCE_FORM_DEFAULTS}
      extraColumns={[
        {
          key: 'shrink_tube_id',
          label: 'Shrink tube',
          render: value => {
            if (!value) return '—'
            const tube = shrinkTubes.find(t => t.id === value)
            return tube ? formatShrinkTubeLabel(tube) : String(value)
          },
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
        <ReferenceOptionsFields
          form={form}
          onChange={onChange}
          shrinkTubes={shrinkTubes}
          shrinkTubeRequired
        />
      )}
    />
  )
}
