import { createHash } from 'node:crypto'

export const CONTRACT_ID = 'usm.vision.sync.v1.fixture-1'
// Commissioning profile bounds. String lengths use JavaScript UTF-16 units;
// diagnostic bytes include JSON quotes, separators and escaping, encoded as UTF-8.
export const REFERENCE_NAME_MAX_LENGTH = 300
export const ISSUES_JSON_MAX_BYTES = 16 * 1024
export const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/
export const REVISION_PATTERN = /^(0|[1-9][0-9]{0,39})$/
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
export const PHASES = ['requested', 'applied', 'loaded', 'ready', 'disabled', 'failed']
export const ENVELOPE_KEYS = ['protocolVersion', 'contractId', 'requestId']
export const SESSION_KEYS = ['masterId', 'masterBootId', 'deviceId', 'slaveBootId', 'sessionId', 'sessionGeneration']
export const BINDING_KEYS = [...SESSION_KEYS, 'selectionRevision', 'desiredRevision', 'referenceId', 'recipeRevision', 'recipeDigest']

export function problem(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status })
}

function invalid(message) { throw problem('VALIDATION_ERROR', message, 422) }
export function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) {
    invalid(`${label} must contain exactly: ${keys.join(', ')}`)
  }
  return value
}
export function id(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) invalid(`${label} must be a 1–128 character identifier`)
  return value
}
export function revision(value, label) {
  if (typeof value !== 'string' || !REVISION_PATTERN.test(value)) invalid(`${label} must be a canonical decimal revision`)
  return value
}
function envelope(value) {
  if (value.protocolVersion !== 1 || value.contractId !== CONTRACT_ID) {
    throw problem('PROTOCOL_INCOMPATIBLE', `Expected protocol 1 and ${CONTRACT_ID}`, 426)
  }
  id(value.requestId, 'requestId')
}
export function validateRegistration(value) {
  exact(value, [...ENVELOPE_KEYS, 'deviceId', 'slaveBootId', 'ledgerId'], 'registration')
  envelope(value)
  for (const key of ['deviceId', 'slaveBootId', 'ledgerId']) id(value[key], key)
  return value
}
function session(value) {
  for (const key of SESSION_KEYS.filter(k => k !== 'sessionGeneration')) id(value[key], key)
  revision(value.sessionGeneration, 'sessionGeneration')
}
export function validateStateRequest(value) {
  exact(value, [...ENVELOPE_KEYS, ...SESSION_KEYS], 'state request')
  envelope(value)
  session(value)
  return value
}
export function validateBinding(value, shared = false) {
  exact(value, [...BINDING_KEYS, ...(shared ? ['localRevision'] : [])], 'binding')
  session(value)
  for (const key of ['selectionRevision', 'desiredRevision']) revision(value[key], key)
  if (value.referenceId !== null) id(value.referenceId, 'referenceId')
  if (value.recipeRevision !== null) revision(value.recipeRevision, 'recipeRevision')
  if (value.referenceId === null && value.recipeRevision !== null) invalid('No reference must have a null recipe revision')
  if (value.referenceId !== null && value.recipeRevision === null) invalid('A reference requires a recipe revision')
  if (typeof value.recipeDigest !== 'string' || !DIGEST_PATTERN.test(value.recipeDigest)) invalid('Invalid recipeDigest')
  if (shared) revision(value.localRevision, 'localRevision')
  return value
}
export function validateAck(value) {
  exact(value, [...ENVELOPE_KEYS, 'binding', 'reportSequence', 'phase', 'ledgerId',
    'ledgerDiscontinuity', 'enabled', 'active', 'locallyReady', 'busy', 'installedGrantId', 'issues'], 'acknowledgement')
  envelope(value)
  validateBinding(value.binding, true)
  revision(value.reportSequence, 'reportSequence')
  id(value.ledgerId, 'ledgerId')
  if (!PHASES.includes(value.phase)) invalid('Invalid acknowledgement phase')
  for (const key of ['ledgerDiscontinuity', 'enabled', 'active', 'locallyReady', 'busy']) {
    if (typeof value[key] !== 'boolean') invalid(`${key} must be boolean`)
  }
  if (value.installedGrantId !== null) id(value.installedGrantId, 'installedGrantId')
  if (!Array.isArray(value.issues) || value.issues.length > 64 ||
      value.issues.some(v => typeof v !== 'string' || v.length > 1024)) invalid('issues must be bounded strings')
  if (Buffer.byteLength(JSON.stringify(value.issues), 'utf8') > ISSUES_JSON_MAX_BYTES) {
    invalid('issues JSON exceeds the 16384-byte diagnostic budget')
  }
  if (value.phase === 'ready' && (!value.enabled || !value.locallyReady)) invalid('Ready requires enabled and locallyReady')
  if (value.phase === 'loaded' && !value.enabled) invalid('Loaded requires enabled')
  if (value.phase === 'disabled' && (value.enabled || value.active || value.busy || value.locallyReady)) {
    invalid('Disabled must be confirmed idle, not enabled and not locally ready')
  }
  return value
}

// JCS for already parsed I-JSON. ECMAScript primitive serialization and UTF-16
// property ordering are intentional. Reject values JSON.stringify would coerce.
export function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('Canonical JSON requires finite numbers')
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) invalid('Invalid Unicode string')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    invalid('Canonical JSON requires plain JSON values')
  }
  return `{${Object.keys(value).sort().map(key => `${canonical(key)}:${canonical(value[key])}`).join(',')}}`
}
export function recipeDigest(requiredByReference, recipe) {
  return `sha256:${createHash('sha256').update(canonical({
    domain: 'usm.vision.recipe.v1', requiredByReference, recipe,
  }), 'utf8').digest('hex')}`
}

export const MEASUREMENTS = {
  welding_splice: {
    length: ['expected_length_mm', 'length_tolerance_mm'],
    width: ['expected_width_mm', 'width_tolerance_mm'],
    position: ['position_tolerance_mm'],
  },
  heat_shrink_tube: {
    length: ['expected_length_mm', 'length_tolerance_mm'],
    diameter: ['expected_diameter_mm', 'diameter_tolerance_mm'],
    position: [],
  },
}

/** Builds an allowlisted wire recipe; no calibration, geometry or live Slave data. */
export function normalizeRecipe(checks, stored) {
  const recipe = {}
  for (const [group, fieldsByCheck] of Object.entries(MEASUREMENTS)) {
    const switches = checks[group]
    const effective = Object.fromEntries(Object.keys(fieldsByCheck).map(check => [check, {
      enabled: switches.enabled === true && switches[`${check}_check`] === true,
    }]))
    const out = { enabled: Object.values(effective).some(c => c.enabled), checks: effective }
    for (const [check, fields] of Object.entries(fieldsByCheck)) {
      for (const field of fields) {
        const value = stored?.[group]?.[field]
        if (!effective[check].enabled) out[field] = null
        else {
          if (typeof value !== 'number' || !Number.isFinite(value) ||
              (field.startsWith('expected_') ? value <= 0 : value < 0)) invalid(`Invalid ${group}.${field}`)
          out[field] = value
        }
      }
    }
    recipe[group] = out
  }
  return recipe
}
