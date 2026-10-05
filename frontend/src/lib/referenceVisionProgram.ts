/**
 * Link product references to Vision Pi inspection programs (1:1).
 */

import {
  syncReferenceVisionInspection,
  type SyncReferenceVisionResult,
} from '@/lib/syncReferenceVisionInspection'
import { findTemplateByReferenceName } from '@/lib/referenceToolConfig'
import { deleteVisionProgram, deleteVisionToolTemplate } from '@/services/visionService'
import type { Reference } from '@/types/reference.types'
import type { ShrinkTube } from '@/types/shrinkTube.types'

export type EnsureVisionProgramResult = {
  reference: Reference
  programId: number | null
  /** True when a new program was created on the Vision Pi. */
  created: boolean
  /** True when Vision push succeeded. */
  synced?: boolean
  /** Master saved but Vision offline / sync failed. */
  pending?: boolean
  warning?: string
}

export function referenceUsesVision(ref: Pick<Reference, 'vision_inspection_enabled'>): boolean {
  return ref.vision_inspection_enabled !== false
}

/**
 * Ensure the reference has a vision_program_id when vision inspection is enabled.
 * Creates / updates the Vision program with visionChecksConfig + shrinkTubeProfile
 * (option tools only — no classic Outline list).
 */
export async function ensureReferenceHasVisionProgram(
  ref: Reference,
  options?: {
    shrinkTube?: Pick<ShrinkTube, 'length_mm' | 'diameter_mm'> | null
  },
): Promise<EnsureVisionProgramResult> {
  if (!referenceUsesVision(ref)) {
    return { reference: ref, programId: null, created: false, synced: false, pending: false }
  }

  const result: SyncReferenceVisionResult = await syncReferenceVisionInspection({
    reference: ref,
    shrinkTube: options?.shrinkTube ?? null,
  })

  if (result.pending && !result.programId && ref.vision_program_id == null) {
    throw new Error(result.warning ?? 'Vision Pi unreachable')
  }

  return {
    reference: result.reference,
    programId: result.programId,
    created: result.created,
    synced: result.synced,
    pending: result.pending,
    warning: result.warning,
  }
}

export type DeleteReferenceVisionResult = {
  programId: number | null
  programDeleted: boolean
  templatesDeleted: number[]
  warnings: string[]
}

/**
 * Delete Vision Pi program, reference-specific tool template(s), and related data.
 * Master image + reference template live on the program — removed when deleted.
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
