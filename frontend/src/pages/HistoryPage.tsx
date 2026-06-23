import { useState, useEffect, useCallback } from 'react'
import { HistoryView } from '@/components/history/HistoryView'
import type { HistoryRecord, HistoryFilters } from '@/types/history.types'

export default function HistoryPage() {
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHistory = useCallback(async (_filters: HistoryFilters = {}) => {
    try {
      setLoading(true)
      setError(null)
      // TODO: wire to /api/history when backend is available
      setRecords([])
      setTotal(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchHistory()
  }, [fetchHistory])

  return (
    <HistoryView
      title="Test History"
      records={records}
      total={total}
      loading={loading}
      error={error}
      onFiltersChange={fetchHistory}
    />
  )
}
