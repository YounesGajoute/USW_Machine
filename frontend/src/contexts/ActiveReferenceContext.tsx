import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Reference } from '@/types/reference.types'

interface ActiveReferenceContextValue {
  activeReference: Reference | null
  setActiveReference: (ref: Reference | null) => void
  clearActiveReference: () => void
}

const ActiveReferenceContext = createContext<ActiveReferenceContextValue | null>(null)

export function ActiveReferenceProvider({ children }: { children: ReactNode }) {
  const [activeReference, setActiveReferenceState] = useState<Reference | null>(null)

  const setActiveReference = useCallback((ref: Reference | null) => {
    setActiveReferenceState(ref)
  }, [])

  const clearActiveReference = useCallback(() => {
    setActiveReferenceState(null)
  }, [])

  const value = useMemo(
    () => ({ activeReference, setActiveReference, clearActiveReference }),
    [activeReference, setActiveReference, clearActiveReference],
  )

  return <ActiveReferenceContext.Provider value={value}>{children}</ActiveReferenceContext.Provider>
}

export function useActiveReference(): ActiveReferenceContextValue {
  const ctx = useContext(ActiveReferenceContext)
  if (!ctx) {
    throw new Error('useActiveReference must be used within ActiveReferenceProvider')
  }
  return ctx
}
