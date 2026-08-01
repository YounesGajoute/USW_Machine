import { useCallback, useEffect, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { DEFAULT_VISION_TOOLS } from '@/lib/defaultVisionTools'
import { loadGeneralTools } from '@/lib/referenceToolConfig'
import { createVisionToolTemplate, listVisionToolTemplates, runVisionWithTemplate } from '@/services/visionService'
import { settingsApi } from '@/services/settingsApi'
import type { VisionGeneralToolTemplate } from '@/types/settings.types'
import type { VisionTool, VisionToolTemplate } from '@/types/vision.types'
import { VisionToolsEditor } from './VisionToolsEditor'

interface GeneralTemplateTabProps {
  programId: number | null
  imageB64: string | null
  busy: boolean
  setBusy: (v: boolean) => void
  onMessage: (msg: string) => void
  onError: (msg: string) => void
}

export function GeneralTemplateTab({
  programId,
  imageB64,
  busy,
  setBusy,
  onMessage,
  onError,
}: GeneralTemplateTabProps) {
  const { colors } = useTheme()
  const [tools, setTools] = useState<VisionTool[]>(DEFAULT_VISION_TOOLS)
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [meta, setMeta] = useState<VisionGeneralToolTemplate | null>(null)
  const [templates, setTemplates] = useState<VisionToolTemplate[]>([])
  const [loadTemplateId, setLoadTemplateId] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  const loadSettings = useCallback(async () => {
    setLoadError(null)
    setSettingsLoaded(false)
    try {
      const s = await settingsApi.getSystemSettings(true)
      if (s.vision_general_tool_template?.tools?.length) {
        setTools(s.vision_general_tool_template.tools)
        setMeta(s.vision_general_tool_template)
      } else if (Object.prototype.hasOwnProperty.call(s, 'vision_general_tool_template')) {
        // Server returned the key (empty/null) — OK to edit; display defaults until first save.
        const local = await loadGeneralTools()
        setTools(local.length ? local : DEFAULT_VISION_TOOLS)
      } else {
        // Key omitted (e.g. public subset / failed auth view) — do not allow Save of client defaults.
        throw new Error('Vision general template unavailable')
      }
      setSettingsLoaded(true)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load vision template settings')
      onError(e instanceof Error ? e.message : 'Could not load vision template settings')
    }
  }, [onError])

  useEffect(() => {
    void loadSettings()
    void listVisionToolTemplates().then(setTemplates).catch(() => setTemplates([]))
  }, [loadSettings])

  const handleSaveTemplate = async () => {
    if (!settingsLoaded || loadError) {
      onError(loadError || 'Cannot save until settings load succeeds')
      return
    }
    setBusy(true)
    onError('')
    try {
      const name = meta?.name ?? 'General'
      const tpl = await createVisionToolTemplate({
        name,
        description: meta?.description ?? 'Site-wide default tool configuration',
        tools,
      })
      const templateId = typeof tpl.id === 'number' ? tpl.id : undefined
      const next: VisionGeneralToolTemplate = {
        name,
        description: meta?.description ?? 'Site-wide default tool configuration',
        template_id: templateId ?? meta?.template_id,
        tools,
      }
      await settingsApi.updateSystemSettings({ vision_general_tool_template: next })
      setMeta(next)
      onMessage(`General template "${name}" saved`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const handleLoadTemplate = () => {
    const tpl = templates.find(t => String(t.id) === loadTemplateId)
    if (tpl?.tools?.length) {
      setTools(tpl.tools)
      onMessage(`Loaded template "${tpl.name}"`)
    }
  }

  const handleRunWithTemplate = async () => {
    if (programId == null || !meta?.template_id) {
      onError('Select a program and save the general template first')
      return
    }
    setBusy(true)
    onError('')
    try {
      const result = await runVisionWithTemplate(meta.template_id, programId)
      onMessage(`run-with-template: ${result.result}`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setBusy(false)
    }
  }

  const btnStyle = {
    padding: '12px 20px',
    borderRadius: 8,
    border: 'none',
    backgroundColor: colors.primary,
    color: '#fff',
    fontWeight: 700,
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.55 : 1,
  }

  if (loadError) {
    return (
      <div>
        <p style={{ marginTop: 0, color: colors.textSecondary, fontSize: 14 }}>
          {loadError}
        </p>
        <button type="button" disabled={busy} onClick={() => void loadSettings()} style={btnStyle}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <VisionToolsEditor
        imageB64={imageB64}
        programId={programId}
        tools={tools}
        onToolsChange={setTools}
        selectedToolId={selectedToolId}
        onSelectToolId={setSelectedToolId}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16, alignItems: 'center' }}>
        <button
          type="button"
          disabled={busy || !settingsLoaded || !!loadError}
          onClick={() => void handleSaveTemplate()}
          style={btnStyle}
        >
          Save as template
        </button>
        <select
          value={loadTemplateId}
          onChange={e => setLoadTemplateId(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: `1px solid ${colors.border}`, minWidth: 180 }}
        >
          <option value="">Load template…</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={busy || !loadTemplateId} onClick={handleLoadTemplate} style={{ ...btnStyle, backgroundColor: colors.success }}>
          Load onto canvas
        </button>
        {programId != null && meta?.template_id != null && (
          <button type="button" disabled={busy} onClick={() => void handleRunWithTemplate()} style={btnStyle}>
            Run with template (program #{programId})
          </button>
        )}
      </div>
    </div>
  )
}
