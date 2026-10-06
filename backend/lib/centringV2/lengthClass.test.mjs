import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyLengthClass,
  lEffFromRecipe,
  LENGTH_CLASS_A,
  LENGTH_CLASS_B,
} from './lengthClass.mjs'

test('40 and 55 are Class A', () => {
  assert.equal(classifyLengthClass(40).class, LENGTH_CLASS_A)
  assert.equal(classifyLengthClass(55).class, LENGTH_CLASS_A)
})

test('55.01 and 100 are Class B', () => {
  assert.equal(classifyLengthClass(55.01).class, LENGTH_CLASS_B)
  assert.equal(classifyLengthClass(100).class, LENGTH_CLASS_B)
})

test('39.9 and 100.1 are rejected as out of range', () => {
  for (const l of [39.9, 100.1]) {
    const r = classifyLengthClass(l)
    assert.equal(r.ok, false)
    assert.equal(r.code, 'LEFF_OUT_OF_RANGE')
    assert.equal(r.class, undefined)
  }
})

test('NaN, missing, empty and non-numeric are rejected with no default class', () => {
  for (const l of [NaN, undefined, null, '', 'abc', Infinity]) {
    const r = classifyLengthClass(l)
    assert.equal(r.ok, false, `value ${String(l)}`)
    assert.equal(r.code, 'LEFF_MISSING')
    assert.equal(r.class, undefined)
  }
})

test('numeric strings from the database are accepted', () => {
  assert.equal(classifyLengthClass('66.5').class, LENGTH_CLASS_B)
})

test('lEffFromRecipe reads persisted and resolved field names', () => {
  assert.equal(lEffFromRecipe({ l_eff_mm: 50 }), 50)
  assert.equal(lEffFromRecipe({ L_eff_mm: 60 }), 60)
  assert.equal(lEffFromRecipe(null), undefined)
})
