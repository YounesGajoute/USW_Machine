import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { HistoryView } from '@/components/history/HistoryView'
import { useTheme } from '@/contexts/ThemeContext'
import {
  getHistory,
  exportHistory,
  archiveHistory,
  type ExportFormat,
} from '@/services/historyApi'
import type { HistoryRecord, HistoryFilters } from '@/types/history.types'

/** Shape a raw production-run row into clean table columns, keeping the full row under `details`. */
function toDisplayRecord(row: HistoryRecord): HistoryRecord {
  const durationMs = typeof row.duration_ms === 'number' ? row.duration_ms : null
  return {
    id: row.id,
    timestamp: row.timestamp,
    reference: row.reference_name ?? row.reference_id ?? '—',
    operator: row.operator_name ?? '—',
    result: row.result ?? null,
    cycle_time: durationMs != null ? `${(durationMs / 1000).toFixed(1)} s` : null,
    source: row.source ?? '—',
    vision: row.vision_summary ?? '—',
    details: row,
  }
}

export default function HistoryPage() {
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const fetchHistory = useCallback(async (filters: HistoryFilters = {}) => {
    try {
      setLoading(true)
      setError(null)
      const { records: rows, total: count } = await getHistory(filters)
      setRecords(rows.map(toDisplayRecord))
      setTotal(count)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history')
      setRecords([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchHistory()
  }, [fetchHistory])

  const handleExport = useCallback(async (format: ExportFormat) => {
    try {
      setBusy(true)
      await exportHistory(format)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }, [])

  const handleArchive = useCallback(async () => {
    try {
      setBusy(true)
      const result = await archiveHistory()
      if (result.archivedRuns || result.archivedErrors) {
        setError(null)
        window.alert(
          `Archived ${result.archivedRuns} runs and ${result.archivedErrors} errors${result.archiveFile ? `\n${result.archiveFile}` : ''}`,
        )
      } else {
        window.alert('Nothing to archive — no records older than the retention period.')
      }
      await fetchHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed')
    } finally {
      setBusy(false)
    }
  }, [fetchHistory])

  return (
    <HistoryView
      title="Test History"
      records={records}
      total={total}
      loading={loading}
      error={error}
      onFiltersChange={fetchHistory}
      renderDetail={(record, onClose) => <RunDetail record={record} onClose={onClose} />}
      filterBarActions={<HistoryActions busy={busy} onExport={handleExport} onArchive={handleArchive} />}
    />
  )
}

function HistoryActions({
  busy,
  onExport,
  onArchive,
}: {
  busy: boolean
  onExport: (format: ExportFormat) => void
  onArchive: () => void
}) {
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
      <button disabled={busy} onClick={onArchive} style={btn}>Archive</button>
    </>
  )
}

function RunDetail({ record }: { record: HistoryRecord; onClose: () => void }) {
  const { colors } = useTheme()
  const row = (record.details ?? record) as HistoryRecord
  const phases: Array<Record<string, unknown>> = Array.isArray(row.details?.phases)
    ? (row.details.phases as Array<Record<string, unknown>>)
    : []

  const fields: Array<[string, React.ReactNode]> = [
    ['Reference', row.reference_name ?? row.reference_id ?? '—'],
    ['Operator', row.operator_name ?? '—'],
    ['Result', row.result == null ? '—' : row.result ? 'PASS' : 'FAIL'],
    ['Duration', typeof row.duration_ms === 'number' ? `${(row.duration_ms / 1000).toFixed(2)} s` : '—'],
    ['Source', row.source ?? '—'],
    ['Vision', row.vision_summary ?? '—'],
    ['Timestamp', new Date(row.timestamp).toLocaleString()],
    ['Job ID', row.job_id ?? '—'],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {fields.map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '14px', color: colors.text, wordBreak: 'break-word' }}>{value}</div>
          </div>
        ))}
      </div>

      {row.error_message && (
        <div style={{ backgroundColor: colors.errorBg, color: colors.error, padding: '12px', borderRadius: '6px', border: `1px solid ${colors.error}`, whiteSpace: 'pre-wrap', fontSize: '14px' }}>
          {row.error_message}
        </div>
      )}

      {phases.length > 0 && (
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: colors.text, marginBottom: '8px' }}>Phases ({phases.length})</div>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            {phases.map((p, i) => {
              const name = String((p as { phase?: unknown }).phase ?? `step ${i + 1}`)
              const pass = (p as { pass?: unknown }).pass
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: i < phases.length - 1 ? `1px solid ${colors.border}` : 'none', backgroundColor: i % 2 === 0 ? colors.white : colors.background }}>
                  <span style={{ fontSize: '13px', color: colors.text, fontFamily: 'monospace' }}>{name}</span>
                  {typeof pass === 'boolean' && (
                    <span style={{ fontSize: '12px', fontWeight: 600, color: pass ? colors.success : colors.error }}>{pass ? 'PASS' : 'FAIL'}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
