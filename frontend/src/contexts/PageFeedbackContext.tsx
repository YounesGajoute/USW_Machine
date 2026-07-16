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

export type PageFeedbackKind = 'success' | 'error'

export interface PageFeedbackMessage {
  kind: PageFeedbackKind
  text: string
}

interface PageFeedbackContextValue {
  message: PageFeedbackMessage | null
  showSuccess: (text: string, durationMs?: number) => void
  showError: (text: string, durationMs?: number) => void
  clear: () => void
}

const PageFeedbackContext = createContext<PageFeedbackContextValue | null>(null)

const DEFAULT_SUCCESS_MS = 4000
const DEFAULT_ERROR_MS = 6000

export function PageFeedbackProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<PageFeedbackMessage | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clear = useCallback(() => {
    clearTimer()
    setMessage(null)
  }, [clearTimer])

  const show = useCallback(
    (kind: PageFeedbackKind, text: string, durationMs: number) => {
      const trimmed = text.trim()
      if (!trimmed) {
        clear()
        return
      }
      clearTimer()
      setMessage({ kind, text: trimmed })
      if (durationMs > 0) {
        timerRef.current = window.setTimeout(() => {
          setMessage(null)
          timerRef.current = null
        }, durationMs)
      }
    },
    [clear, clearTimer],
  )

  const showSuccess = useCallback(
    (text: string, durationMs = DEFAULT_SUCCESS_MS) => show('success', text, durationMs),
    [show],
  )

  const showError = useCallback(
    (text: string, durationMs = DEFAULT_ERROR_MS) => show('error', text, durationMs),
    [show],
  )

  useEffect(() => () => clearTimer(), [clearTimer])

  const value = useMemo(
    () => ({ message, showSuccess, showError, clear }),
    [message, showSuccess, showError, clear],
  )

  return <PageFeedbackContext.Provider value={value}>{children}</PageFeedbackContext.Provider>
}

export function usePageFeedback(): PageFeedbackContextValue {
  const ctx = useContext(PageFeedbackContext)
  if (!ctx) throw new Error('usePageFeedback must be used within PageFeedbackProvider')
  return ctx
}

export function usePageFeedbackOptional(): PageFeedbackContextValue | null {
  return useContext(PageFeedbackContext)
}
