import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchMachineInitStatus,
  runProductionStart,
  runMachineSetup,
  notifyReferenceLoaded,
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

  const refresh = useCallback(async () => {
    try {
      const snap = await fetchMachineInitStatus()
      setStatus(snap)
      if (snap.productionRunning) {
        setIsProductionRunning(true)
      } else if (!productionLockRef.current) {
        setIsProductionRunning(false)
      }
      return snap
    } catch {
      setStatus(null)
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
      if (!referenceId || productionLockRef.current) return false
      productionLockRef.current = true
      setIsProductionRunning(true)
      if (!opts?.silent) setProductionError(null)
      try {
        const snap = await runProductionStart(referenceId, { requireButton: false })
        setStatus(snap)
        setProductionError(null)
        return true
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Production sequence failed'
        if (!opts?.silent) setProductionError(msg)
        await refresh()
        return false
      } finally {
        setIsProductionRunning(false)
        productionLockRef.current = false
      }
    },
    [referenceId, refresh],
  )

  const setMaintenance = useCallback(
    async (next: { active?: boolean; target?: MaintenanceTarget | null }) => {
      try {
        const snap = await setMaintenanceMode(next)
        setStatus(snap)
        return true
      } catch {
        await refresh()
        return false
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
    if (referenceId && machineOperationsEnabled) {
      void notifyReferenceLoaded(referenceId).then(() => refresh())
    }
  }, [referenceId, refresh, machineOperationsEnabled])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh, referenceId])

  useEffect(() => {
    const running = status?.productionRunning === true
    if (running && !prevProductionRunningRef.current && !productionLockRef.current && machineOperationsEnabled) {
      onProductionStarted?.()
    }
    prevProductionRunningRef.current = running
  }, [status?.productionRunning, onProductionStarted, machineOperationsEnabled])

  const initialized =
    !!referenceId &&
    (status?.initialized === true ||
      (status?.referenceId === referenceId && status?.initialized))

  const needsInitialization = !!referenceId && !initialized

  const lifecycleState: LifecycleState | null =
    parseLifecycleState(status?.lifecycleState) ??
    (needsInitialization ? LIFECYCLE_STATE.INIT : LIFECYCLE_STATE.IDLE)

  const isLifecycleRunning =
    status?.isProductionActive === true ||
    status?.productionRunning === true ||
    lifecycleState === LIFECYCLE_STATE.RUN ||
    lifecycleState === LIFECYCLE_STATE.CYCLE_START ||
    lifecycleState === LIFECYCLE_STATE.PRECHECK

  const setupInProgress = status?.setupInProgress ?? status?.initInProgress ?? false
  const canRunSetup =
    status?.canRunSetup ?? status?.canInitialize ?? status?.canRecover ?? false

  return {
    status,
    initialized,
    needsInitialization,
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
    setupMode: status?.setupMode ?? null,
    setupBlockReason: status?.setupBlockReason ?? status?.initBlockReason ?? null,
    recoveryBlockReason: status?.recoveryBlockReason ?? null,
    pnozCircuitRestored: status?.pnozCircuitRestored ?? false,
    initButtonPressed: status?.initButton ?? false,
    startButtonPressed: status?.startButton ?? false,
    canStartProduction: status?.canEnqueueProduction ?? status?.canStartProduction ?? false,
    productionPhase: status?.productionPhase ?? null,
    queueDepth: status?.queueDepth ?? 0,
    isSafetyLockout: status?.isSafetyLockout ?? false,
    safetyRootCause: status?.safetyRootCause ?? null,
    activeFault: status?.activeFault ?? null,
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
