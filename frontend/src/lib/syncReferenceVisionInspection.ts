/**
 * Single master-side helper: push inspection checks + shrink-tube expectedMm
 * to the linked Vision Pi program (option tools only — no classic Outline list).
 */

import { listReferences, updateReference } from '@/services/referencesApi'
import { createVisionProgram, updateVisionProgram } from '@/services/visionService'
import { normalizeVisionChecksConfig } from '@/lib/visionChecksConfig'
import {
  heatShrinkExpectedFromProfile,
  selectedOptionsFromVisionChecks,
  shrinkTubeProfileFromTube,
  type InspectionOptionId,
  type InspectionOptionParams,
  type ShrinkTubeProfile,
} from '@/lib/visionInspectionOptions'
import type { Reference } from '@/types/reference.types'
import type { ShrinkTube } from '@/types/shrinkTube.types'

export type SyncReferenceVisionResult = {
  reference: Reference
  programId: number | null
  created: boolean
  /** True when Vision accepted the push. */
  synced: boolean
  /** Master row ok but Vision push failed / offline. */
  pending: boolean
  warning?: string
}

function referenceUsesVision(ref: Pick<Reference, 'vision_inspection_enabled'>): boolean {
  return ref.vision_inspection_enabled !== false
}

export type SyncReferenceVisionOptions = {
  reference: Reference
  shrinkTube?: Pick<ShrinkTube, 'length_mm' | 'diameter_mm'> | null
  /** Merge into config.inspectionOptions.params on Vision. */
  inspectionOptionsParams?: Partial<Record<InspectionOptionId, InspectionOptionParams>>
  /**
   * When true, force heat-shrink expectedMm from the tube catalog into params
   * (tube edit policy). Default false so operator Dimension overrides stick.
   */
  forceHeatShrinkExpectedFromTube?: boolean
  /** Override program name (defaults to reference.name). */
  name?: string
}

/**
 * Ensure linked Vision program exists and push visionChecksConfig + shrinkTubeProfile.
 * Sends empty classic tools; Vision builds option tools from selected checks.
 */
export async function syncReferenceVisionInspection(
  options: SyncReferenceVisionOptions,
): Promise<SyncReferenceVisionResult> {
  let reference = options.reference

  if (!referenceUsesVision(reference)) {
    return {
      reference,
      programId: null,
      created: false,
      synced: false,
      pending: false,
    }
  }

  const checks = normalizeVisionChecksConfig(reference.vision_checks_config)
  const selected = selectedOptionsFromVisionChecks(checks)
  const profile: ShrinkTubeProfile | null = shrinkTubeProfileFromTube(options.shrinkTube)
  const name = (options.name ?? reference.name).trim()
  let programId = reference.vision_program_id
  let created = false

  try {
    if (programId == null) {
      const program = await createVisionProgram(name, reference.description ?? `Reference ${name}`, {
        visionChecksConfig: checks,
        shrinkTubeProfile: profile ?? undefined,
        includeDefaultTools: false,
      })
      if (program.id == null) throw new Error('Vision Pi did not return a program id')
      programId = program.id
      created = true
      reference = await updateReference(reference.id, { vision_program_id: programId })
    }

    const params = { ...(options.inspectionOptionsParams ?? {}) }
    if (options.forceHeatShrinkExpectedFromTube && profile) {
      const fromTube = heatShrinkExpectedFromProfile(profile)
      for (const [oid, mm] of Object.entries(fromTube)) {
        const key = oid as InspectionOptionId
        params[key] = { ...(params[key] ?? {}), expectedMm: mm }
      }
    }

    const inspectionOptions: Record<string, unknown> = {
      selected,
    }
    if (Object.keys(params).length > 0) {
      inspectionOptions.params = params
    }

    await updateVisionProgram(programId, {
      name,
      description: reference.description ?? undefined,
      config: {
        tools: [],
        inspectionOptions,
      },
      visionChecksConfig: checks,
      shrinkTubeProfile: profile ?? undefined,
    })

    return {
      reference,
      programId,
      created,
      synced: true,
      pending: false,
    }
  } catch (e) {
    const warning = e instanceof Error ? e.message : 'Vision sync failed'
    return {
      reference,
      programId: programId ?? null,
      created,
      synced: false,
      pending: true,
      warning,
    }
  }
}

/**
 * Re-sync heat-shrink expectedMm for every vision-enabled reference using this tube.
 * Called when Settings → Shrink Tubes changes length_mm / diameter_mm.
 */
export async function syncVisionProgramsForShrinkTube(
  tubeId: string,
  tube: Pick<ShrinkTube, 'length_mm' | 'diameter_mm'>,
): Promise<{ synced: number; pending: number; warnings: string[] }> {
  const refs = await listReferences()
  const linked = refs.filter(
    r =>
      r.shrink_tube_id === tubeId &&
      referenceUsesVision(r) &&
      r.vision_program_id != null &&
      r.is_active !== false,
  )

  let synced = 0
  let pending = 0
  const warnings: string[] = []

  for (const ref of linked) {
    const result = await syncReferenceVisionInspection({
      reference: ref,
      shrinkTube: tube,
      forceHeatShrinkExpectedFromTube: true,
    })
    if (result.synced) synced += 1
    else {
      pending += 1
      if (result.warning) {
        warnings.push(`${ref.name}: ${result.warning}`)
      }
    }
  }

  return { synced, pending, warnings }
}
