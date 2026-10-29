const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null
export const inspectionGroups = ['welding_splice', 'heat_shrink_tube']
export function inspectionVerdict(value) {
  if (object(value)) {
    if (value.enabled === false || value.skipped === true) return 'SKIPPED'
    const explicit = value.verdict ?? value.outcome ?? value.result ?? value.status
    if (typeof explicit === 'string') return inspectionVerdict(explicit)
    if (typeof value.pass === 'boolean') return value.pass ? 'PASS' : 'FAIL'
    if (typeof value.passed === 'boolean') return value.passed ? 'PASS' : 'FAIL'
    return 'UNKNOWN'
  }
  const text = typeof value === 'string' ? value.toUpperCase() : ''
  if (['PASS', 'OK'].includes(text)) return 'PASS'
  if (['FAIL', 'NG'].includes(text)) return 'FAIL'
  if (['SKIPPED', 'DISABLED'].includes(text)) return 'SKIPPED'
  return 'UNKNOWN'
}

/** An enabled check or a valid measurement is not a PASS. Only explicit judgments count. */
export function inspectionPresentation(result) {
  const groups = Object.fromEntries(inspectionGroups.map(key => [key, { verdict: 'UNKNOWN', rows: [] }]))
  const unknown = []
  function visit(value, path, group, disabled = false) {
    const record = object(value)
    const key = path.join('.').toLowerCase().replace(/[ -]/g, '_')
    group = inspectionGroups.find(name => key === name || key.startsWith(name + '.') || key.startsWith(name + '_')) ?? group
    const isDisabled = disabled || record?.enabled === false || record?.skipped === true
    const children = record ? Object.entries(record).filter(([, item]) => object(item)) : []
    if (children.length && inspectionVerdict(value) === 'UNKNOWN') {
      for (const [name, item] of children) visit(item, [...path, name], group, isDisabled)
      return
    }
    const name = path.filter(part => !inspectionGroups.includes(part) && part !== 'checks').join(' · ')
      .replace(/^(welding_splice|heat_shrink_tube)[._]/, '').replace(/[_-]/g, ' ') || 'Inspection'
    const verdict = isDisabled ? 'SKIPPED' : inspectionVerdict(value)
    const fields = record ? Object.entries(record).filter(([name, item]) =>
      !['enabled', 'skipped', 'pass', 'passed', 'verdict', 'outcome', 'result', 'status'].includes(name) &&
      (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) : []
    const row = { name, verdict, fields }
    if (group) groups[group].rows.push(row)
    else unknown.push(row)
    if (children.length) for (const [name, item] of children) visit(item, [...path, name], group, isDisabled)
  }
  for (const [key, value] of Object.entries(object(result?.checks) ?? {})) visit(value, [key], null)
  for (const group of Object.values(groups)) {
    const active = group.rows.filter(row => row.verdict !== 'SKIPPED')
    group.verdict = active.some(row => row.verdict === 'FAIL') ? 'FAIL'
      : active.length && active.every(row => row.verdict === 'PASS') ? 'PASS'
      : group.rows.length && !active.length ? 'SKIPPED' : 'UNKNOWN'
  }
  return { verdict: inspectionVerdict(result), groups, unknown }
}
