import type { VisionTool } from '@/types/vision.types'

/**
 * Generic resource/reference record for CRUD management.
 * Projects can extend via the index signature.
 */
export interface Resource {
  id: string
  name: string
  description?: string
  created_at?: string
  updated_at?: string
  is_active?: boolean
  [key: string]: any
}

export interface ResourceCreateRequest {
  name: string
  description?: string
  [key: string]: any
}

export interface ResourceUpdateRequest {
  name?: string
  description?: string
  is_active?: boolean
  [key: string]: any
}

/** RBK profile selection for a product reference. */
export type RbkOption = 'RBK1' | 'RBK2' | 'RBK3'

export const RBK_OPTIONS: RbkOption[] = ['RBK1', 'RBK2', 'RBK3']

/** Use site-wide general tool template or a reference-specific template. */
export type ToolConfigMode = 'general' | 'specific'

export const TOOL_CONFIG_MODES: ToolConfigMode[] = ['general', 'specific']

/**
 * Product reference — stored in SQLite maindata.db.
 * Each reference is linked to a Vision Pi inspection program via `vision_program_id`.
 * When a reference is created, a matching program is auto-created on the Vision Pi.
 */
export interface Reference extends Resource {
  /** Vision Pi program ID linked to this reference. Auto-assigned on creation. */
  vision_program_id: number | null
  vision_inspection_enabled: boolean
  send_barcode_weld_enabled: boolean
  send_barcode_shrink_enabled: boolean
  rbk: RbkOption
  tool_config_mode: ToolConfigMode
  specific_tool_template_id: number | null
  /** Parsed from specific_tools_json when tool_config_mode is specific. */
  specific_tools: VisionTool[] | null
}

export interface ReferenceCreateRequest {
  name: string
  description?: string
  /** Set automatically after creating the Vision program — do not pass manually. */
  vision_program_id?: number | null
  vision_inspection_enabled?: boolean
  send_barcode_weld_enabled?: boolean
  send_barcode_shrink_enabled?: boolean
  rbk?: RbkOption
  tool_config_mode?: ToolConfigMode
  specific_tool_template_id?: number | null
  specific_tools?: VisionTool[] | null
}

export interface ReferenceUpdateRequest {
  name?: string
  description?: string
  is_active?: boolean
  vision_program_id?: number | null
  vision_inspection_enabled?: boolean
  send_barcode_weld_enabled?: boolean
  send_barcode_shrink_enabled?: boolean
  rbk?: RbkOption
  tool_config_mode?: ToolConfigMode
  specific_tool_template_id?: number | null
  specific_tools?: VisionTool[] | null
}
