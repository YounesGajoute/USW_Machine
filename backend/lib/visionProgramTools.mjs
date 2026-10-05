/**
 * Vision Pi program tools: fetch program, merge tools, save, run-once inspection.
 */

export async function fetchVisionProgramOnPi(api, localHeaders, programId) {
  const getRes = await fetch(`${api}/programs/${programId}`, { headers: localHeaders })
  const existing = await getRes.json().catch(() => ({}))
  return { ok: getRes.ok, status: getRes.status, data: existing }
}

export async function saveProgramToolsOnPi(api, localHeaders, programId, tools) {
  const { ok, status, data: existing } = await fetchVisionProgramOnPi(api, localHeaders, programId)
  if (!ok) {
    return { ok: false, status, data: existing }
  }

  const config = { ...(existing.config ?? {}), tools }
  const putRes = await fetch(`${api}/programs/${programId}`, {
    method: 'PUT',
    headers: localHeaders,
    body: JSON.stringify({ config }),
  })
  const putData = await putRes.json().catch(() => ({}))
  return { ok: putRes.ok, status: putRes.status, data: putData }
}

export async function runInspectionOnceOnPi(api, remoteHeaders, programId, options = {}) {
  const { includeImage = false } = options
  const runRes = await fetch(`${api}/remote/inspection/run-once`, {
    method: 'POST',
    headers: remoteHeaders,
    body: JSON.stringify({
      programId,
      includeImage,
      triggerType: 'remote',
    }),
    signal: AbortSignal.timeout(90_000),
  })
  const runData = await runRes.json().catch(() => ({}))
  return { ok: runRes.ok, status: runRes.status, data: runData }
}

/** Allowlisted Vision Pi folders for production capture-and-save. */
export const CAPTURE_AND_SAVE_FOLDERS = Object.freeze([
  'vision_welding_splice',
  'vision_heat_shrink_tube',
])

/**
 * Deep folder validation before any Vision HTTP call.
 * Rejects missing/blank values, path traversal, separators, and non-allowlisted names.
 *
 * @param {unknown} rawFolder
 * @returns {{ ok: true, folder: string } | {
 *   ok: false,
 *   status: 400,
 *   code: string,
 *   message: string,
 *   details: object[],
 *   data: { ok: false, error: string, detail?: string, code: string },
 * }}
 */
export function validateCaptureAndSaveFolder(rawFolder) {
  const allowed = [...CAPTURE_AND_SAVE_FOLDERS]
  const allowedMsg = `Allowed: ${allowed.join(', ')}`

  if (rawFolder == null || rawFolder === '') {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_FOLDER',
      message: `folder is required. ${allowedMsg}`,
      details: [{ path: 'folder', message: 'Required', allowed }],
      data: {
        ok: false,
        code: 'INVALID_FOLDER',
        error: `folder is required. ${allowedMsg}`,
        detail: 'Missing folder',
      },
    }
  }

  if (typeof rawFolder !== 'string' && typeof rawFolder !== 'number') {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_FOLDER',
      message: `folder must be a string. ${allowedMsg}`,
      details: [{ path: 'folder', message: 'Must be a string', allowed }],
      data: {
        ok: false,
        code: 'INVALID_FOLDER',
        error: `folder must be a string. ${allowedMsg}`,
        detail: `Got ${typeof rawFolder}`,
      },
    }
  }

  const folder = String(rawFolder).trim()
  if (!folder) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_FOLDER',
      message: `folder is required. ${allowedMsg}`,
      details: [{ path: 'folder', message: 'Required (blank after trim)', allowed }],
      data: {
        ok: false,
        code: 'INVALID_FOLDER',
        error: `folder is required. ${allowedMsg}`,
        detail: 'Blank folder',
      },
    }
  }

  // Path / traversal guards — Vision stores under Master_capture_option/{folder}/ only.
  if (
    folder.includes('/') ||
    folder.includes('\\') ||
    folder.includes('\0') ||
    folder.includes('..') ||
    folder.startsWith('.')
  ) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_FOLDER',
      message: `Invalid folder "${folder}". ${allowedMsg}`,
      details: [
        {
          path: 'folder',
          message: 'Must be an allowlisted basename (no path separators or traversal)',
          allowed,
        },
      ],
      data: {
        ok: false,
        code: 'INVALID_FOLDER',
        error: `Invalid folder "${folder}". ${allowedMsg}`,
        detail: 'Path characters or traversal not allowed',
      },
    }
  }

  if (!CAPTURE_AND_SAVE_FOLDERS.includes(folder)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_FOLDER',
      message: `Invalid folder "${folder}". ${allowedMsg}`,
      details: [{ path: 'folder', message: 'Not in allowlist', allowed, received: folder }],
      data: {
        ok: false,
        code: 'INVALID_FOLDER',
        error: `Invalid folder "${folder}". ${allowedMsg}`,
        detail: 'Not in allowlist',
      },
    }
  }

  return { ok: true, folder }
}

