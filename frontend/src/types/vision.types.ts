/**
 * Vision Inspection System types.
 *
 * The Vision Pi runs a Flask/Socket.IO backend at http://<vision-ip>:5000/api
 * See VISION_SLAVE_AND_SELF_CONFIGURATION.md for full protocol details.
 */

export type VisionResult = 'PASS' | 'FAIL' | 'UNKNOWN'

export type VisionConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

export interface VisionRoi {
  x: number
  y: number
  width: number
  height: number
}

export interface VisionTool {
  id: string
  name: string
  type: string
  color?: string
  threshold?: number
  roi?: VisionRoi
  [key: string]: unknown
}

export interface VisionToolTemplate {
  id?: number
  name: string
  description?: string
  tools: VisionTool[]
}

export interface VisionProgram {
  id: number
  name: string
  description?: string
  config?: { tools?: VisionTool[]; [key: string]: unknown }
}

/** Per-tool row from Vision Pi run-once (`toolResults` array). */
export interface VisionToolResultItem {
  matching_rate: number
  name: string
  status: 'OK' | 'NG'
  threshold: number
  tool_type: string
  upper_limit?: number | null
}

/** Response from POST /api/vision/tool-judgment (Vision Pi run-once, no image). */
export interface VisionToolJudgmentResponse {
  cameraUnavailable?: boolean
  status?: string
  toolResults?: VisionToolResultItem[]
  processingTimeMs?: number
  programId?: number
  error?: string
  message?: string
}

/** Response from POST /remote/inspection/run-once */
export interface VisionInspectionResponse {
  result: VisionResult
  /** Base64-encoded JPEG image */
  image_b64?: string
  details?: Record<string, unknown>
  error?: string
  toolResults?: VisionToolResultItem[]
  status?: string
  processingTimeMs?: number
}

/** Response from GET /remote/info */
export interface VisionRemoteInfo {
  socketio_connect_auth_required: boolean
  require_real_hardware: boolean
  require_remote_api_key_configured: boolean
}

/** How the main canvas should interpret lastImage (inspection judgment vs capture-only). */
export type VisionCanvasMode = 'inspection' | 'capture'

/** Full state managed by useVision hook */
export interface VisionState {
  connectionStatus: VisionConnectionStatus
  /** Last inspection result */
  lastResult: VisionResult | null
  /** Base64 JPEG/PNG of last inspection or production capture snapshot */
  lastImage: string | null
  /** Format hint for lastImage (e.g. jpg, png) */
  lastImageFormat: string | null
  /** Canvas display mode — capture shows image without PASS/FAIL badge */
  lastCanvasMode: VisionCanvasMode | null
  /** Details returned by the inspection algorithm */
  lastDetails: Record<string, unknown> | null
  /** Per-tool OK/NG rows from the last inspection */
  lastToolResults: VisionToolResultItem[] | null
  /** Timestamp of last inspection */
  lastInspectedAt: Date | null
  /** True while a run-once request is in flight */
  isInspecting: boolean
  /** True while the Socket.IO live feed is active */
  isLiveFeedActive: boolean
  /** Latest live feed frame (base64 JPEG) */
  liveFeedFrame: string | null
  /** Error message if last operation failed */
  error: string | null
  /** Available programs on the Vision Pi */
  programs: VisionProgram[]
  /** Currently selected program ID */
  selectedProgramId: number | null
  /** Registered master image for the active reference program (base64 JPEG/PNG) */
  masterImageB64: string | null
  /** Format hint for masterImageB64 */
  masterImageFormat: string | null
}
