import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { formatInspectionMessage } from '@/lib/visionInspection'
import { extractImageB64 } from '@/lib/visionWizard'
import {
  fetchMasterImage,
  fetchVisionPrograms,
  fetchVisionToolTemplateForProgram,
  listVisionToolTemplates,
  saveAndRunVisionInspection,
  saveVisionProgramTools,
} from '@/services/visionService'
import type { VisionTool, VisionToolTemplate } from '@/types/vision.types'
import { VisionToolsEditor } from './VisionToolsEditor'

interface ToolConfigurationTabProps {
  programId: number | null
  busy: boolean
  setBusy: (v: boolean) => void
  onMessage: (msg: string) => void
  onError: (msg: string) => void
}

const GROUP_LABEL: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  margin: 0,
}

export function ToolConfigurationTab({
  programId,
  busy,
  setBusy,
  onMessage,
  onError,
}: ToolConfigurationTabProps) {
  const { colors } = useTheme()
  const [imageB64, setImageB64] = useState<string | null>(null)
  const [tools, setTools] = useState<VisionTool[]>([])
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<VisionToolTemplate[]>([])
  const [applyTemplateId, setApplyTemplateId] = useState('')

  const loadProgramData = useCallback(async () => {
    if (programId == null) return
    onError('')
    try {
      const master = await fetchMasterImage(programId)
      const b64 = extractImageB64(master as Record<string, unknown>)
      if (b64) setImageB64(b64)
    } catch {
      setImageB64(null)
    }
    try {
      const programs = await fetchVisionPrograms(false)
      const prog = programs.find(p => p.id === programId)
      const programTools = prog?.config?.tools
      if (Array.isArray(programTools) && programTools.length > 0) {
        setTools(programTools as VisionTool[])
        setSelectedToolId(null)
        return
      }
    } catch {
      /* keep empty */
    }
    setTools([])
    setSelectedToolId(null)
  }, [programId, onError])

  useEffect(() => {
    void listVisionToolTemplates().then(setTemplates).catch(() => setTemplates([]))
  }, [])

  useEffect(() => {
    if (programId != null) void loadProgramData()
    else {
      setImageB64(null)
      setTools([])
      setSelectedToolId(null)
    }
  }, [programId, loadProgramData])

  const handleSave = async () => {
    if (programId == null) {
      onError('Select a program first')
      return
    }
    setBusy(true)
    onError('')
    try {
      await saveVisionProgramTools(programId, tools)
      onMessage(`Tools saved to program #${programId}`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const handleApplyTemplate = async () => {
    if (programId == null || !applyTemplateId) return
    setBusy(true)
    onError('')
    try {
      const tpl = await fetchVisionToolTemplateForProgram(Number(applyTemplateId), programId)
      if (tpl.tools?.length) {
        setTools(tpl.tools)
        onMessage(`Applied template "${tpl.name}"`)
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Apply template failed')
    } finally {
      setBusy(false)
    }
  }

  const handleRunOnce = async () => {
    if (programId == null) {
      onError('Select a program first')
      return
    }
    if (!imageB64) {
      onError('Register a master image on the Vision Pi before running inspection')
      return
    }
    setBusy(true)
    onError('')
    try {
      const result = await saveAndRunVisionInspection(programId, tools, { includeImage: false })
      if (result.result === 'FAIL' && result.error) {
        onError(result.error)
        return
      }
      onMessage(formatInspectionMessage(result))
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || programId == null
  const groupLabelColor = colors.textSecondary

  const actionBtn: CSSProperties = {
    width: '100%',
    minHeight: 48,
    padding: '10px 14px',
    borderRadius: 10,
    border: 'none',
    fontWeight: 700,
    fontSize: 14,
    lineHeight: 1.2,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    touchAction: 'manipulation',
    boxSizing: 'border-box',
  }

  const editorActions = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 16,
        height: '100%',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ ...GROUP_LABEL, color: groupLabelColor }}>Program</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void handleSave()}
          style={{
            ...actionBtn,
            backgroundColor: colors.primary,
            color: '#fff',
          }}
        >
          Save to program
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void handleRunOnce()}
          style={{
            ...actionBtn,
            backgroundColor: colors.white,
            color: colors.primary,
            border: `2px solid ${colors.primary}`,
          }}
        >
          Save & run once
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          paddingTop: 12,
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        <p style={{ ...GROUP_LABEL, color: groupLabelColor }}>Template</p>
        <select
          value={applyTemplateId}
          onChange={e => setApplyTemplateId(e.target.value)}
          disabled={disabled}
          style={{
            width: '100%',
            minHeight: 48,
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            fontSize: 14,
            backgroundColor: colors.white,
            color: colors.text,
            boxSizing: 'border-box',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.55 : 1,
          }}
        >
          <option value="">Apply template…</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !applyTemplateId || programId == null}
          onClick={() => void handleApplyTemplate()}
          style={{
            ...actionBtn,
            backgroundColor: colors.success,
            color: '#fff',
            opacity: busy || !applyTemplateId || programId == null ? 0.55 : 1,
            cursor: busy || !applyTemplateId || programId == null ? 'not-allowed' : 'pointer',
          }}
        >
          Apply template
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ width: 'fit-content', maxWidth: '100%' }}>
      {!imageB64 && programId != null && (
        <p style={{ color: colors.warning ?? colors.error, marginTop: 0, marginBottom: 12, fontSize: 14 }}>
          No master image for this program — register one under Master image tab.
        </p>
      )}
      <VisionToolsEditor
        key={programId ?? 'no-program'}
        imageB64={imageB64}
        programId={programId}
        tools={tools}
        onToolsChange={setTools}
        selectedToolId={selectedToolId}
        onSelectToolId={setSelectedToolId}
        judgmentPaused={busy}
        actions={editorActions}
      />
    </div>
  )
}
