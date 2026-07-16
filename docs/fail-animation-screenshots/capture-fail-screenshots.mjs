#!/usr/bin/env node
/** Re-run: cd frontend && node scripts/capture-fail-screenshots.mjs */
import { spawnSync } from 'node:child_process'
const r = spawnSync(
  process.execPath,
  ['scripts/capture-fail-screenshots.mjs'],
  { cwd: new URL('../../frontend/', import.meta.url).pathname, stdio: 'inherit' },
)
process.exit(r.status ?? 1)
