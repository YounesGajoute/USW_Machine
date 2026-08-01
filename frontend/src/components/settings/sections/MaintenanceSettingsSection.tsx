import { useCallback, useEffect, useRef, useState } from 'react'
import { Wrench, Lightbulb, Wind, Activity } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useSyncPageFeedback } from '@/hooks/useSyncPageFeedback'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { useMachineInitialization } from '@/hooks/useMachineInitialization'
import { useMachineOperationAccess } from '@/hooks/useMachineOperationAccess'
import { PanelControlCard } from '@/components/main/PanelControlCard'
import {
  runHardwareTest,
  fetchIoSnapshot,
  setMaintenanceMode as postMaintenanceMode,
  type IoSnapshot,
} from '@/services/machineInitApi'

/** Mount generation — local only; backend uses opaque clientSession for ownership. */
let _maintenanceSessionGen = 0

function newMaintenanceClientSession() {
  return `maint-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Fire-and-forget leave for section unmount / pagehide (M-8).
 * Must not await ECM-heavy responses; keepalive may outlive the document.
 * Session-stamped so a stale leave cannot clear a newer mount's enable.
 */
function fireLeaveMaintenance(clientSession: string) {
  try {
    void postMaintenanceMode(
      { active: false, clientSession },
      { keepalive: true },
    ).catch(() => {
      /* best effort — EtherCAT shutdown is last-resort clear */
    })
  } catch {
    /* ignore */
  }
}

const TOWER_TESTS: Array<{ key: 'red' | 'green' | 'yellow' | 'buzzer'; label: string }> = [
  { key: 'red', label: 'Red' },
  { key: 'green', label: 'Green' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'buzzer', label: 'Buzzer' },
]

const PNEUMATIC_TESTS: Array<{
  key: 'clampRight' | 'clampLeft' | 'leverUp' | 'ppClamp' | 'puller'
  label: string
}> = [
  { key: 'clampRight', label: 'Clamp Right' },
  { key: 'clampLeft', label: 'Clamp Left' },
  { key: 'leverUp', label: 'Lever Up' },
  { key: 'ppClamp', label: 'P&P Clamp' },
  { key: 'puller', label: 'Puller' },
]

const DI_LABELS: Record<number, string> = {
  0: 'DI0 Init button',
  1: 'DI1 Start button',
  3: 'DI3 PNOZ feedback',
  5: 'DI5 Door right 2',
  6: 'DI6 Door right 1',
  7: 'DI7 Door back',
  8: 'DI8 Air pressure',
  9: 'DI9 Clamp left trigger',
  10: 'DI10 Clamp right trigger',
  15: 'DI15 E-stop button',
}

const DO_LABELS: Record<number, string> = {
  0: 'DO0 Clamp Right',
  1: 'DO1 Clamp Left',
  2: 'DO2 Lever Up',
  3: 'DO3 P&P Clamp',
  4: 'DO4 Puller',
  5: 'DO5 Main Air',
  6: 'DO6 ESTOP CH2',
  7: 'DO7 Tower Red',
  8: 'DO8 Lighting',
  9: 'DO9 PNOZ Reset',
  10: 'DO10 Tower Green',
  11: 'DO11 Tower Yellow',
  12: 'DO12 Buzzer',
  13: 'DO13 Init LED',
  14: 'DO14 Start LED',
  15: 'DO15 ARM evo500',
}

export default function MaintenanceSettingsSection() {
  const { colors } = useTheme()
  // Nav already requires settings_maintenance (or Bypass). Operate when machine ops allowed.
  const { canOperateMachine } = useMachineOperationAccess()
  const { maintenance, panel, setMaintenance, status, refresh } = useMachineInitialization({
    referenceId: null,
    machineOperationsEnabled: canOperateMachine,
  })

  const active = maintenance?.active === true
  const connected = status?.connected === true
  const disabled = !canOperateMachine
  const testsDisabled = disabled || !active || !connected
  const setMaintenanceRef = useRef(setMaintenance)
  setMaintenanceRef.current = setMaintenance

  const [tower, setTower] = useState({ red: false, green: false, yellow: false, buzzer: false })
  const [leds, setLeds] = useState({ init: false, start: false })
  const [valves, setValves] = useState({
    clampRight: false,
    clampLeft: false,
    leverUp: false,
    ppClamp: false,
    puller: false,
  })
  const [io, setIo] = useState<IoSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useSyncPageFeedback(null, error)

  // Enter maintenance for the lifetime of this mount. Leave is fire-and-forget
  // + session-stamped so congested ECM / `connected` flickers cannot orphan mode ON
  // or let a stale disable clear a newer enter (M-3 / M-8).
  useEffect(() => {
    if (!canOperateMachine) return undefined

    const sessionGen = ++_maintenanceSessionGen
    const clientSession = newMaintenanceClientSession()
    const enableAbort = new AbortController()
    let cancelled = false

    if (connected) {
      void (async () => {
        const result = await setMaintenanceRef.current(
          { active: true, clientSession },
          { signal: enableAbort.signal },
        )
        if (cancelled || _maintenanceSessionGen !== sessionGen || result.aborted) return
        if (!result.ok) {
          setError(result.error ?? 'Cannot enable maintenance mode.')
        }
      })()
    }

    const onPageHide = () => {
      enableAbort.abort()
      fireLeaveMaintenance(clientSession)
    }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onPageHide)

    return () => {
      cancelled = true
      enableAbort.abort()
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onPageHide)
      // Do NOT await — and do NOT re-enable after leave (that raced under ECM congestion).
      fireLeaveMaintenance(clientSession)
    }
  }, [canOperateMachine, connected])

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      try {
        // Bound hardware-test wait so a congested bridge cannot lock the HMI forever.
        await Promise.race([
          fn(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Hardware test timed out — EtherCAT may be congested')), 10000)
          }),
        ])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Hardware test failed')
      } finally {
        setBusy(false)
        void refresh()
      }
    },
    [refresh],
  )

  const applyTower = (next: typeof tower) => {
    setTower(next)
    void run(() => runHardwareTest({ tower: next }))
  }

  const applyLeds = (next: typeof leds) => {
    setLeds(next)
    void run(() =>
      runHardwareTest({ buttonLeds: { init: next.init ? 'on' : 'off', start: next.start ? 'on' : 'off' } }),
    )
  }

  const applyValves = (next: typeof valves) => {
    setValves(next)
    void run(() => runHardwareTest({ pneumatics: next }))
  }

  const clearAll = () => {
    setTower({ red: false, green: false, yellow: false, buzzer: false })
    setLeds({ init: false, start: false })
    void run(() => runHardwareTest({ clear: true }))
  }

  const readIo = () => void run(async () => setIo(await fetchIoSnapshot()))

  const pillStyle = (on: boolean): React.CSSProperties => ({
    cursor: testsDisabled ? 'not-allowed' : 'pointer',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '14px',
    fontWeight: 600,
    border: `2px solid ${on ? colors.primary : colors.border}`,
    backgroundColor: on ? colors.primary : colors.white,
    color: on ? 'white' : colors.text,
    opacity: testsDisabled ? 0.55 : 1,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <SettingsSectionCard
        title="Maintenance mode & panel buttons"
        icon={Wrench}
        description="Hardware tests and panel remapping (requires settings_maintenance)"
      >
        {!connected ? (
          <p style={{ margin: '0 0 12px', color: colors.error, fontWeight: 600 }}>
            EtherCAT offline
          </p>
        ) : null}
        {error ? (
          <p style={{ margin: '0 0 12px', color: colors.error, fontWeight: 600 }}>{error}</p>
        ) : null}
        <PanelControlCard
          panel={panel}
          maintenance={maintenance}
          onSetMaintenance={(next) => void setMaintenance(next)}
          disabled={disabled || !connected}
        />
      </SettingsSectionCard>

      <SettingsSectionCard title="Indicator tower & button LEDs" icon={Lightbulb}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: colors.textSecondary, marginBottom: 8 }}>
              STATUS TOWER
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {TOWER_TESTS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  disabled={testsDisabled || busy}
                  onClick={() => applyTower({ ...tower, [key]: !tower[key] })}
                  style={pillStyle(tower[key])}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                disabled={testsDisabled || busy}
                onClick={() => applyTower({ red: true, green: true, yellow: true, buzzer: false })}
                style={pillStyle(false)}
              >
                Lamp test
              </button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: colors.textSecondary, marginBottom: 8 }}>
              BUTTON LEDS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                type="button"
                disabled={testsDisabled || busy}
                onClick={() => applyLeds({ ...leds, init: !leds.init })}
                style={pillStyle(leds.init)}
              >
                DI0 LED
              </button>
              <button
                type="button"
                disabled={testsDisabled || busy}
                onClick={() => applyLeds({ ...leds, start: !leds.start })}
                style={pillStyle(leds.start)}
              >
                DI1 LED
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" disabled={testsDisabled || busy} onClick={clearAll} style={pillStyle(false)}>
              Clear lamp/LED overrides
            </button>
          </div>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="Pneumatic valves" icon={Wind}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {PNEUMATIC_TESTS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              disabled={testsDisabled || busy}
              onClick={() => applyValves({ ...valves, [key]: !valves[key] })}
              style={pillStyle(valves[key])}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={testsDisabled || busy}
            onClick={() =>
              applyValves({ clampRight: false, clampLeft: false, leverUp: false, ppClamp: false, puller: false })
            }
            style={pillStyle(false)}
          >
            All off
          </button>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="I/O diagnostics" icon={Activity}>
        <button
          type="button"
          disabled={disabled || !connected || busy}
          onClick={readIo}
          style={{ ...pillStyle(false), opacity: disabled || !connected ? 0.55 : 1, cursor: disabled || !connected ? 'not-allowed' : 'pointer' }}
        >
          Read I/O
        </button>
        {io && io.ok ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '14px' }}>
            <IoColumn title="Inputs (DI)" values={io.inputs ?? null} labels={DI_LABELS} colors={colors} />
            <IoColumn title="Outputs (DO)" values={io.outputs ?? null} labels={DO_LABELS} colors={colors} />
          </div>
        ) : io && !io.ok ? (
          <p style={{ color: colors.error, marginTop: 12 }}>{io.error ?? 'I/O read failed'}</p>
        ) : null}
      </SettingsSectionCard>

    </div>
  )
}

function IoColumn({
  title,
  values,
  labels,
  colors,
}: {
  title: string
  values: number[] | null
  labels: Record<number, string>
  colors: ReturnType<typeof useTheme>['colors']
}) {
  return (
    <div>
      <div style={{ fontSize: '13px', fontWeight: 700, color: colors.textSecondary, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {values == null
          ? <span style={{ color: colors.textSecondary }}>—</span>
          : values.map((v, i) => {
              const on = !!v
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    fontSize: '13px',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    backgroundColor: on ? `${colors.success}22` : colors.background,
                    color: colors.text,
                  }}
                >
                  <span>{labels[i] ?? `#${i}`}</span>
                  <span style={{ fontWeight: 700, color: on ? colors.success : colors.textSecondary }}>
                    {on ? '1' : '0'}
                  </span>
                </div>
              )
            })}
      </div>
    </div>
  )
}
