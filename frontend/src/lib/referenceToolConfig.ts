/**
 * Sync Vision Pi programs and tool templates with reference tool_config_mode.
 * Specific templates are always named exactly like the reference (barcode).
 */

import { DEFAULT_VISION_TOOLS } from '@/lib/defaultVisionTools'
import { settingsApi } from '@/services/settingsApi'
import {
  createVisionToolTemplate,
  listVisionToolTemplates,
  updateVisionProgram,
} from '@/services/visionService'
import type { Reference, ToolConfigMode } from '@/types/reference.types'
import type { VisionTool } from '@/types/vision.types'

function templateIdFromResponse(tpl: unknown): number | null {
  if (!tpl || typeof tpl !== 'object') return null
  const o = tpl as Record<string, unknown>
  if (typeof o.id === 'number') return o.id
  const nested = o.template
  if (nested && typeof nested === 'object' && typeof (nested as { id?: number }).id === 'number') {
    return (nested as { id: number }).id
  }
  return null
}

/** Load general template tools from system settings, else defaults. */
export async function loadGeneralTools(): Promise<VisionTool[]> {
  try {
    const s = await settingsApi.getSystemSettings()
    const tools = s.vision_general_tool_template?.tools
    if (Array.isArray(tools) && tools.length > 0) return tools
  } catch {
    /* use defaults */
  }
  return DEFAULT_VISION_TOOLS
}

/** Find Vision Pi template whose name matches the reference (case-insensitive). */
export async function findTemplateByReferenceName(referenceName: string) {
  const templates = await listVisionToolTemplates()
  const key = referenceName.trim().toLowerCase()
  return templates.find(t => String(t.name ?? '').trim().toLowerCase() === key) ?? null
}

/**
 * Create or replace the Vision Pi tool template named exactly like the reference.
 * Returns template id and tools written.
 */
export async function upsertSpecificTemplateForReference(
  referenceName: string,
  tools: VisionTool[],
): Promise<{ templateId: number | null; tools: VisionTool[] }> {
  const name = referenceName.trim()
  const existing = await findTemplateByReferenceName(name)
  const tpl = await createVisionToolTemplate({
    name,
    description: `Specific tool configuration for reference ${name}`,
    tools,
  })
  const newId = templateIdFromResponse(tpl) ?? existing?.id ?? null
  return { templateId: newId, tools }
}

/** Apply tools to the Vision program linked to this reference. */
export async function applyToolsToProgram(programId: number, tools: VisionTool[]): Promise<void> {
  await updateVisionProgram(programId, { config: { tools } })
}

/** Resolve which tools apply for a reference row from DB + mode. */
export function resolveToolsForReference(
  ref: Pick<Reference, 'tool_config_mode' | 'specific_tools'>,
  generalTools: VisionTool[],
): VisionTool[] {
  if (ref.tool_config_mode === 'specific' && Array.isArray(ref.specific_tools) && ref.specific_tools.length > 0) {
    return ref.specific_tools
  }
  return generalTools
}

/** After reference create/update: sync Vision program (and specific template if needed). */
export async function syncReferenceVisionTools(
  ref: Pick<
    Reference,
    'name' | 'vision_program_id' | 'tool_config_mode' | 'specific_tools' | 'specific_tool_template_id'
  >,
  options?: { tools?: VisionTool[] },
): Promise<{ specific_tool_template_id?: number | null; specific_tools?: VisionTool[] | null }> {
  const programId = ref.vision_program_id
  if (programId == null) return {}

  const mode: ToolConfigMode = ref.tool_config_mode === 'specific' ? 'specific' : 'general'

  if (mode === 'general') {
    const generalTools = await loadGeneralTools()
    await applyToolsToProgram(programId, generalTools)
    return { specific_tool_template_id: null, specific_tools: null }
  }

  const tools =
    options?.tools ??
    (Array.isArray(ref.specific_tools) && ref.specific_tools.length > 0 ? ref.specific_tools : await loadGeneralTools())

  const { templateId, tools: savedTools } = await upsertSpecificTemplateForReference(ref.name, tools)
  await applyToolsToProgram(programId, savedTools)

  return {
    specific_tool_template_id: templateId,
    specific_tools: savedTools,
  }
}
