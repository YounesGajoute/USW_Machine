export type TestMode = 'manual' | 'reference' | 'sequential'

export type MachineModel = 'STCS-CS19' | 'STCS-evo500'

export const MACHINE_MODELS: MachineModel[] = ['STCS-CS19', 'STCS-evo500']

/** Pick & place axis — take vs remove wire (mm along that axis). */
export interface PickPlaceSideWirePositions {
  take_mm?: number
  remove_mm?: number
}

/** Centering mechanism travel (mm) and motion speed for recipe / automation. */
export interface CenteringMechanismPositions {
  entry_mm?: number
  exit_mm?: number
  /** Coordinated motion speed (e.g. pick–place traverse) in the centring zone — mm/s */
  speed_mm_s?: number
}

/**
 * Profiles keyed by machine model (General → Machine Model).
 * Left and right PP share the same gripper motion; the settings UI stores the same take/remove on both.
 * Centering has its own entry/exit.
 */
export interface MachineMechanismPositions {
  wire_left?: PickPlaceSideWirePositions
  wire_right?: PickPlaceSideWirePositions
  centering?: CenteringMechanismPositions
  /** Shown to operators when motion is coordinated by the centering mechanism */
  centering_motion_notes?: string
}

export type ReferenceSerialLineEnding = 'CRLF' | 'LF' | 'CR' | 'NONE'

export type CentringTransport = 'tcp'

/** Centring Nano TCP config (SQLite system_settings.centring_config). Double_Actuator FW. */
export interface CentringSlaveCal {
  calId: string
  hu: number
  tu: number
  hl: number
  tl: number
  A?: number
  B?: number
  C?: number
  sHome?: number
  sTravel?: number
}

export interface CentringConfig {
  transport?: CentringTransport
  tcp?: {
    host?: string
    port?: number
  }
  movementSpeedDegS?: number
  homingSpeedDegS?: number
  gapMoveSpeedDegS?: number
  mechOffsetMm?: number
  hRangeMm?: {
    min?: number
    max?: number
  }
  /** Persisted slave RAM cal — restored with SETCAL after connect/reboot. */
  slaveCal?: CentringSlaveCal | null
}

export type SerialFlowControl = 'none' | 'hardware'

export type SerialParity = 'none' | 'even' | 'odd'

/** Per logical port — maps to node-serialport open options + line ending for broadcast payloads. */
export interface ReferenceSerialPortOptions {
  baudRate?: number
  bufferSize?: number
  dataBits?: 7 | 8
  flowControl?: SerialFlowControl
  parity?: SerialParity
  stopBits?: 1 | 2
  lineEnding?: ReferenceSerialLineEnding
}

/** USB serial output for reference string to external machines (FT232); stored in system_settings. Device paths come from backend `.env` only. */
export interface ReferenceSerialSettings {
  /** Legacy shared default; per-port options take precedence when set */
  baud?: number
  /** Legacy shared default */
  line_ending?: ReferenceSerialLineEnding
  weld_baud?: number
  shrink_baud?: number
  weld_line_ending?: ReferenceSerialLineEnding
  shrink_line_ending?: ReferenceSerialLineEnding
  weld?: ReferenceSerialPortOptions
  shrink?: ReferenceSerialPortOptions
}

import type { VisionTool } from '@/types/vision.types'

/** Site-wide tool template stored in system_settings (used when reference tool_config_mode is general). */
export interface VisionGeneralToolTemplate {
  name?: string
  description?: string
  template_id?: number | null
  tools: VisionTool[]
}

/** Pick & place motion/homing config (SQLite system_settings.pick_place_config). */
export interface PickPlaceConfig {
  movementSpeedMmS: number
  homingSpeedMmS: number
  backoffMmA: number
  backoffMmB: number
  referenceAxis: 'a' | 'b'
  /** Soft travel ceiling for the stepper (mm). Targets clamp to [backoff, max]. */
  maxPositionMm: number
}

/** Two-hand start gesture mode (panel DI0/DI1). Runtime: backend `.env` only. */
export type TwoHandMode = 'sequential' | 'single'

