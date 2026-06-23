/**
 * Legacy cable assembly canvas API — delegates to splice-py harness renderer.
 * @see https://github.com/splice-cad/splice-py
 */

import { drawHarness, describeHarness } from '@/lib/splice/drawHarness'
import { harnessFromCableAssemblySpec } from '@/lib/splice/harnessAdapter'
import type { CableAssemblySpec } from '@/types/cableAssembly.types'

/** Paint the cable assembly schematic onto a 2D canvas context. */
export function drawCableAssembly(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spec: CableAssemblySpec,
) {
  const harness = harnessFromCableAssemblySpec(spec)
  drawHarness(ctx, width, height, harness)
}

/** Human-readable summary for accessibility. */
export function describeCableAssembly(spec: CableAssemblySpec): string {
  return describeHarness(harnessFromCableAssemblySpec(spec))
}
