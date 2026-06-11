export interface ProductionCountBucket {
  good: number
  ng: number
}

export const EMPTY_PRODUCTION_COUNTS: ProductionCountBucket = { good: 0, ng: 0 }

export function productionCountTotal(bucket: ProductionCountBucket): number {
  return bucket.good + bucket.ng
}

export function productionCountIsEmpty(bucket: ProductionCountBucket): boolean {
  return bucket.good === 0 && bucket.ng === 0
}

/** Whole-number yield (good ÷ total cycles), or null when no cycles yet. */
export function productionYieldPct(bucket: ProductionCountBucket): number | null {
  const total = productionCountTotal(bucket)
  if (total <= 0) return null
  return Math.round((bucket.good / total) * 100)
}
