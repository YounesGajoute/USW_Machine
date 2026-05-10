import type React from 'react'
import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import type { ThemePalette } from '@/lib/themePalettes'
import { KIOSK_DLG_MAX_H_TALL, KIOSK_DLG_PAGE_W } from '@/lib/kioskDialogSizing'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import type { HistoryRecord, HistoryFilters } from '@/types/history.types'

/**
 * Generic paginated history / data-log table.
 *
 * The parent is responsible for data fetching.  Pass `records`, `total`,
 * `loading` and hook into `onFiltersChange` / `onViewDetails`.
 *
 * Usage:
 *   <HistoryView
 *     records={tests}
 *     total={totalCount}
 *     loading={loading}
 *     onFiltersChange={(f) => fetchHistory(f)}
 *     renderDetail={(r) => <MyDetailPanel record={r} />}
 *   />
 */
export interface HistoryViewProps {
  title?: string
  records: HistoryRecord[]
  total: number
  loading?: boolean
  error?: string | null
  /** Called whenever filters change (date, search, page). */
  onFiltersChange?: (filters: HistoryFilters) => void
  /** Provide a custom detail panel; receives the clicked record. */
  renderDetail?: (record: HistoryRecord, onClose: () => void) => React.ReactNode
  /** Extra actions in the filter bar (e.g. Export button). */
  filterBarActions?: React.ReactNode
  /** Show extra custom filter inputs. */
  extraFilters?: React.ReactNode
  pageSize?: number
}

