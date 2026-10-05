import { useState, useEffect, useMemo, useCallback, type ReactNode, type CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Eye, Image, Wrench, Layers, RotateCcw } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useSyncPageFeedback } from '@/hooks/useSyncPageFeedback'
import { useAccessibleTabKeys } from '@/hooks/useAccessibleTabKeys'
import { useAuth } from '@/hooks/useAuth'
import { useActiveReference } from '@/contexts/ActiveReferenceContext'
import {
  canVisionSubTab,
  hasVisionSettingsAccess,
  VISION_SETTINGS_TAB_KEYS,
} from '@/lib/roleTabAccess'
import { hasMinRole } from '@/types/auth.types'
import { Switch } from '@/components/ui/Switch'
import { settingsApi } from '@/services/settingsApi'
import { checkVisionReachable, fetchMasterImage, recoverVisionCamera } from '@/services/visionService'
import { extractImageB64 } from '@/lib/visionWizard'
import { MasterImageTab } from '@/components/settings/vision/MasterImageTab'
import { ToolConfigurationTab } from '@/components/settings/vision/ToolConfigurationTab'
import { GeneralTemplateTab } from '@/components/settings/vision/GeneralTemplateTab'

type VisionTab = 'master' | 'tools' | 'general'

const noop = () => {}

