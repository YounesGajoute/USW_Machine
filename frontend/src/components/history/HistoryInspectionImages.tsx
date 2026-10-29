import { useEffect, useState } from 'react'
import { apiFetch } from '@/services/apiClient'
import { useTheme } from '@/contexts/ThemeContext'

function SavedImage({ runId, kind, title }: { runId: string; kind: string; title: string }) {
  const { colors } = useTheme()
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    setSrc(null)
    setFailed(false)
    void apiFetch(`/api/history/${encodeURIComponent(runId)}/images/${kind}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Image unavailable')
        const blob = await response.blob()
        if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setSrc(url) }
      }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [runId, kind])
  return <figure style={{ margin: 0, minWidth: 0 }}>
    <figcaption style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{title}</figcaption>
    {src && !failed ? <img src={src} alt={`${title} for selected test`} onError={() => setFailed(true)} style={{ width: '100%', height: 220, objectFit: 'contain' }} />
      : <div role="status" style={{ padding: '32px 12px', color: colors.textSecondary, background: colors.background, fontSize: 13 }}>{failed ? 'Image unavailable for this saved test.' : 'Loading saved image…'}</div>}
  </figure>
}

export function HistoryInspectionImages({ runId }: { runId: string }) {
  return <section aria-label="Saved inspection images" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 20 }}>
    <SavedImage key={`${runId}-weld`} runId={runId} kind="welding_splice" title="Welding splice" />
    <SavedImage key={`${runId}-tube`} runId={runId} kind="heat_shrink_tube" title="Heat-shrink tube" />
    <SavedImage key={`${runId}-product`} runId={runId} kind="product" title="Full-product overlay" />
  </section>
}
