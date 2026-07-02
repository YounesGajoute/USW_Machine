#!/usr/bin/env node
/**
 * Move centring to an explicit gap (mm).
 *
 * Preview (no hardware):
 *   node scripts/load_reference.js --gap 18 --preview
 *
 * Apply on Nano (TCP):
 *   node scripts/load_reference.js --gap 18
 *   node scripts/load_reference.js --gap 18 --axis upper --home
 */

import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const masterUrl = pathToFileURL(path.join(__dirname, '..', 'master', 'centring_master.js')).href

function parseArgs(argv) {
  const out = {
    gapMm: null,
    axis: 'both',
    preview: false,
    home: false,
    speedDegS: null,
    connect: true,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--preview') out.preview = true
    else if (a === '--home') out.home = true
    else if (a === '--no-connect') out.connect = false
    else if (a === '--gap' && argv[i + 1]) out.gapMm = Number(argv[++i])
    else if (a === '--axis' && argv[i + 1]) out.axis = String(argv[++i])
    else if (a === '--speed' && argv[i + 1]) out.speedDegS = Number(argv[++i])
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`unknown arg: ${a}`)
  }
  return out
}

function usage() {
  console.log(`Usage: node scripts/load_reference.js --gap <mm> [options]

Options:
  --axis <both|upper|lower>  Move command (default: both)
  --preview                  Resolve move plan only (no TCP)
  --home                     HOME before loadGap
  --speed <deg/s>            Override movement speed
  --no-connect               Skip connectWithRetry
  -h, --help                 Show this help

Examples:
  node scripts/load_reference.js --gap 18 --preview
  node scripts/load_reference.js --gap 18 --axis both --home
`)
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    usage()
    return
  }
  if (!Number.isFinite(args.gapMm) || args.gapMm <= 0) {
    usage()
    throw new Error('--gap must be a positive number (mm)')
  }

  const master = await import(masterUrl)

  const resolved = master.resolveGapMove({
    gapMm: args.gapMm,
    axis: args.axis,
  })

  if (args.preview) {
    console.log(JSON.stringify(resolved, null, 2))
    return
  }

  const probe = await master.probeConnection()
  if (!probe.ok) {
    throw new Error(`Nano unreachable at ${probe.target}: ${probe.error}`)
  }

  if (args.connect) {
    await master.connectWithRetry()
  }
  if (args.home) {
    console.log('# HOME…')
    await master.homeBoth()
  }

  console.log('# loadGap', resolved)
  const result = await master.loadGap({
    gapMm: args.gapMm,
    axis: args.axis,
    speedDegS: args.speedDegS ?? undefined,
    connect: false,
  })

  const hErr = Math.abs(result.done.h - result.gapMm)
  console.log(JSON.stringify(result, null, 2))
  if (hErr > 0.5) {
    console.warn(`# warning: DONE h=${result.done.h} differs from gapMm=${result.gapMm} by ${hErr.toFixed(2)} mm`)
  } else {
    console.log(`# ok: h=${result.done.h} mm (target ${result.gapMm} mm)`)
  }
}

main().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
