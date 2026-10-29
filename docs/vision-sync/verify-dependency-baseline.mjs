// Read-only verification of an isolated Master dependency installation.
// Never imports index.mjs, calls getDbPath(), or opens a persistent database.
import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

try {
  assert.equal(process.argv.length, 3, 'Usage: node verify-dependency-baseline.mjs <isolated-backend-directory>')
  const backend = realpathSync(resolve(process.argv[2]))
  const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
  const baseline = readJson(new URL('./dependency-baseline.json', import.meta.url))
  assert.equal(process.version, baseline.node, 'Node runtime differs from the tested candidate')
  const lockBytes = readFileSync(join(backend, 'package-lock.json'))
  assert.equal(createHash('sha256').update(lockBytes).digest('hex'), baseline.packageLockSha256, 'Master lockfile differs')
  const lock = JSON.parse(lockBytes)
  const pkg = readJson(join(backend, 'package.json'))
  assert.deepEqual(pkg.dependencies, lock.packages[''].dependencies, 'Package dependency declarations differ from lockfile')
  const installed = {}
  for (const name of Object.keys(pkg.dependencies)) {
    const actual = readJson(join(backend, 'node_modules', name, 'package.json')).version
    assert.equal(actual, lock.packages[`node_modules/${name}`].version, `${name} differs from the lockfile`)
    installed[name] = actual
  }
  const require = createRequire(join(backend, 'package.json'))
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  let sqlite
  try { sqlite = db.prepare('SELECT sqlite_version() AS version').get().version } finally { db.close() }
  assert.equal(sqlite, baseline.sqliteEngine, 'SQLite engine differs from the tested candidate')
  console.log(JSON.stringify({ verified: true, node: process.version,
    platform: process.platform, arch: process.arch, nodeModuleABI: process.versions.modules,
    dependencies: installed, sqlite, productionAuthorization: false }, null, 2))
} catch (error) {
  console.error(`Dependency baseline verification failed: ${error.message}`)
  process.exitCode = 1
}
