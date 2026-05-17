import { useState, useEffect, useMemo, useCallback, type ReactNode, type CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Eye, Image, Wrench, Layers } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useAccessibleTabKeys } from '@/hooks/useAccessibleTabKeys'
import { useAuth } from '@/hooks/useAuth'
import {
  canVisionSubTab,
  hasVisionSettingsAccess,
  VISION_SETTINGS_TAB_KEYS,
} from '@/lib/roleTabAccess'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { checkVisionReachable, fetchMasterImage, fetchVisionPrograms } from '@/services/visionService'
import { extractImageB64 } from '@/lib/visionWizard'
import { VisionProgramSelector } from '@/components/settings/vision/VisionProgramSelector'
import { MasterImageTab } from '@/components/settings/vision/MasterImageTab'
import { ToolConfigurationTab } from '@/components/settings/vision/ToolConfigurationTab'
import { GeneralTemplateTab } from '@/components/settings/vision/GeneralTemplateTab'
import type { VisionProgram } from '@/types/vision.types'

type VisionTab = 'master' | 'tools' | 'general'

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
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [visionOnline, setVisionOnline] = useState<boolean | null>(null)
  const [programs, setPrograms] = useState<VisionProgram[]>([])
  const [programId, setProgramId] = useState<number | null>(null)
  const [sharedMasterB64, setSharedMasterB64] = useState<string | null>(null)

  useEffect(() => {
    if (subTabs.length > 0 && !subTabs.some(t => t.id === activeTab)) {
      setActiveTab(subTabs[0].id)
    }
  }, [subTabs, activeTab])

  useEffect(() => {
    checkVisionReachable().then(setVisionOnline).catch(() => setVisionOnline(false))
    fetchVisionPrograms(true)
      .then(list => {
        setPrograms(list)
        if (list.length > 0 && programId == null) setProgramId(list[0].id)
      })
      .catch(() => setPrograms([]))
  }, [])

  useEffect(() => {
    if (programId == null) {
      setSharedMasterB64(null)
      return
    }
    void fetchMasterImage(programId)
      .then(data => setSharedMasterB64(extractImageB64(data as Record<string, unknown>)))
      .catch(() => setSharedMasterB64(null))
  }, [programId])

  const showMsg = (msg: string) => {
    setStatus(msg)
    setError(null)
    setTimeout(() => setStatus(null), 5000)
  }

  const showErr = (msg: string) => {
    if (!msg) {
      setError(null)
      return
    }
    setError(msg)
    setStatus(null)
  }

  if (!hasVisionAccess) {
    return (
      <Panel>
        <p style={{ margin: 0 }}>You do not have permission to configure vision. Ask an administrator to grant vision tab access.</p>
      </Panel>
    )
  }

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
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
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: colors.text }}>Vision</h2>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: colors.textSecondary }}>
            Remote configuration on vision Pi
            {visionOnline === false && ' · Vision Pi offline'}
            {visionOnline === true && ' · Connected'}
          </p>
        </div>
      </div>

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

      <Panel style={{ marginBottom: 16 }}>
        <VisionProgramSelector
          programs={programs}
          programId={programId}
          onChange={setProgramId}
          disabled={busy}
          optional={activeTab === 'general'}
        />
      </Panel>

      {status && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 8,
            backgroundColor: colors.successBg,
            color: colors.success,
            border: `1px solid ${colors.success}`,
          }}
        >
          {status}
        </div>
      )}
      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 8,
            backgroundColor: colors.errorBg,
            color: colors.error,
            border: `1px solid ${colors.error}`,
          }}
        >
          {error}
        </div>
      )}

      <div
        className={KIOSK_TOUCH_SCROLL_CLASS}
        style={{ ...touchScrollable, maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}
      >
        {activeTab === 'master' && can('settings_vision_master') && (
          <Panel>
            <MasterImageTab
              programId={programId}
              busy={busy}
              setBusy={setBusy}
              onMessage={showMsg}
              onError={showErr}
              onMasterImageChange={setSharedMasterB64}
            />
          </Panel>
        )}

        {activeTab === 'tools' && can('settings_vision_tools') && (
          <Panel>
            <ToolConfigurationTab
              programId={programId}
              busy={busy}
              setBusy={setBusy}
              onMessage={showMsg}
              onError={showErr}
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
              onMessage={showMsg}
              onError={showErr}
            />
          </Panel>
        )}
      </div>
    </div>
  )
}
