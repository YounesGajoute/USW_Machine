import type React from 'react'
import { useState, useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Plus, Edit2, Trash2, Search, Download, X, Save, Barcode } from 'lucide-react'
import { KIOSK_DLG_CONFIRM_W, KIOSK_DLG_FORM_W, KIOSK_DLG_MAX_H, KIOSK_DLG_MAX_H_TALL } from '@/lib/kioskDialogSizing'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import DialogVirtualKeyboard from '@/components/auth/DialogVirtualKeyboard'
import { Switch } from '@/components/ui/Switch'
import type { Resource, ResourceCreateRequest, ResourceUpdateRequest } from '@/types/reference.types'

/**
 * Generic resource/reference management view (CRUD).
 *
 * Wire your API in the parent and pass the callbacks.
 *
 * Usage:
 *   <ReferenceManagementView
 *     title="References"
 *     resources={references}
 *     loading={loading}
 *     error={error}
 *     onCreate={async (data) => { await refApi.create(data); reload() }}
 *     onUpdate={async (id, data) => { await refApi.update(id, data); reload() }}
 *     onDelete={async (id) => { await refApi.delete(id); reload() }}
 *     extraColumns={[{ key: 'barcode_prefix', label: 'Prefix' }]}
 *   />
 *
 * Extra fields beyond name/description can be handled via `renderExtraFormFields`.
 */
export interface ExtraColumn {
  key: string
  label: string
  render?: (value: any, resource: Resource) => React.ReactNode
}

export interface ReferenceManagementViewProps {
  title?: string
  resources: Resource[]
  loading?: boolean
  error?: string | null
  success?: string | null
  /** Optional banner rendered above the search bar (e.g. Vision Pi status) */
  headerExtra?: React.ReactNode
  /** Disable the New button (e.g. when Vision Pi is offline) */
  createDisabled?: boolean
  /** Tooltip shown on the disabled New button */
  createDisabledReason?: string
  onCreate?: (data: ResourceCreateRequest) => Promise<void>
  onUpdate?: (id: string, data: ResourceUpdateRequest) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  onExport?: () => Promise<void>
  onImport?: () => void
  extraColumns?: ExtraColumn[]
  renderExtraFormFields?: (data: Record<string, any>, onChange: (key: string, value: any) => void) => React.ReactNode
}

