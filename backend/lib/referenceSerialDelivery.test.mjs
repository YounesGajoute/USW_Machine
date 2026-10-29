import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordReferenceSerialDelivery, getReferenceSerialDeliveryBlockReason } from './referenceSerialDelivery.mjs'

const status = (referenceId, selectionRevision, required) =>
  getReferenceSerialDeliveryBlockReason({ referenceId, selectionRevision, required })

test('production requires delivery to every enabled destination for the exact reference selection', () => {
  recordReferenceSerialDelivery({ referenceId: 'REF-A', selectionRevision: '10', required: ['weld', 'shrink'], sentTo: ['shrink'] })
  assert.match(status('REF-A', '10', ['weld', 'shrink']), /not sent to weld/)
  assert.match(status('REF-A', '11', ['weld', 'shrink']), /has not been sent/)
  assert.match(status('REF-B', '10', ['weld', 'shrink']), /has not been sent/)
  recordReferenceSerialDelivery({ referenceId: 'REF-A', selectionRevision: '10', required: ['weld', 'shrink'], sentTo: ['weld', 'shrink'] })
  assert.equal(status('REF-A', '10', ['weld', 'shrink']), null)
  assert.match(status('REF-A', '10', ['weld', 'shrink', 'other']), /has not been sent/)
  assert.equal(status('REF-A', '10', []), null)
})
