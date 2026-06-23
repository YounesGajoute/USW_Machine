/**
 * Vision Pi proxy config (US Machine = Ethernet master).
 *
 * Two secrets on the vision Pi — do not mix them:
 *   Remote: VISION_REMOTE_KEY / VISION_REMOTE_API_KEY → X-Vision-Remote-Key (/api/remote/*, Socket.IO)
 *   Local:  VISION_LOCAL_KEY / VISION_LOCAL_API_KEY   → X-Vision-Local-Key (/api/programs, etc.)
 *
 * Master automation normally sets only the remote key. Set the local key only if the slave
 * locks its local REST API and this HMI must proxy program CRUD.
 */

function stripVisionBase(url) {
  let base = String(url).replace(/\/$/, '')
  base = base.replace(/\/api\/v1$/i, '').replace(/\/api$/i, '')
  return base
}

export function visionBaseFromEnv() {
  const raw =
    process.env.VISION_URL ??
    process.env.VISION_SLAVE_URL ??
    'http://192.168.10.2:5000'
  return stripVisionBase(raw)
}

export function visionRemoteKeyFromEnv() {
  return (
    process.env.VISION_REMOTE_KEY ??
    process.env.VISION_REMOTE_API_KEY ??
    ''
  )
}

export function visionLocalKeyFromEnv() {
  return (
    process.env.VISION_LOCAL_KEY ??
    process.env.VISION_LOCAL_API_KEY ??
    ''
  )
}

/** @param {Record<string, unknown> | null | undefined} body */
export function resolveVisionConfig(body, readSystemSettings) {
  const settings = readSystemSettings?.() ?? {}
  const base = stripVisionBase(
    body?.vision_url ?? settings.vision_url ?? visionBaseFromEnv(),
  )
  const api = `${base}/api`
  const remoteKey =
    body?.vision_remote_key ?? settings.vision_remote_key ?? visionRemoteKeyFromEnv()
  const localKey =
    body?.vision_local_key ?? settings.vision_local_key ?? visionLocalKeyFromEnv()

  const remoteHeaders = { 'Content-Type': 'application/json' }
  if (remoteKey) remoteHeaders['X-Vision-Remote-Key'] = remoteKey

  const localHeaders = { 'Content-Type': 'application/json' }
  if (localKey) localHeaders['X-Vision-Local-Key'] = localKey

  return { api, base, remoteHeaders, localHeaders }
}
