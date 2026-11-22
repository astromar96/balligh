// Which source files import fixture data that this checkout does not have.
//
// The public repository (github.com/astromar96/balligh) carries the code without any third-party data: captured API
// responses from Quran Foundation, QuranEnc, Quranpedia, mp3quran, EveryAyah and Tanzil may not be republished
// (QF Developer Terms: data in a public repository is redistribution). The tests and dev benches that import such
// data are left out there — of tsc (scripts/typecheck.mjs), vitest (vitest.config.mts) and the dev bundle
// (metro.config.js) — instead of failing. In the full checkout nothing is missing and nothing is left out.
//
// A file is left out when one of its relative imports does not exist, or when it imports a file that is left out.
// App code may never be left out: missingDataFiles() throws if anything outside tests, fixtures, testing helpers or
// labs would be.
const fs = require('fs')
const path = require('path')

const ROOTS = ['src', 'server/src']
const CODE = /\.(ts|tsx|mts)$/ // what tsc, vitest and Metro compile; .mjs tools are run by hand
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm
const RESOLVE = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx']

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (CODE.test(entry.name)) out.push(p)
  }
  return out
}

function resolveImport(from, spec) {
  const base = path.resolve(path.dirname(from), spec)
  for (const ext of RESOLVE) {
    const candidate = base + ext
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

/** may this file be left out? tests, fixture helpers, testing helpers and dev labs only */
function isTestSide(rel) {
  return /\.test\.[cm]?tsx?$/.test(rel) || /(^|\/)(__fixtures__|testing|lab)\//.test(rel)
}

/** Repository-relative paths (forward slashes) of the files that need data this checkout lacks. */
function missingDataFiles(root = path.resolve(__dirname, '..')) {
  const files = ROOTS.flatMap((r) => walk(path.join(root, r), []))
  const importsOf = new Map()
  const out = new Set()
  for (const file of files) {
    // template literals out first: tests quote import lines as data (media/imports.test.ts)
    const text = fs.readFileSync(file, 'utf8').replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    const resolved = []
    for (const m of text.matchAll(SPECIFIER)) {
      const target = resolveImport(file, m[1])
      if (target === null) out.add(file)
      else resolved.push(target)
    }
    importsOf.set(file, resolved)
  }
  // whatever imports a left-out file is left out too
  for (let changed = true; changed; ) {
    changed = false
    for (const [file, targets] of importsOf) {
      if (!out.has(file) && targets.some((t) => out.has(t))) {
        out.add(file)
        changed = true
      }
    }
  }
  const rel = [...out].map((f) => path.relative(root, f).split(path.sep).join('/')).sort()
  const appCode = rel.filter((f) => !isTestSide(f))
  if (appCode.length > 0) throw new Error(`app code imports files that are missing: ${appCode.join(', ')}`)
  return rel
}

module.exports = { missingDataFiles }

if (require.main === module) {
  const list = missingDataFiles()
  console.log(list.length ? list.join('\n') : 'nothing is missing')
}
