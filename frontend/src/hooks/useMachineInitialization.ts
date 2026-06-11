import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchMachineInitStatus,
  runProductionStart,
  notifyReferenceLoaded,
  type MachineInitStatus,
} from '@/services/machineInitApi'

const POLL_MS = 250

export interface UseMachineInitializationOptions {
  referenceId: string | null
  /** Called when production starts (DI1 panel or HMI Start). */
  onProductionStarted?: () => void
}

export function useMachineInitialization({
  referenceId,
  onProductionStarted,
}: UseMachineInitializationOptions) {
  const [status, setStatus] = useState<MachineInitStatus | null>(null)
  const [productionError, setProductionError] = useState<string | null>(null)
  const [isProductionRunning, setIsProductionRunning] = useState(false)
  const productionLockRef = useRef(false)
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

  useEffect(() => {
    if (referenceId) {
      void notifyReferenceLoaded(referenceId).then(() => refresh())
    }
  }, [referenceId, refresh])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh, referenceId])

  useEffect(() => {
    const running = status?.productionRunning === true
    // DI1 panel start — sync HMI; skip when this client triggered production via HMI Start
    if (running && !prevProductionRunningRef.current && !productionLockRef.current) {
      onProductionStarted?.()
    }
    prevProductionRunningRef.current = running
  }, [status?.productionRunning, onProductionStarted])

  const initialized =
    !!referenceId &&
    (status?.initialized === true ||
      (status?.referenceId === referenceId && status?.initialized))

  const needsInitialization = !!referenceId && !initialized

  return {
    status,
    initialized,
    needsInitialization,
    initError: null,
    productionError,
    isInitializing: status?.initInProgress ?? false,
    isProductionRunning,
    initButtonPressed: status?.initButton ?? false,
    startButtonPressed: status?.startButton ?? false,
    canStartProduction: status?.canStartProduction ?? false,
    productionPhase: status?.productionPhase ?? null,
    startProduction,
    refresh,
  }
}
