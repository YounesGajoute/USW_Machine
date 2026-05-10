import { useState, useCallback } from 'react'
import type React from 'react'
import { X, ChevronDown, ChevronUp } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import type { ThemePalette } from '@/lib/themePalettes'
import { KIOSK_DLG_MAX_H_TALL, KIOSK_DLG_PAGE_W } from '@/lib/kioskDialogSizing'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import type { ErrorRecord, ErrorFilters } from '@/types/history.types'

/**
 * Generic error-log table with severity filtering, pagination, and
 * an expandable detail modal.
 *
 * The parent is responsible for data fetching.
 *
 * Usage:
 *   <ErrorHistoryView
 *     errors={errorRecords}
 *     total={total}
 *     loading={loading}
 *     onFiltersChange={(f) => fetchErrors(f)}
 *   />
 */
export interface ErrorHistoryViewProps {
  title?: string
  errors: ErrorRecord[]
  total: number
  loading?: boolean
  error?: string | null
  onFiltersChange?: (filters: ErrorFilters) => void
  pageSize?: number
}

function getSeverityStyle(severity: string | null | undefined, colors: ThemePalette): { bg: string; text: string } {
  switch (severity?.toLowerCase()) {
    case 'critical': return { bg: colors.severityCriticalBg, text: colors.severityCriticalText }
    case 'high':     return { bg: colors.severityHighBg,     text: colors.severityHighText }
    case 'medium':   return { bg: colors.severityMediumBg,   text: colors.severityMediumText }
    case 'low':      return { bg: colors.severityLowBg,      text: colors.severityLowText }
    default:         return { bg: colors.severityDefaultBg,  text: colors.severityDefaultText }
  }
}

