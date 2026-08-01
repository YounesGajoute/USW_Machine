/**
 * References create/edit form — validation and API payload shaping.
 * Keeps dialog state (Record) separate from typed create/update bodies.
 */

import type {
  RbkOption,
  ReferenceCreateRequest,
  ReferenceUpdateRequest,
  ToolConfigMode,
  VisionChecksConfig,
} from '@/types/reference.types'
import { RBK_OPTIONS, TOOL_CONFIG_MODES } from '@/types/reference.types'
import { DEFAULT_VISION_CHECKS_CONFIG, normalizeVisionChecksConfig } from '@/lib/visionChecksConfig'
import {
  REFERENCE_SHRINK_TUBE_REQUIRED_MSG,
  validateReferenceShrinkTubeForm,
} from '@/lib/referenceShrinkTube'

export const REFERENCE_FORM_DEFAULTS = {
  vision_inspection_enabled: true,
  send_barcode_weld_enabled: true,
  send_barcode_shrink_enabled: true,
  tool_config_mode: 'general' as const,
  rbk: 'RBK1' as const,
  shrink_tube_id: null as string | null,
  vision_checks_config: DEFAULT_VISION_CHECKS_CONFIG,
}

const NAME_MAX_LEN = 64
/** Barcode-style name: letters, digits, and common scan punctuation (. _ -). */
const NAME_PATTERN = /^[A-Z0-9._\-]+$/

export function normalizeRbkOption(value: unknown): RbkOption {
  const s = String(value ?? 'RBK1').toUpperCase().replace(/\s+/g, '')
  return (RBK_OPTIONS as string[]).includes(s) ? (s as RbkOption) : 'RBK1'
}

export function normalizeToolConfigModeOption(value: unknown): ToolConfigMode {
  const s = String(value ?? 'general').toLowerCase()
  return (TOOL_CONFIG_MODES as string[]).includes(s) ? (s as ToolConfigMode) : 'general'
}

function validateReferenceName(name: unknown): string | null {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return 'Reference is required'
  if (trimmed.length > NAME_MAX_LEN) {
    return `Reference must be at most ${NAME_MAX_LEN} characters`
  }
  const upper = trimmed.toUpperCase()
  if (!NAME_PATTERN.test(upper)) {
    return 'Reference may use letters, digits, and . _ - only'
  }
  return null
}

/**
 * Dialog-level validation for create/edit.
 * Name emptiness is also checked in ReferenceManagementView; this covers barcode rules + shrink tube.
 */
export function validateReferenceForm(
  form: Record<string, unknown>,
  _mode: 'create' | 'edit' = 'create',
): string | null {
  const nameError = validateReferenceName(form.name)
  if (nameError) return nameError
  return validateReferenceShrinkTubeForm(form)
}

function asBool(value: unknown, defaultTrue = true): boolean {
  if (value === undefined || value === null) return defaultTrue
  return value !== false && value !== 0 && value !== '0'
}

function visionChecksForPayload(
  visionEnabled: boolean,
  raw: unknown,
): VisionChecksConfig {
  if (!visionEnabled) return DEFAULT_VISION_CHECKS_CONFIG
  return normalizeVisionChecksConfig(raw ?? DEFAULT_VISION_CHECKS_CONFIG)
}

/** Shape dialog form → POST body (no id / timestamps / vision_program_id). */
export function toReferenceCreatePayload(data: Record<string, unknown>): ReferenceCreateRequest {
  const validationError = validateReferenceForm(data, 'create')
  if (validationError) throw new Error(validationError)

  const visionEnabled = asBool(data.vision_inspection_enabled, true)
  const toolMode = normalizeToolConfigModeOption(data.tool_config_mode)
  const shrinkTubeId = String(data.shrink_tube_id).trim()

  return {
    name: String(data.name).trim().toUpperCase(),
    description: data.description != null ? String(data.description).trim() : '',
    vision_inspection_enabled: visionEnabled,
    send_barcode_weld_enabled: asBool(data.send_barcode_weld_enabled, true),
    send_barcode_shrink_enabled: asBool(data.send_barcode_shrink_enabled, true),
    rbk: normalizeRbkOption(data.rbk),
    tool_config_mode: toolMode,
    shrink_tube_id: shrinkTubeId,
    vision_checks_config: visionChecksForPayload(visionEnabled, data.vision_checks_config),
    specific_tool_template_id:
      toolMode === 'specific' ? (data.specific_tool_template_id as number | null | undefined) ?? null : null,
    specific_tools: toolMode === 'specific' ? (data.specific_tools as ReferenceCreateRequest['specific_tools']) ?? null : null,
  }
}

/** Shape dialog form → PATCH body (only editable fields). */
export function toReferenceUpdatePayload(data: Record<string, unknown>): ReferenceUpdateRequest {
  const validationError = validateReferenceForm(data, 'edit')
  if (validationError) throw new Error(validationError)

  const visionEnabled = asBool(data.vision_inspection_enabled, true)
  const toolMode = normalizeToolConfigModeOption(data.tool_config_mode)
  const shrinkTubeId = String(data.shrink_tube_id).trim()

  const payload: ReferenceUpdateRequest = {
    name: String(data.name).trim().toUpperCase(),
    description: data.description != null ? String(data.description).trim() : '',
    is_active: asBool(data.is_active, true),
    vision_inspection_enabled: visionEnabled,
    send_barcode_weld_enabled: asBool(data.send_barcode_weld_enabled, true),
    send_barcode_shrink_enabled: asBool(data.send_barcode_shrink_enabled, true),
    rbk: normalizeRbkOption(data.rbk),
    tool_config_mode: toolMode,
    shrink_tube_id: shrinkTubeId,
    vision_checks_config: visionChecksForPayload(visionEnabled, data.vision_checks_config),
  }

  if (toolMode === 'specific') {
    if (data.specific_tool_template_id !== undefined) {
      payload.specific_tool_template_id = (data.specific_tool_template_id as number | null) ?? null
    }
    if (data.specific_tools !== undefined) {
      payload.specific_tools = data.specific_tools as ReferenceUpdateRequest['specific_tools']
    }
  } else {
    payload.specific_tool_template_id = null
    payload.specific_tools = null
  }

  return payload
}

export { REFERENCE_SHRINK_TUBE_REQUIRED_MSG }
