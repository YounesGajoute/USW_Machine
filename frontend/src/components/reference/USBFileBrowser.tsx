import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { KIOSK_DLG_MAX_H_TALL, KIOSK_DLG_PAGE_W } from '@/lib/kioskDialogSizing'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { FileText, Folder, RefreshCw, Home, ChevronRight } from 'lucide-react'

/**
 * Generic file-browser dialog.
 *
 * Bring your own file-system callbacks; the component handles navigation
 * state, breadcrumbs, and selection.
 *
 * Usage (USB):
 *   <USBFileBrowser
 *     open={showBrowser}
 *     onClose={() => setShowBrowser(false)}
 *     onSelectFile={(path, name, content) => handleFile(content)}
 *     listFiles={async (dir) => usbApi.listFiles(dir, '.csv')}
 *     readFile={async (path) => usbApi.readFile(path)}
 *     rootPath="/media/usb0"
 *     rootLabel="USB Drive"
 *   />
 *
 * Usage (local):
 *   <USBFileBrowser
 *     open={open}
 *     onClose={onClose}
 *     onSelectFilePath={(path, name) => setPath(path)}
 *     listFiles={async (dir) => localApi.listFiles(dir)}
 *     rootPath="/var/data/references"
 *     selectPathOnly
 *   />
 */
export interface BrowseFile {
  name: string
  path: string
  size: number
  modified: string
  isDirectory?: boolean
}

export interface USBFileBrowserProps {
  open: boolean
  onClose: () => void
  /** Called with file path, name, and file content (if readFile is provided). */
  onSelectFile?: (path: string, name: string, content: string) => void
  /** Called with just path + name when selectPathOnly=true. */
  onSelectFilePath?: (path: string, name: string) => void
  /** Returns the list of files/folders for a given directory path. */
  listFiles: (directory: string) => Promise<BrowseFile[]>
  /** Returns file content for a given path. Not needed when selectPathOnly=true. */
  readFile?: (path: string) => Promise<string>
  rootPath: string
  rootLabel?: string
  title?: string
  fileExtension?: string
  selectPathOnly?: boolean
}

const SYSTEM_PATTERNS = [
  /^System Volume Information$/i, /^\$RECYCLE\.BIN$/i, /^\.Trashes$/i,
  /^\./, /^Thumbs\.db$/i, /^\.DS_Store$/i, /^desktop\.ini$/i,
]

function isSystem(name: string) {
  return SYSTEM_PATTERNS.some(p => p.test(name))
}

