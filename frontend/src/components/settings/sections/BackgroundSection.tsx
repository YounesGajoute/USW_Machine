import { useCallback, useEffect, useState } from 'react'
import { Image, Camera, RefreshCw, Save, Trash2 } from 'lucide-react'
import { realtimeInspectionApi, realtimeReferenceCaptureId, type RealtimeCapture, type RealtimeReference, type RealtimeStatus } from '@/services/realtimeInspectionApi'
import { VisionSectionFrame } from '@/components/settings/vision/VisionSectionFrame'

export default function BackgroundSection({ embedded = false, zoneEditsPending = false, onBusyChange }: { embedded?: boolean; zoneEditsPending?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [reference, setReference] = useState<RealtimeReference | null>(null)
  const [candidate, setCandidate] = useState<RealtimeCapture | null>(null)
  const [status, setStatus] = useState<RealtimeStatus>({})
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<'capture' | 'save' | null>(null)
  const [fixtureEmpty, setFixtureEmpty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)
  const [candidateImageError, setCandidateImageError] = useState(false)
  const [candidateImageLoaded, setCandidateImageLoaded] = useState(false)
  const busy = busyAction !== null

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextReference, snapshot] = await Promise.all([
        realtimeInspectionApi.reference(), realtimeInspectionApi.snapshot(),
      ])
      setReference(nextReference)
      setStatus(snapshot.status ?? {})
      setImageError(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the background image.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const capture = async () => {
    if (!fixtureEmpty || busy || loading || zoneEditsPending || sessionStorage.getItem('us-machine-pending-zone-edits') === '1') return
    setBusyAction('capture')
    onBusyChange?.(true)
    setError(null)
    setNotice(null)
    try {
      // Recheck machine state immediately before capturing a candidate frame.
      const snapshot = await realtimeInspectionApi.snapshot()
      setStatus(snapshot.status ?? {})
      if (snapshot.status?.active || snapshot.status?.disable_pending) {
        throw new Error('Inspection is busy. Wait until it finishes before capturing the background.')
      }
      const frame = await realtimeInspectionApi.captureBackground()
      if (frame.archive_status !== 'COMPLETE' || !frame.capture_id || !frame.image_url) {
        throw new Error('The new background capture is incomplete. Capture again before saving.')
      }
      setCandidate(frame)
      setCandidateImageError(false)
      setCandidateImageLoaded(false)
      setNotice('New image captured. Review it, then save it to the inspection slave.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not capture the background image.')
    } finally {
      setBusyAction(null)
      onBusyChange?.(false)
    }
  }

  const save = async () => {
    if (!candidate || !candidateImageLoaded || candidateImageError || !fixtureEmpty || busy || loading || zoneEditsPending || sessionStorage.getItem('us-machine-pending-zone-edits') === '1') return
    setBusyAction('save')
    onBusyChange?.(true)
    setError(null)
    setNotice(null)
    try {
      const snapshot = await realtimeInspectionApi.snapshot()
      setStatus(snapshot.status ?? {})
      if (snapshot.status?.active || snapshot.status?.disable_pending) {
        throw new Error('Inspection is busy. Wait until it finishes before saving the background.')
      }
      const saved = await realtimeInspectionApi.useCurrentFrame(candidate.capture_id)
      if (realtimeReferenceCaptureId(saved) !== candidate.capture_id) {
        throw new Error('Inspection slave did not confirm the new background image.')
      }
      setReference(saved)
      setCandidate(null)
      setFixtureEmpty(false)
      setImageError(false)
      setNotice('New background saved and verified on the inspection slave.')
    } catch (cause) {
      const uncertain = (cause as Error & { saved?: boolean })?.saved
      setError(uncertain ? 'The save was sent, but the inspection slave did not confirm the new background. Refresh to check its active image before retrying.'
        : cause instanceof Error ? cause.message : 'Could not save the new background image.')
    } finally {
      setBusyAction(null)
      onBusyChange?.(false)
    }
  }

  const captureId = reference ? realtimeReferenceCaptureId(reference) : null
  const imageUrl = captureId
    ? realtimeInspectionApi.referenceImageUrl(captureId)
    : reference?.image_url ? realtimeInspectionApi.imageUrl(reference.image_url) : null
  const candidateUrl = candidate?.image_url ? realtimeInspectionApi.imageUrl(candidate.image_url) : null
  const machineBusy = !!status.active || !!status.disable_pending

  const content = <>
    <div className="vision-page">
      <div className="vision-page__topline">
        <div>
          <p className="vision-page__eyebrow">EMPTY-FIXTURE REFERENCE</p>
          <h3>Background image</h3>
          <p className="vision-page__muted">Capture the empty fixture, review the new image, then save it as the inspection slave's background.</p>
        </div>
        <button type="button" className="vision-page__secondary" onClick={() => void reload()} disabled={loading || busy} aria-label="Refresh background image">
          <RefreshCw size={17} aria-hidden="true" /> Refresh
        </button>
      </div>

      {error && <p className="vision-page__message vision-page__message--error" role="alert">{error}</p>}
      {notice && <p className="vision-page__message vision-page__message--success" role="status">{notice}</p>}
      {machineBusy && <p className="vision-page__message" role="status">Inspection is busy. Background capture is unavailable.</p>}
      {zoneEditsPending && <p className="vision-page__message" role="status">Save pending zone adjustments before replacing the empty-fixture reference.</p>}

      <div className="vision-page__actions vision-background-controls">
        <label className="vision-page__confirm">
          <input type="checkbox" checked={fixtureEmpty} onChange={event => setFixtureEmpty(event.target.checked)} disabled={loading || busy || machineBusy || zoneEditsPending} />
          {candidate ? 'Fixture was empty for this capture' : 'Fixture is empty and ready to capture'}
        </label>
        <div className="vision-background-actions">
          {candidate && <button type="button" className="vision-page__secondary" onClick={() => { setCandidate(null); setCandidateImageError(false); setCandidateImageLoaded(false); setNotice(null) }} disabled={busy}>
            <Trash2 size={17} aria-hidden="true" /> Discard new capture
          </button>}
          <button type="button" className="vision-page__secondary" onClick={() => void capture()} disabled={!fixtureEmpty || loading || busy || machineBusy || zoneEditsPending}>
            <Camera size={17} aria-hidden="true" /> {busyAction === 'capture' ? 'Capturing…' : candidate ? 'Capture again' : 'Capture new image'}
          </button>
          {candidate && <button type="button" className="vision-page__primary" onClick={() => void save()} disabled={!fixtureEmpty || !candidateImageLoaded || candidateImageError || loading || busy || machineBusy || zoneEditsPending}>
            <Save size={17} aria-hidden="true" /> {busyAction === 'save' ? 'Saving to slave…' : 'Save new background'}
          </button>}
        </div>
      </div>

      <div className={`vision-background-layout${candidate ? ' has-candidate' : ''}`}>
        {candidate && <div className="vision-background-card">
          <h4>New capture · not saved</h4>
          <div className="vision-background-preview" aria-label="New background image awaiting save">
            {candidateUrl && !candidateImageError ? <>
              <img src={candidateUrl} alt="New empty-fixture capture awaiting save" onLoad={() => setCandidateImageLoaded(true)} onError={() => { setCandidateImageError(true); setCandidateImageLoaded(false) }} />
              {!candidateImageLoaded && <span role="status">Loading new capture…</span>}
            </> : <div className="vision-background-preview__empty"><Image size={38} aria-hidden="true" /><strong>New image could not be displayed</strong><span>Capture again before saving.</span></div>}
          </div>
        </div>}
        <div className="vision-background-card">
          <h4>{candidate ? 'Current saved background' : 'Saved background on inspection slave'}</h4>
          <div className="vision-background-preview" aria-label="Saved empty-fixture background image">
            {loading ? <p role="status">Loading background image…</p> : imageUrl && !imageError ?
              <img src={imageUrl} alt="Saved empty-fixture inspection background" onError={() => setImageError(true)} /> :
              <div className="vision-background-preview__empty">
                <Image size={38} aria-hidden="true" />
                <strong>{imageError ? 'Background image could not be displayed' : 'No background image saved'}</strong>
                <span>{imageError ? 'Refresh to retry loading it.' : 'Clear the fixture, then capture a reference image.'}</span>
              </div>}
          </div>
        </div>
      </div>

    </div>
  </>
  return embedded ? <section className="vision-zone-workspace__reference vision-page" aria-label="Empty fixture reference">{content}</section> : <VisionSectionFrame title="Background" icon={Image}>{content}</VisionSectionFrame>
}
