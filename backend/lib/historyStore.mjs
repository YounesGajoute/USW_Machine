/**
 * History store — durable production traceability.
 *
 * Persists every production cycle (production_runs) and every error
 * (error_log) to the shared SQLite database, with filtered read, CSV/JSON
 * export, and retention/auto-archive.
 *
 * Uses its own better-sqlite3 connection to `getDbPath()` (WAL-safe) so the
 * production job queue and lifecycle modules can write without depending on
 * the connection owned by `index.mjs`.
 */
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { getDbPath } from './db.mjs'

/** @type {import('better-sqlite3').Database | null} */
let _db = null

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      timestamp TEXT NOT NULL,
      reference_id TEXT,
      reference_name TEXT,
      operator_id TEXT,
      operator_name TEXT,
      source TEXT,
      result INTEGER,
      duration_ms INTEGER,
      vision_summary TEXT,
      error_message TEXT,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_production_runs_timestamp ON production_runs (timestamp);
    CREATE INDEX IF NOT EXISTS idx_production_runs_reference ON production_runs (reference_id);
    CREATE INDEX IF NOT EXISTS idx_production_runs_result ON production_runs (result);

    CREATE TABLE IF NOT EXISTS error_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT NOT NULL,
      severity TEXT,
      phase TEXT,
      job_id TEXT,
      reference_id TEXT,
      operator_id TEXT,
      context_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_error_log_timestamp ON error_log (timestamp);
    CREATE INDEX IF NOT EXISTS idx_error_log_severity ON error_log (severity);
    CREATE INDEX IF NOT EXISTS idx_error_log_phase ON error_log (phase);
  `)
}

/** Lazily open (and memoise) the history DB connection. */
export function getHistoryDb() {
  if (_db) return _db
  const dbPath = getDbPath()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  ensureSchema(db)
  _db = db
  return _db
}

/** Test/maintenance hook — close the cached connection. */
export function closeHistoryDb() {
  if (_db) {
    try {
      _db.close()
    } catch {
      /* ignore */
    }
    _db = null
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return '{}'
  }
}

function lookupReferenceName(db, referenceId) {
  if (!referenceId) return null
  try {
    const row = db.prepare('SELECT name FROM product_references WHERE id = ?').get(String(referenceId))
    return row?.name ?? null
  } catch {
    return null
  }
}

function lookupOperatorName(db, operatorId) {
  if (!operatorId) return null
  try {
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(String(operatorId))
    return row?.username ?? null
  } catch {
    return null
  }
}

/**
 * Persist a completed/failed production cycle.
 * @param {{
 *   jobId?: string|null,
 *   source?: string|null,
 *   referenceId?: string|null,
 *   referenceName?: string|null,
 *   operatorId?: string|null,
 *   operatorName?: string|null,
 *   result?: boolean|null,
 *   durationMs?: number|null,
 *   visionSummary?: string|null,
 *   errorMessage?: string|null,
 *   details?: object|null,
 *   timestamp?: string,
 * }} run
 */
export function recordProductionRun(run = {}) {
  try {
    const db = getHistoryDb()
    const id = randomUUID()
    const timestamp = run.timestamp ?? new Date().toISOString()
    const referenceName = run.referenceName ?? lookupReferenceName(db, run.referenceId)
    const operatorName = run.operatorName ?? lookupOperatorName(db, run.operatorId)
    const result = run.result == null ? null : run.result ? 1 : 0
    const durationMs = Number.isFinite(run.durationMs) ? Math.round(run.durationMs) : null
    db.prepare(
      `INSERT INTO production_runs
        (id, job_id, timestamp, reference_id, reference_name, operator_id, operator_name,
         source, result, duration_ms, vision_summary, error_message, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      run.jobId ?? null,
      timestamp,
      run.referenceId != null ? String(run.referenceId) : null,
      referenceName,
      run.operatorId != null ? String(run.operatorId) : null,
      operatorName,
      run.source ?? null,
      result,
      durationMs,
      run.visionSummary ?? null,
      run.errorMessage ?? null,
      safeStringify(run.details),
    )
    return id
  } catch (err) {
    console.warn('[historyStore] recordProductionRun failed:', err?.message ?? err)
    return null
  }
}

