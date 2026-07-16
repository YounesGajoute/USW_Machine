/**
 * Secrets store — vision API keys kept out of public settings documents.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { getDbPath } from '../db.mjs'

const SECRET_KEYS = ['vision_remote_key', 'vision_local_key']

function deriveKey(secret) {
  return createHash('sha256').update(String(secret || 'us-machine-settings')).digest()
}

function encrypt(plain, keyMaterial) {
  if (plain == null || plain === '') return null
  const key = deriveKey(keyMaterial)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

function decrypt(blob, keyMaterial) {
  if (!blob) return null
  try {
    const buf = Buffer.from(String(blob), 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const data = buf.subarray(28)
    const key = deriveKey(keyMaterial)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export function ensureSecretsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings_secrets (
      key TEXT PRIMARY KEY,
      value_enc TEXT,
      updated_at TEXT NOT NULL
    );
  `)
}

function resolveKeyMaterial() {
  return process.env.SETTINGS_SECRETS_KEY || process.env.SESSION_SECRET || 'us-machine-settings'
}

/**
 * Load secrets preferring env overrides, then encrypted DB rows.
 * @returns {Record<string, string|null>}
 */
export function loadSecrets(db) {
  ensureSecretsTable(db)
  const out = {}
  for (const key of SECRET_KEYS) {
    const envName = key.toUpperCase()
    if (process.env[envName]) {
      out[key] = process.env[envName]
      continue
    }
    const row = db.prepare('SELECT value_enc FROM settings_secrets WHERE key = ?').get(key)
    out[key] = row?.value_enc ? decrypt(row.value_enc, resolveKeyMaterial()) : null
  }
  return out
}

/**
 * Persist secrets (null clears). Env-defined secrets are not overwritten in DB.
 */
export function saveSecrets(db, patch) {
  ensureSecretsTable(db)
  const now = new Date().toISOString()
  const upsert = db.prepare(`
    INSERT INTO settings_secrets (key, value_enc, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at
  `)
  const del = db.prepare('DELETE FROM settings_secrets WHERE key = ?')
  for (const key of SECRET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch || {}, key)) continue
    const envName = key.toUpperCase()
    if (process.env[envName]) continue
    const value = patch[key]
    if (value == null || value === '') {
      del.run(key)
    } else {
      upsert.run(key, encrypt(value, resolveKeyMaterial()), now)
    }
  }
  return loadSecrets(db)
}

/** Masked projection for ADMIN responses. */
export function maskSecrets(secrets) {
  const out = {}
  for (const key of SECRET_KEYS) {
    const v = secrets?.[key]
    out[key] = v ? '••••••••' : null
  }
  return out
}

export function secretKeyNames() {
  return [...SECRET_KEYS]
}

/** Optional: path hint for ops docs */
export function secretsStorageHint() {
  return path.join(path.dirname(getDbPath()), 'settings_secrets (sqlite)')
}

void fs
