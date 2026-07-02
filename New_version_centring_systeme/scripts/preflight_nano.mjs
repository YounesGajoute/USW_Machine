#!/usr/bin/env node
import { diagnoseConnection } from '../centring_master.js'

const diag = await diagnoseConnection()
console.log(`=== Centring Nano preflight → ${diag.target} ===\n`)
console.log(diag.report || '')
if (diag.ok) {
  console.log(`\nAll checks passed — ${diag.localIp} → ${diag.target}`)
  process.exit(0)
}
process.exit(1)