export function USBFileBrowser({
  open,
  onClose,
  onSelectFile,
  onSelectFilePath,
  listFiles,
  readFile,
  rootPath,
  rootLabel = 'Root',
  title = 'Select File',
  fileExtension,
  selectPathOnly = false,
}: USBFileBrowserProps) {
  const { colors } = useTheme()
  const [currentDir, setCurrentDir] = useState(rootPath)
  const [files, setFiles] = useState<BrowseFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setCurrentDir(rootPath); setFiles([]); setError(null) }
  }, [open, rootPath])

  useEffect(() => {
    if (open && currentDir) loadFiles()
  }, [currentDir, open])

  const loadFiles = async () => {
    try {
      setLoading(true); setError(null)
      const result = await listFiles(currentDir)
      const filtered = result.filter(f => !isSystem(f.name))
      setFiles(filtered)
      if (filtered.length === 0) setError(`No ${fileExtension ?? ''} files found here`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files')
      setFiles([])
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = async (file: BrowseFile) => {
    if (file.isDirectory) { setCurrentDir(file.path); return }
    if (selectPathOnly && onSelectFilePath) { onSelectFilePath(file.path, file.name); onClose(); return }
    if (!onSelectFile) return
    try {
      setLoading(true); setError(null)
      const content = readFile ? await readFile(file.path) : ''
      onSelectFile(file.path, file.name, content)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file')
    } finally {
      setLoading(false)
    }
  }

  const navigateUp = () => {
    if (currentDir === rootPath) return
    const parent = currentDir.split('/').slice(0, -1).join('/') || rootPath
    setCurrentDir(parent.length < rootPath.length ? rootPath : parent)
  }

  const breadcrumbs = (): string[] => {
    if (currentDir === rootPath) return [rootLabel]
    const rel = currentDir.replace(rootPath, '').split('/').filter(Boolean)
    return [rootLabel, ...rel]
  }

  const fmtSize = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`
  const fmtDate = (s: string) => { try { return new Date(s).toLocaleString() } catch { return s } }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent style={{ width: KIOSK_DLG_PAGE_W, maxWidth: '100%', maxHeight: KIOSK_DLG_MAX_H_TALL, overflowY: 'auto' }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Browse and select a file{fileExtension ? ` (${fileExtension})` : ''}</DialogDescription>
        </DialogHeader>

        {error && (
          <div style={{ backgroundColor: colors.errorBg, color: colors.error, padding: '10px 14px', borderRadius: '6px', marginBottom: '14px', border: `1px solid ${colors.error}` }}>
            {error}
          </div>
        )}

        {/* Navigation bar */}
        <div style={{ backgroundColor: colors.grey, padding: '12px 16px', borderRadius: '6px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', color: colors.textSecondary }}>{rootLabel}</span>
            <button onClick={loadFiles} disabled={loading}
              style={{ padding: '6px 12px', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', opacity: loading ? 0.6 : 1 }}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <button onClick={() => setCurrentDir(rootPath)} disabled={currentDir === rootPath || loading}
              style={{ padding: '4px 8px', backgroundColor: currentDir === rootPath ? colors.primary : 'transparent', color: currentDir === rootPath ? 'white' : colors.text, border: `1px solid ${currentDir === rootPath ? colors.primary : colors.border}`, borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
              <Home size={13} />
            </button>
            {currentDir !== rootPath && (
              <button onClick={navigateUp} disabled={loading}
                style={{ padding: '4px 8px', backgroundColor: 'transparent', color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
                ↑ Up
              </button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}>
              {breadcrumbs().map((crumb, i, arr) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '12px', color: colors.textSecondary }}>{crumb}</span>
                  {i < arr.length - 1 && <ChevronRight size={13} color={colors.textSecondary} />}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* File list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: colors.textSecondary }}>Loading files…</div>
        ) : files.length === 0 ? (
          <div style={{ backgroundColor: colors.grey, padding: '40px', borderRadius: '8px', textAlign: 'center', color: colors.textSecondary, border: `2px dashed ${colors.border}` }}>
            <FileText size={42} style={{ marginBottom: '12px', opacity: 0.4 }} />
            <p style={{ fontSize: '14px', margin: 0 }}>No files found</p>
          </div>
        ) : (
          <div className={KIOSK_TOUCH_SCROLL_CLASS} style={{ border: `1px solid ${colors.border}`, borderRadius: '8px', maxHeight: '380px', overflowY: 'auto', ...touchScrollable }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: colors.grey, borderBottom: `2px solid ${colors.border}` }}>
                  {['Name', 'Size', 'Modified', 'Action'].map(h => (
                    <th key={h} style={{ padding: '12px', textAlign: h === 'Action' ? 'center' : 'left', color: colors.text, fontWeight: 'bold', fontSize: '13px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map((file, idx) => (
                  <tr key={file.path}
                    style={{ borderBottom: idx < files.length - 1 ? `1px solid ${colors.border}` : 'none', backgroundColor: idx % 2 === 0 ? colors.white : colors.rowAltBg }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.rowHoverBg }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = idx % 2 === 0 ? colors.white : colors.rowAltBg }}>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {file.isDirectory ? <Folder size={18} color="#f59e0b" /> : <FileText size={18} color={colors.primary} />}
                        <span style={{ fontWeight: 500, fontSize: '14px' }}>{file.name}</span>
                        {file.isDirectory && <span style={{ fontSize: '11px', color: colors.textSecondary }}>(folder)</span>}
                      </div>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: colors.textSecondary, fontSize: '13px' }}>{file.isDirectory ? '—' : fmtSize(file.size)}</td>
                    <td style={{ padding: '12px', color: colors.textSecondary, fontSize: '13px' }}>{fmtDate(file.modified)}</td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <button onClick={() => handleSelect(file)} disabled={loading}
                        style={{ padding: '7px 18px', backgroundColor: file.isDirectory ? '#f59e0b' : colors.primary, color: 'white', border: 'none', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 'bold', opacity: loading ? 0.6 : 1 }}>
                        {file.isDirectory ? 'Open' : 'Select'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button onClick={onClose} disabled={loading}
            style={{ padding: '10px 20px', backgroundColor: colors.grey, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
