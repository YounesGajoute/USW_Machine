import { randomUUID } from 'node:crypto'
import { canonical, id, problem } from './protocol.mjs'

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'UNKNOWN_OUTCOME'])

/** Durable Master-side run identity. An uncertain POST is never reissued. */
export function createVisionSyncRunStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS vision_sync_runs (
    run_id TEXT PRIMARY KEY,
    ledger_id TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    request_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('CREATED','DISPATCHED','COMPLETED','FAILED','UNKNOWN_OUTCOME')),
    result_json TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  const insert = db.prepare(`INSERT INTO vision_sync_runs
    (run_id,ledger_id,reference_id,request_json,state,created_at,updated_at)
    VALUES (@runId,@ledgerId,@referenceId,@requestJson,'CREATED',@now,@now)`)
  const read = db.prepare('SELECT * FROM vision_sync_runs WHERE run_id = ?')
  const update = db.prepare(`UPDATE vision_sync_runs SET state=@state,result_json=@resultJson,
    error=@error,updated_at=@now WHERE run_id=@runId`)
  const unresolved = db.prepare(`SELECT * FROM vision_sync_runs WHERE state IN ('CREATED','DISPATCHED','UNKNOWN_OUTCOME') ORDER BY created_at`)
  function decode(row) {
    return row && { runId: row.run_id, ledgerId: row.ledger_id,
      referenceId: row.reference_id, request: JSON.parse(row.request_json), state: row.state,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      error: row.error, createdAt: row.created_at, updatedAt: row.updated_at }
  }
  function create(request, now = Date.now()) {
    id(request.runId, 'runId'); id(request.ledgerId, 'ledgerId')
    id(request.binding?.referenceId, 'referenceId')
    const requestJson = canonical(request)
    return db.transaction(() => {
      const old = decode(read.get(request.runId))
      if (old) {
        if (canonical(old.request) !== requestJson) throw problem('RUN_CONFLICT', 'Run ID was reused with different content')
        return old
      }
      insert.run({ runId: request.runId, ledgerId: request.ledgerId,
        referenceId: request.binding.referenceId, requestJson, now })
      return decode(read.get(request.runId))
    })()
  }
  function mark(runId, state, { result = null, error = null } = {}, now = Date.now()) {
    id(runId, 'runId')
    if (!['DISPATCHED', 'COMPLETED', 'FAILED', 'UNKNOWN_OUTCOME'].includes(state)) {
      throw problem('INVALID_RUN_STATE', 'Invalid Master run state')
    }
    return db.transaction(() => {
      const before = decode(read.get(runId))
      if (!before) throw problem('RUN_NOT_FOUND', 'Master run ID does not exist', 404)
      if (TERMINAL.has(before.state) && !(before.state === 'UNKNOWN_OUTCOME' &&
          (state === 'COMPLETED' || state === 'FAILED'))) {
        if (before.state !== state) throw problem('RUN_TERMINAL', 'Terminal run cannot change state')
        return before
      }
      update.run({ runId, state, resultJson: result == null ? null : canonical(result),
        error: error == null ? null : String(error).slice(0, 500), now })
      return decode(read.get(runId))
    })()
  }
  return { create, mark, get: runId => decode(read.get(runId)),
    unresolved: () => unresolved.all().map(decode), newRunId: () => randomUUID() }
}
