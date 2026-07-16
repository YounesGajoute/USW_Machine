/**
 * Domain registry contract helpers.
 * Each domain module exports a descriptor consumed by SettingsService.
 */

/**
 * @typedef {'device'|'medium'|'high'|'admin'|'bypass'|'secret'} Sensitivity
 */

/**
 * @typedef {object} DomainDescriptor
 * @property {string} id
 * @property {number} schemaVersion
 * @property {Sensitivity} sensitivity
 * @property {string|null} tabKey
 * @property {() => object} defaults
 * @property {(fromVersion: number, data: object) => object} migrate
 * @property {(current: object, patch: object) => object} mergePatch
 * @property {(data: unknown) => object} normalize
 * @property {(data: object) => object} [publicProjection]
 * @property {(data: object, runtime: object) => void} [onApply]
 * @property {Record<string, unknown>} [fieldMeta] — ranges/units for HMI
 * @property {string[]} [blobKeys] — legacy system_settings.json keys owned by this domain
 */

/** @type {Map<string, DomainDescriptor>} */
const domains = new Map()

/** @param {DomainDescriptor} descriptor */
export function registerDomain(descriptor) {
  if (!descriptor?.id) throw new Error('Domain descriptor requires id')
  domains.set(descriptor.id, descriptor)
  return descriptor
}

export function getDomain(id) {
  return domains.get(id) || null
}

export function listDomains() {
  return [...domains.values()]
}

export function clearDomainsForTests() {
  domains.clear()
}
