import { useEffect, useState } from 'react'
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

  useEffect(() => {
    void loadGeneralTools().then(t => setTools(t.length ? t : DEFAULT_VISION_TOOLS))
    settingsApi.getSystemSettings().then(s => {
      if (s.vision_general_tool_template?.tools?.length) {
        setTools(s.vision_general_tool_template.tools)
        setMeta(s.vision_general_tool_template)
      }
    }).catch(() => {})
    void listVisionToolTemplates().then(setTemplates).catch(() => setTemplates([]))
  }, [])

  const handleSaveTemplate = async () => {
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
      onMessage(`General template "${name}" saved on vision Pi`)
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

  return (
    <div>
      <p style={{ marginTop: 0, color: colors.textSecondary, fontSize: 14 }}>
        Shared template — any program can use it. No reference image stored in the template.
      </p>
      <VisionToolsEditor
        imageB64={imageB64}
        tools={tools}
        onToolsChange={setTools}
        selectedToolId={selectedToolId}
        onSelectToolId={setSelectedToolId}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16, alignItems: 'center' }}>
        <button type="button" disabled={busy} onClick={() => void handleSaveTemplate()} style={btnStyle}>
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
