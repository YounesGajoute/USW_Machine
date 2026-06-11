/**
 * Tool judgment helpers — scores come from the Vision Pi inspection pipeline,
 * not browser-side ROI metrics.
 */

import type { VisionTool, VisionToolResultItem } from '@/types/vision.types'
import { imageDataUrl, stripDataUri, WIZARD_H, WIZARD_W } from '@/lib/visionWizard'

export const TOOL_JUDGMENT_DEBOUNCE_MS = 500

export interface ToolJudgmentChannel {
  metricLabel: string
  fastScore: number
  pipelineScore?: number
  /** OK/NG from Vision Pi when available */
  piStatus?: 'OK' | 'NG'
  detail?: string
}

export interface ToolJudgmentSnapshot {
  metricLabel: string
  /** Stored master on Pi — inspection compares camera frame to this template */
  master: ToolJudgmentChannel | null
  /** Live camera inspection result from Vision Pi */
  live: ToolJudgmentChannel | null
  suggestThreshold: number | null
  error?: string | null
}

export function displayScore(channel: ToolJudgmentChannel | null | undefined): number | null {
  if (!channel) return null
  if (channel.pipelineScore != null) return channel.pipelineScore
  return channel.fastScore
}

export function judgmentPass(score: number | null, threshold: number, upper?: number): boolean | null {
  if (score == null) return null
  if (upper !== undefined) return score >= threshold && score <= upper
  return score >= threshold
}

export function channelPass(
  channel: ToolJudgmentChannel | null | undefined,
  threshold: number,
  upper?: number,
): boolean | null {
  if (channel?.piStatus === 'OK') return true
  if (channel?.piStatus === 'NG') return false
  return judgmentPass(displayScore(channel), threshold, upper)
}

export function suggestThreshold(channel: ToolJudgmentChannel | null | undefined): number | null {
  const score = displayScore(channel)
  if (score == null) return null
  return Math.max(0, Math.min(100, Math.round(score - 8)))
}

/** Map Vision Pi toolResults entry + tool index to UI snapshot. */
export function snapshotFromVisionPi(
  piResult: VisionToolResultItem | null,
  options?: { processingTimeMs?: number; error?: string | null },
): ToolJudgmentSnapshot | null {
  if (!piResult && !options?.error) return null

  if (!piResult) {
    return {
      metricLabel: 'Match rate',
      master: null,
      live: null,
      suggestThreshold: null,
      error: options?.error ?? 'Inspection failed',
    }
  }

  const score = Math.round(piResult.matching_rate)
  const live: ToolJudgmentChannel = {
    metricLabel: 'Match rate',
    fastScore: score,
    piStatus: piResult.status,
    detail: `Camera vs master · ${piResult.tool_type}`,
  }
  if (options?.processingTimeMs != null) {
    live.detail += ` · ${Math.round(options.processingTimeMs)} ms`
  }

  const master: ToolJudgmentChannel = {
    metricLabel: 'Match rate',
    fastScore: score,
    piStatus: piResult.status,
    detail: 'Compared to registered master on Vision Pi',
  }

  return {
    metricLabel: 'Match rate',
    master,
    live,
    suggestThreshold: suggestThreshold(live),
    error: options?.error ?? null,
  }
}

export function findVisionPiToolResult(
  tools: VisionTool[],
  toolResults: VisionToolResultItem[] | undefined,
  toolId: string,
): VisionToolResultItem | null {
  if (!toolResults?.length) return null
  const idx = tools.findIndex(t => t.id === toolId)
  if (idx >= 0 && idx < toolResults.length) return toolResults[idx]
  const tool = tools.find(t => t.id === toolId)
  if (!tool) return null
  const byName = toolResults.find(r => r.name === tool.name)
  return byName ?? null
}

/** Normalize any capture/live frame to 640×480 wizard space (JPEG base64, no data-URI prefix). */
export async function imageBase64ToWizardFrame640(base64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = WIZARD_W
      canvas.height = WIZARD_H
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to create wizard frame canvas'))
        return
      }
      ctx.drawImage(img, 0, 0, WIZARD_W, WIZARD_H)
      resolve(stripDataUri(canvas.toDataURL('image/jpeg', 0.88)))
    }
    img.onerror = () => reject(new Error('Failed to load image for wizard frame'))
    const raw = stripDataUri(base64)
    img.src = base64.startsWith('data:') ? base64 : (imageDataUrl(raw) ?? `data:image/png;base64,${raw}`)
  })
}
