import { useState, useEffect, useCallback } from 'react'
import { ErrorHistoryView } from '@/components/error-history/ErrorHistoryView'
import type { ErrorRecord, ErrorFilters } from '@/types/history.types'

export default function ErrorHistoryPage() {
  const [errors, setErrors] = useState<ErrorRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchErrors = useCallback(async (_filters: ErrorFilters = {}) => {
    try {
      setLoading(true)
      setError(null)
      // TODO: wire to /api/error-history when backend is available
      setErrors([])
      setTotal(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load error history')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchErrors()
  }, [fetchErrors])

  return (
    <ErrorHistoryView
      errors={errors}
      total={total}
      loading={loading}
      error={error}
      onFiltersChange={fetchErrors}
    />
  )
}
