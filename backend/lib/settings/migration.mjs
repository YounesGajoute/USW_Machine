/**
 * Domain table schema + blob → domain migration.
 */
import { createHash } from 'node:crypto'
import { listDomains } from './domainRegistry.mjs'
import './domains/all.mjs'

export const FRAMEWORK_SCHEMA_VERSION = 1

export function ensureSettingsDomainTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS settings_domain (
      domain TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      json TEXT NOT NULL,
      checksum TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );
  `)
}

export function checksumJson(data) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex')
}

function readBlob(db) {
  const row = db.prepare('SELECT json FROM system_settings WHERE id = 1').get()
  try {
    return JSON.parse(row?.json || '{}')
  } catch {
    return {}
  }
}

/**
 * Extract domain payload from a legacy flat blob.
 */
export function extractDomainFromBlob(domain, blob) {
  const keys = domain.blobKeys || []
  if (domain.id === 'pick_place') {
    return domain.normalize(blob.pick_place_config)
  }
  if (domain.id === 'production_sequence') {
    return domain.normalize(blob.production_sequence_config)
  }
  if (domain.id === 'serial') {
    return domain.normalize(blob.reference_serial)
  }
  if (domain.id === 'access') {
    return domain.normalize(blob.role_tab_access)
  }
  if (domain.id === 'vision') {
    return domain.normalize({
      vision_general_tool_template: blob.vision_general_tool_template,
      vision_url: blob.vision_url ?? null,
    })
  }
  const raw = {}
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(blob, key)) {
      raw[key] = blob[key]
    }
  }
  return domain.normalize(Object.keys(raw).length ? raw : domain.defaults())
}

/**
 * One-shot: if settings_domain is empty, split system_settings blob into domains.
 * Also heals missing domains on later boots.
 */
export function migrateBlobToDomains(db, { updatedBy = 'migration' } = {}) {
  ensureSettingsDomainTables(db)
  const now = new Date().toISOString()
  const blob = readBlob(db)
  const existing = new Set(
    db.prepare('SELECT domain FROM settings_domain').all().map((r) => r.domain),
  )

  const upsert = db.prepare(`
    INSERT INTO settings_domain (domain, schema_version, json, checksum, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain) DO NOTHING
  `)

  const tx = db.transaction(() => {
    for (const domain of listDomains()) {
      if (existing.has(domain.id)) continue
      let data = extractDomainFromBlob(domain, blob)
      if (typeof domain.migrate === 'function' && domain.schemaVersion > 1) {
        // future stepwise migrations start from stored version; first insert uses current schema
      }
      data = domain.normalize(data)
      const json = JSON.stringify(data)
      upsert.run(domain.id, domain.schemaVersion, json, checksumJson(data), now, updatedBy)
    }

    const meta = db.prepare('SELECT id FROM settings_meta WHERE id = 1').get()
    if (!meta) {
      db.prepare(
        'INSERT INTO settings_meta (id, schema_version, updated_at, updated_by) VALUES (1, ?, ?, ?)',
      ).run(FRAMEWORK_SCHEMA_VERSION, now, updatedBy)
    }
  })
  tx()
  return listDomains().map((d) => d.id)
}

/**
 * Mirror assembled domains back into legacy system_settings.json for dual-read soak.
 */
export function mirrorDomainsToBlob(db, assembledFlat) {
  db.prepare('UPDATE system_settings SET json = ? WHERE id = 1').run(JSON.stringify(assembledFlat))
}

/**
 * Load + migrate a stored domain row to current schemaVersion.
 */
export function loadDomainRow(db, domain) {
  const row = db.prepare(
    'SELECT schema_version, json, checksum, updated_at, updated_by FROM settings_domain WHERE domain = ?',
  ).get(domain.id)
  if (!row) {
    const data = domain.normalize(domain.defaults())
    return {
      data,
      schemaVersion: domain.schemaVersion,
      updatedAt: new Date().toISOString(),
      updatedBy: 'defaults',
    }
  }
  let parsed = {}
  try {
    parsed = JSON.parse(row.json || '{}')
  } catch {
    parsed = domain.defaults()
  }
  let version = Number(row.schema_version) || 1
  let data = parsed
  while (version < domain.schemaVersion) {
    data = domain.migrate(version, data)
    version += 1
  }
  data = domain.normalize(data)
  return {
    data,
    schemaVersion: domain.schemaVersion,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export function writeDomainRow(db, domain, data, { updatedBy = null } = {}) {
  const now = new Date().toISOString()
  const normalized = domain.normalize(data)
  const json = JSON.stringify(normalized)
  db.prepare(`
    INSERT INTO settings_domain (domain, schema_version, json, checksum, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET
      schema_version = excluded.schema_version,
      json = excluded.json,
      checksum = excluded.checksum,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(domain.id, domain.schemaVersion, json, checksumJson(normalized), now, updatedBy)
  db.prepare(
    'UPDATE settings_meta SET schema_version = ?, updated_at = ?, updated_by = ? WHERE id = 1',
  ).run(FRAMEWORK_SCHEMA_VERSION, now, updatedBy)
  return { data: normalized, updatedAt: now }
}
