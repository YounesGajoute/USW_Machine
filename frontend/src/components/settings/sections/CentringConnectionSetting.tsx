import { useCallback, useEffect, useState } from 'react'
import { Cable } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useSyncPageFeedback } from '@/hooks/useSyncPageFeedback'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { Button } from '@/components/ui/Button'
import { NumericKeypad } from '@/components/ui/NumericKeypad'
import { settingsApi } from '@/services/settingsApi'
import { apiFetch } from '@/services/apiClient'
import type { CentringConfig } from '@/types/settings.types'

const DEFAULT_TCP = { host: '192.168.10.55', port: 8177 }

export function CentringConnectionSetting() {
  const { colors } = useTheme()
  const [tcpHost, setTcpHost] = useState(DEFAULT_TCP.host)
  const [tcpPort, setTcpPort] = useState(String(DEFAULT_TCP.port))
  const [effectiveTarget, setEffectiveTarget] = useState<string | null>(null)
  const [envOverridesUi, setEnvOverridesUi] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [portKeypadOpen, setPortKeypadOpen] = useState(false)
  useSyncPageFeedback(success ?? testResult, error ?? loadError)

  const refreshConnectionInfo = useCallback(async () => {
    try {
      const res = await apiFetch('/api/centring/connection')
      if (!res.ok) return
      const data = (await res.json()) as {
        target?: string
        host?: string
        port?: number
      }
      if (data.target) setEffectiveTarget(data.target)
      const uiHost = tcpHost.trim()
      const uiPort = Number(tcpPort)
      if (data.host && data.port != null) {
        setEnvOverridesUi(
          data.host !== uiHost || Number(data.port) !== uiPort,
        )
      }
    } catch {
      /* ignore */
    }
  }, [tcpHost, tcpPort])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoadError(null)
    try {
      const settings = await settingsApi.getSystemSettings(true)
      if (!settings.centring_config || typeof settings.centring_config !== 'object') {
        throw new Error('Centring configuration unavailable')
      }
      const cfg = settings.centring_config
      setTcpHost(String(cfg.tcp?.host ?? DEFAULT_TCP.host))
      setTcpPort(String(cfg.tcp?.port ?? DEFAULT_TCP.port))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load centring connection settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (loading || loadError) return
    void refreshConnectionInfo()
  }, [loading, loadError, refreshConnectionInfo])

  useEffect(() => {
    if (!success) return
    const id = window.setTimeout(() => setSuccess(null), 3000)
    return () => window.clearTimeout(id)
  }, [success])

  const buildPatch = (): CentringConfig => {
    const port = Number(tcpPort)
    if (
      !tcpHost.trim()
      || !Number.isFinite(port)
      || !Number.isInteger(port)
      || port < 1
      || port > 65535
    ) {
      throw new Error('TCP host and port (1–65535) are required')
    }
    return {
      transport: 'tcp',
      tcp: { host: tcpHost.trim(), port },
    }
  }

  const save = async (): Promise<boolean> => {
    if (loadError) return false
    setSaving(true)
    setError(null)
    setTestResult(null)
    try {
      const patch = buildPatch()
      await settingsApi.updateSystemSettings({ centring_config: patch })
      setSuccess('Centring connection settings saved')
      await refreshConnectionInfo()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      return false
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      const saved = await save()
      if (!saved) return
      const res = await apiFetch('/api/centring/ping')
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        target?: string
        sessionRemote?: string
        localPort?: number | null
        cal?: boolean | null
        estop?: boolean | null
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Ping failed (${res.status})`)
      }
      const shown = data.sessionRemote || data.target || `${tcpHost}:${tcpPort}`
      const portNote = data.localPort != null ? ` via local :${data.localPort}` : ''
      const calNote = data.cal === false
        ? ' — cal=0 (SETCAL required before MOVE)'
        : data.cal === true
          ? ' — cal=1'
          : ''
      setTestResult(`Connected — STATUS OK (${shown}${portNote})${calNote}`)
      await refreshConnectionInfo()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  const fieldStyle = {
    width: '100%',
    maxWidth: '320px',
    padding: '10px 12px',
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    fontSize: '15px',
    color: colors.text,
    backgroundColor: colors.white,
    boxSizing: 'border-box' as const,
  }

  return (
    <SettingsSectionCard
      title="Centring connection"
      icon={Cable}
      description={
        loadError
          ? 'Could not load configuration from the server. Retry before saving.'
          : 'TCP client to the Double Actuator Centring Nano (cal/SETCAL, keepalive). Default 192.168.10.55:8177.'
      }
    >
      {loadError ? (
        <Button variant="primary" size="md" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Retry'}
        </Button>
      ) : (
        <>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', color: colors.text }}>Host</label>
      <input
        type="text"
        value={loading ? '…' : tcpHost}
        onChange={e => setTcpHost(e.target.value)}
        disabled={loading || saving || testing}
        style={fieldStyle}
      />
      <label style={{ display: 'block', fontWeight: 600, margin: '12px 0 6px', color: colors.text }}>Port</label>
      <input
        type="text"
        inputMode="numeric"
        readOnly
        value={loading ? '…' : tcpPort}
        onClick={() => {
          if (!loading && !saving && !testing) setPortKeypadOpen(true)
        }}
        disabled={loading || saving || testing}
        style={{
          ...fieldStyle,
          cursor: loading || saving || testing ? 'not-allowed' : 'pointer',
          border: `2px solid ${portKeypadOpen ? colors.primary : colors.border}`,
          fontFamily: 'ui-monospace, monospace',
        }}
      />

      <NumericKeypad
        open={portKeypadOpen}
        onOpenChange={setPortKeypadOpen}
        title="TCP port"
        value={Number(tcpPort) || DEFAULT_TCP.port}
        unit=""
        min={1}
        max={65535}
        allowDecimal={false}
        onConfirm={value => setTcpPort(String(Math.round(value)))}
      />

      {effectiveTarget && (
        <p style={{ marginTop: '10px', fontSize: '13px', color: colors.text, opacity: 0.75 }}>
          Effective runtime target: <strong>{effectiveTarget}</strong>
          {envOverridesUi
            ? ' (CENTRING_HOST / CENTRING_PORT env overrides Settings UI)'
            : ''}
        </p>
      )}

      <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Button variant="primary" size="md" onClick={() => void save()} disabled={loading || saving || testing || !!loadError}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        <Button variant="secondary" size="md" onClick={() => void testConnection()} disabled={loading || saving || testing || !!loadError}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
      </div>
        </>
      )}
    </SettingsSectionCard>
  )
}