export function ReferenceManagementView({
  title = 'Reference Management',
  resources,
  loading = false,
  error,
  success,
  headerExtra,
  createDisabled = false,
  createDisabledReason,
  onCreate,
  onUpdate,
  onDelete,
  onExport,
  onImport,
  extraColumns = [],
  renderExtraFormFields,
}: ReferenceManagementViewProps) {
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
  const inputStyle = useMemo(
    () =>
      ({
        width: '100%',
        padding: '10px 14px',
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        fontSize: '16px',
        color: colors.text,
        backgroundColor: colors.white,
        boxSizing: 'border-box' as const,
        outline: 'none',
      }) satisfies React.CSSProperties,
    [colors],
  )
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editResource, setEditResource] = useState<Resource | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, any>>({ name: '', description: '', is_active: true })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [kbTarget, setKbTarget] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)

  const filtered = useMemo(() =>
    resources.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.id.toLowerCase().includes(search.toLowerCase())),
    [resources, search])

  const openCreate = () => {
    setForm({ name: '', description: '', is_active: true }); setFormError(null); setShowCreate(true)
  }

  const openEdit = (r: Resource) => {
    setEditResource(r); setForm({ ...r }); setFormError(null)
  }

  const closeDialog = () => { setShowCreate(false); setEditResource(null); setKbTarget(null); setFormError(null) }

  const setFormField = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }))

  const handleSave = async () => {
    if (!form.name?.trim()) { setFormError('Reference (barcode) is required'); return }
    try {
      setSaving(true); setFormError(null)
      if (showCreate) {
        await onCreate?.(form as ResourceCreateRequest)
      } else if (editResource) {
        await onUpdate?.(editResource.id, form as ResourceUpdateRequest)
      }
      closeDialog()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      setDeleting(true); setDeleteError(null)
      await onDelete?.(deleteId)
      setDeleteId(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const deleteTarget = deleteId ? resources.find(r => r.id === deleteId) : null

  const handleExport = async () => {
    if (!onExport) return
    setExportLoading(true)
    try { await onExport() } finally { setExportLoading(false) }
  }

  const kbAppend = (ch: string) => { if (kbTarget) setFormField(kbTarget, ((form[kbTarget] as string) ?? '') + ch) }
  const kbBackspace = () => { if (kbTarget) setFormField(kbTarget, ((form[kbTarget] as string) ?? '').slice(0, -1)) }
  const kbClear = () => { if (kbTarget) setFormField(kbTarget, '') }

  const isDialogOpen = showCreate || editResource !== null

  return (
    <div style={{ height: '100%', backgroundColor: colors.background, padding: '20px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ flexShrink: 0, marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '28px', fontWeight: 'bold', color: colors.text, margin: 0 }}>{title}</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            {onExport && (
              <button onClick={handleExport} disabled={exportLoading}
                style={{ padding: '10px 16px', backgroundColor: colors.success, color: 'white', border: 'none', borderRadius: '8px', cursor: exportLoading ? 'not-allowed' : 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px', opacity: exportLoading ? 0.7 : 1 }}>
                <Download size={16} />{exportLoading ? 'Exporting…' : 'Export'}
              </button>
            )}
            {onImport && (
              <button onClick={onImport}
                style={{ padding: '10px 16px', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                Import
              </button>
            )}
            {onCreate && (
              <button
                onClick={createDisabled ? undefined : openCreate}
                disabled={createDisabled}
                title={createDisabled ? createDisabledReason : undefined}
                style={{
                  padding: '10px 18px',
                  backgroundColor: createDisabled ? colors.grey : colors.success,
                  color: createDisabled ? colors.textSecondary : 'white',
                  border: createDisabled ? `1px solid ${colors.border}` : 'none',
                  borderRadius: '8px',
                  cursor: createDisabled ? 'not-allowed' : 'pointer',
                  fontSize: '15px', fontWeight: 'bold',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  opacity: createDisabled ? 0.6 : 1,
                }}>
                <Plus size={16} /> New
              </button>
            )}
          </div>
        </div>

        {error && <div style={{ backgroundColor: colors.errorBg, color: colors.error, padding: '12px', borderRadius: '6px', marginBottom: '12px', border: `1px solid ${colors.error}` }}>{error}</div>}
        {success && <div style={{ backgroundColor: colors.successBg, color: colors.success, padding: '12px', borderRadius: '6px', marginBottom: '12px', border: `1px solid ${colors.success}` }}>{success}</div>}

        {headerExtra}

        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: colors.white, borderRadius: '8px', border: `1px solid ${colors.border}` }}>
          <Search size={18} color={colors.textSecondary} />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: '16px', color: colors.text, backgroundColor: 'transparent' }} />
          {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px' }}><X size={16} color={colors.textSecondary} /></button>}
        </div>
      </div>

      {/* Table */}
      <div className={KIOSK_TOUCH_SCROLL_CLASS} style={{ flex: 1, overflowY: 'auto', minHeight: 0, ...touchScrollable }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: colors.textSecondary }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ backgroundColor: colors.white, borderRadius: '8px', padding: '40px', textAlign: 'center', border: `1px solid ${colors.border}` }}>
            <p style={{ color: colors.textSecondary }}>{search ? 'No matching records' : 'No records yet'}</p>
          </div>
        ) : (
          <div className={KIOSK_TOUCH_SCROLL_CLASS} style={{ backgroundColor: colors.white, borderRadius: '8px', border: `1px solid ${colors.border}`, overflowX: 'auto', ...touchScrollable }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
              <thead>
                <tr style={{ backgroundColor: colors.grey, borderBottom: `2px solid ${colors.border}` }}>
                  <th style={thStyle}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Barcode size={15} />
                      Reference
                    </span>
                  </th>
                  <th style={thStyle}>Description</th>
                  {extraColumns.map(c => <th key={c.key} style={thStyle}>{c.label}</th>)}
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => (
                  <tr key={r.id}
                    style={{ backgroundColor: idx % 2 === 0 ? colors.white : colors.rowAltBg, borderBottom: `1px solid ${colors.border}` }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.rowHoverBg }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = idx % 2 === 0 ? colors.white : colors.rowAltBg }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Barcode size={16} color={colors.primary} style={{ flexShrink: 0 }} />
                        <span style={{ fontFamily: 'monospace', letterSpacing: '0.05em', fontSize: '15px' }}>{r.name}</span>
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: colors.textSecondary }}>{r.description || '—'}</td>
                    {extraColumns.map(c => (
                      <td key={c.key} style={tdStyle}>{c.render ? c.render(r[c.key], r) : String(r[c.key] ?? '—')}</td>
                    ))}
                    <td style={tdStyle}>
                      <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '13px', fontWeight: 'bold', backgroundColor: r.is_active !== false ? colors.statusActiveBg : colors.statusInactiveBg, color: r.is_active !== false ? colors.success : colors.textSecondary }}>
                        {r.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        {onUpdate && (
                          <button onClick={() => openEdit(r)}
                            style={{ padding: '6px 12px', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px' }}>
                            <Edit2 size={14} /> Edit
                          </button>
                        )}
                        {onDelete && (
                          <button onClick={() => setDeleteId(r.id)}
                            style={{ padding: '6px 12px', backgroundColor: colors.error, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px' }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent style={{ width: KIOSK_DLG_FORM_W, maxWidth: '100%', maxHeight: KIOSK_DLG_MAX_H_TALL, overflowY: 'auto' }}>
          <DialogHeader>
            <DialogTitle>
              {showCreate ? 'New Reference' : `Edit Reference: ${editResource?.name}`}
            </DialogTitle>
          </DialogHeader>

          {formError && <div style={{ backgroundColor: colors.errorBg, color: colors.error, padding: '10px 14px', borderRadius: '6px', marginBottom: '14px', border: `1px solid ${colors.error}`, whiteSpace: 'pre-wrap' }}>{formError}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <FormField label="Reference" required>
              <div style={{ position: 'relative' }}>
                <Barcode
                  size={18}
                  color={colors.textSecondary}
                  style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                />
                <input
                  value={form.name ?? ''}
                  onChange={(e) => setFormField('name', e.target.value.toUpperCase())}
                  onFocus={() => setKbTarget('name')}
                  placeholder=""
                  style={{ ...inputStyle, paddingLeft: '38px', letterSpacing: '0.06em', fontFamily: 'monospace', fontSize: '17px' }}
                />
              </div>
            </FormField>
            <FormField label="Description">
              <input value={form.description ?? ''} onChange={(e) => setFormField('description', e.target.value)} onFocus={() => setKbTarget('description')}
                placeholder="" style={inputStyle} />
            </FormField>
            {renderExtraFormFields?.(form, setFormField)}
            <FormField label="Active">
              <Switch checked={form.is_active !== false} onChange={(v) => setFormField('is_active', v)} label={form.is_active !== false ? 'Active' : 'Inactive'} />
            </FormField>
          </div>

          {kbTarget && (
            <div style={{ marginTop: '16px' }}>
              <DialogVirtualKeyboard onKeyPress={kbAppend} onBackspace={kbBackspace} onClear={kbClear} onEnter={handleSave} onClose={() => setKbTarget(null)} />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button onClick={closeDialog} disabled={saving}
              style={{ padding: '10px 20px', backgroundColor: colors.grey, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '16px' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '10px 24px', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', opacity: saving ? 0.7 : 1 }}>
              <Save size={16} />{saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) { setDeleteId(null); setDeleteError(null) } }}>
        <DialogContent style={{ width: KIOSK_DLG_CONFIRM_W, maxWidth: '100%', maxHeight: KIOSK_DLG_MAX_H }}>
          <DialogHeader>
            <DialogTitle>Delete Reference</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <div style={{ marginBottom: '20px' }}>
            <p style={{ color: colors.text, fontSize: '16px', marginBottom: '10px' }}>
              Are you sure you want to delete this reference?
            </p>
            {deleteTarget && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '12px 16px', borderRadius: '8px',
                backgroundColor: colors.errorBg, border: `1px solid ${colors.error}`,
              }}>
                <Barcode size={20} color={colors.error} style={{ flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '16px', letterSpacing: '0.05em', color: colors.error }}>
                    {deleteTarget.name}
                  </div>
                  {deleteTarget.description && (
                    <div style={{ fontSize: '13px', color: colors.textSecondary, marginTop: '2px' }}>
                      {deleteTarget.description}
                    </div>
                  )}
                  {deleteTarget.vision_program_id != null && (
                    <div style={{ fontSize: '13px', color: colors.textSecondary, marginTop: '2px' }}>
                      Vision program #{deleteTarget.vision_program_id} will also be deleted
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {deleteError && <div style={{ backgroundColor: colors.errorBg, color: colors.error, padding: '10px', borderRadius: '6px', marginBottom: '14px', border: `1px solid ${colors.error}` }}>{deleteError}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button onClick={() => { setDeleteId(null); setDeleteError(null) }} disabled={deleting}
              style={{ padding: '10px 20px', backgroundColor: colors.grey, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '16px' }}>
              Cancel
            </button>
            <button onClick={handleDelete} disabled={deleting}
              style={{ padding: '10px 24px', backgroundColor: colors.error, color: 'white', border: 'none', borderRadius: '8px', cursor: deleting ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: 'bold', opacity: deleting ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trash2 size={16} />{deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  const { colors } = useTheme()
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
        {label}{required && <span style={{ color: colors.error, marginLeft: 2 }}>*</span>}
        {hint && (
          <span style={{ fontSize: '12px', fontWeight: 400, color: colors.textSecondary, marginLeft: '4px' }}>
            — {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  )
}