function formatTs(ts: string) {
  return new Date(ts).toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function ErrorHistoryView({
  title = 'Error History',
  errors,
  total,
  loading = false,
  error,
  onFiltersChange,
  pageSize = 50,
}: ErrorHistoryViewProps) {
  const { colors } = useTheme()
  const [offset, setOffset] = useState(0)
  const [severityFilter, setSeverityFilter] = useState('')
  const [selectedError, setSelectedError] = useState<ErrorRecord | null>(null)
  const [expanded, setExpanded] = useState({ basic: true, context: true })

  const buildFilters = useCallback((overrides: Partial<ErrorFilters> = {}): ErrorFilters => ({
    limit: pageSize, offset, severity: severityFilter || undefined, ...overrides,
  }), [pageSize, offset, severityFilter])

  const handleSeverityChange = (v: string) => {
    setSeverityFilter(v); const o = 0; setOffset(o)
    onFiltersChange?.(buildFilters({ severity: v || undefined, offset: o }))
  }

  const handlePage = (dir: 'prev' | 'next') => {
    const o = dir === 'prev' ? Math.max(0, offset - pageSize) : offset + pageSize
    setOffset(o); onFiltersChange?.(buildFilters({ offset: o }))
  }

  const handleClear = () => {
    setSeverityFilter(''); const o = 0; setOffset(o)
    onFiltersChange?.(buildFilters({ severity: undefined, offset: o }))
  }

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
        <div style={{ backgroundColor: colors.white, borderRadius: '8px', padding: '14px 20px', marginBottom: '16px', border: `1px solid ${colors.border}`, display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ color: colors.text, fontWeight: 'bold' }}>Severity:</label>
          <select value={severityFilter} onChange={(e) => handleSeverityChange(e.target.value)}
            style={{ padding: '8px 12px', border: `1px solid ${colors.border}`, borderRadius: '6px', fontSize: '14px', backgroundColor: colors.background, color: colors.text }}>
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button onClick={handleClear} style={{ padding: '8px 14px', backgroundColor: colors.grey, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', marginLeft: 'auto' }}>
            Clear
          </button>
        </div>
      </div>

      {/* Table */}
      <div className={KIOSK_TOUCH_SCROLL_CLASS} style={{ flex: 1, overflowY: 'auto', minHeight: 0, ...touchScrollable }}>
        {loading && errors.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: colors.textSecondary }}>Loading…</div>
        ) : errors.length === 0 ? (
          <div style={{ backgroundColor: colors.white, borderRadius: '8px', padding: '40px', textAlign: 'center', border: `1px solid ${colors.border}` }}>
            <p style={{ color: colors.textSecondary }}>No error records found</p>
          </div>
        ) : (
          <div className={KIOSK_TOUCH_SCROLL_CLASS} style={{ backgroundColor: colors.white, borderRadius: '8px', padding: '20px', border: `1px solid ${colors.border}`, overflowX: 'auto', ...touchScrollable }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
              <thead>
                <tr style={{ backgroundColor: colors.grey, borderBottom: `2px solid ${colors.border}` }}>
                  {['Date & Time', 'Code', 'Message', 'Severity', 'Phase', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '12px', textAlign: h === 'Actions' ? 'right' : 'left', color: colors.text, fontWeight: 'bold', fontSize: '15px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {errors.map((err) => {
                  const sv = getSeverityStyle(err.severity, colors)
                  return (
                    <tr key={err.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '12px', color: colors.text, fontSize: '15px' }}>{formatTs(err.timestamp)}</td>
                      <td style={{ padding: '12px', color: colors.text, fontSize: '14px', fontFamily: 'monospace' }}>{err.error_code || '—'}</td>
                      <td style={{ padding: '12px', color: colors.text, fontSize: '15px', maxWidth: '400px' }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{err.error_message}</div>
                      </td>
                      <td style={{ padding: '12px' }}>
                        {err.severity
                          ? <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold', backgroundColor: sv.bg, color: sv.text }}>{err.severity.toUpperCase()}</span>
                          : <span style={{ color: colors.textSecondary }}>—</span>}
                      </td>
                      <td style={{ padding: '12px', color: colors.text, fontSize: '15px' }}>{err.phase || '—'}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <button onClick={() => setSelectedError(err)}
                          style={{ padding: '6px 12px', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
                          View
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

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
      {selectedError && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 'min(20px, 3vw)', boxSizing: 'border-box' }}
          onClick={() => setSelectedError(null)}>
          <div className={KIOSK_TOUCH_SCROLL_CLASS} style={{ backgroundColor: colors.white, borderRadius: '14px', padding: 'clamp(24px, 3.5vw, 40px)', width: KIOSK_DLG_PAGE_W, maxWidth: '100%', maxHeight: KIOSK_DLG_MAX_H_TALL, overflowY: 'auto', boxSizing: 'border-box', border: `1px solid ${colors.border}`, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', ...touchScrollable }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '16px', borderBottom: `2px solid ${colors.border}` }}>
              <h2 style={{ fontSize: '26px', fontWeight: 'bold', color: colors.text, margin: 0 }}>Error Details</h2>
              <button onClick={() => { setSelectedError(null); setExpanded({ basic: true, context: true }) }}
                style={{ minWidth: '48px', minHeight: '48px', padding: '10px', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '10px', touchAction: 'manipulation' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.grey }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}>
                <X size={24} color={colors.text} strokeWidth={2.25} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Basic info section */}
              <ExpandableSection title="Basic Information" expanded={expanded.basic}
                onToggle={() => setExpanded(p => ({ ...p, basic: !p.basic }))}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {selectedError.severity && (
                    <Field label="Severity">
                      <span style={{ padding: '6px 12px', borderRadius: '6px', fontWeight: 'bold', backgroundColor: getSeverityStyle(selectedError.severity, colors).bg, color: getSeverityStyle(selectedError.severity, colors).text }}>
                        {selectedError.severity.toUpperCase()}
                      </span>
                    </Field>
                  )}
                  <Field label="Timestamp">{formatTs(selectedError.timestamp)}</Field>
                  {selectedError.error_code && <Field label="Error Code"><code style={{ fontFamily: 'monospace', padding: '8px 12px', backgroundColor: colors.background, borderRadius: '6px', display: 'block' }}>{selectedError.error_code}</code></Field>}
                  <Field label="Message">
                    <div style={{ padding: '12px', backgroundColor: colors.background, borderRadius: '6px', whiteSpace: 'pre-wrap' }}>{selectedError.error_message}</div>
                  </Field>
                  {selectedError.phase && <Field label="Phase">{selectedError.phase}</Field>}
                </div>
              </ExpandableSection>

              {/* Context / extra fields */}
              {Object.keys(selectedError).filter(k => !['id', 'timestamp', 'error_code', 'error_message', 'severity', 'phase'].includes(k) && typeof selectedError[k] !== 'object' && selectedError[k] !== undefined && selectedError[k] !== null).length > 0 && (
                <ExpandableSection title="Additional Context" expanded={expanded.context}
                  onToggle={() => setExpanded(p => ({ ...p, context: !p.context }))}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    {Object.keys(selectedError).filter(k => !['id', 'timestamp', 'error_code', 'error_message', 'severity', 'phase'].includes(k) && typeof selectedError[k] !== 'object').map(k => (
                      selectedError[k] !== undefined && selectedError[k] !== null
                        ? <Field key={k} label={k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}>{String(selectedError[k])}</Field>
                        : null
                    ))}
                  </div>
                </ExpandableSection>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── sub-components ───────────────────────────────────────────────────────────

function ExpandableSection({ title, expanded, onToggle, children }: { title: string; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { colors } = useTheme()
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '8px', overflow: 'hidden' }}>
      <button onClick={onToggle}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', backgroundColor: colors.background, border: 'none', cursor: 'pointer', textAlign: 'left' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.grey }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = colors.background }}>
        <span style={{ fontSize: '15px', fontWeight: 600, color: colors.text }}>{title}</span>
        {expanded ? <ChevronUp size={18} color={colors.text} /> : <ChevronDown size={18} color={colors.text} />}
      </button>
      {expanded && <div style={{ padding: '16px 20px', backgroundColor: colors.white }}>{children}</div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme()
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: colors.textSecondary, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ color: colors.text, fontSize: '14px' }}>{children}</div>
    </div>
  )
}
