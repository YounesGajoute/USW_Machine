import { useCallback, useEffect, useState } from 'react'
import { Cable } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { Button } from '@/components/ui/Button'
import { settingsApi } from '@/services/settingsApi'
import { apiFetch } from '@/services/apiClient'
import type { CentringConfig, CentringTransport } from '@/types/settings.types'

const DEFAULT_TCP = { host: '192.168.10.55', port: 8177 }
const DEFAULT_SERIAL = { baudRate: 115200 }

function normalizeTransport(value: unknown): CentringTransport {
  return value === 'serial' ? 'serial' : 'tcp'
}

export function CentringConnectionSetting() {
  const { colors } = useTheme()
  const [transport, setTransport] = useState<CentringTransport>('tcp')
  const [tcpHost, setTcpHost] = useState(DEFAULT_TCP.host)
  const [tcpPort, setTcpPort] = useState(String(DEFAULT_TCP.port))
  const [serialBaud, setSerialBaud] = useState(String(DEFAULT_SERIAL.baudRate))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const settings = await settingsApi.getSystemSettings(true)
      const cfg = settings.centring_config ?? {}
      setTransport(normalizeTransport(cfg.transport))
      setTcpHost(String(cfg.tcp?.host ?? DEFAULT_TCP.host))
      setTcpPort(String(cfg.tcp?.port ?? DEFAULT_TCP.port))
      setSerialBaud(String(cfg.serial?.baudRate ?? DEFAULT_SERIAL.baudRate))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load centring connection settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!success) return
    const id = window.setTimeout(() => setSuccess(null), 3000)
    return () => window.clearTimeout(id)
  }, [success])

  const buildPatch = (): CentringConfig => {
    const port = Number(tcpPort)
    const baudRate = Number(serialBaud)
    if (transport === 'tcp' && (!tcpHost.trim() || !Number.isFinite(port) || port < 1)) {
      throw new Error('TCP host and port (1–65535) are required')
    }
    if (transport === 'serial' && (!Number.isFinite(baudRate) || baudRate < 300)) {
      throw new Error('Serial baud rate must be at least 300')
    }
    return {
      transport,
      tcp: { host: tcpHost.trim(), port },
      serial: { baudRate },
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setTestResult(null)
    try {
      const patch = buildPatch()
      await settingsApi.updateSystemSettings({ centring_config: patch })
      setSuccess('Centring connection settings saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      await save()
      const res = await apiFetch('/api/centring/ping')
      const data = (await res.json()) as { ok?: boolean; error?: string; target?: string }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Ping failed (${res.status})`)
      }
      setTestResult(`Connected — ${data.target ?? 'PONG'}`)
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
      description="Choose how the master talks to the centring Nano. TCP uses ENC28J60 (centring_nano firmware). USB serial uses centring_nano_motor firmware."
    >
      {error && (
        <div
          role="alert"
          style={{
            marginBottom: '12px',
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colors.errorBg,
            color: colors.error,
            border: `1px solid ${colors.error}`,
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          style={{
            marginBottom: '12px',
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colors.successBg,
            color: colors.successDark,
            border: `1px solid ${colors.success}`,
            fontSize: '14px',
          }}
        >
          {success}
        </div>
      )}
      {testResult && (
        <div
          role="status"
          style={{
            marginBottom: '12px',
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colors.successBg,
            color: colors.successDark,
            fontSize: '14px',
          }}
        >
          {testResult}
        </div>
      )}

      <fieldset disabled={loading || saving || testing} style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: '8px', color: colors.text }}>Transport</legend>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="centring-transport"
            checked={transport === 'tcp'}
            onChange={() => setTransport('tcp')}
          />
          TCP (Ethernet) — 192.168.10.55:8177
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="centring-transport"
            checked={transport === 'serial'}
            onChange={() => setTransport('serial')}
          />
          USB serial
        </label>
      </fieldset>

      {transport === 'tcp' ? (
        <>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', color: colors.text }}>Host</label>
          <input
            type="text"
            value={loading ? '…' : tcpHost}
            onChange={e => setTcpHost(e.target.value)}
            style={fieldStyle}
          />
          <label style={{ display: 'block', fontWeight: 600, margin: '12px 0 6px', color: colors.text }}>Port</label>
          <input
            type="number"
            min={1}
            max={65535}
            value={loading ? '' : tcpPort}
            onChange={e => setTcpPort(e.target.value)}
            style={fieldStyle}
          />
        </>
      ) : (
        <>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', color: colors.text }}>Baud rate</label>
          <input
            type="number"
            min={300}
            value={loading ? '' : serialBaud}
            onChange={e => setSerialBaud(e.target.value)}
            style={fieldStyle}
          />
          <p style={{ margin: '10px 0 0', fontSize: '13px', color: colors.textSecondary, lineHeight: 1.45 }}>
            USB device path is set on the server in <code>CENTRING_SERIAL_PATH</code> (use a{' '}
            <code>/dev/serial/by-path/…</code> symlink for stable naming). Flash <strong>centring_nano_motor</strong>{' '}
            on the Nano.
          </p>
        </>
      )}

      <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Button variant="primary" size="md" onClick={() => void save()} disabled={loading || saving || testing}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        <Button variant="secondary" size="md" onClick={() => void testConnection()} disabled={loading || saving || testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
      </div>
    </SettingsSectionCard>
  )
}