export function HistoryView({
  title = 'History',
  records,
  total,
  loading = false,
  error,
  onFiltersChange,
  renderDetail,
  filterBarActions,
  extraFilters,
  pageSize = 50,
}: HistoryViewProps) {
  const { colors } = useTheme()
  const thStyle = useMemo(
    () =>
      ({
        padding: '14px',
        textAlign: 'left' as const,
        color: colors.text,
        fontWeight: 600,
        fontSize: '15px',
        borderBottom: `2px solid ${colors.border}`,
      }) satisfies React.CSSProperties,
    [colors],
  )
  const tdStyle = useMemo(
    () =>
      ({ padding: '12px 14px', color: colors.text, fontSize: '15px' }) satisfies React.CSSProperties,
    [colors],
  )
  const [dateFilter, setDateFilter] = useState('all')
  const [searchFilter, setSearchFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [selectedRecord, setSelectedRecord] = useState<HistoryRecord | null>(null)
  const [highlightedId, setHighlightedId] = useState<number | string | null>(null)

  const buildFilters = (overrides: Partial<HistoryFilters> = {}): HistoryFilters => ({
    limit: pageSize,
    offset,
    ...overrides,
  })

  const handleDateFilterChange = (value: string) => {
    setDateFilter(value)
    const now = new Date()
    let startDate: string | undefined
    if (value === 'today') startDate = new Date(now.setHours(0, 0, 0, 0)).toISOString()
    else if (value === 'week') startDate = new Date(now.setDate(now.getDate() - 7)).toISOString()
    else if (value === 'month') startDate = new Date(now.setMonth(now.getMonth() - 1)).toISOString()
    const newOffset = 0; setOffset(newOffset)
    onFiltersChange?.(buildFilters({ start_date: startDate, offset: newOffset }))
  }

  const handleSearch = () => {
    const newOffset = 0; setOffset(newOffset)
    onFiltersChange?.(buildFilters({ search: searchFilter || undefined, offset: newOffset }))
  }

  const handleClear = () => {
    setDateFilter('all'); setSearchFilter('')
    const newOffset = 0; setOffset(newOffset)
    onFiltersChange?.(buildFilters({ offset: newOffset }))
  }

  const handlePage = (dir: 'prev' | 'next') => {
    const newOffset = dir === 'prev' ? Math.max(0, offset - pageSize) : offset + pageSize
    setOffset(newOffset)
    onFiltersChange?.(buildFilters({ offset: newOffset }))
  }

  const handleRowClick = (record: HistoryRecord) => {
    setSelectedRecord(record)
    setHighlightedId(record.id)
    setTimeout(() => setHighlightedId(null), 5000)
  }

  // Infer columns from first record keys (excluding id, timestamp, and complex objects)
  const inferredColumns = records.length > 0
    ? Object.keys(records[0]).filter(k => !['id', 'timestamp', '__typename'].includes(k) && typeof records[0][k] !== 'object')
    : []

  return (
    <div style={{ height: '100%', backgroundColor: colors.background, padding: '20px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ flexShrink: 0, marginBottom: '20px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '20px', color: colors.text }}>{title}</h2>

        {error && (
          <div style={{ backgroundColor: colors.errorBg, color: colors.error, padding: '12px', borderRadius: '6px', marginBottom: '16px', border: `1px solid ${colors.error}` }}>
            {error}
          </div>
        )}

        {/* Filter bar */}
        <div style={{ backgroundColor: colors.white, borderRadius: '8px', padding: '16px 20px', marginBottom: '16px', border: `1px solid ${colors.border}` }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: extraFilters ? '12px' : 0 }}>
            <label style={{ color: colors.text, fontWeight: 'bold' }}>Date:</label>
            <select value={dateFilter} onChange={(e) => handleDateFilterChange(e.target.value)}
              style={{ padding: '8px 12px', border: `1px solid ${colors.border}`, borderRadius: '6px', fontSize: '14px', backgroundColor: colors.background, color: colors.text }}>
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">Last 7 Days</option>
              <option value="month">Last 30 Days</option>
            </select>
            <label style={{ color: colors.text, fontWeight: 'bold' }}>Search:</label>
            <input
              type="text" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search records…"
              style={{ padding: '8px 12px', border: `1px solid ${colors.border}`, borderRadius: '6px', fontSize: '14px', minWidth: '180px', backgroundColor: colors.background, color: colors.text }}
            />
            {extraFilters}
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {filterBarActions}
            <button onClick={handleSearch} style={{ padding: '8px 16px', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
              Apply
            </button>
            <button onClick={handleClear} style={{ padding: '8px 16px', backgroundColor: colors.grey, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className={KIOSK_TOUCH_SCROLL_CLASS} style={{ flex: 1, overflowY: 'auto', minHeight: 0, ...touchScrollable }}>
        {loading && records.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: colors.textSecondary }}>Loading…</div>
        ) : records.length === 0 ? (
          <div style={{ backgroundColor: colors.white, borderRadius: '8px', padding: '40px', textAlign: 'center', border: `1px solid ${colors.border}` }}>
            <p style={{ color: colors.textSecondary }}>No records found</p>
          </div>
        ) : (
          <div className={KIOSK_TOUCH_SCROLL_CLASS} style={{ backgroundColor: colors.white, borderRadius: '8px', padding: '20px', border: `1px solid ${colors.border}`, overflowX: 'auto', ...touchScrollable }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: '700px' }}>
              <thead>
                <tr style={{ backgroundColor: colors.grey }}>
                  <th style={thStyle}>Date & Time</th>
                  <th style={thStyle}>ID</th>
                  {inferredColumns.map(col => <th key={col} style={thStyle}>{formatColName(col)}</th>)}
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec, idx) => {
                  const isHighlighted = highlightedId === rec.id
                  const isEven = idx % 2 === 0
                  return (
                    <tr key={rec.id}
                      style={{ backgroundColor: isHighlighted ? colors.rowHighlightBg : isEven ? colors.white : colors.rowAltBg, borderBottom: `1px solid ${colors.border}`, cursor: 'default' }}
                      onMouseEnter={(e) => { if (!isHighlighted) e.currentTarget.style.backgroundColor = colors.rowHoverBg }}
                      onMouseLeave={(e) => { if (!isHighlighted) e.currentTarget.style.backgroundColor = isEven ? colors.white : colors.rowAltBg }}
                    >
                      <td style={tdStyle}>{isHighlighted && <span style={{ color: colors.newBadgeColor, fontWeight: 600, marginRight: 8, fontSize: 13 }}>● NEW</span>}{new Date(rec.timestamp).toLocaleString()}</td>
                      <td style={tdStyle}>{rec.id}</td>
                      {inferredColumns.map(col => (
                        <td key={col} style={tdStyle}>{renderCellValue(rec[col], colors)}</td>
                      ))}
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {renderDetail && (
                          <button onClick={() => handleRowClick(rec)}
                            style={{ padding: '6px 14px', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
                            View
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {total > pageSize && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
                <p style={{ color: colors.textSecondary, fontSize: '14px' }}>
                  Showing {offset + 1} – {Math.min(offset + pageSize, total)} of {total}
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => handlePage('prev')} disabled={offset === 0}
                    style={{ padding: '8px 16px', backgroundColor: colors.grey, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: offset === 0 ? 'not-allowed' : 'pointer', opacity: offset === 0 ? 0.6 : 1 }}>
                    Previous
                  </button>
                  <button onClick={() => handlePage('next')} disabled={offset + pageSize >= total}
                    style={{ padding: '8px 16px', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '6px', cursor: offset + pageSize >= total ? 'not-allowed' : 'pointer', opacity: offset + pageSize >= total ? 0.6 : 1 }}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedRecord && renderDetail && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 'min(16px, 2.5vw)', boxSizing: 'border-box' }}
          onClick={() => setSelectedRecord(null)}>
          <div className={KIOSK_TOUCH_SCROLL_CLASS} style={{ backgroundColor: colors.white, borderRadius: '14px', padding: 'clamp(24px, 3.5vw, 40px)', width: KIOSK_DLG_PAGE_W, maxWidth: '100%', maxHeight: KIOSK_DLG_MAX_H_TALL, overflowY: 'auto', boxSizing: 'border-box', boxShadow: '0 10px 40px rgba(0,0,0,0.2)', border: `2px solid ${colors.border}`, ...touchScrollable }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '16px', borderBottom: `2px solid ${colors.border}` }}>
              <h3 style={{ fontSize: '26px', fontWeight: 'bold', color: colors.text, margin: 0 }}>Record Details</h3>
              <button onClick={() => setSelectedRecord(null)} style={{ minWidth: '48px', minHeight: '48px', padding: '10px', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '10px', touchAction: 'manipulation' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.grey }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}>
                <X size={24} color={colors.text} strokeWidth={2.25} />
              </button>
            </div>
            {renderDetail(selectedRecord, () => setSelectedRecord(null))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────────

function formatColName(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function renderCellValue(value: any, colors: ThemePalette): React.ReactNode {
  if (value === null || value === undefined) return <span style={{ color: colors.textSecondary }}>—</span>
  if (typeof value === 'boolean') {
    return (
      <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, backgroundColor: value ? colors.successBg : colors.errorBg, color: value ? colors.success : colors.error }}>
        {value ? 'PASS' : 'FAIL'}
      </span>
    )
  }
  return String(value)
}
