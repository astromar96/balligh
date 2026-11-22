// Guards the cause of "Mediabunny was loaded twice" (dev server static-rendering log after a hot reload).
// Investigation 2026-11-21: in the browser there is one Mediabunny instance (one Metro module, one async chunk; the
// AAC encoder's own `import … from "mediabunny"` resolves to the same file). The warning comes from the dev
// server's static renderer: it re-evaluates the server bundle on every reload in the SAME Node global, where
// Mediabunny's Symbol.for('mediabunny loaded') marker survives — so it fires whenever a module the server renders
// imports Mediabunny STATICALLY. Reproduced by adding `import 'mediabunny'` to the lab bench; gone with dynamic
// imports only. Rule: only video.web.ts touches Mediabunny, and only through import() (types via `import type` or
// `typeof import()`, which compile away — `import { type X } from 'mediabunny'` does NOT under verbatimModuleSyntax).

type Fs = {
  readdirSync(p: URL, o: { recursive: true }): string[]
  readFileSync(p: URL, encoding: 'utf8'): string
}

const PACKAGE = /^(mediabunny|@mediabunny\/aac-encoder)(\/|$)/
/** `import|export [type] <clause> from '<spec>'` (clause: default, namespace, `{ … }` over lines) or `import '<spec>'` */
const STATEMENT =
  /^[ \t]*(?:import|export)\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\w+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]/gm

/** Static import/export statements of the Mediabunny packages (not `import type`, not `import()`). */
function staticMediabunnyImports(source: string): string[] {
  const found: string[] = []
  for (const m of source.matchAll(STATEMENT)) {
    const typeOnly = m[1] !== undefined
    const spec = m[2] ?? m[3]
    if (!typeOnly && PACKAGE.test(spec)) found.push(m[0].trim())
  }
  return found
}

describe('Mediabunny is only ever imported dynamically (one instance, never evaluated by the static renderer)', () => {
  it('recognises static imports and lets type-only and dynamic imports through', () => {
    expect(staticMediabunnyImports(`import 'mediabunny'`)).toHaveLength(1)
    expect(staticMediabunnyImports(`import { Output } from "mediabunny"`)).toHaveLength(1)
    expect(staticMediabunnyImports(`import { type Output } from 'mediabunny'`)).toHaveLength(1) // kept as a side-effect import
    expect(staticMediabunnyImports(`export { registerAacEncoder } from '@mediabunny/aac-encoder'`)).toHaveLength(1)
    expect(staticMediabunnyImports(`import {\n  Output,\n  Quality,\n} from 'mediabunny'`)).toHaveLength(1)
    expect(staticMediabunnyImports(`import * as mb from 'mediabunny'`)).toHaveLength(1)
    expect(staticMediabunnyImports(`import mb, { Output } from 'mediabunny'`)).toHaveLength(1)
    expect(staticMediabunnyImports(`import type { Output } from 'mediabunny'`)).toEqual([])
    expect(staticMediabunnyImports(`export type { Output } from 'mediabunny'`)).toEqual([])
    expect(staticMediabunnyImports(`type M = typeof import('mediabunny')\nconst m = import('mediabunny')`)).toEqual([])
    expect(staticMediabunnyImports(`import { x } from './mediabunny-helpers'`)).toEqual([])
    expect(staticMediabunnyImports(`export const a = 1\n// a comment: import { X } from 'mediabunny' is not code`)).toEqual([])
  })

  it('no file under src/ imports mediabunny or @mediabunny/aac-encoder statically', async () => {
    const fs = (await import('node:fs' as string)) as Fs
    const root = new URL('../', import.meta.url)
    const offenders: string[] = []
    for (const rel of fs.readdirSync(root, { recursive: true })) {
      if (!/\.(ts|tsx|js|mjs)$/.test(rel) || rel.startsWith('vendor') || rel.endsWith('imports.test.ts')) continue
      const found = staticMediabunnyImports(fs.readFileSync(new URL(rel, root), 'utf8'))
      if (found.length) offenders.push(`${rel}: ${found.join(' | ')}`)
    }
    expect(offenders).toEqual([])
  })
})
