import { canonical, problem } from './protocol.mjs'

function verifiedRecord(record, request) {
  if (!record || record.runId !== request.runId || record.ledgerId !== request.ledgerId) {
    throw problem('RUN_IDENTITY_MISMATCH', 'Slave returned another run identity')
  }
  if (!record.request || canonical(record.request) !== canonical(request)) {
    throw problem('RUN_BINDING_MISMATCH', 'Slave run journal does not match the dispatched binding')
  }
  return record
}

/** Persist before POST. A lost response is resolved by exact lookup, never a second POST. */
export async function dispatchVersionedRun({ store, ticket, post, get, now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 120_000,
  pollMs = 500 }) {
  if (!ticket?.binding?.referenceId || !ticket.grantId || !ticket.ledgerId ||
      ticket.expiresAt <= now() + 500) throw problem('GRANT_EXPIRED', 'Current installed inspection grant is unavailable')
  // A prior unknown result is historical, not a Start interlock. Each new
  // operator-requested inspection still requires a current grant and fresh ID.
  const request = { runId: store.newRunId(), ledgerId: ticket.ledgerId,
    binding: ticket.binding, grantId: ticket.grantId,
    localRevision: ticket.localRevision, purpose: 'production' }
  if (store.get(request.runId)) throw problem('RUN_CONFLICT', 'Generated run ID already exists')
  store.create(request)
  let record = null
  try {
    record = verifiedRecord(await post(request), request)
    store.mark(request.runId, 'DISPATCHED')
  } catch (error) {
    // The Slave may have accepted the POST even when the response was lost.
    // Preserve the identity and look it up; never repeat admission.
    store.mark(request.runId, 'UNKNOWN_OUTCOME', { error: error?.message ?? String(error) })
  }
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    if (!record) {
      try { record = verifiedRecord(await get(request.runId, request.ledgerId), request) }
      catch { record = null }
    }
    if (record?.state === 'COMPLETED') {
      store.mark(request.runId, 'COMPLETED', { result: record.result })
      return { result: record.result, runId: request.runId, ledgerId: request.ledgerId }
    }
    if (record?.state === 'FAILED' || record?.state === 'UNKNOWN_OUTCOME') {
      store.mark(request.runId, record.state, { error: record.error ?? 'Slave run failed' })
      throw problem('INSPECTION_FAILED', record.error ?? `Inspection ${record.state}`)
    }
    await sleep(pollMs)
    record = null
  }
  store.mark(request.runId, 'UNKNOWN_OUTCOME', { error: 'Exact Slave result was not available before timeout' })
  throw problem('RUN_OUTCOME_UNKNOWN', `Inspection outcome unknown for run ${request.runId}; current inspection failed, result retained for background reconciliation`)
}

/** Read-only reconciliation after a timeout or Master restart. Never dispatches. */
export async function reconcileUnresolvedRuns({ store, get }) {
  const outcomes = []
  for (const local of store.unresolved()) {
    let remote
    try { remote = verifiedRecord(await get(local.runId, local.ledgerId), local.request) }
    catch { outcomes.push({ runId: local.runId, state: local.state }); continue }
    if (remote.state === 'COMPLETED' || remote.state === 'FAILED') {
      store.mark(local.runId, remote.state, { result: remote.result, error: remote.error })
    }
    outcomes.push({ runId: local.runId, state: store.get(local.runId).state })
  }
  return outcomes
}
