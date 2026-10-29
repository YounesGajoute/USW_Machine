import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canonical, recipeDigest, normalizeRecipe, validateRegistration, validateStateRequest, validateAck, ISSUES_JSON_MAX_BYTES } from './protocol.mjs'
import { parseStrictJson } from './router.mjs'

const proposal = JSON.parse(readFileSync(new URL('./fixtures/slave-proposal.json', import.meta.url), 'utf8'))

test('supplied Slave fixture schemas and digest agree', () => {
  validateRegistration(proposal.registrationRequest)
  validateStateRequest(proposal.stateRequest)
  validateAck(proposal.readyReport)
  validateAck(proposal.installedReport)
  assert.equal(recipeDigest(true, proposal.stateResponse.recipe), proposal.stateResponse.binding.recipeDigest)
})
test('no-reference and presence-only digest vectors', () => {
  assert.equal(recipeDigest(false, null), 'sha256:98abaf4522dbe5f831319add889a47de0adc48a2311abc19ce75e1804539e6bf')
  const recipe = normalizeRecipe({ welding_splice: {}, heat_shrink_tube: { enabled: true, position_check: true } }, {})
  assert.equal(recipeDigest(true, recipe), 'sha256:55b60a32118fd52d237d0d81a984093bb4165266142236cc3d429cb360cc8c04')
  const dimensional = structuredClone(recipe)
  dimensional.heat_shrink_tube.checks.length.enabled = true
  dimensional.heat_shrink_tube.expected_length_mm = 50
  dimensional.heat_shrink_tube.length_tolerance_mm = 2
  assert.equal(recipeDigest(true, dimensional), 'sha256:59a470752bc01ad1efbbcd6eed01d3a875380fb2cba259ffefb2c01e062cb9e4')
})
test('canonical serialization: key ordering, numeric representation and invalid values', () => {
  assert.equal(canonical({ z: -0, a: [1e-7, 1e30, 4.50, '😀'] }), '{"a":[1e-7,1e+30,4.5,"😀"],"z":0}')
  for (const value of [NaN, Infinity, undefined, '\ud800', '\udc00', { bad: undefined }]) assert.throws(() => canonical(value))
  assert.equal(canonical({ '\ue000': 1, '😀': 2 }), '{"😀":2,"":1}')
})
test('strict schema rejects missing, unknown, null flags and noncanonical revisions', () => {
  for (const patch of [{ extra: 1 }, { enabled: null }, { reportSequence: '01' }, { reportSequence: '-1' }, { reportSequence: '1'.repeat(41) }]) {
    assert.throws(() => validateAck({ ...proposal.readyReport, ...patch }))
  }
  assert.throws(() => validateRegistration({ ...proposal.registrationRequest, contractId: 'different' }), { code: 'PROTOCOL_INCOMPATIBLE' })
  const report = structuredClone(proposal.readyReport)
  delete report.busy
  assert.throws(() => validateAck(report))
})
test('normalizer allowlists fields, drops inactive dimensions and needs no calibration for presence', () => {
  const checks = { welding_splice: { enabled: false, length_check: true }, heat_shrink_tube: { enabled: true, position_check: true } }
  const result = normalizeRecipe(checks, { calibration: { valid: false }, weld_zone: {}, welding_splice: { expected_length_mm: 999, extra: 'never' } })
  assert.equal(result.welding_splice.expected_length_mm, null)
  assert.equal(result.welding_splice.enabled, false)
  assert.equal(result.heat_shrink_tube.checks.position.enabled, true)
  assert.deepEqual(Object.keys(result), ['welding_splice', 'heat_shrink_tube'])
  assert.equal('extra' in result.welding_splice, false)
})
test('active values accept zero tolerance, reject strings, missing dimensions and negative tolerance', () => {
  const checks = { welding_splice: { enabled: true, length_check: true }, heat_shrink_tube: {} }
  for (const stored of [{}, { expected_length_mm: '10', length_tolerance_mm: 0 }, { expected_length_mm: 10, length_tolerance_mm: -1 }]) {
    assert.throws(() => normalizeRecipe(checks, { welding_splice: stored }))
  }
  assert.equal(normalizeRecipe(checks, { welding_splice: { expected_length_mm: 10, length_tolerance_mm: 0 } }).welding_splice.length_tolerance_mm, 0)
})
test('JSON duplicate keys including escaped aliases are rejected', () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":[{"a":1,"a":2}]}']) assert.throws(() => parseStrictJson(text))
  assert.deepEqual(parseStrictJson('{"a":{"x":1},"b":{"x":2},"text":"{\\\"a\\\":1}"}'), { a: { x: 1 }, b: { x: 2 }, text: '{"a":1}' })
})

test('diagnostic budget counts UTF-8 JSON bytes including escaping and delimiters', () => {
  const issues = [...Array(15).fill('a'.repeat(1024)), 'a'.repeat(975)]
  assert.equal(Buffer.byteLength(JSON.stringify(issues), 'utf8'), ISSUES_JSON_MAX_BYTES)
  validateAck({ ...proposal.readyReport, issues })
  for (const oversized of [
    [...issues.slice(0, -1), issues.at(-1) + 'a'],
    Array(8).fill('😀'.repeat(512)),
    Array(6).fill('\u0000'.repeat(512)),
  ]) {
    assert.ok(oversized.every(s => s.length <= 1024))
    assert.throws(() => validateAck({ ...proposal.readyReport, issues: oversized }), { code: 'VALIDATION_ERROR', status: 422 })
  }
})
