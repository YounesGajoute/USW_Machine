/**
 * Detect vision-Pi responses where the slave is reachable but CSI / Picamera2 is not ready.
 */

function normMessage(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value.message != null) return String(value.message)
  return String(value)
}

/**
 * @param {number} status HTTP status from Vision Pi
 * @param {Record<string, unknown>|null|undefined} data Parsed JSON body
 */
export function isVisionCameraUnavailableHttp(status, data) {
  if (status === 503) {
    const code = data?.code ?? data?.error?.code
    if (code === 'CAMERA_UNAVAILABLE' || code === 'NO_CAMERA') return true
  }
  const msg = normMessage(data?.error ?? data?.message ?? data?.detail)
  return isVisionCameraUnavailableMessage(msg)
}

/** @param {string|null|undefined} message */
export function isVisionCameraUnavailableMessage(message) {
  const m = normMessage(message)
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
