import { settingsApi } from '@/services/settingsApi'
import type {
  ProductionSequenceConfig,
  ProductionSequenceConfigUpdate,
} from '@/types/productionSequence.types'

const DEFAULTS: ProductionSequenceConfig = {
  delayAfterClampCloseMs: 1000,
  delayAfterLeverUpMs: 1000,
  delayAfterPpClampCloseMs: 1000,
  delayAfterClampOpenMs: 1000,
  delayAfterLeverDownMs: 1000,
  delayAfterPickClampOpenMs: 1000,
  movePositionMm: 320,
  moveSpeedMmS: 0,
}

function parseDelayMs(raw: unknown, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback
}

function normalizeProductionSequenceConfig(raw: unknown): ProductionSequenceConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
  const o = raw as Record<string, unknown>
  return {
    delayAfterClampCloseMs: parseDelayMs(o.delayAfterClampCloseMs, DEFAULTS.delayAfterClampCloseMs),
    delayAfterLeverUpMs: parseDelayMs(o.delayAfterLeverUpMs, DEFAULTS.delayAfterLeverUpMs),
    delayAfterPpClampCloseMs: parseDelayMs(o.delayAfterPpClampCloseMs, DEFAULTS.delayAfterPpClampCloseMs),
    delayAfterClampOpenMs: parseDelayMs(o.delayAfterClampOpenMs, DEFAULTS.delayAfterClampOpenMs),
    delayAfterLeverDownMs: parseDelayMs(o.delayAfterLeverDownMs, DEFAULTS.delayAfterLeverDownMs),
    delayAfterPickClampOpenMs: parseDelayMs(
      o.delayAfterPickClampOpenMs,
      DEFAULTS.delayAfterPickClampOpenMs,
    ),
    movePositionMm: Number(o.movePositionMm) || DEFAULTS.movePositionMm,
    moveSpeedMmS: Number(o.moveSpeedMmS) >= 0 ? Number(o.moveSpeedMmS) : DEFAULTS.moveSpeedMmS,
  }
}

export async function getProductionSequenceConfig(): Promise<ProductionSequenceConfig> {
  const settings = await settingsApi.getSystemSettings(true)
  return normalizeProductionSequenceConfig(settings.production_sequence_config)
}

export async function saveProductionSequenceConfig(
  update: ProductionSequenceConfigUpdate,
): Promise<ProductionSequenceConfig> {
  const current = await getProductionSequenceConfig()
  const next = { ...current, ...update }
  await settingsApi.updateSystemSettings({ production_sequence_config: next })
  return next
}
