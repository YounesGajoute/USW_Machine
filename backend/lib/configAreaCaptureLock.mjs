let busy = false
let abortReason = null

export function isConfigAreaCaptureBusy() { return busy }
export function requestConfigAreaCaptureAbort(reason = 'Config Area capture was interrupted') {
  if (busy) abortReason = reason
}
export function assertConfigAreaCaptureNotAborted() {
  if (abortReason) throw Object.assign(new Error(abortReason), { status: 409 })
}

export function acquireConfigAreaCapture() {
  if (busy) throw Object.assign(new Error('Config Area capture is already running'), { status: 409 })
  busy = true
  abortReason = null
  return () => { busy = false; abortReason = null }
}
