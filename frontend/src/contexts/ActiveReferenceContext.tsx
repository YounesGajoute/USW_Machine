import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Reference } from '@/types/reference.types'

const STORAGE_KEY = 'usm.activeReference'

interface ActiveReferenceContextValue {
  activeReference: Reference | null
  setActiveReference: (ref: Reference | null) => void
  clearActiveReference: () => void
  /** Vision Pi program for the loaded reference, when vision inspection is enabled. */
  visionProgramId: number | null
}

const ActiveReferenceContext = createContext<ActiveReferenceContextValue | null>(null)

function readStoredReference(): Reference | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Reference
    return parsed?.id && parsed?.name ? parsed : null
  } catch {
    return null
  }
}

function writeStoredReference(ref: Reference | null) {
  try {
    if (ref) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ref))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* private mode / quota */
  }
}

export function ActiveReferenceProvider({ children }: { children: ReactNode }) {
  const [activeReference, setActiveReferenceState] = useState<Reference | null>(() => readStoredReference())

  const setActiveReference = useCallback((ref: Reference | null) => {
    setActiveReferenceState(ref)
    writeStoredReference(ref)
  }, [])

  const clearActiveReference = useCallback(() => {
    setActiveReferenceState(null)
    writeStoredReference(null)
  }, [])

  const visionProgramId = useMemo(() => {
    if (!activeReference || activeReference.vision_inspection_enabled === false) return null
    return activeReference.vision_program_id ?? null
  }, [activeReference])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      setActiveReferenceState(e.newValue ? (JSON.parse(e.newValue) as Reference) : null)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const value = useMemo(
    () => ({ activeReference, setActiveReference, clearActiveReference, visionProgramId }),
    [activeReference, setActiveReference, clearActiveReference, visionProgramId],
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
