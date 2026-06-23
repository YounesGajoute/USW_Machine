import type { VisionTool } from '@/types/vision.types'

/** Default inspection tools for new programs and the general template. */
export const DEFAULT_VISION_TOOLS: VisionTool[] = [
  {
    id: 'outline-presence-default',
    name: 'Tube Presence Check',
    type: 'outline',
    color: '#00B2E3',
    threshold: 65,
    roi: { x: 200, y: 100, width: 240, height: 200 },
  },
  {
    id: 'outline-alignment-default',
    name: 'Tube Alignment Check',
    type: 'outline',
    color: '#4CAF50',
    threshold: 60,
    roi: { x: 180, y: 280, width: 280, height: 120 },
  },
]
