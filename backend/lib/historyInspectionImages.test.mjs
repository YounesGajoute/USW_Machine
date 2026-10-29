import test from 'node:test'
import assert from 'node:assert/strict'
import { historyInspectionImagePath } from './historyInspectionImages.mjs'

const details = inspection => ({ phases: [{ phase: 'vision_realtime_v2', inspection }] })
test('history resolves only the selected run and requested image kind', () => {
  const urls = { product: '/api/realtime/inspection/results/one/product.png', welding_splice: '/api/results/one/weld.png', heat_shrink_tube: '/api/results/one/tube.png' }
  for (const kind of Object.keys(urls)) {
    assert.equal(historyInspectionImagePath(details({ image_urls: urls }), kind), urls[kind])
    assert.equal(historyInspectionImagePath(details({ result: { image_urls: urls } }), kind), urls[kind])
    assert.equal(historyInspectionImagePath(details({ status: { last_result: { image_urls: urls } } }), kind), urls[kind])
  }
  assert.equal(historyInspectionImagePath(details({ image_urls: urls }), 'other'), null)
  assert.equal(historyInspectionImagePath({}, 'product'), null)
  assert.equal(historyInspectionImagePath({ phases: {} }, 'product'), null)
  assert.equal(historyInspectionImagePath(details({}), 'product'), null)
})
test('history refuses unsafe, mutable and expired-proxy paths', () => {
  for (const path of ['https://example.com/a.png', '//example.com/a.png', '/api/../private', '/api/results/latest/product.png', '/api/realtime/inspection/reference/image', '/api/realtime-v2/images/old-token']) {
    assert.equal(historyInspectionImagePath(details({ image_urls: { product: path } }), 'product'), null)
  }
})
