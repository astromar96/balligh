// The /lab/domain bench re-runs unit-test facts in the Metro bundle; here it runs under Node, so a stale bench
// fails in CI instead of on the lab page.
import { describe, expect, it } from 'vitest'
import { runDomainLab } from './bench'

describe('domain lab bench', () => {
  it('passes every check', () => {
    const r = runDomainLab()
    expect(r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`)).toEqual([])
    expect(r.checks.length).toBeGreaterThan(30)
    expect(r.rules).toHaveLength(19)
    expect(r.labels.every((l) => l.ar && l.en)).toBe(true)
  })
})