/**
 * Capture one frame on Vision Pi and save under Master_capture_option/{folder}/.
 * Does not run inspection tools or PASS/FAIL judgment.
 *
 * @param {string} api Vision API base (…/api)
 * @param {Record<string, string>} remoteHeaders
 * @param {{
 *   folder: string,
 *   programId?: number|null,
 *   referenceId?: string|null,
 *   triggerType?: string,
 *   includeImage?: boolean,
 *   filenameHint?: string|null,
 * }} opts
 * @returns {Promise<{ ok: boolean, status: number, data: object }>}
 */
export async function captureAndSaveOnPi(api, remoteHeaders, opts = {}) {
  const validated = validateCaptureAndSaveFolder(opts.folder)
  if (!validated.ok) {
    return { ok: false, status: validated.status, data: validated.data }
  }
  const folder = validated.folder

  const includeImage = opts.includeImage !== false
  const body = {
    folder,
    triggerType: opts.triggerType ?? 'remote',
    includeImage,
  }
  if (opts.programId != null && Number.isFinite(Number(opts.programId))) {
    body.programId = Number(opts.programId)
  }
  if (opts.referenceId != null && String(opts.referenceId) !== '') {
    body.referenceId = String(opts.referenceId)
  }
  if (opts.filenameHint != null && String(opts.filenameHint) !== '') {
    body.filenameHint = String(opts.filenameHint)
  }

  console.log(
    `[Vision] capture-and-save folder=${folder}` +
      (body.referenceId ? ` referenceId=${body.referenceId}` : '') +
      (body.programId != null ? ` programId=${body.programId}` : ''),
  )

  const runRes = await fetch(`${api}/remote/camera/capture-and-save`, {
    method: 'POST',
    headers: remoteHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  const runData = await runRes.json().catch(() => ({}))
  console.log(
    `[Vision] capture-and-save status=${runRes.status}` +
      (runData.filename ? ` filename=${runData.filename}` : '') +
      (runData.path ? ` path=${runData.path}` : ''),
  )
  return { ok: runRes.ok, status: runRes.status, data: runData }
}

/** Map Vision Pi OK/NG to HMI PASS/FAIL. */
export function normalizeInspectionRunData(runData) {
  const piStatus = runData.status
  let result = 'UNKNOWN'
  if (piStatus === 'OK') result = 'PASS'
  else if (piStatus === 'NG') result = 'FAIL'
  else if (runData.result === 'PASS' || runData.result === 'FAIL') result = runData.result

  return {
    result,
    status: piStatus,
    toolResults: runData.toolResults ?? [],
    processingTimeMs: runData.processingTimeMs,
    programId: runData.programId,
    programName: runData.programName,
    resultId: runData.resultId,
    image_b64: runData.image ?? runData.image_b64 ?? undefined,
    error: runData.error ?? undefined,
    details: runData,
  }
}

export async function saveToolsAndRunOnceOnPi(cfg, programId, tools, options = {}) {
  const { api, localHeaders, remoteHeaders } = cfg
  const { includeImage = false } = options

  const saveOutcome = await saveProgramToolsOnPi(api, localHeaders, programId, tools)
  if (!saveOutcome.ok) {
    return { ok: false, phase: 'save', status: saveOutcome.status, data: saveOutcome.data }
  }

  const runOutcome = await runInspectionOnceOnPi(api, remoteHeaders, programId, { includeImage })
  if (!runOutcome.ok) {
    return {
      ok: false,
      phase: 'run',
      status: runOutcome.status,
      data: {
        error: runOutcome.data.error ?? runOutcome.data.message ?? `Inspection failed (${runOutcome.status})`,
        ...runOutcome.data,
      },
    }
  }

  return {
    ok: true,
    data: normalizeInspectionRunData(runOutcome.data),
  }
}
