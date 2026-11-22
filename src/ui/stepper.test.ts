import {
  ENTRY_KEY,
  STEPS,
  canOpenStep,
  currentEntry,
  isOwnEntry,
  landingStep,
  nextStep,
  planBack,
  planPop,
  planSheetClosed,
  prevStep,
  pushEntry,
  readEntry,
  replaceStep,
  showsStage,
  slideDirection,
  slideOffset,
  startNav,
  stepIndex,
  withEntry,
  type Nav,
  type NavEntry,
  type StepGate,
} from './stepper'

const DONE: StepGate = { hasSelection: true, pending: false }

describe('the steps', () => {
  it('runs verses → reciter → extras → design → preview', () => {
    expect(STEPS).toEqual(['verses', 'reciter', 'extras', 'design', 'preview'])
    expect(stepIndex('extras')).toBe(2)
    expect(nextStep('verses')).toBe('reciter')
    expect(nextStep('preview')).toBeNull()
    expect(prevStep('reciter')).toBe('verses')
    expect(prevStep('verses')).toBeNull()
  })

  it('keeps every step after the verses closed until a selection is finished', () => {
    const none = { hasSelection: false, pending: false }
    const pending = { hasSelection: true, pending: true }
    const done = { hasSelection: true, pending: false }
    expect(canOpenStep('verses', none)).toBe(true)
    for (const s of STEPS.slice(1)) {
      expect(canOpenStep(s, none)).toBe(false)
      expect(canOpenStep(s, pending)).toBe(false)
      expect(canOpenStep(s, done)).toBe(true)
    }
  })

  it('opens a shared passage on the preview, anything else on the verses', () => {
    expect(landingStep(true)).toBe('preview')
    expect(landingStep(false)).toBe('verses')
  })

  it('shows the live preview on the design and preview steps only', () => {
    expect(STEPS.filter(showsStage)).toEqual(['design', 'preview'])
  })

  it('slides in the reading direction: in Arabic the next step comes in from the left', () => {
    expect(slideDirection('verses', 'design')).toBe(1)
    expect(slideDirection('preview', 'reciter')).toBe(-1)
    expect(slideDirection('extras', 'extras')).toBe(0)
    expect(slideOffset(1, true, 24)).toBe(-24)
    expect(slideOffset(-1, true, 24)).toBe(24)
    expect(slideOffset(1, false, 24)).toBe(24)
    expect(slideOffset(-1, false, 24)).toBe(-24)
    expect(slideOffset(0, true, 24)).toBe(0)
  })
})

describe('history entries', () => {
  const entry: NavEntry = { key: 'a:1', prev: 'a:0', step: 'design', sheet: false }

  it("keeps Expo Router's own state next to ours", () => {
    const state = withEntry({ id: 'router:3', other: [1] }, entry)
    expect(state.id).toBe('router:3')
    expect(state.other).toEqual([1])
    expect(state[ENTRY_KEY]).toEqual({ key: 'a:1', prev: 'a:0', step: 'design', sheet: false })
    expect(readEntry(state)).toEqual(entry)
  })

  it('replaces only our part of an entry that already has one', () => {
    const once = withEntry({ id: 'r:0' }, entry)
    const twice = withEntry(once, { ...entry, step: 'extras' })
    expect(twice.id).toBe('r:0')
    expect(readEntry(twice)?.step).toBe('extras')
  })

  it('starts from an empty state when there is none', () => {
    expect(withEntry(null, entry)).toEqual({ [ENTRY_KEY]: { key: 'a:1', prev: 'a:0', step: 'design', sheet: false } })
    expect(withEntry('junk', entry)[ENTRY_KEY]).toBeTruthy()
  })

  it("reads nothing from the router's first entry or a malformed one", () => {
    expect(readEntry(null)).toBeNull()
    expect(readEntry({ id: 'r:0' })).toBeNull()
    expect(readEntry({ [ENTRY_KEY]: { key: 'a', prev: null, step: 'cooking', sheet: false } })).toBeNull()
    expect(readEntry({ [ENTRY_KEY]: { key: '', prev: null, step: 'verses' } })).toBeNull()
    expect(readEntry({ [ENTRY_KEY]: { key: 'a', prev: 7, step: 'verses' } })).toBeNull()
    expect(readEntry({ [ENTRY_KEY]: { key: 'a', prev: null, step: 'verses' } })).toEqual({ key: 'a', prev: null, step: 'verses', sheet: false })
  })
})

