/**
 * Settings backup / restore / import / export packages.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import { getDbPath } from '../db.mjs'
import { SettingsError } from './errors.mjs'
import { FRAMEWORK_SCHEMA_VERSION } from './migration.mjs'

const PACKAGE_VERSION = 1

function packageDir() {
  const dir = path.join(path.dirname(getDbPath()), 'settings-backups')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function hmacKey() {
  return process.env.SETTINGS_EXPORT_HMAC_KEY || process.env.SESSION_SECRET || ''
}

function sign(payload) {
  const key = hmacKey()
  if (!key) return null
  return createHmac('sha256', key).update(payload).digest('hex')
}

function checksum(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

/**
 * Build an export/backup package object (not yet written to disk).
 */
export function buildSettingsPackage({ domains, meta, includeSecrets = false, secrets = null }) {
  const body = {
    packageVersion: PACKAGE_VERSION,
    frameworkSchemaVersion: FRAMEWORK_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    meta: meta || null,
    domains,
  }
  if (includeSecrets && secrets) {
    body.secrets = secrets
  }
  const checksumValue = checksum({ domains: body.domains, secrets: body.secrets || null })
  const signature = sign(checksumValue)
  return {
    ...body,
    checksum: checksumValue,
    signature,
  }
}

export function verifySettingsPackage(pkg, { requireSignature = false } = {}) {
  if (!pkg || typeof pkg !== 'object') {
    throw new SettingsError('INVALID_PACKAGE', 'Package must be an object', { status: 400 })
  }
  if (Number(pkg.packageVersion) !== PACKAGE_VERSION) {
    throw new SettingsError('INVALID_PACKAGE', `Unsupported packageVersion ${pkg.packageVersion}`, {
      status: 400,
    })
  }
  if (!pkg.domains || typeof pkg.domains !== 'object') {
    throw new SettingsError('INVALID_PACKAGE', 'Package missing domains', { status: 400 })
  }
  const expected = checksum({ domains: pkg.domains, secrets: pkg.secrets || null })
  if (pkg.checksum && pkg.checksum !== expected) {
    throw new SettingsError('CHECKSUM_MISMATCH', 'Package checksum mismatch', { status: 400 })
  }
  const key = hmacKey()
  if (pkg.signature && key) {
    const expectedSig = sign(expected)
    if (pkg.signature !== expectedSig) {
      throw new SettingsError('SIGNATURE_MISMATCH', 'Package signature mismatch', { status: 400 })
    }
  } else if (requireSignature && key) {
    throw new SettingsError('SIGNATURE_REQUIRED', 'Package signature required', { status: 400 })
  }
  return true
}

/**
 * Write package JSON to backups directory; returns path.
 */
export function writeBackupFile(pkg, prefix = 'settings-backup') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(packageDir(), `${prefix}-${stamp}.json`)
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2), 'utf8')
  return filePath
}

export function readBackupFile(filePath) {
  const abs = path.resolve(filePath)
  if (!abs.startsWith(packageDir()) && !abs.startsWith(path.dirname(getDbPath()))) {
    // Allow absolute paths under data dir only
    const dataDir = path.dirname(getDbPath())
    if (!abs.startsWith(dataDir)) {
      throw new SettingsError('INVALID_PATH', 'Backup path must be under the data directory', {
        status: 400,
      })
    }
  }
  if (!fs.existsSync(abs)) {
    throw new SettingsError('NOT_FOUND', 'Backup file not found', { status: 404 })
  }
  return JSON.parse(fs.readFileSync(abs, 'utf8'))
}

export function listBackupFiles() {
  const dir = packageDir()
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((name) => {
      const full = path.join(dir, name)
      const st = fs.statSync(full)
      return { name, path: full, size: st.size, modified: st.mtime.toISOString() }
    })
    .sort((a, b) => (a.modified < b.modified ? 1 : -1))
}
