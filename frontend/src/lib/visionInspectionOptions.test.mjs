/**
 * Lightweight contract test for master → Vision option mapping.
 * Mirrors frontend/src/lib/visionInspectionOptions.ts (keep in sync).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const CHECK_TO_OPTION = [
  ['welding_splice', 'length_check', 'welding_splice_length'],
  ['welding_splice', 'width_check', 'welding_splice_width'],
  ['welding_splice', 'position_check', 'welding_splice_position'],
  ['heat_shrink_tube', 'length_check', 'heat_shrink_length'],
  ['heat_shrink_tube', 'diameter_check', 'heat_shrink_diameter'],
  ['heat_shrink_tube', 'position_check', 'heat_shrink_position'],
]

function selectedOptionsFromVisionChecks(checks) {
  if (!checks || typeof checks !== 'object') return []
  const selected = []
  for (const [groupKey, flagKey, optionId] of CHECK_TO_OPTION) {
    const group = checks[groupKey]
    if (!group?.enabled) continue
    if (group[flagKey] === true) selected.push(optionId)
  }
  return selected
}

test('maps enabled welding + heat-shrink checks to Vision option ids', () => {
  const selected = selectedOptionsFromVisionChecks({
    welding_splice: {
      enabled: true,
      length_check: true,
      width_check: false,
      position_check: true,
    },
    heat_shrink_tube: {
      enabled: true,
      length_check: true,
      diameter_check: true,
      position_check: false,
    },
  })
  assert.deepEqual(selected, [
    'welding_splice_length',
    'welding_splice_position',
    'heat_shrink_length',
    'heat_shrink_diameter',
  ])
})

test('group disabled yields no options from that group', () => {
  const selected = selectedOptionsFromVisionChecks({
    welding_splice: {
      enabled: false,
      length_check: true,
      width_check: true,
      position_check: true,
    },
    heat_shrink_tube: {
      enabled: false,
      length_check: true,
      diameter_check: true,
      position_check: true,
    },
  })
  assert.deepEqual(selected, [])
})
