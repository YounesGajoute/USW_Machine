import { useCallback, useEffect, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { DEFAULT_VISION_TOOLS } from '@/lib/defaultVisionTools'
import { extractImageB64 } from '@/lib/visionWizard'
import {
  fetchMasterImage,
  fetchVisionPrograms,
  fetchVisionToolTemplateForProgram,
  listVisionToolTemplates,
  runVisionInspection,
  updateVisionProgram,
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

export function ToolConfigurationTab({
  programId,
  busy,
  setBusy,
  onMessage,
  onError,
}: ToolConfigurationTabProps) {
  const { colors } = useTheme()
  const [imageB64, setImageB64] = useState<string | null>(null)
  const [tools, setTools] = useState<VisionTool[]>(DEFAULT_VISION_TOOLS)
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
        return
      }
    } catch {
      /* use defaults */
    }
    setTools(DEFAULT_VISION_TOOLS)
  }, [programId, onError])

  useEffect(() => {
    void listVisionToolTemplates().then(setTemplates).catch(() => setTemplates([]))
  }, [])

  useEffect(() => {
    if (programId != null) void loadProgramData()
    else {
      setImageB64(null)
      setTools(DEFAULT_VISION_TOOLS)
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
      const programs = await fetchVisionPrograms(false)
      const existing = programs.find(p => p.id === programId)
      await updateVisionProgram(programId, {
        config: { ...existing?.config, tools },
      })
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
    setBusy(true)
    onError('')
    try {
      const programs = await fetchVisionPrograms(false)
      const existing = programs.find(p => p.id === programId)
      await updateVisionProgram(programId, {
        config: { ...existing?.config, tools },
      })
      const result = await runVisionInspection(programId)
      onMessage(`Inspection: ${result.result}${result.error ? ` — ${result.error}` : ''}`)
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
    cursor: busy || programId == null ? 'not-allowed' : 'pointer',
    opacity: busy || programId == null ? 0.55 : 1,
  }

  return (
    <div>
      {!imageB64 && programId != null && (
        <p style={{ color: colors.warning ?? colors.error, marginTop: 0 }}>
          No master image for this program — register one under Master image tab.
        </p>
      )}
      <VisionToolsEditor
        imageB64={imageB64}
        tools={tools}
        onToolsChange={setTools}
        selectedToolId={selectedToolId}
        onSelectToolId={setSelectedToolId}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16, alignItems: 'center' }}>
        <button type="button" disabled={busy || programId == null} onClick={() => void handleSave()} style={btnStyle}>
          Save to program
        </button>
        <button type="button" disabled={busy || programId == null} onClick={() => void handleRunOnce()} style={btnStyle}>
          Save & run once
        </button>
        <select
          value={applyTemplateId}
          onChange={e => setApplyTemplateId(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: `1px solid ${colors.border}`, minWidth: 180 }}
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
          style={{ ...btnStyle, backgroundColor: colors.success }}
        >
          Apply
        </button>
      </div>
    </div>
  )
}
