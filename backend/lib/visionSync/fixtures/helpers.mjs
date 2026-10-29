import Database from 'better-sqlite3'
import { createVisionSyncStore } from '../store.mjs'
import { createVisionSyncService } from '../service.mjs'
import { CONTRACT_ID } from '../protocol.mjs'

export function fixture({ getPolicyIssues, getServiceState } = {}) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE product_references (id TEXT PRIMARY KEY, name TEXT, is_active INTEGER,
    vision_inspection_enabled INTEGER, vision_checks_json TEXT, shrink_tube_id TEXT,
    realtime_v2_config_json TEXT, updated_at TEXT);
    CREATE TABLE shrink_tubes (id TEXT PRIMARY KEY, length_mm REAL, diameter_mm REAL);`)
  db.prepare('INSERT INTO shrink_tubes VALUES (?, ?, ?)').run('tube', 50, 10)
  const checks = {
    welding_splice: { enabled: true, length_check: true, width_check: false, position_check: false },
    heat_shrink_tube: { enabled: false, length_check: false, diameter_check: false, position_check: false },
  }
  const sourceFingerprint = { vision_inspection_enabled: true, checks, shrink_tube_id: 'tube', length_mm: 50, diameter_mm: 10 }
  const config = { welding_splice: { expected_length_mm: 10, length_tolerance_mm: 1 } }
  const insert = db.prepare('INSERT INTO product_references VALUES (?, ?, 1, ?, ?, ?, ?, ?)')
  insert.run('reference-A', 'reference-A', 1, JSON.stringify(checks), 'tube',
    JSON.stringify({ reference_fingerprint: JSON.stringify(sourceFingerprint), config }), '')
  insert.run('reference-B', 'reference-B', 0, JSON.stringify(checks), 'tube', '', '')
  const store = createVisionSyncStore(db)
  let selected = { referenceId: 'reference-A', selectionRevision: '1' }
  const getSelection = () => ({ ...selected })
  let nextId = 0
  const service = createVisionSyncService({ store, getSelection, deviceId: 'slave-example',
    bootId: 'master-boot-1', uuid: () => `session-${++nextId}`, getPolicyIssues, getServiceState })
  const registration = { protocolVersion: 1, contractId: CONTRACT_ID, requestId: 'register-example',
    deviceId: 'slave-example', slaveBootId: 'slave-boot-example', ledgerId: 'ledger-example' }
  function select(referenceId) { selected = { referenceId, selectionRevision: String(BigInt(selected.selectionRevision) + 1n) } }
  function stateRequest(response, requestId = 'poll-example') { return { ...response, requestId } }
  function report(state, overrides = {}) {
    return { protocolVersion: 1, contractId: CONTRACT_ID, requestId: 'ready-example',
      reportSequence: '1', binding: { ...state.binding, localRevision: '1' }, phase: 'ready',
      ledgerId: 'ledger-example', ledgerDiscontinuity: false, enabled: true, active: false,
      locallyReady: true, busy: false, installedGrantId: null, issues: [], ...overrides }
  }
  return { db, store, service, registration, select, getSelection, stateRequest, report }
}
