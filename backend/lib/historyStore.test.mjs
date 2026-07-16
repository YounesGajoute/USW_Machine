import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Point the store at an isolated temp DB before it lazily opens a connection.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'history-store-test-'))
process.env.MAIN_DATA_DB_PATH = path.join(TMP_DIR, 'maindata.db')

const {
  recordProductionRun,
  recordError,
  queryProductionRuns,
  queryErrors,
  exportProductionRuns,
  exportErrors,
  archiveAndPrune,
  summarizeVisionPhases,
  closeHistoryDb,
} = await import('./historyStore.mjs')

test.after(() => {
  closeHistoryDb()
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
})

test('records and queries production runs newest-first', () => {
  recordProductionRun({
    jobId: 'job-1',
    source: 'api',
    referenceId: 'REF-1',
    referenceName: 'Alpha',
    operatorName: 'alice',
    result: true,
    durationMs: 3200,
    visionSummary: '2/2 pass',
    timestamp: '2026-01-01T00:00:00.000Z',
  })
  recordProductionRun({
    jobId: 'job-2',
    source: 'panel',
    referenceId: 'REF-2',
    referenceName: 'Beta',
    operatorName: 'bob',
    result: false,
    durationMs: 1500,
    errorMessage: 'centring failed',
    timestamp: '2026-01-02T00:00:00.000Z',
  })

  const { records, total } = queryProductionRuns({})
  assert.equal(total, 2)
  assert.equal(records.length, 2)
  assert.equal(records[0].job_id, 'job-2')
  assert.equal(records[0].result, false)
  assert.equal(records[1].result, true)
})

test('production run search filter matches reference and operator', () => {
  const byRef = queryProductionRuns({ search: 'Alpha' })
  assert.equal(byRef.total, 1)
  assert.equal(byRef.records[0].reference_name, 'Alpha')

  const byOperator = queryProductionRuns({ search: 'bob' })
  assert.equal(byOperator.total, 1)
  assert.equal(byOperator.records[0].operator_name, 'bob')
})

test('production run pagination clamps limit/offset', () => {
  const page = queryProductionRuns({ limit: 1, offset: 1 })
  assert.equal(page.total, 2)
  assert.equal(page.records.length, 1)
  assert.equal(page.records[0].job_id, 'job-1')
})

test('records and filters errors by severity', () => {
  recordError({ errorMessage: 'low thing', severity: 'low', phase: 'vision' })
  recordError({ errorMessage: 'boom', severity: 'critical', phase: 'safety_lockout' })
  recordError({ errorMessage: 'bad sev ignored', severity: 'nonsense' })

  const all = queryErrors({})
  assert.equal(all.total, 3)

  const critical = queryErrors({ severity: 'critical' })
  assert.equal(critical.total, 1)
  assert.equal(critical.errors[0].error_message, 'boom')

  const byPhase = queryErrors({ phase: 'vision' })
  assert.equal(byPhase.total, 1)
})

test('summarizeVisionPhases counts vision passes', () => {
  assert.equal(summarizeVisionPhases(null), null)
  assert.equal(summarizeVisionPhases([{ phase: 'close_clamps' }]), null)
  assert.equal(
    summarizeVisionPhases([
      { phase: 'vision_welding_splice', pass: true },
      { phase: 'vision_heat_shrink_tube', pass: false },
      { phase: 'close_clamps' },
    ]),
    '1/2 pass',
  )
  assert.equal(
    summarizeVisionPhases([
      { phase: 'vision_welding_splice', result: 'PASS' },
      { phase: 'vision_heat_shrink_tube', result: 'FAIL' },
    ]),
    '1/2 pass',
  )
})

test('CSV export includes header and rows', () => {
  const csv = exportProductionRuns('csv')
  assert.match(csv, /^id,timestamp,reference_id/)
  assert.match(csv, /Alpha/)
  assert.match(csv, /PASS/)

  const errCsv = exportErrors('csv')
  assert.match(errCsv, /^id,timestamp,error_code/)
  assert.match(errCsv, /boom/)
})

test('JSON export parses to arrays', () => {
  const runs = JSON.parse(exportProductionRuns('json'))
  assert.ok(Array.isArray(runs))
  assert.equal(runs.length, 2)
})

test('archiveAndPrune removes old records and writes an archive file', () => {
  const before = queryProductionRuns({}).total
  assert.ok(before >= 2)

  const result = archiveAndPrune({ retentionDays: 1 })
  // Both seeded runs are dated in early 2026, well past a 1-day cutoff.
  assert.ok(result.archivedRuns >= 2)
  assert.ok(result.archiveFile)
  assert.ok(fs.existsSync(result.archiveFile))

  const after = queryProductionRuns({}).total
  assert.equal(after, 0)
})

test('archiveAndPrune is a no-op for non-positive retention', () => {
  const result = archiveAndPrune({ retentionDays: 0 })
  assert.equal(result.skipped, true)
  assert.equal(result.archivedRuns, 0)
})
