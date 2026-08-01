import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { useSyncPageFeedback } from '@/hooks/useSyncPageFeedback'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { Switch } from '@/components/ui/Switch'
import { Button } from '@/components/ui/Button'
import { LanguageSelector } from '@/components/settings/LanguageSelector'
import { useLocale } from '@/contexts/LocaleContext'
import { settingsApi, type SystemSettings } from '@/services/settingsApi'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { KIOSK_DLG_COMPACT_W, KIOSK_DLG_MAX_H } from '@/lib/kioskDialogSizing'
import { Globe, LogIn, Clock, Palette, Cpu } from 'lucide-react'
import { ThemeAppearancePicker } from '@/components/settings/ThemeAppearancePicker'
import { MachineModelPicker } from '@/components/settings/MachineModelPicker'
import type { MachineModel } from '@/types/settings.types'
import { readStoredMachineModel, writeStoredMachineModel } from '@/lib/machineModelStorage'
import { isDarkTheme } from '@/lib/themePalettes'

function toLocalDatetimeInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const cardStyle = { padding: '12px 14px 14px' } as const

export default function GeneralSettingsSection() {
  const { colors, theme } = useTheme()
  const { general, locale } = useLocale()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Pick<SystemSettings, 'require_login' | 'machine_model'>>({
    require_login: false,
    machine_model: readStoredMachineModel() ?? undefined,
  })
  const [currentTime, setCurrentTime] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  useSyncPageFeedback(success, error ?? loadError)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [datetimeInput, setDatetimeInput] = useState('')
  const [savingTime, setSavingTime] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [pendingModel, setPendingModel] = useState<MachineModel | null>(null)
  const [modelSaving, setModelSaving] = useState(false)

  const notifySaved = () => {
    setError(null)
    setSuccess(general.saved)
  }
  const notifyError = (msg: string) => setError(msg)

  const busy = settingsSaving || modelSaving

  const formattedTime = useMemo(() => {
    if (!currentTime) return null
    const d = new Date(currentTime)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    })
  }, [currentTime, locale])

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setSuccess(null)
    try {
      const data = await settingsApi.getSystemSettings(true)
      const apiModel = data.machine_model as MachineModel | undefined
      setSettings({
        require_login: !!data.require_login,
        machine_model: apiModel ?? readStoredMachineModel() ?? undefined,
      })
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : general.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [general.loadFailed])

  const refreshClock = useCallback(async () => {
    try {
      const t = await settingsApi.getSystemTime()
      if (t.current_time) {
        setCurrentTime(prev => (prev === t.current_time ? prev : t.current_time!))
      }
    } catch {
      const fallback = new Date().toISOString()
      setCurrentTime(prev => {
        if (!prev) return fallback
        const prevMs = new Date(prev).getTime()
        const nextMs = new Date(fallback).getTime()
        if (Number.isNaN(prevMs) || Number.isNaN(nextMs)) return fallback
        // Avoid churn when local fallback is within the same displayed second.
        return Math.abs(nextMs - prevMs) < 1000 ? prev : fallback
      })
    }
  }, [])

  useEffect(() => {
    void loadSettings()
    void refreshClock()
  }, [loadSettings, refreshClock])

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshClock()
    }, 10_000)
    return () => window.clearInterval(id)
  }, [refreshClock])

  useEffect(() => {
    if (!success) return
    const id = window.setTimeout(() => setSuccess(null), 3000)
    return () => window.clearTimeout(id)
  }, [success])

  const patchSettings = async (partial: Partial<SystemSettings>) => {
    setError(null)
    setSettings(prev => ({ ...prev, ...partial }))
    setSettingsSaving(true)
    try {
      await settingsApi.updateSystemSettings(partial)
      setSuccess(general.saved)
    } catch (e) {
      const msg = e instanceof Error ? e.message : general.saveFailed
      setError(msg === 'not_authenticated' ? general.notAuthenticated : msg)
      await loadSettings()
    } finally {
      setSettingsSaving(false)
    }
  }

  const requestModelChange = (model: MachineModel) => {
    if (model === settings.machine_model || busy) return
    setPendingModel(model)
    setError(null)
  }

  const applyModelChange = async () => {
    if (!pendingModel) return
    const model = pendingModel
    setModelSaving(true)
    setError(null)
    setSettings(prev => ({ ...prev, machine_model: model }))
    try {
      await writeStoredMachineModel(model)
      setPendingModel(null)
      setSuccess(general.machineModelSaved)
    } catch (e) {
      const msg = e instanceof Error ? e.message : general.saveFailed
      setError(msg === 'not_authenticated' ? general.notAuthenticated : msg)
      await loadSettings()
    } finally {
      setModelSaving(false)
    }
  }

  const openTimeDialog = () => {
    setDatetimeInput(toLocalDatetimeInput(currentTime || new Date().toISOString()))
    setError(null)
    setDialogOpen(true)
  }

  const applyTime = async () => {
    if (!datetimeInput) return
    const parsed = new Date(datetimeInput)
    if (Number.isNaN(parsed.getTime())) {
      setError(general.invalidDateTime)
      return
    }
    setSavingTime(true)
    setError(null)
    try {
      const iso = parsed.toISOString()
      const res = await settingsApi.setSystemTime(iso)
      if (res.status !== 'success') {
        throw new Error(res.message || general.timeFailed)
      }
      setSuccess(general.timeSet)
      setDialogOpen(false)
      await refreshClock()
    } catch (e) {
      setError(e instanceof Error ? e.message : general.timeFailed)
    } finally {
      setSavingTime(false)
    }
  }

  const pendingModelLabel =
    pendingModel === 'STCS-CS19'
      ? general.machineModelCS19
      : pendingModel === 'STCS-evo500'
        ? general.machineModelEvo500
        : ''

  if (loading) {
    return (
      <div style={{ padding: '24px', color: colors.textSecondary }}>
        {general.loading}
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ padding: '24px', maxWidth: '560px' }}>
        <h2 style={{ fontSize: '26px', fontWeight: 700, color: colors.text, margin: '0 0 16px' }}>
          {general.pageTitle}
        </h2>
        <Button variant="primary" size="md" onClick={() => void loadSettings()}>
          {general.retry}
        </Button>
      </div>
    )
  }

  return (
    <div style={{ padding: 0, width: '100%', boxSizing: 'border-box' }}>
      <h2
        style={{
          fontSize: '22px',
          fontWeight: 700,
          color: colors.text,
          margin: '0 0 12px',
          letterSpacing: '-0.02em',
        }}
      >
        {general.pageTitle}
      </h2>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '10px',
        }}
      >
        <SettingsSectionCard
          title={general.machineModel}
          icon={Cpu}
          style={{ ...cardStyle, gridColumn: '1 / -1' }}
        >
          <MachineModelPicker
            value={settings.machine_model as MachineModel | undefined}
            onChange={requestModelChange}
            disabled={busy}
          />
        </SettingsSectionCard>

        <SettingsSectionCard title={general.language} icon={Globe} style={cardStyle}>
          <LanguageSelector onSaved={notifySaved} onError={notifyError} />
        </SettingsSectionCard>

        <SettingsSectionCard title={general.theme} icon={Palette} style={cardStyle}>
          <ThemeAppearancePicker onSaved={notifySaved} onError={notifyError} />
        </SettingsSectionCard>

        <SettingsSectionCard title={general.login} icon={LogIn} style={cardStyle}>
          <Switch
            checked={!!settings.require_login}
            onChange={checked => void patchSettings({ require_login: checked })}
            disabled={busy}
            label={general.requireLogin}
          />
        </SettingsSectionCard>

        <SettingsSectionCard title={general.dateTime} icon={Clock} style={cardStyle}>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: colors.text, marginBottom: '6px' }}>
              {general.currentTime}
            </div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: colors.primary,
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {formattedTime ?? general.loadingTime}
            </div>
          </div>
          <Button variant="primary" size="md" onClick={openTimeDialog} disabled={busy}>
            {general.setDateTime}
          </Button>
        </SettingsSectionCard>
      </div>

      <Dialog
        open={pendingModel !== null}
        onOpenChange={open => {
          if (!open && !modelSaving) setPendingModel(null)
        }}
      >
        <DialogContent style={{ width: KIOSK_DLG_COMPACT_W, maxWidth: '100%', maxHeight: KIOSK_DLG_MAX_H }}>
          <DialogHeader>
            <DialogTitle>{general.machineModelConfirmTitle}</DialogTitle>
          </DialogHeader>
          <div
            style={{
              marginTop: '12px',
              marginBottom: '20px',
              fontSize: '18px',
              fontWeight: 700,
              color: colors.text,
            }}
          >
            {pendingModelLabel}
          </div>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setPendingModel(null)}
              disabled={modelSaving}
            >
              {general.cancel}
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => void applyModelChange()}
              disabled={modelSaving || !pendingModel}
            >
              {modelSaving ? general.loading : general.apply}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent style={{ width: KIOSK_DLG_COMPACT_W, maxWidth: '100%', maxHeight: KIOSK_DLG_MAX_H }}>
          <DialogHeader>
            <DialogTitle>{general.dialogTitle}</DialogTitle>
          </DialogHeader>
          <input
            type="datetime-local"
            value={datetimeInput}
            onChange={e => setDatetimeInput(e.target.value)}
            style={{
              width: '100%',
              marginTop: '12px',
              marginBottom: '20px',
              padding: '16px 14px',
              minHeight: 52,
              fontSize: '18px',
              borderRadius: '10px',
              border: `2px solid ${colors.border}`,
              backgroundColor: colors.white,
              color: colors.text,
              colorScheme: isDarkTheme(theme) ? 'dark' : 'light',
              boxSizing: 'border-box',
              touchAction: 'manipulation',
            }}
          />
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="lg" onClick={() => setDialogOpen(false)} disabled={savingTime}>
              {general.cancel}
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => void applyTime()}
              disabled={savingTime || !datetimeInput}
            >
              {savingTime ? general.loading : general.apply}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
