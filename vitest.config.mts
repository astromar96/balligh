import { configDefaults, defineConfig } from 'vitest/config'
import gate from './scripts/fixture-gate.cjs'

// Tests whose captured API data is not in this checkout (the public repository carries none) are left out rather
// than failing; scripts/fixture-gate.cjs says why. In the full checkout the list is empty.
const missing = gate.missingDataFiles()
if (missing.length > 0) console.log(`[vitest] ${missing.filter((f) => f.endsWith('.test.ts')).length} test files skipped: their fixture data is not in this checkout`)

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'server/src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...missing],
    environment: 'node',
    globals: true,
    passWithNoTests: true,
  },
})
