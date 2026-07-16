import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ENV_PATH = path.join(__dirname, '..', '.env')

/**
 * Load backend/.env into process.env (does not override existing exports).
 * Shell `source .env` does not export to child processes — use this in scripts.
 * @param {string} [envPath]
 */
export function loadBackendEnv(envPath = DEFAULT_ENV_PATH) {
  if (!fs.existsSync(envPath)) return { loaded: false, path: envPath, keys: 0 }
  const text = fs.readFileSync(envPath, 'utf8')
  let keys = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
      keys++
    }
  }
  return { loaded: true, path: envPath, keys }
}