function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { colors } = useTheme()
  return (
    <div
      style={{
        backgroundColor: colors.white,
        borderRadius: 10,
        border: `1px solid ${colors.border}`,
        padding: 20,
        color: colors.text,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export default function VisionSettingsSection() {
  const { colors } = useTheme()
  const { user } = useAuth()
  const { tabs: accessTabs, loading: accessLoading } = useAccessibleTabKeys()
  const { activeReference, visionProgramId } = useActiveReference()

  const can = useCallback(
    (key: (typeof VISION_SETTINGS_TAB_KEYS)[number]) => {
      if (accessLoading) return false
      return canVisionSubTab(accessTabs, key, user?.role)
    },
    [user?.role, accessTabs, accessLoading],
  )

  const hasVisionAccess = useMemo(() => {
    if (accessLoading) return false
    return hasVisionSettingsAccess(accessTabs, user?.role)
  }, [accessTabs, accessLoading, user?.role])

  const subTabs = useMemo(() => {
    if (!hasVisionAccess) return []
    const defs: { id: VisionTab; label: string; icon: LucideIcon; key: (typeof VISION_SETTINGS_TAB_KEYS)[number] }[] = [
      { id: 'master', label: 'Master image', icon: Image, key: 'settings_vision_master' },
      { id: 'tools', label: 'Tool configuration', icon: Wrench, key: 'settings_vision_tools' },
      { id: 'general', label: 'General template', icon: Layers, key: 'settings_vision_general' },
    ]
    return defs.filter(t => can(t.key))
  }, [hasVisionAccess, can])

  const [activeTab, setActiveTab] = useState<VisionTab>('master')
  const [busy, setBusy] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [visionOnline, setVisionOnline] = useState<boolean | null>(null)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [sharedMasterB64, setSharedMasterB64] = useState<string | null>(null)
  /** Bump after master-image register so Tool configuration reloads canvas/params. */
  const [toolsRefreshToken, setToolsRefreshToken] = useState(0)
  const canEditCaptureOnly = hasMinRole(user, 'ADMIN')
  const [visionProductionCaptureOnly, setVisionProductionCaptureOnly] = useState(false)
  const [savingVisionProductionCaptureOnly, setSavingVisionProductionCaptureOnly] = useState(false)
  useSyncPageFeedback(
    banner?.kind === 'ok' ? banner.text : null,
    banner?.kind === 'err' ? banner.text : null,
  )

  const programId = visionProgramId
  const visionConfigured = programId != null && activeReference != null

  const statusColor =
    visionOnline === true ? colors.success : visionOnline === false ? colors.error : colors.textSecondary

  useEffect(() => {
    if (subTabs.length > 0 && !subTabs.some(t => t.id === activeTab)) {
      setActiveTab(subTabs[0].id)
    }
  }, [subTabs, activeTab])

  const refreshVisionOnline = useCallback(() => {
    checkVisionReachable().then(setVisionOnline).catch(() => setVisionOnline(false))
  }, [])

  const setBannerMsg = useCallback((text: string) => {
    setBanner({ kind: 'ok', text })
  }, [])

  const setBannerErr = useCallback((text: string) => {
    if (!text) {
      setBanner(null)
      return
    }
    setBanner({ kind: 'err', text })
  }, [])

  useEffect(() => {
    refreshVisionOnline()
  }, [refreshVisionOnline])

  useEffect(() => {
    if (!canEditCaptureOnly) return
    let cancelled = false
    void settingsApi
      .getSystemSettings(true)
      .then(settings => {
        if (cancelled) return
        setVisionProductionCaptureOnly(settings.vision_production_capture_only ?? false)
      })
      .catch(() => {
        /* keep default false */
      })
    return () => {
      cancelled = true
    }
  }, [canEditCaptureOnly])

  const handleVisionProductionCaptureOnlyChange = useCallback(
    async (checked: boolean) => {
      const previousValue = visionProductionCaptureOnly
      try {
        setSavingVisionProductionCaptureOnly(true)
        setBanner(null)
        setVisionProductionCaptureOnly(checked)
        await settingsApi.updateSystemSettings({ vision_production_capture_only: checked })
        const settings = await settingsApi.getSystemSettings(true)
        setVisionProductionCaptureOnly(settings.vision_production_capture_only ?? false)
      } catch (err) {
        setVisionProductionCaptureOnly(previousValue)
        setBanner({
          kind: 'err',
          text:
            err instanceof Error
              ? err.message
              : 'Failed to save vision production capture-only setting',
        })
      } finally {
        setSavingVisionProductionCaptureOnly(false)
      }
    },
    [visionProductionCaptureOnly],
  )

  const handleRecoverCamera = async () => {
    setRecovering(true)
    setBanner(null)
    try {
      const data = await recoverVisionCamera()
      const ok = data.ok !== false && data.success !== false
      if (ok) {
        setBanner({
          kind: 'ok',
          text: 'Camera recovered on the vision Pi (live feeds stopped, pipeline restarted, test capture OK).',
        })
      } else {
        const err =
          (typeof data.error === 'string' && data.error) ||
          (typeof data.message === 'string' && data.message) ||
          'Recover reported failure'
        setBanner({ kind: 'err', text: err })
      }
      refreshVisionOnline()
    } catch (e) {
      setBanner({
        kind: 'err',
        text: e instanceof Error ? e.message : 'Camera recover failed',
      })
    } finally {
      setRecovering(false)
    }
  }

  useEffect(() => {
    if (programId == null) {
      setSharedMasterB64(null)
      return
    }
    void fetchMasterImage(programId)
      .then(data => setSharedMasterB64(extractImageB64(data as Record<string, unknown>)))
      .catch(() => setSharedMasterB64(null))
  }, [programId])

  if (!hasVisionAccess) {
    return (
      <Panel>
        <p style={{ margin: 0 }}>Permission denied</p>
      </Panel>
    )
  }

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: banner ? 10 : 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: `${colors.primary}1A`,
          }}
        >
          <Eye size={24} color={colors.primary} />
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: colors.text }}>Vision</h2>
          {visionOnline != null && (
            <span
              title={visionOnline ? 'Online' : 'Offline'}
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                backgroundColor: statusColor,
                flexShrink: 0,
                boxShadow: `0 0 0 2px ${statusColor}33`,
              }}
            />
          )}
        </div>
        </div>
        <button
          type="button"
          disabled={recovering || visionOnline === false}
          onClick={() => void handleRecoverCamera()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.white,
            color: colors.text,
            fontWeight: 600,
            fontSize: 14,
            cursor: recovering || visionOnline === false ? 'not-allowed' : 'pointer',
            opacity: recovering || visionOnline === false ? 0.55 : 1,
          }}
        >
          <RotateCcw size={16} />
          {recovering ? 'Recovering…' : 'Recover camera'}
        </button>
      </div>

      {canEditCaptureOnly && (
        <Panel style={{ marginBottom: 16, padding: '16px 20px' }}>
          <label
            style={{
              display: 'block',
              marginBottom: 8,
              fontSize: 14,
              fontWeight: 600,
              color: colors.text,
            }}
          >
            Vision production capture only
          </label>
          <Switch
            checked={visionProductionCaptureOnly}
            onChange={handleVisionProductionCaptureOnlyChange}
            disabled={savingVisionProductionCaptureOnly}
            label="Capture and save images on Vision Pi (no PASS/FAIL)"
          />
        </Panel>
      )}

      {subTabs.length > 0 && (
        <div
          role="tablist"
          style={{
            display: 'inline-flex',
            flexWrap: 'wrap',
            gap: 4,
            marginBottom: 16,
            padding: 5,
            borderRadius: 12,
            backgroundColor: colors.grey,
            border: `1px solid ${colors.border}`,
          }}
        >
          {subTabs.map(tab => {
            const Icon = tab.icon
            const on = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: on ? 700 : 500,
                  backgroundColor: on ? colors.white : 'transparent',
                  color: on ? colors.primary : colors.text,
                  boxShadow: on ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            )
          })}
        </div>
      )}

      <div>
        {!visionConfigured && activeTab !== 'general' ? null : (
          <>
            {activeTab === 'master' && can('settings_vision_master') && (
              <Panel>
                <MasterImageTab
                  programId={programId}
                  busy={busy}
                  setBusy={setBusy}
                  onMessage={noop}
                  onError={noop}
                  onMasterImageChange={setSharedMasterB64}
                  onRegistered={() => setToolsRefreshToken(t => t + 1)}
                />
              </Panel>
            )}

            {activeTab === 'tools' && can('settings_vision_tools') && (
              <Panel style={{ padding: '12px 14px' }}>
                <ToolConfigurationTab
                  programId={programId}
                  busy={busy}
                  setBusy={setBusy}
                  onMessage={setBannerMsg}
                  onError={setBannerErr}
                  refreshToken={toolsRefreshToken}
                />
              </Panel>
            )}

            {activeTab === 'general' && can('settings_vision_general') && (
              <Panel>
                <GeneralTemplateTab
                  programId={programId}
                  imageB64={sharedMasterB64}
                  busy={busy}
                  setBusy={setBusy}
                  onMessage={noop}
                  onError={noop}
                />
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  )
}