/** Steps through the model the way the app does, keeping a fake browser history in step with it. */
function session(landing: 'verses' | 'preview' = 'verses') {
  let nav: Nav = startNav('p:0', landing)
  let gate: StepGate = DONE
  const stack: unknown[] = [{ id: 'router:0' }]
  let index = 0
  let seq = 0
  const state = () => stack[index]
  const push = (step: Parameters<typeof pushEntry>[2], sheet = false) => {
    const r = pushEntry(nav, `p:${++seq}`, step, sheet)
    nav = r.nav
    stack.splice(index + 1)
    stack.push(withEntry(state(), r.entry))
    index += 1
    return r.entry.key
  }
  /** the browser's Back/Forward: moves, then delivers popstate */
  const go = (delta: number, open: Parameters<typeof planPop>[2] = null) => {
    index += delta
    const plan = planPop(nav, state(), open, gate)
    nav = plan.nav
    if (plan.replace) stack[index] = withEntry(state(), plan.replace)
    return plan
  }
  const back = () => {
    const plan = planBack(nav)
    if (!plan) return null
    nav = plan.nav
    if (plan.kind === 'history') index -= 1
    else stack[index] = withEntry(state(), plan.entry)
    return plan
  }
  return { nav: () => nav, setNav: (n: Nav) => (nav = n), setGate: (g: StepGate) => (gate = g), push, go, back, state, depth: () => index, stack }
}

describe('navigation', () => {
  it('goes back through the steps with the browser, and forward again', () => {
    const s = session()
    s.push('reciter')
    s.push('extras')
    expect(s.go(-1).step).toBe('reciter')
    expect(s.go(-1).step).toBe('verses')
    expect(s.go(1).step).toBe('reciter')
    expect(s.go(1).step).toBe('extras')
    expect(currentEntry(s.nav()).step).toBe('extras')
  })

  it("keeps the router's id in every entry it adds", () => {
    const s = session()
    s.push('reciter')
    s.push('extras', true)
    for (const st of s.stack) expect((st as { id: string }).id).toBe('router:0')
  })

  it('takes the on-screen Back through the browser when the entry below is the previous step', () => {
    const s = session()
    s.push('reciter')
    s.push('extras')
    const plan = s.back()
    expect(plan).toMatchObject({ kind: 'history', step: 'reciter' })
    expect(s.depth()).toBe(1)
    expect(s.back()).toMatchObject({ kind: 'history', step: 'verses' })
    expect(s.depth()).toBe(0)
    expect(s.back()).toBeNull() // hidden on the first step
  })

  it('changes the entry in place after a jump, so the browser Back still matches what is shown', () => {
    const s = session()
    s.push('design') // a jump with the indicator from the verses
    const plan = s.back()
    expect(plan).toMatchObject({ kind: 'replace', step: 'extras' })
    expect(s.depth()).toBe(1)
    expect(readEntry(s.state())?.step).toBe('extras')
    // the entry below is still the verses: in place again, until the previous step is the verses
    expect(s.back()).toMatchObject({ kind: 'replace', step: 'reciter' })
    expect(s.back()).toMatchObject({ kind: 'history', step: 'verses' })
    expect(s.depth()).toBe(0)
  })

  it('never leaves the app from a shared link: there is no entry below the preview', () => {
    const s = session('preview')
    for (const step of ['design', 'extras', 'reciter', 'verses'] as const) {
      expect(s.back()).toMatchObject({ kind: 'replace', step })
      expect(s.depth()).toBe(0)
    }
    expect(s.back()).toBeNull()
    // the router's id is still on the page's first entry
    expect((s.state() as { id: string }).id).toBe('router:0')
  })

  it('reads a replaced entry back from its own marker', () => {
    const s = session('preview')
    s.back() // design, in place
    s.push('preview')
    expect(s.go(-1).step).toBe('design')
  })

  it('uses what it learnt about an entry, not what it was when the entry above was added', () => {
    const s = session()
    s.push('design') // jump
    s.push('preview')
    s.go(-1) // on design
    s.back() // design → extras in place (below is the verses)
    s.go(1) // forward onto the preview again
    // Back from the preview: the entry below now shows the extras, not the design
    expect(s.back()).toMatchObject({ kind: 'replace', step: 'design' })
  })

  it("treats an entry without a marker as the page's first entry", () => {
    const s = session()
    s.push('reciter')
    expect(s.go(-1)).toMatchObject({ step: 'verses', closeSheet: false, skipBack: false })
    expect(s.nav().current).toBe('p:0')
  })

  it('learns entries of an earlier page load when the browser reaches them', () => {
    let nav = startNav('new:0', 'verses')
    const old = withEntry({ id: 'r:old' }, { key: 'old:2', prev: 'old:1', step: 'extras', sheet: false })
    const plan = planPop(nav, old, null, DONE)
    nav = plan.nav
    expect(plan.step).toBe('extras')
    expect(nav.current).toBe('old:2')
    // the entry below it is unknown: the on-screen Back stays in place
    expect(planBack(nav)).toMatchObject({ kind: 'replace', step: 'reciter' })
  })

  it('tells its own entries (of any page load) from the router’s', () => {
    expect(isOwnEntry(withEntry({ id: 'r:old' }, { key: 'old:2', prev: 'old:1', step: 'extras', sheet: false }))).toBe(true)
    expect(isOwnEntry({ id: 'r:0' })).toBe(false)
    expect(isOwnEntry(null)).toBe(false)
  })
})

