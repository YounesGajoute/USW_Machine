import { useCallback, useEffect, useState } from 'react'
import type { VisionResult } from '@/types/vision.types'
import {
  EMPTY_PRODUCTION_COUNTS,
  type ProductionCountBucket,
} from '@/types/productionCounts.types'

function bumpBucket(prev: ProductionCountBucket, result: 'PASS' | 'FAIL'): ProductionCountBucket {
  return result === 'PASS'
    ? { ...prev, good: prev.good + 1 }
    : { ...prev, ng: prev.ng + 1 }
}

export function useProductionCounts(activeReferenceId: string | null | undefined) {
  const [totalCounts, setTotalCounts] = useState<ProductionCountBucket>(EMPTY_PRODUCTION_COUNTS)
  const [referenceCounts, setReferenceCounts] = useState<ProductionCountBucket>(EMPTY_PRODUCTION_COUNTS)

  useEffect(() => {
    setReferenceCounts(EMPTY_PRODUCTION_COUNTS)
  }, [activeReferenceId])

  const recordCycleResult = useCallback((result: VisionResult | null) => {
    if (result !== 'PASS' && result !== 'FAIL') return
    setTotalCounts(prev => bumpBucket(prev, result))
    setReferenceCounts(prev => bumpBucket(prev, result))
  }, [])

  const resetTotalCounts = useCallback(() => {
    setTotalCounts(EMPTY_PRODUCTION_COUNTS)
  }, [])

  return {
    totalCounts,
    referenceCounts,
    recordCycleResult,
    resetTotalCounts,
  }
}
