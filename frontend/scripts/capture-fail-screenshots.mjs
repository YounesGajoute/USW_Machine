#!/usr/bin/env node
/**
 * Capture Maincard FAIL animation screenshots for each vision check.
 * Saves PNGs into this directory.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = '/home/bot/US Machine/docs/fail-animation-screenshots'
const URL = process.env.HMI_URL || 'http://127.0.0.1:5173/#/'
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium'

const CASES = [
  {
    file: '00-baseline-assembly.png',
    label: 'Baseline assembly (no FAIL)',
    tools: null,
  },
  {
    file: '01-fail-weld-length.png',
    label: 'Welding Splice Length Check NG',
    tools: [{ name: 'Welding Splice Length Check', status: 'NG' }],
  },
  {
    file: '02-fail-weld-width.png',
    label: 'Welding Splice Width Check NG',
    tools: [{ name: 'Welding Splice Width Check', status: 'NG' }],
  },
  {
    file: '03-fail-weld-position.png',
    label: 'Welding Splice Position Check NG',
    tools: [{ name: 'Welding Splice Position Check', status: 'NG' }],
  },
  {
    file: '04-fail-hs-position.png',
    label: 'Heat-Shrink Tube Position Check NG',
    tools: [{ name: 'Heat-Shrink Tube Position Check', status: 'NG' }],
  },
  {
    file: '05-fail-hs-length.png',
    label: 'Heat-Shrink Tube Length Check NG',
    tools: [{ name: 'Heat-Shrink Tube Length Check', status: 'NG' }],
  },
  {
    file: '06-fail-hs-diameter.png',
    label: 'Heat-Shrink Tube Diameter Check NG',
    tools: [{ name: 'Heat-Shrink Tube Diameter Check', status: 'NG' }],
  },
]

const TINY =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function waitForMain(page) {
  await page.waitForFunction(
    () => !!document.querySelector('[aria-label="Main card"]'),
    { timeout: 20000 },
  )
}

async function findAndApply(page, tools) {
  return page.evaluate(
    ({ toolsArg, tiny }) => {
      function fiberOf(node) {
        const key = Object.keys(node).find(k => k.startsWith('__reactFiber$'))
        return key ? node[key] : null
      }
      function findVisionDispatch() {
        const rootEl = document.getElementById('root')
        const start = fiberOf(rootEl?.firstElementChild)
        const queue = [start]
        const seen = new Set()
        while (queue.length) {
          const f = queue.shift()
          if (!f || seen.has(f)) continue
          seen.add(f)
          let m = f.memoizedState
          let i = 0
          while (m && i < 80) {
            const val = m.memoizedState
            const q = m.queue
            if (val && typeof val === 'object' && 'lastResult' in val && 'masterImageB64' in val) {
              return q && q.dispatch
            }
            m = m.next
            i++
          }
          if (f.child) queue.push(f.child)
          if (f.sibling) queue.push(f.sibling)
        }
        return null
      }
      const dispatch = findVisionDispatch()
      if (!dispatch) throw new Error('vision dispatch not found')
      if (!toolsArg) {
        dispatch(prev => ({
          ...prev,
          lastResult: null,
          lastToolResults: null,
          lastImage: null,
          lastInspectedAt: null,
          isInspecting: false,
        }))
      } else {
        dispatch(prev => ({
          ...prev,
          lastResult: 'FAIL',
          lastImage: tiny,
          lastInspectedAt: new Date(),
          isInspecting: false,
          lastToolResults: toolsArg,
        }))
      }
      return true
    },
    { toolsArg: tools, tiny: TINY },
  )
}

async function snapState(page) {
  return page.evaluate(() => {
    const anim = document.querySelector('.wire-splice-vision-animation')
    const assembly = document.querySelector('img[src*="ProductComponentAssembly"]')
    const zone = document.querySelector(
      '[aria-label="Product component assembly"], [aria-label="Vision check result"]',
    )
    return {
      mode: anim ? 'ANIMATION' : assembly ? 'ASSEMBLY' : 'EMPTY',
      aria: zone?.getAttribute('aria-label') || null,
      texts: anim
        ? [...anim.querySelectorAll('text')].map(t => (t.textContent || '').trim()).filter(Boolean)
        : [],
    }
  })
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  // remove ping leftovers
  for (const f of ['ping.txt', 'ping2.txt', 'netcheck.txt']) {
    try {
      fs.unlinkSync(path.join(OUT, f))
    } catch {}
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  })

  const page = await browser.newPage()
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 })
  await waitForMain(page)
  // allow reference/master image to settle
  await new Promise(r => setTimeout(r, 1500))

  const index = []
  for (const c of CASES) {
    await findAndApply(page, c.tools)
    await new Promise(r => setTimeout(r, 700))
    const state = await snapState(page)
    const outPath = path.join(OUT, c.file)
    await page.screenshot({ path: outPath, type: 'png', fullPage: false })
    const size = fs.statSync(outPath).size
    index.push({ ...c, ...state, bytes: size, path: outPath })
    console.log(`${c.file}: ${state.mode} aria=${state.aria} texts=${JSON.stringify(state.texts)} (${size} B)`)
  }

  const md = [
    '# Vision FAIL animation screenshots',
    '',
    `Captured from \`${URL}\` on ${new Date().toISOString()}.`,
    '',
    '| File | Case | Mode | Aria | Texts |',
    '|------|------|------|------|-------|',
    ...index.map(
      r =>
        `| [\`${r.file}\`](./${r.file}) | ${r.label} | ${r.mode} | ${r.aria || ''} | ${(r.texts || []).join(', ') || '—'} |`,
    ),
    '',
  ].join('\n')
  fs.writeFileSync(path.join(OUT, 'README.md'), md)
  console.log(`Wrote ${index.length} screenshots + README.md to ${OUT}`)

  await browser.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
