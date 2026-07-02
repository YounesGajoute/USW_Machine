import { useState, useEffect, useCallback } from 'react'
import { ErrorHistoryView } from '@/components/error-history/ErrorHistoryView'
import { useTheme } from '@/contexts/ThemeContext'
import { getErrorHistory, exportErrorHistory, type ExportFormat } from '@/services/historyApi'
import type { ErrorRecord, ErrorFilters } from '@/types/history.types'

export default function ErrorHistoryPage() {
  const [errors, setErrors] = useState<ErrorRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const fetchErrors = useCallback(async (filters: ErrorFilters = {}) => {
    try {
      setLoading(true)
      setError(null)
      const { errors: rows, total: count } = await getErrorHistory(filters)
      setErrors(rows)
      setTotal(count)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load error history')
      setErrors([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchErrors()
  }, [fetchErrors])

  const handleExport = useCallback(async (format: ExportFormat) => {
    try {
      setBusy(true)
      await exportErrorHistory(format)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <ErrorHistoryView
      errors={errors}
      total={total}
      loading={loading}
      error={error}
      onFiltersChange={fetchErrors}
      filterBarActions={<ExportActions busy={busy} onExport={handleExport} />}
    />
  )
}

function ExportActions({ busy, onExport }: { busy: boolean; onExport: (format: ExportFormat) => void }) {
  const { colors } = useTheme()
  const btn = {
    padding: '8px 14px',
    backgroundColor: colors.grey,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: '6px',
    cursor: busy ? 'not-allowed' : 'pointer',
    fontSize: '14px',
    opacity: busy ? 0.6 : 1,
  } as const
  return (
    <>
      <button disabled={busy} onClick={() => onExport('csv')} style={btn}>Export CSV</button>
      <button disabled={busy} onClick={() => onExport('json')} style={btn}>Export JSON</button>
    </>
  )
}
