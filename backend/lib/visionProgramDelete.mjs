/** @typedef {{ api: string, remoteHeaders: Record<string, string>, localHeaders: Record<string, string> }} VisionCfg */

const VISION_DELETE_TIMEOUT_MS = 120_000

/**
 * Delete an inspection program on the vision Pi (remote API preferred on master).
 * Falls back to local `/api/programs/:id` when remote fails — including when the
 * slave has no LOCAL_API_KEY (local routes are open) so reference cleanup still works.
 * @param {VisionCfg} cfg
 * @param {number | string} programId
 */
export async function deleteVisionProgramOnPi(cfg, programId) {
  const { api, remoteHeaders, localHeaders } = cfg
  const id = String(programId)
  /** @type {{ ok: false, via: string, status?: number, error?: string } | null} */
  let remoteFailure = null

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
      remoteFailure = {
        ok: false,
        via: 'remote',
        status: res.status,
        error: body.slice(0, 200) || `HTTP ${res.status}`,
      }
    } catch (err) {
      remoteFailure = { ok: false, via: 'remote', error: err.message }
    }
  }

  // Local CRUD (optional local key). Always try after remote failure so cleanup
  // succeeds when Vision's remote delete is broken or LOCAL_API_KEY is unset.
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
      error:
        (remoteFailure?.error ? `${remoteFailure.error}; ` : '') +
        (body.slice(0, 200) || `HTTP ${res.status}`),
    }
  } catch (err) {
    if (remoteFailure) return remoteFailure
    return { ok: false, via: 'local', error: err.message }
  }
}