/**
 * Persist an error event.
 * @param {{
 *   errorCode?: string|null,
 *   errorMessage: string,
 *   severity?: 'low'|'medium'|'high'|'critical'|null,
 *   phase?: string|null,
 *   jobId?: string|null,
 *   referenceId?: string|null,
 *   operatorId?: string|null,
 *   context?: object|null,
 *   timestamp?: string,
 * }} err
 */
export function recordError(errEvent = {}) {
  try {
    const db = getHistoryDb()
    const id = randomUUID()
    const timestamp = errEvent.timestamp ?? new Date().toISOString()
    const message = errEvent.errorMessage != null ? String(errEvent.errorMessage) : 'Unknown error'
    const severity = VALID_SEVERITIES.has(errEvent.severity) ? errEvent.severity : null
    db.prepare(
      `INSERT INTO error_log
        (id, timestamp, error_code, error_message, severity, phase, job_id, reference_id, operator_id, context_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      timestamp,
      errEvent.errorCode ?? null,
      message,
      severity,
      errEvent.phase ?? null,
      errEvent.jobId ?? null,
      errEvent.referenceId != null ? String(errEvent.referenceId) : null,
      errEvent.operatorId != null ? String(errEvent.operatorId) : null,
      safeStringify(errEvent.context),
    )
    return id
  } catch (err) {
    console.warn('[historyStore] recordError failed:', err?.message ?? err)
    return null
  }
}

function clampLimit(limit, fallback = 50) {
  const n = Number(limit)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), 500)
}

function clampOffset(offset) {
  const n = Number(offset)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function mapRunRow(row) {
  let details = {}
  try {
    details = JSON.parse(row.details_json || '{}')
  } catch {
    details = {}
  }
  return {
    id: row.id,
    job_id: row.job_id,
    timestamp: row.timestamp,
    reference_id: row.reference_id,
    reference_name: row.reference_name,
    operator_id: row.operator_id,
    operator_name: row.operator_name,
    source: row.source,
    result: row.result == null ? null : row.result === 1,
    duration_ms: row.duration_ms,
    vision_summary: row.vision_summary,
    error_message: row.error_message,
    details,
  }
}

function mapErrorRow(row) {
  let context = {}
  try {
    context = JSON.parse(row.context_json || '{}')
  } catch {
    context = {}
  }
  return {
    id: row.id,
    timestamp: row.timestamp,
    error_code: row.error_code,
    error_message: row.error_message,
    severity: row.severity,
    phase: row.phase,
    job_id: row.job_id,
    reference_id: row.reference_id,
    operator_id: row.operator_id,
    context,
  }
}

/**
 * @param {{ limit?: number, offset?: number, start_date?: string, end_date?: string, search?: string }} filters
 */
export function queryProductionRuns(filters = {}) {
  const db = getHistoryDb()
  const where = []
  const params = []
  if (filters.start_date) {
    where.push('timestamp >= ?')
    params.push(String(filters.start_date))
  }
  if (filters.end_date) {
    where.push('timestamp <= ?')
    params.push(String(filters.end_date))
  }
  if (filters.search) {
    const like = `%${String(filters.search).trim()}%`
    where.push('(reference_name LIKE ? OR reference_id LIKE ? OR operator_name LIKE ? OR error_message LIKE ?)')
    params.push(like, like, like, like)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) AS c FROM production_runs ${whereSql}`).get(...params).c
  const limit = clampLimit(filters.limit)
  const offset = clampOffset(filters.offset)
  const rows = db
    .prepare(`SELECT * FROM production_runs ${whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
  return { records: rows.map(mapRunRow), total }
}

/**
 * @param {{ limit?: number, offset?: number, severity?: string, phase?: string, error_code?: string, start_date?: string, end_date?: string }} filters
 */
export function queryErrors(filters = {}) {
  const db = getHistoryDb()
  const where = []
  const params = []
  if (filters.severity) {
    where.push('severity = ?')
    params.push(String(filters.severity).toLowerCase())
  }
  if (filters.phase) {
    where.push('phase = ?')
    params.push(String(filters.phase))
  }
  if (filters.error_code) {
    where.push('error_code LIKE ?')
    params.push(`%${String(filters.error_code).trim()}%`)
  }
  if (filters.start_date) {
    where.push('timestamp >= ?')
    params.push(String(filters.start_date))
  }
  if (filters.end_date) {
    where.push('timestamp <= ?')
    params.push(String(filters.end_date))
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) AS c FROM error_log ${whereSql}`).get(...params).c
  const limit = clampLimit(filters.limit)
  const offset = clampOffset(filters.offset)
  const rows = db
    .prepare(`SELECT * FROM error_log ${whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
  return { errors: rows.map(mapErrorRow), total }
}

function toCsv(rows, columns) {
  const escape = (v) => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.join(',')
  const body = rows.map((r) => columns.map((c) => escape(r[c])).join(',')).join('\n')
  return body ? `${header}\n${body}` : header
}

const RUN_EXPORT_COLUMNS = [
  'id',
  'timestamp',
  'reference_id',
  'reference_name',
  'operator_id',
  'operator_name',
  'source',
  'result',
  'duration_ms',
  'vision_summary',
  'error_message',
]

const ERROR_EXPORT_COLUMNS = [
  'id',
  'timestamp',
  'error_code',
  'severity',
  'phase',
  'error_message',
  'job_id',
  'reference_id',
  'operator_id',
]

/** @param {'csv'|'json'} format */
export function exportProductionRuns(format = 'json') {
  const db = getHistoryDb()
  const rows = db.prepare('SELECT * FROM production_runs ORDER BY timestamp DESC').all().map(mapRunRow)
  if (format === 'csv') {
    return toCsv(
      rows.map((r) => ({ ...r, result: r.result == null ? '' : r.result ? 'PASS' : 'FAIL' })),
      RUN_EXPORT_COLUMNS,
    )
  }
  return JSON.stringify(rows, null, 2)
}

/** @param {'csv'|'json'} format */
export function exportErrors(format = 'json') {
  const db = getHistoryDb()
  const rows = db.prepare('SELECT * FROM error_log ORDER BY timestamp DESC').all().map(mapErrorRow)
  if (format === 'csv') {
    return toCsv(rows, ERROR_EXPORT_COLUMNS)
  }
  return JSON.stringify(rows, null, 2)
}

/**
 * Archive then delete records older than `retentionDays`.
 * Pruned rows are appended to a JSONL file under `<db dir>/archive/`.
 * @param {{ retentionDays?: number }} opts
 */
export function archiveAndPrune({ retentionDays = 365 } = {}) {
  const days = Number(retentionDays)
  if (!Number.isFinite(days) || days <= 0) {
    return { archivedRuns: 0, archivedErrors: 0, archiveFile: null, skipped: true }
  }
  const db = getHistoryDb()
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const oldRuns = db.prepare('SELECT * FROM production_runs WHERE timestamp < ?').all(cutoff).map(mapRunRow)
  const oldErrors = db.prepare('SELECT * FROM error_log WHERE timestamp < ?').all(cutoff).map(mapErrorRow)

  if (oldRuns.length === 0 && oldErrors.length === 0) {
    return { archivedRuns: 0, archivedErrors: 0, archiveFile: null, cutoff }
  }

  const archiveDir = path.join(path.dirname(getDbPath()), 'archive')
  fs.mkdirSync(archiveDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archiveFile = path.join(archiveDir, `history-archive-${stamp}.jsonl`)
  const lines = [
    ...oldRuns.map((r) => JSON.stringify({ kind: 'production_run', ...r })),
    ...oldErrors.map((e) => JSON.stringify({ kind: 'error_log', ...e })),
  ]
  fs.writeFileSync(archiveFile, lines.join('\n') + '\n', 'utf8')

  const prune = db.transaction(() => {
    db.prepare('DELETE FROM production_runs WHERE timestamp < ?').run(cutoff)
    db.prepare('DELETE FROM error_log WHERE timestamp < ?').run(cutoff)
  })
  prune()

  console.log(
    `[historyStore] Archived ${oldRuns.length} runs + ${oldErrors.length} errors older than ${cutoff} → ${archiveFile}`,
  )
  return {
    archivedRuns: oldRuns.length,
    archivedErrors: oldErrors.length,
    archiveFile,
    cutoff,
  }
}

/**
 * Build a short "N/M pass" vision summary from production sequence phases.
 * @param {Array<{ phase?: string, pass?: boolean }>} phases
 * @returns {string|null}
 */
export function summarizeVisionPhases(phases) {
  if (!Array.isArray(phases)) return null
  const visionPhases = phases.filter((p) => typeof p?.phase === 'string' && p.phase.startsWith('vision_'))
  if (visionPhases.length === 0) return null
  const passed = visionPhases.filter((p) => p.pass === true).length
  return `${passed}/${visionPhases.length} pass`
}
