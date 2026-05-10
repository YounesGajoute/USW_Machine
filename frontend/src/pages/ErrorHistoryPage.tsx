import { useState, useEffect } from 'react'
import { ErrorHistoryView } from '@/components/error-history/ErrorHistoryView'
import type { ErrorRecord, ErrorFilters } from '@/types/history.types'

/**
 * Example page wiring ErrorHistoryView to an API.
 *
 * Replace the mock `fetchErrors` function with your own API call, e.g.:
 *   const response = await fetch(`/api/errors?limit=${f.limit}&offset=${f.offset}`)
 *   const data = await response.json()
 *   setErrors(data.errors)
 *   setTotal(data.total)
 */
export default function ErrorHistoryPage() {
  const [errors, setErrors] = useState<ErrorRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchErrors = async (_filters: ErrorFilters = {}) => {
    try {
      setLoading(true)
      setError(null)
      // TODO: replace with real API call
      // const response = await fetch(`/api/error-history?limit=${filters.limit ?? 50}&offset=${filters.offset ?? 0}`)
      // const data = await response.json()
      // setErrors(data.errors)
      // setTotal(data.total)

      const SEVERITIES: Array<ErrorRecord['severity']> = ['low', 'medium', 'high', 'critical']
      const mockErrors: ErrorRecord[] = Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        timestamp: new Date(Date.now() - i * 7_200_000).toISOString(),
        error_code: `ERR_${String(i + 1).padStart(3, '0')}`,
        error_message: `Sample error message #${i + 1}: something went wrong during phase execution.`,
        severity: SEVERITIES[i % 4],
        phase: ['FILL', 'REGULATION', 'TESTING', 'EMPTYING'][i % 4],
      }))
      setErrors(mockErrors)
      setTotal(24)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load error history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchErrors() }, [])

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
