/** @typedef {{ api: string, remoteHeaders: Record<string, string>, localHeaders: Record<string, string> }} VisionCfg */

const VISION_DELETE_TIMEOUT_MS = 120_000

/**
 * Delete an inspection program on the vision Pi (remote API preferred on master).
 * @param {VisionCfg} cfg
 * @param {number | string} programId
 */
export async function deleteVisionProgramOnPi(cfg, programId) {
  const { api, remoteHeaders, localHeaders } = cfg
  const id = String(programId)

  if (remoteHeaders['X-Vision-Remote-Key']) {
    try {
      const res = await fetch(`${api}/remote/programs/${id}`, {
        method: 'DELETE',
        headers: remoteHeaders,
        signal: AbortSignal.timeout(VISION_DELETE_TIMEOUT_MS),
      })
      if (res.ok || res.status === 404) {
        return { ok: true, via: 'remote', status: res.status }
      }
      const body = await res.text().catch(() => '')
      if (!localHeaders['X-Vision-Local-Key']) {
        return {
          ok: false,
          via: 'remote',
          status: res.status,
          error: body.slice(0, 200) || `HTTP ${res.status}`,
        }
      }
    } catch (err) {
      if (!localHeaders['X-Vision-Local-Key']) {
        return { ok: false, via: 'remote', error: err.message }
      }
    }
  }

  if (localHeaders['X-Vision-Local-Key']) {
    try {
      const res = await fetch(`${api}/programs/${id}`, {
        method: 'DELETE',
        headers: localHeaders,
        signal: AbortSignal.timeout(VISION_DELETE_TIMEOUT_MS),
      })
      if (res.ok || res.status === 404) {
        return { ok: true, via: 'local', status: res.status }
      }
      const body = await res.text().catch(() => '')
      return {
        ok: false,
        via: 'local',
        status: res.status,
        error: body.slice(0, 200) || `HTTP ${res.status}`,
      }
    } catch (err) {
      return { ok: false, via: 'local', error: err.message }
    }
  }

  return {
    ok: false,
    error: 'Set VISION_REMOTE_KEY (recommended) or VISION_LOCAL_KEY in backend/.env on the master',
  }
}
