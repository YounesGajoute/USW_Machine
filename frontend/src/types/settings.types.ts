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

export interface SystemSettings {
  require_login?: boolean
  test_mode?: TestMode
  serial_number?: string
  quickpass?: boolean
  machine_model?: MachineModel
  /** Vision Inspection slave base URL, e.g. http://192.168.10.2:5000/api */
  vision_url?: string
  /** Optional X-Vision-Remote-Key for authenticated Vision Pi slaves */
  vision_remote_key?: string
  /** Per–machine model: wire take/remove (left/right), centering entry/exit/speed (mm/s), notes */
  mechanism_positions_by_machine?: Partial<Record<MachineModel, MachineMechanismPositions>>
  /** Weld + shrink serial; backend merges with env (see referenceSerialBridge.mjs) */
  reference_serial?: ReferenceSerialSettings
  [key: string]: unknown
}
