import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchMachineInitStatus,
  runProductionStart,
  runMachineSetup,
  setMaintenanceMode,
  type MachineInitStatus,
  type MachineActionError,
  type MaintenanceTarget,
} from '@/services/machineInitApi'
import { isActiveFault } from '@/lib/faultPresentation'
import {
  parseLifecycleState,
  LIFECYCLE_STATE,
  type LifecycleState,
} from '@/types/machineLifecycle.types'

const POLL_MS = 250
/** Keep last-good init-status across brief fetch blips before treating as offline. */
const MAX_CONSECUTIVE_FETCH_FAILURES = 4

/** A single POWER_OFF → INIT precondition (stable id + live pass/fail). */
export interface InitPrecondition {
  id: 'doorRight1' | 'doorRight2' | 'doorBack' | 'airPressure' | 'emergency'
  ok: boolean
}

export interface UseMachineInitializationOptions {
  referenceId: string | null
  /** Called when production starts (DI1 panel or HMI Start). */
  onProductionStarted?: () => void
  /** When false (require_login + unsigned-in), skip reference-loaded sync and panel-driven starts. */
  machineOperationsEnabled?: boolean
}

function applyMachineSnapshot(
  snap: MachineInitStatus,
  setStatus: (s: MachineInitStatus) => void,
  setInitRequestError: (e: string | null) => void,
  setProductionError: (e: string | null) => void,
) {
  setStatus(snap)
  if (isActiveFault(snap.activeFault)) {
    setInitRequestError(null)
  } else {
    setInitRequestError(null)
    setProductionError(null)
  }
}

function snapshotFromActionError(e: unknown): MachineInitStatus | undefined {
  if (e && typeof e === 'object' && 'snapshot' in e) {
    const snap = (e as MachineActionError).snapshot
    if (snap && typeof snap === 'object') return snap
  }
  return undefined
}

