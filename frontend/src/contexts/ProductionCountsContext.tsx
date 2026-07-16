import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { VisionResult } from '@/types/vision.types'
import {
  EMPTY_PRODUCTION_COUNTS,
  type ProductionCountBucket,
} from '@/types/productionCounts.types'
import { useActiveReference } from '@/contexts/ActiveReferenceContext'

const SESSION_STORAGE_KEY = 'usm.productionCounts.session'
const REFERENCE_STORAGE_KEY = 'usm.productionCounts.reference'

function bumpBucket(prev: ProductionCountBucket, result: 'PASS' | 'FAIL'): ProductionCountBucket {
  return result === 'PASS'
    ? { ...prev, good: prev.good + 1 }
    : { ...prev, ng: prev.ng + 1 }
}

function isCountBucket(value: unknown): value is ProductionCountBucket {
  if (!value || typeof value !== 'object') return false
  const v = value as ProductionCountBucket
  return Number.isFinite(v.good) && Number.isFinite(v.ng) && v.good >= 0 && v.ng >= 0
}

/** Prefer localStorage (survives login/logout); migrate older sessionStorage values. */
function readBucket(key: string): ProductionCountBucket | null {
  try {
    const fromLocal = localStorage.getItem(key)
    if (fromLocal) {
      const parsed = JSON.parse(fromLocal) as unknown
      return isCountBucket(parsed) ? { good: parsed.good, ng: parsed.ng } : null
    }
    const fromSession = sessionStorage.getItem(key)
    if (fromSession) {
      const parsed = JSON.parse(fromSession) as unknown
      if (isCountBucket(parsed)) {
        const bucket = { good: parsed.good, ng: parsed.ng }
        localStorage.setItem(key, JSON.stringify(bucket))
        sessionStorage.removeItem(key)
        return bucket
      }
    }
  } catch {
    /* private mode / quota */
  }
  return null
}

function writeBucket(key: string, counts: ProductionCountBucket) {
  try {
    localStorage.setItem(key, JSON.stringify(counts))
    sessionStorage.removeItem(key)
  } catch {
    /* private mode / quota */
  }
}

function clearBucket(key: string) {
  try {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  } catch {
    /* private mode / quota */
  }
}

function readSessionCounts(): ProductionCountBucket {
  return readBucket(SESSION_STORAGE_KEY) ?? EMPTY_PRODUCTION_COUNTS
}

function writeSessionCounts(counts: ProductionCountBucket) {
  writeBucket(SESSION_STORAGE_KEY, counts)
}

function clearSessionCountsStorage() {
  clearBucket(SESSION_STORAGE_KEY)
}

function readReferenceRecord(): { referenceId: string; counts: ProductionCountBucket } | null {
  const tryParse = (raw: string | null) => {
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as { referenceId?: string; counts?: unknown }
      if (typeof parsed?.referenceId !== 'string' || !isCountBucket(parsed.counts)) return null
      return {
        referenceId: parsed.referenceId,
        counts: { good: parsed.counts.good, ng: parsed.counts.ng },
      }
    } catch {
      return null
    }
  }
  try {
    const local = tryParse(localStorage.getItem(REFERENCE_STORAGE_KEY))
    if (local) return local
    const session = tryParse(sessionStorage.getItem(REFERENCE_STORAGE_KEY))
    if (session) {
      localStorage.setItem(REFERENCE_STORAGE_KEY, JSON.stringify(session))
      sessionStorage.removeItem(REFERENCE_STORAGE_KEY)
      return session
    }
  } catch {
    /* private mode / quota */
  }
  return null
}

function readReferenceCounts(referenceId: string | null | undefined): ProductionCountBucket {
  if (!referenceId) return EMPTY_PRODUCTION_COUNTS
  const stored = readReferenceRecord()
  if (!stored || stored.referenceId !== referenceId) return EMPTY_PRODUCTION_COUNTS
  return stored.counts
}

function writeReferenceCounts(referenceId: string | null | undefined, counts: ProductionCountBucket) {
  try {
    if (!referenceId) {
      clearBucket(REFERENCE_STORAGE_KEY)
      return
    }
    localStorage.setItem(REFERENCE_STORAGE_KEY, JSON.stringify({ referenceId, counts }))
    sessionStorage.removeItem(REFERENCE_STORAGE_KEY)
  } catch {
    /* private mode / quota */
  }
}

interface ProductionCountsContextValue {
  totalCounts: ProductionCountBucket
  referenceCounts: ProductionCountBucket
  recordCycleResult: (result: VisionResult | null) => void
  resetTotalCounts: () => void
}

const ProductionCountsContext = createContext<ProductionCountsContextValue | null>(null)

/**
 * App-scoped production counters. Survives menu navigation and login/logout.
 * Session totals clear only via the manual Reset control.
 */
export function ProductionCountsProvider({ children }: { children: ReactNode }) {
  const { activeReference } = useActiveReference()
  const activeReferenceId = activeReference?.id ?? null
  const referenceIdRef = useRef(activeReferenceId)
  referenceIdRef.current = activeReferenceId

  const [totalCounts, setTotalCounts] = useState<ProductionCountBucket>(() => readSessionCounts())
  const [referenceCounts, setReferenceCounts] = useState<ProductionCountBucket>(() =>
    readReferenceCounts(activeReferenceId),
  )

  useEffect(() => {
    setReferenceCounts(readReferenceCounts(activeReferenceId))
  }, [activeReferenceId])

  const recordCycleResult = useCallback((result: VisionResult | null) => {
    if (result !== 'PASS' && result !== 'FAIL') return
    setTotalCounts((prev) => {
      const next = bumpBucket(prev, result)
      writeSessionCounts(next)
      return next
    })
    setReferenceCounts((prev) => {
      const next = bumpBucket(prev, result)
      writeReferenceCounts(referenceIdRef.current, next)
      return next
    })
  }, [])

  const resetTotalCounts = useCallback(() => {
    clearSessionCountsStorage()
    setTotalCounts(EMPTY_PRODUCTION_COUNTS)
  }, [])

  const value = useMemo(
    () => ({
      totalCounts,
      referenceCounts,
      recordCycleResult,
      resetTotalCounts,
    }),
    [totalCounts, referenceCounts, recordCycleResult, resetTotalCounts],
  )

  return (
    <ProductionCountsContext.Provider value={value}>{children}</ProductionCountsContext.Provider>
  )
}

export function useProductionCountsContext(): ProductionCountsContextValue {
  const ctx = useContext(ProductionCountsContext)
  if (!ctx) {
    throw new Error('useProductionCountsContext must be used within ProductionCountsProvider')
  }
  return ctx
}
