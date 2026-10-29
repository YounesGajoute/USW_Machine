import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectionPresentation, inspectionVerdict } from './realtimePresentation.mjs'

test('nested failed tube and accepted weld identify only the failed component', () => {
  const model = inspectionPresentation({ outcome: 'FAIL', checks: {
    welding_splice: { length: { outcome: 'PASS', measured_length_mm: 12 } },
    heat_shrink_tube: { checks: { position: { status: 'NG', offset_mm: 2 } } },
  } })
  assert.equal(model.groups.welding_splice.verdict, 'PASS')
  assert.equal(model.groups.heat_shrink_tube.verdict, 'FAIL')
  assert.deepEqual(model.groups.heat_shrink_tube.rows[0].fields, [['offset_mm', 2]])
})
test('unknown global failures never fabricate failed components', () => {
  const model = inspectionPresentation({ verdict: 'FAIL', checks: { other: { result: 'FAIL' } } })
  assert.equal(model.groups.welding_splice.verdict, 'UNKNOWN')
  assert.equal(model.groups.heat_shrink_tube.verdict, 'UNKNOWN')
  assert.equal(model.unknown.length, 1)
  assert.equal(inspectionVerdict({ enabled: true, valid: true, ok: true }), 'UNKNOWN')
})
test('disabled checks do not highlight failures; flat identifiers work', () => {
  const model = inspectionPresentation({ checks: {
    'welding_splice.length': { status: 'NG', enabled: false },
    heat_shrink_tube_position: { pass: false },
  } })
  assert.equal(model.groups.welding_splice.verdict, 'SKIPPED')
  assert.equal(model.groups.heat_shrink_tube.verdict, 'FAIL')
})
test('missing judgments and disabled parent propagate without an inferred pass', () => {
  const model = inspectionPresentation({ checks: {
    welding_splice: { length: { pass: true }, width: { measured_mm: 5 } },
    heat_shrink_tube: { enabled: false, checks: { position: { pass: false } } },
  } })
  assert.equal(model.groups.welding_splice.verdict, 'UNKNOWN')
  assert.equal(model.groups.heat_shrink_tube.verdict, 'SKIPPED')
})