export function useMachineInitialization({
  referenceId,
  onProductionStarted,
  machineOperationsEnabled = true,
}: UseMachineInitializationOptions) {
  const [status, setStatus] = useState<MachineInitStatus | null>(null)
  const [productionError, setProductionError] = useState<string | null>(null)
  const [isProductionRunning, setIsProductionRunning] = useState(false)
  const [initRequestError, setInitRequestError] = useState<string | null>(null)
  const productionLockRef = useRef(false)
  const setupLockRef = useRef(false)
  const prevProductionRunningRef = useRef(false)
  const fetchFailStreakRef = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const snap = await fetchMachineInitStatus()
      fetchFailStreakRef.current = 0
      setStatus(snap)
      if (snap.productionRunning) {
        setIsProductionRunning(true)
      } else if (!productionLockRef.current) {
        setIsProductionRunning(false)
      }
      return snap
    } catch {
      fetchFailStreakRef.current += 1
      if (fetchFailStreakRef.current >= MAX_CONSECUTIVE_FETCH_FAILURES) {
        setStatus(null)
      }
      // S2: keep last-good status for a few consecutive failures (transient blips).
      return null
    }
  }, [])

  const reconcileSnapshot = useCallback(
    async (primary?: MachineInitStatus | null) => {
      const snap = primary ?? (await refresh())
      if (snap) {
        applyMachineSnapshot(snap, setStatus, setInitRequestError, setProductionError)
      }
      return snap
    },
    [refresh],
  )

  const startProduction = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!referenceId || productionLockRef.current) {
        return { ok: false as const, cycleResult: null as 'PASS' | 'FAIL' | null }
      }
      productionLockRef.current = true
      setIsProductionRunning(true)
      if (!opts?.silent) setProductionError(null)
      try {
        const snap = await runProductionStart(referenceId, { requireButton: false })
        setStatus(snap)
        setProductionError(null)
        const cycleResult =
          snap.cycleResult === 'PASS' || snap.cycleResult === 'FAIL'
            ? snap.cycleResult
            : snap.lastJob?.cycleResult === 'PASS' || snap.lastJob?.cycleResult === 'FAIL'
              ? snap.lastJob.cycleResult
              : ('PASS' as const)
        return {
          ok: true as const,
          cycleResult,
          jobId: snap.jobId ?? snap.lastJob?.jobId ?? null,
          phases: snap.phases,
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Production sequence failed'
        if (!opts?.silent) setProductionError(msg)
        const snap = await refresh()
        const cycleResult =
          snap?.lastJob?.cycleResult === 'PASS' || snap?.lastJob?.cycleResult === 'FAIL'
            ? snap.lastJob.cycleResult
            : ('FAIL' as const)
        return {
          ok: false as const,
          cycleResult,
          jobId: snap?.lastJob?.jobId ?? null,
          error: msg,
        }
      } finally {
        setIsProductionRunning(false)
        productionLockRef.current = false
      }
    },
    [referenceId, refresh],
  )

  const setMaintenance = useCallback(
    async (
      next: { active?: boolean; target?: MaintenanceTarget | null; clientSession?: string | null },
      opts?: { signal?: AbortSignal; keepalive?: boolean },
    ) => {
      try {
        const snap = await setMaintenanceMode(next, opts)
        if (snap.lifecycleState != null) {
          setStatus(snap)
        } else if (snap.maintenance != null) {
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  maintenance: snap.maintenance ?? prev.maintenance,
                  connected: snap.connected ?? prev.connected,
                }
              : prev,
          )
        }
        return { ok: true as const, ignoredStaleDisable: snap.ignoredStaleDisable === true }
      } catch (e) {
        if (opts?.signal?.aborted) {
          return { ok: false as const, error: 'aborted', aborted: true as const }
        }
        if (!opts?.keepalive) {
          await refresh()
        }
        const error = e instanceof Error ? e.message : 'Maintenance mode update failed'
        return { ok: false as const, error }
      }
    },
    [refresh],
  )

  const setup = useCallback(async () => {
    if (setupLockRef.current) return false
    setupLockRef.current = true
    setInitRequestError(null)
    try {
      const snap = await runMachineSetup(referenceId ?? undefined, { requireButton: false })
      const fresh = await reconcileSnapshot(snap)
      return fresh ? !isActiveFault(fresh.activeFault) : false
    } catch (e) {
      const fromError = snapshotFromActionError(e)
      const fresh = await reconcileSnapshot(fromError)
      if (!fresh) {
        const msg = e instanceof Error ? e.message : 'Setup failed'
        setInitRequestError(msg)
      }
      return false
    } finally {
      setupLockRef.current = false
    }
  }, [referenceId, reconcileSnapshot])

  /** @deprecated Use setup() */
  const initialize = setup
  /** @deprecated Use setup() */
  const recover = setup

  useEffect(() => {
    let cancelled = false
    let intervalId: number | undefined

    const boot = async () => {
      if (!cancelled) await refresh()
      if (cancelled) return
      intervalId = window.setInterval(() => void refresh(), POLL_MS)
    }

    void boot()
    return () => {
      cancelled = true
      if (intervalId !== undefined) window.clearInterval(intervalId)
    }
  }, [refresh, referenceId])

  useEffect(() => {
    const running = status?.productionRunning === true
    if (running && !prevProductionRunningRef.current && !productionLockRef.current && machineOperationsEnabled) {
      onProductionStarted?.()
    }
    prevProductionRunningRef.current = running
  }, [status?.productionRunning, onProductionStarted, machineOperationsEnabled])

  const machineInitialized = status?.machineInitialized === true

  const lifecycleState: LifecycleState | null =
    parseLifecycleState(status?.lifecycleState) ??
    (machineInitialized ? LIFECYCLE_STATE.IDLE : LIFECYCLE_STATE.INIT)

  // "Ready to start production": the backend only enters RUN when the machine is
  // initialized AND a reference is loaded. Also accept the legacy per-reference flag
  // (setup run with a reference already scanned).
  const initialized =
    lifecycleState === LIFECYCLE_STATE.RUN ||
    (!!referenceId && status?.initialized === true)

  // The machine needs Initialization whenever it is not physically initialized.
  const needsInitialization = !machineInitialized

  // RUN is a resting ready state, NOT a running cycle — exclude it here.
  const isLifecycleRunning =
    status?.isProductionActive === true ||
    status?.productionRunning === true ||
    lifecycleState === LIFECYCLE_STATE.CYCLE_START ||
    lifecycleState === LIFECYCLE_STATE.PRECHECK

  const setupInProgress = status?.setupInProgress ?? status?.initInProgress ?? false
  const setupPhase = setupInProgress ? (status?.setupPhase ?? null) : null
  const canRunSetup =
    status?.canRunSetup ?? status?.canInitialize ?? status?.canRecover ?? false

  // Live POWER_OFF → INIT preconditions (model doors closed, DI8 air, DI15 emergency).
  // null while EtherCAT is disconnected (no live safety inputs).
  const initPreconditions: InitPrecondition[] | null =
    status && status.connected !== false
      ? (() => {
          const items: InitPrecondition[] = [
            { id: 'doorRight1', ok: status.doorRight1Open === false },
            { id: 'doorRight2', ok: status.doorRight2Open === false },
          ]
          if (status.doorInterlockModel === true) {
            items.push({ id: 'doorBack', ok: status.doorBackOpen === false })
          }
          items.push({ id: 'airPressure', ok: status.airPressureOk === true })
          items.push({ id: 'emergency', ok: status.emergencyOk === true })
          return items
        })()
      : null
  const initPreconditionsMet =
    initPreconditions != null && initPreconditions.every((p) => p.ok)

  return {
    status,
    initialized,
    machineInitialized,
    needsInitialization,
    initPreconditions,
    initPreconditionsMet,
    lifecycleState,
    isLifecycleRunning,
    initError: initRequestError ?? status?.lastError ?? null,
    productionError,
    isInitializing: setupInProgress,
    isRecovering: status?.recoveryInProgress ?? setupInProgress,
    isProductionRunning: isProductionRunning || isLifecycleRunning,
    connected: status?.connected ?? false,
    canInitialize: canRunSetup,
    canRecover: status?.canRecover ?? canRunSetup,
    canRunSetup,
    setupInProgress,
    setupPhase,
    setupMode: status?.setupMode ?? null,
    setupBlockReason: status?.setupBlockReason ?? status?.initBlockReason ?? null,
    recoveryBlockReason: status?.recoveryBlockReason ?? null,
    pnozCircuitRestored: status?.pnozCircuitRestored ?? false,
    initButtonPressed: status?.initButton ?? false,
    startButtonPressed: status?.startButton ?? false,
    canStartProduction: status?.canEnqueueProduction ?? status?.canStartProduction ?? false,
    productionBlockReason: status?.productionBlockReason ?? null,
    clampTriggerMode: status?.clampTriggerMode ?? 'off',
    clampRightTriggered: status?.clampRightTriggered ?? false,
    clampLeftTriggered: status?.clampLeftTriggered ?? false,
    clampRightDi: status?.clampRightDi ?? false,
    clampLeftDi: status?.clampLeftDi ?? false,
    clampInhibitRight: status?.clampInhibitRight ?? false,
    clampInhibitLeft: status?.clampInhibitLeft ?? false,
    productionPhase: status?.productionPhase ?? null,
    queueDepth: status?.queueDepth ?? 0,
    isSafetyLockout: status?.isSafetyLockout ?? false,
    safetyRootCause: status?.safetyRootCause ?? null,
    activeFault: status?.activeFault ?? null,
    lastJob: status?.lastJob ?? null,
    maintenance: status?.maintenance ?? null,
    panel: status?.panel ?? null,
    startProduction,
    setup,
    initialize,
    recover,
    setMaintenance,
    refresh,
  }
}
