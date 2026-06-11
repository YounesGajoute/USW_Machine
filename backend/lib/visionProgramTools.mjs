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
