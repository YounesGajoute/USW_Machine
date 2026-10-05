/** Vision Pi reachable but CSI / Picamera2 not ready (503, NO_CAMERA, etc.). */
export function isVisionCameraUnavailableMessage(message: string | null | undefined): boolean {
  const m = (message ?? '').trim()
  if (!m) return false
  return (
    /\bcamera\b/i.test(m) &&
    (/\bunavailable\b/i.test(m) ||
      /\bnot connected\b/i.test(m) ||
      /\bnot ready\b/i.test(m) ||
      /\bno camera\b/i.test(m) ||
      /\bNO_CAMERA\b/.test(m))
  )
}

export function isVisionCameraUnavailablePayload(data: Record<string, unknown>): boolean {
  if (data.cameraUnavailable === true) return true
  const err = data.error
  const msg =
    typeof err === 'string'
      ? err
      : typeof data.message === 'string'
        ? data.message
        : typeof err === 'object' && err && 'message' in err
          ? String((err as { message?: string }).message ?? '')
          : ''
  return isVisionCameraUnavailableMessage(msg)
}
