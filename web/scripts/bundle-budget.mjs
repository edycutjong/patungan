// Bundle budget for the production build: gzip size of every JS and CSS asset in dist/assets.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = { js: 150, css: 30 }
const dir = join(import.meta.dirname, '..', 'dist', 'assets')
const totals = { js: 0, css: 0 }
for (const f of readdirSync(dir)) {
  const ext = f.endsWith('.js') ? 'js' : f.endsWith('.css') ? 'css' : null
  if (!ext) continue
  totals[ext] += gzipSync(readFileSync(join(dir, f))).length
}
let ok = true
for (const ext of ['js', 'css']) {
  const kb = totals[ext] / 1024
  const pass = kb <= BUDGET_KB[ext]
  ok &&= pass
  console.log(`${ext.toUpperCase()} gzip ${kb.toFixed(1)} KB / budget ${BUDGET_KB[ext]} KB ${pass ? 'OK' : 'OVER'}`)
}
if (!ok) process.exit(1)