/** Production sequence pneumatic/move delays (SQLite system_settings.production_sequence_config). */
export interface ProductionSequenceConfig {
  delayAfterClampCloseMs: number
  delayAfterLeverUpMs: number
  delayAfterPpClampCloseMs: number
  delayAfterClampOpenMs: number
  delayAfterLeverDownMs: number
  delayAfterPickClampOpenMs: number
  /**
   * Live DI→close delay for right clamp when CLAMP_TRIGGER_MODE=both (ms).
   * 0 = close on next monitor poll.
   */
  clampTriggerCloseDelayRightMs: number
  /**
   * Live DI→close delay for left clamp when CLAMP_TRIGGER_MODE=both (ms).
   * 0 = close on next monitor poll.
   */
  clampTriggerCloseDelayLeftMs: number
  /** Pick position for STCS-CS19 (mm) */
  movePositionMm: number
  /** Pick position for STCS-evo500 (mm) */
  movePositionEvoMm: number
  /** STCS-evo500 ARM (DO15): delay before pulse (ms) */
  armDelayBeforeMs: number
  /** STCS-evo500 ARM (DO15): pulse / hold duration (ms) */
  armPulseMs: number
  /** STCS-evo500 ARM (DO15): delay after pulse (ms) */
  armDelayAfterMs: number
  /** 0 = use pick & place movement speed at runtime */
  moveSpeedMmS: number
  /**
   * Legacy SQLite fields — panel two-hand Start is configured in backend `.env`
   * (`PANEL_TWO_HAND_MODE`: sequential | single), not Settings.
   */
  twoHandMode: TwoHandMode
  /** Unused at runtime (legacy SQLite field). */
  twoHandWindowMs: number
}

/** Sole production mode (advanced). Legacy `full` is coerced server-side. */
export type ProductionCycleVariant = 'advanced'

export const PRODUCTION_CYCLE_VARIANTS: ProductionCycleVariant[] = ['advanced']

export interface SystemSettings {
  require_login?: boolean
  test_mode?: TestMode
  /** Kiosk appearance — persisted in SQLite */
  theme?: 'light' | 'dark' | 'versigent'
  /** UI language — persisted in SQLite */
  locale?: 'en' | 'fr'
  /** Which settings sidebar sections appear in production builds */
  production_sections?: Record<string, boolean>
  serial_number?: string
  quickpass?: boolean
  /**
   * Production mode — always `advanced`:
   * on reference load assert h_pre; open h_post at traverse output; restore h_pre after P&P home.
   */
  production_cycle_variant?: ProductionCycleVariant
  machine_model?: MachineModel
  /** Vision Inspection slave base URL, e.g. http://192.168.10.2:5000/api */
  vision_url?: string
  /** Optional X-Vision-Remote-Key for /api/remote/* on the vision Pi */
  vision_remote_key?: string
  /** Optional X-Vision-Local-Key when proxying /api/programs (slave local API lockdown) */
  vision_local_key?: string
  /** Default tool template for references with tool_config_mode = general */
  vision_general_tool_template?: VisionGeneralToolTemplate
  /** Pick-and-place axis position (mm) where the centring mechanism input starts. */
  centering_input_start_mm?: number
  /** Fine-tune offset (mm) added to input start for move_to_centering_input; may be negative. */
  centering_input_offset_mm?: number
  /** Frame constants for shrink-tube centering travel (mm). */
  centring_frame_config?: {
    sideA_guide_spacing_mm?: number
    sideB_guide_spacing_mm?: number
    module_length_mm?: number
  }
  /** Pick & place motion, homing, backoff, reference axis. */
  pick_place_config?: PickPlaceConfig
  /** Production sequence delays and move targets. */
  production_sequence_config?: ProductionSequenceConfig
  /** Per–machine model: wire take/remove (left/right), centering entry/exit/speed (mm/s), notes */
  mechanism_positions_by_machine?: Partial<Record<MachineModel, MachineMechanismPositions>>
  /** Weld + shrink serial; backend merges with env (see referenceSerialBridge.mjs) */
  reference_serial?: ReferenceSerialSettings
  /** Centring motion + TCP host/port (Double_Actuator FW at 192.168.10.55:8177) */
  centring_config?: CentringConfig
  [key: string]: unknown
}
