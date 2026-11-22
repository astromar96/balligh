// npm run typecheck: tsc over the app and over server/. Files whose fixture data is not in this checkout (the public
// repository carries none — scripts/fixture-gate.cjs) are excluded through a generated tsconfig; in the full
// checkout the plain tsconfig.json is used.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { missingDataFiles } = createRequire(import.meta.url)('./fixture-gate.cjs')
const missing = missingDataFiles(root)

function tsc(...args) {
  const r = spawnSync('npx', ['tsc', '--noEmit', ...args], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (missing.length === 0) tsc()
else {
  const base = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))
  const generated = join(root, 'tsconfig.check.json')
  writeFileSync(generated, JSON.stringify({ extends: './tsconfig.json', exclude: [...(base.exclude ?? []), ...missing] }, null, 2))
  console.log(`[typecheck] ${missing.length} files left out: their fixture data is not in this checkout`)
  try {
    tsc('-p', 'tsconfig.check.json')
  } finally {
    rmSync(generated, { force: true })
  }
}
tsc('-p', 'server')
