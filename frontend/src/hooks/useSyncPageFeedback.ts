import { useEffect } from 'react'
import { usePageFeedbackOptional } from '@/contexts/PageFeedbackContext'

/**
 * Push local success/error strings into the shared bottom feedback bar.
 * Does not clear the bar when both are empty — route changes and dismiss handle that.
 * Errors take priority over success when both are set.
 */
export function useSyncPageFeedback(
  success: string | null | undefined,
  error: string | null | undefined,
) {
  const feedback = usePageFeedbackOptional()

  useEffect(() => {
    if (!feedback) return
    if (error) {
      feedback.showError(error)
      return
    }
    if (success) {
      feedback.showSuccess(success)
    }
  }, [feedback, success, error])
}
