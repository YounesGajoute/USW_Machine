import { fitImageDisplaySize, WIZARD_H, WIZARD_W } from '@/lib/visionWizard'

/** Inner padding for main canvas and cable assembly bordered bodies. */
export const MAIN_CARD_BODY_PADDING = 12

/** Fixed 640×480 viewport, scaled down only to fit available row height. */
export function mainCardViewportSize(maxBodyHeight: number) {
  const maxH = Math.max(120, maxBodyHeight - MAIN_CARD_BODY_PADDING * 2)
  return fitImageDisplaySize(WIZARD_W, WIZARD_H, WIZARD_W, maxH)
}

export function mainCardFrameSize(maxBodyHeight: number) {
  const viewport = mainCardViewportSize(maxBodyHeight)
  return {
    viewport,
    frameW: viewport.width + MAIN_CARD_BODY_PADDING * 2,
    frameH: viewport.height + MAIN_CARD_BODY_PADDING * 2,
    canvasW: viewport.width,
    canvasH: viewport.height,
  }
}