describe('the selection gate on Back/Forward', () => {
  it('shows the verses, in place, when Forward reaches a step while the end of a new selection is pending', () => {
    const s = session()
    s.push('reciter')
    s.push('extras')
    s.go(-1)
    s.go(-1) // back on the verses
    s.setGate({ hasSelection: true, pending: true }) // a word tapped: a new selection begins
    const plan = s.go(1)
    expect(plan).toMatchObject({ step: 'verses', skipBack: false })
    expect(plan.replace).toEqual({ key: 'p:1', prev: 'p:0', step: 'verses', sheet: false })
    // the entry now says so, for the next time the browser reaches it
    expect(readEntry(s.state())?.step).toBe('verses')
    expect(currentEntry(s.nav())).toMatchObject({ key: 'p:1', step: 'verses' })
    expect(s.go(1)).toMatchObject({ step: 'verses' })
    // the selection finished: the entries above the verses that were not reached keep their step
    s.setGate(DONE)
    s.go(-2)
    s.push('reciter')
    expect(s.go(-1).step).toBe('verses')
    expect(s.go(1).step).toBe('reciter')
  })

  it('shows the verses without a selection (another surah still loading)', () => {
    const s = session()
    s.push('design')
    s.go(-1)
    s.setGate({ hasSelection: false, pending: false })
    expect(s.go(1)).toMatchObject({ step: 'verses', replace: { step: 'verses' } })
  })

  it('applies to the page’s first entry too (a shared link that landed on the preview)', () => {
    const s = session('preview')
    s.setGate({ hasSelection: false, pending: false })
    s.push('verses')
    expect(s.go(-1)).toMatchObject({ step: 'verses', replace: { key: 'p:0', prev: null, step: 'verses' } })
  })

  it('leaves the entry alone when it is open, and never gates the verses', () => {
    const s = session()
    s.push('reciter')
    expect(s.go(-1)).toMatchObject({ step: 'verses', replace: null })
    s.setGate({ hasSelection: false, pending: false })
    expect(s.go(0)).toMatchObject({ step: 'verses', replace: null })
  })

  it('does not gate a stale sheet entry: it is gone back over, and the entry below decides', () => {
    const s = session()
    s.push('preview')
    const key = s.push('preview', true)
    s.go(-1, { key, hasEntry: true }) // system Back closed it
    s.setGate({ hasSelection: true, pending: true })
    expect(s.go(1)).toMatchObject({ skipBack: true, replace: null })
    expect(s.go(-1)).toMatchObject({ step: 'verses', replace: { step: 'verses' } })
  })
})

describe('sheets', () => {
  it('closes an open sheet on system Back and keeps the step', () => {
    const s = session()
    s.push('extras')
    const key = s.push('extras', true)
    const plan = s.go(-1, { key, hasEntry: true })
    expect(plan).toMatchObject({ step: 'extras', closeSheet: true, skipBack: false })
    // the sheet's own close then finds the browser already off its entry
    expect(planSheetClosed(s.nav(), key).goBack).toBe(false)
  })

  it('goes back over the entry when the sheet is closed from the UI', () => {
    const s = session()
    s.push('reciter')
    const key = s.push('reciter', true)
    const plan = planSheetClosed(s.nav(), key)
    expect(plan.goBack).toBe(true)
    s.setNav(plan.nav)
    expect(currentEntry(s.nav()).step).toBe('reciter')
    expect(currentEntry(s.nav()).sheet).toBe(false)
    // the popstate that follows changes nothing
    expect(s.go(-1, null)).toMatchObject({ step: 'reciter', closeSheet: false, skipBack: false })
  })

  it('skips the entry of a closed sheet when the browser comes forward onto it', () => {
    const s = session()
    s.push('preview')
    const key = s.push('preview', true)
    s.go(-1, { key, hasEntry: true }) // system Back closed it
    expect(s.go(1, null)).toMatchObject({ step: 'preview', closeSheet: false, skipBack: true })
  })

  it('closes a sheet that has no entry when the browser moves', () => {
    const s = session()
    s.push('design')
    expect(s.go(-1, { key: 'p:9', hasEntry: false })).toMatchObject({ step: 'verses', closeSheet: true })
  })

  it('keeps the on-screen Back out of the way while a sheet is open', () => {
    const s = session()
    s.push('design')
    s.push('design', true)
    expect(planBack(s.nav())).toBeNull()
  })

  it('does not go back for a sheet whose entry is not the current one', () => {
    const nav = startNav('p:0', 'verses')
    expect(planSheetClosed(nav, 'p:5')).toEqual({ goBack: false, nav })
    const { nav: withStep } = pushEntry(nav, 'p:1', 'reciter')
    expect(planSheetClosed(withStep, 'p:1').goBack).toBe(false) // a step entry, not a sheet
  })
})

describe('replaceStep', () => {
  it('changes the current entry only', () => {
    const nav = startNav('p:0', 'verses')
    const { nav: next, entry } = replaceStep(nav, 'preview')
    expect(entry).toEqual({ key: 'p:0', prev: null, step: 'preview', sheet: false })
    expect(currentEntry(next).step).toBe('preview')
    expect(currentEntry(nav).step).toBe('verses')
  })
})
