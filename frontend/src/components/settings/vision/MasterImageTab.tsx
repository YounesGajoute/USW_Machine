import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { useVisionLiveFeed } from '@/hooks/useVisionLiveFeed'
import {
  applyCaptureMeta,
  detectMimeFromB64,
  extractImageB64,
  type CaptureMeta,
} from '@/lib/visionWizard'
import {
  captureVisionFrame,
  fetchMasterImage,
  registerMasterImage,
} from '@/services/visionService'
import { VisionImageCanvas } from './VisionImageCanvas'

const TOUCH_BTN: CSSProperties = {
  minWidth: 48,
  minHeight: 48,
  padding: '12px 22px',
  borderRadius: 10,
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
  touchAction: 'manipulation',
  userSelect: 'none',
}

interface MasterImageTabProps {
  programId: number | null
  busy: boolean
  setBusy: (v: boolean) => void
  onMessage: (msg: string) => void
  onError: (msg: string) => void
  onMasterImageChange?: (b64: string | null) => void
}

export function MasterImageTab({
  programId,
  busy,
  setBusy,
  onMessage,
  onError,
  onMasterImageChange,
}: MasterImageTabProps) {
  const { colors } = useTheme()
  const [stillB64, setStillB64] = useState<string | null>(null)
  const [stillFormat, setStillFormat] = useState('png')
  const [isRegistered, setIsRegistered] = useState(false)
  const [liveOn, setLiveOn] = useState(true)

  const stillB64Ref = useRef<string | null>(null)
  const stillFormatRef = useRef('png')
  const registeredB64Ref = useRef<string | null>(null)
  const loadGenRef = useRef(0)
  const localDraftRef = useRef(false)

  const onErrorRef = useRef(onError)
  const onMessageRef = useRef(onMessage)
  const onMasterImageChangeRef = useRef(onMasterImageChange)
  onErrorRef.current = onError
  onMessageRef.current = onMessage
  onMasterImageChangeRef.current = onMasterImageChange

  const syncStill = useCallback((b64: string | null) => {
    stillB64Ref.current = b64
    setStillB64(b64)
  }, [])

  const syncFormat = useCallback((fmt: string) => {
    stillFormatRef.current = fmt
    setStillFormat(fmt)
  }, [])

  const liveEnabled = programId != null && liveOn && stillB64 == null
  const { frame: liveFrame } = useVisionLiveFeed(programId, liveEnabled)

  const displayB64 = stillB64 ?? liveFrame
  const registered = isRegistered && stillB64 != null

  const applyStill = useCallback(
    (
      b64: string,
      meta?: CaptureMeta,
      opts?: { fromServer?: boolean; format?: string },
    ) => {
      const fmtRaw = opts?.format ?? meta?.format ?? detectMimeFromB64(b64)
      const mimeFmt = fmtRaw.includes('/') ? fmtRaw.split('/')[1] : fmtRaw
      const normalizedFmt = mimeFmt === 'jpeg' ? 'jpg' : mimeFmt

      syncStill(b64)
      syncFormat(normalizedFmt)
      setLiveOn(false)

      if (opts?.fromServer) {
        registeredB64Ref.current = b64
        localDraftRef.current = false
        setIsRegistered(true)
      } else {
        localDraftRef.current = true
        setIsRegistered(false)
      }
      onMasterImageChangeRef.current?.(b64)
    },
    [syncStill, syncFormat],
  )

  const loadRegistered = useCallback(
    async (pid: number, opts?: { force?: boolean }) => {
      const gen = ++loadGenRef.current
      try {
        const data = await fetchMasterImage(pid)
        if (gen !== loadGenRef.current) return
        if (localDraftRef.current && !opts?.force) return

        const b64 = extractImageB64(data)
        if (b64) {
          const meta = applyCaptureMeta(data)
          const fmt = typeof data.format === 'string' ? data.format : 'png'
          applyStill(b64, meta, { fromServer: true, format: fmt })
        } else {
          registeredB64Ref.current = null
          localDraftRef.current = false
          setIsRegistered(false)
          syncStill(null)
          onMasterImageChangeRef.current?.(null)
        }
      } catch (e) {
        if (gen !== loadGenRef.current) return
        if (localDraftRef.current && !opts?.force) return

        registeredB64Ref.current = null
        localDraftRef.current = false
        setIsRegistered(false)
        syncStill(null)
        onMasterImageChangeRef.current?.(null)

        const msg = e instanceof Error ? e.message : ''
        if (msg && !/404|not found/i.test(msg)) {
          onErrorRef.current(msg)
        }
      }
    },
    [applyStill, syncStill],
  )

  useEffect(() => {
    loadGenRef.current += 1
    localDraftRef.current = false
    syncStill(null)
    syncFormat('png')
    setLiveOn(true)
    setIsRegistered(false)
    registeredB64Ref.current = null
    onErrorRef.current('')

    if (programId != null) {
      void loadRegistered(programId)
    } else {
      onMasterImageChangeRef.current?.(null)
    }
  }, [programId, loadRegistered, syncStill, syncFormat])

  const handleCapture = async () => {
    if (programId == null) {
      onErrorRef.current('Select a program first')
      return
    }
    loadGenRef.current += 1
    setBusy(true)
    onErrorRef.current('')
    try {
      const data = await captureVisionFrame()
      const b64 = extractImageB64(data as Record<string, unknown>)
      if (!b64) throw new Error('No image returned from camera')
      applyStill(b64, applyCaptureMeta(data as Record<string, unknown>), {
        format: typeof data.format === 'string' ? data.format : 'png',
      })
      onMessageRef.current('Frame captured — tap Register to save')
    } catch (e) {
      onErrorRef.current(e instanceof Error ? e.message : 'Capture failed')
    } finally {
      setBusy(false)
    }
  }

  const handleRegister = async () => {
    const pid = programId
    const b64 = stillB64Ref.current
    const fmt = stillFormatRef.current

    if (pid == null) {
      onErrorRef.current('Select a program first')
      return
    }
    if (!b64) {
      onErrorRef.current('Tap Capture first — live preview cannot be registered directly')
      return
    }
    if (registered) return

    setBusy(true)
    onErrorRef.current('')
    onMessageRef.current('Registering master image…')

    try {
      const result = await registerMasterImage(pid, b64, fmt)
      localDraftRef.current = false
      await loadRegistered(pid, { force: true })

      const pathHint = result.path ? ` (${result.path})` : ''
      onMessageRef.current(`Master image registered for program #${pid}${pathHint}`)
    } catch (e) {
      onErrorRef.current(e instanceof Error ? e.message : 'Register failed')
    } finally {
      setBusy(false)
    }
  }

  const resumeLive = useCallback(() => {
    loadGenRef.current += 1
    localDraftRef.current = false
    syncStill(null)
    setLiveOn(true)
    onErrorRef.current('')
    if (isRegistered && registeredB64Ref.current) {
      onMasterImageChangeRef.current?.(registeredB64Ref.current)
    }
  }, [isRegistered, syncStill])

  const controlsDisabled = busy || programId == null
  const registerDisabled = controlsDisabled || !stillB64 || registered

  const btnBase: CSSProperties = {
    ...TOUCH_BTN,
    cursor: controlsDisabled ? 'not-allowed' : 'pointer',
    opacity: controlsDisabled ? 0.55 : 1,
  }

  return (
    <div>
      <VisionImageCanvas imageB64={displayB64} formatHint={stillFormat} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16, alignItems: 'center' }}>
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={() => void handleCapture()}
          style={{ ...btnBase, backgroundColor: '#111', color: '#fff', border: 'none' }}
        >
          Capture
        </button>
        <button
          type="button"
          disabled={registerDisabled}
          onClick={() => void handleRegister()}
          style={{
            ...btnBase,
            backgroundColor: registered ? colors.success : colors.grey,
            color: registered ? '#fff' : colors.text,
            border: registered ? 'none' : `1px solid ${colors.border}`,
            opacity: registerDisabled ? 0.55 : 1,
            cursor: registerDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Registering…' : registered ? 'Registered' : 'Register'}
        </button>
        {stillB64 != null && (
          <button
            type="button"
            disabled={busy}
            onClick={resumeLive}
            style={{
              ...btnBase,
              backgroundColor: colors.white,
              color: colors.primary,
              border: `1px solid ${colors.primary}`,
              opacity: busy ? 0.55 : 1,
            }}
          >
            Resume live
          </button>
        )}
      </div>
    </div>
  )
}