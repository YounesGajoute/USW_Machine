/**
 * Resolves the express-session signing secret.
 *
 * Priority:
 *   1. `SESSION_SECRET` from the environment (rejected if it is the old
 *      hard-coded placeholder or too short to be meaningful).
 *   2. A strong random secret persisted under the data directory, so sessions
 *      survive process restarts on a single-instance kiosk without requiring
 *      operators to manage an env var.
 *
 * This removes the previous behaviour of silently falling back to a shared,
 * source-controlled constant — which let anyone forge session cookies.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** The insecure default that used to ship in source — never allow it. */
export const INSECURE_PLACEHOLDER = 'app-dev-change-me-in-production'
const MIN_SECRET_LENGTH = 16
const SECRET_FILENAME = '.session-secret'

function readPersistedSecret(file) {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    return existing.length >= MIN_SECRET_LENGTH ? existing : null
  } catch {
    return null
  }
}

function createPersistedSecret(dataDir) {
  const file = path.join(dataDir, SECRET_FILENAME)
  const generated = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file, generated, { mode: 0o600 })
  // writeFileSync mode is masked by umask; enforce owner-only explicitly.
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    /* best-effort on filesystems without POSIX permissions */
  }
  return generated
}

/**
 * @param {object} opts
 * @param {string} opts.dataDir  Directory used to persist a generated secret.
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(msg: string) => void} [opts.warn]
 * @returns {string}
 */
export function resolveSessionSecret({ dataDir, env = process.env, warn = console.warn } = {}) {
  const fromEnv = typeof env.SESSION_SECRET === 'string' ? env.SESSION_SECRET.trim() : ''

  if (fromEnv) {
    if (fromEnv === INSECURE_PLACEHOLDER) {
      throw new Error(
        'SESSION_SECRET is set to the insecure placeholder value ' +
          `"${INSECURE_PLACEHOLDER}". Set a unique, random value ` +
          '(e.g. `openssl rand -hex 32`) before starting the server.',
      )
    }
    if (fromEnv.length < MIN_SECRET_LENGTH) {
      throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`)
    }
    return fromEnv
  }

  if (!dataDir) {
    throw new Error(
      'SESSION_SECRET is not set and no data directory is available to persist a generated secret.',
    )
  }

  const file = path.join(dataDir, SECRET_FILENAME)
  const persisted = readPersistedSecret(file)
  if (persisted) return persisted

  const generated = createPersistedSecret(dataDir)
  warn(
    `[auth] SESSION_SECRET not set — generated a persistent random secret at ${file}. ` +
      'Set SESSION_SECRET in the environment for multi-instance or reproducible deployments.',
  )
  return generated
}
