/**
 * In-memory SettingsRegistry — domain-keyed cache with etags.
 */
import { createHash } from 'node:crypto'

function etagFor(domainId, schemaVersion, data) {
  const payload = JSON.stringify({ domainId, schemaVersion, data })
  return `"${createHash('sha1').update(payload).digest('hex').slice(0, 16)}"`
}

export function createSettingsRegistry() {
  /** @type {Map<string, { schemaVersion: number, data: object, etag: string, updatedAt: string }>} */
  const cache = new Map()

  function set(domainId, schemaVersion, data, updatedAt = new Date().toISOString()) {
    const etag = etagFor(domainId, schemaVersion, data)
    const entry = { schemaVersion, data, etag, updatedAt }
    cache.set(domainId, entry)
    return entry
  }

  function get(domainId) {
    return cache.get(domainId) || null
  }

  function has(domainId) {
    return cache.has(domainId)
  }

  function invalidate(domainId) {
    cache.delete(domainId)
  }

  function clear() {
    cache.clear()
  }

  function catalog() {
    return [...cache.entries()].map(([id, entry]) => ({
      domain: id,
      schemaVersion: entry.schemaVersion,
      etag: entry.etag,
      updatedAt: entry.updatedAt,
    }))
  }

  return { set, get, has, invalidate, clear, catalog }
}
