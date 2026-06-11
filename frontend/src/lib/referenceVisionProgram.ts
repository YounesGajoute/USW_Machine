/**
 * Link product references to Vision Pi inspection programs (1:1).
 */

import { updateReference } from '@/services/referencesApi'
import { createVisionProgram, deleteVisionProgram, deleteVisionToolTemplate } from '@/services/visionService'
import type { Reference } from '@/types/reference.types'
import { findTemplateByReferenceName, syncReferenceVisionTools } from '@/lib/referenceToolConfig'

export type EnsureVisionProgramResult = {
  reference: Reference
  programId: number | null
  /** True when a new program was created on the Vision Pi. */
  created: boolean
}

export function referenceUsesVision(ref: Pick<Reference, 'vision_inspection_enabled'>): boolean {
  return ref.vision_inspection_enabled !== false
}

/** Create a Vision Pi program named after the reference (barcode). */
export async function createVisionProgramForReference(
  name: string,
  description?: string,
): Promise<number> {
  const program = await createVisionProgram(name.trim(), description)
  if (program.id == null) throw new Error('Vision Pi did not return a program id')
  return program.id
}

/**
 * Ensure the reference has a vision_program_id when vision inspection is enabled.
 * Creates a program on the Vision Pi and patches the reference row when missing.
 */
export async function ensureReferenceHasVisionProgram(
  ref: Reference,
  options?: { syncTools?: boolean },
): Promise<EnsureVisionProgramResult> {
  if (!referenceUsesVision(ref)) {
    return { reference: ref, programId: null, created: false }
  }

  let programId = ref.vision_program_id
  let created = false
  let reference = ref

  if (programId == null) {
    programId = await createVisionProgramForReference(
      ref.name,
      ref.description ?? `Reference ${ref.name}`,
    )
    created = true
    reference = await updateReference(ref.id, { vision_program_id: programId })
  }

  if (options?.syncTools !== false && programId != null) {
    try {
      const sync = await syncReferenceVisionTools({ ...reference, vision_program_id: programId })
      if (sync.specific_tools || sync.specific_tool_template_id !== undefined) {
        reference = await updateReference(reference.id, {
          specific_tools: sync.specific_tools ?? null,
          specific_tool_template_id: sync.specific_tool_template_id ?? null,
        })
      }
    } catch {
      /* program exists — tool sync can be retried from Settings */
    }
  }

  return { reference, programId, created }
}

export type DeleteReferenceVisionResult = {
  programId: number | null
  programDeleted: boolean
  templatesDeleted: number[]
  warnings: string[]
}

/**
 * Delete Vision Pi program, reference-specific tool template(s), and related data.
 * Master image lives on the program — removed when the program is deleted.
 */
export async function deleteReferenceVisionAssets(
  ref: Pick<
    Reference,
    'name' | 'vision_program_id' | 'specific_tool_template_id' | 'vision_inspection_enabled'
  >,
): Promise<DeleteReferenceVisionResult> {
  const warnings: string[] = []
  const templatesDeleted: number[] = []
  const programId = ref.vision_program_id ?? null

  if (programId == null && !referenceUsesVision(ref)) {
    return { programId: null, programDeleted: false, templatesDeleted, warnings }
  }

  const templateIds = new Set<number>()
  if (ref.specific_tool_template_id != null) {
    templateIds.add(ref.specific_tool_template_id)
  }

  try {
    const byName = await findTemplateByReferenceName(ref.name)
    if (byName?.id != null) templateIds.add(Number(byName.id))
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Could not list tool templates')
  }

  for (const tid of templateIds) {
    try {
      await deleteVisionToolTemplate(tid)
      templatesDeleted.push(tid)
    } catch (e) {
      warnings.push(
        `Template #${tid}: ${e instanceof Error ? e.message : 'delete failed'}`,
      )
    }
  }

  if (programId == null) {
    return { programId: null, programDeleted: false, templatesDeleted, warnings }
  }

  try {
    await deleteVisionProgram(programId)
    return { programId, programDeleted: true, templatesDeleted, warnings }
  } catch (e) {
    warnings.push(`Program #${programId}: ${e instanceof Error ? e.message : 'delete failed'}`)
    return { programId, programDeleted: false, templatesDeleted, warnings }
  }
}
