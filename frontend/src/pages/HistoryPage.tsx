import { useState, useEffect } from 'react'
import { HistoryView } from '@/components/history/HistoryView'
import type { HistoryRecord, HistoryFilters } from '@/types/history.types'

/**
 * Example page wiring HistoryView to an API.
 *
 * Replace the mock `fetchHistory` function with your own API call, e.g.:
 *   const response = await fetch(`/api/history?limit=${f.limit}&offset=${f.offset}`)
 *   const data = await response.json()
 *   setRecords(data.records)
 *   setTotal(data.total)
 */
export default function HistoryPage() {
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHistory = async (filters: HistoryFilters = {}) => {
    try {
      setLoading(true)
      setError(null)
      // TODO: replace with real API call
      // const response = await fetch(`/api/history?limit=${filters.limit ?? 50}&offset=${filters.offset ?? 0}`)
      // const data = await response.json()
      // setRecords(data.records)
      // setTotal(data.total)

      // Mock data for template demonstration
      const mockRecords: HistoryRecord[] = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1 + (filters.offset ?? 0),
        timestamp: new Date(Date.now() - i * 3_600_000).toISOString(),
        operator_name: i % 3 === 0 ? 'admin' : `operator${i}`,
        result: i % 4 !== 0,
        duration: 30 + i * 2,
        test_mode: i % 2 === 0 ? 'automatic' : 'manual',
      }))
      setRecords(mockRecords)
      setTotal(47)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchHistory() }, [])

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
