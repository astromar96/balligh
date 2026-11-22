import { vi } from 'vitest'
import type { Selection } from '../core/types'
import { fixtureAyahs } from './__fixtures__/load'

// the store loads ayahs through data/; the tests serve the committed fixture instead of the network
vi.mock('../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data')>()
  return {
    ...actual,
    fetchAyahs: vi.fn(async (n: number) => fixtureAyahs(n as 1 | 2 | 112)),
    fetchSurahs: vi.fn(async () => []),
  }
})

const { defaultDesign, useAppStore } = await import('./store')

const sel = (a: number, w: number, b: number, x: number, surah = 2): Selection => ({ surah, start: { ayah: a, word: w }, end: { ayah: b, word: x } })
const initial = useAppStore.getState()
const flush = () => new Promise((r) => setTimeout(r, 0))

function onKursi(over: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  useAppStore.setState({ ...initial, surah: 2, ayahs: fixtureAyahs(2), ayahsStatus: 'ready', selection: null, pending: null, ...over })
}

beforeEach(() => onKursi())

describe('tapping words', () => {
  it('extends a finished range to the next pause mark when «التزم بعلامات الوقف» is on', () => {
    const { tap } = useAppStore.getState()
    tap({ kind: 'word', ref: { ayah: 255, word: 1 } })
    expect(useAppStore.getState().pending).not.toBeNull()
    tap({ kind: 'word', ref: { ayah: 255, word: 5 } })
    const s = useAppStore.getState()
    expect(s.pending).toBeNull()
    expect(s.selection).toEqual(sel(255, 1, 255, 7)) // «ٱلْقَيُّومُ ۚ»
    expect(s.cursor).toEqual({ ayah: 255, word: 5 })
  })

  it('keeps the exact words when snapping is off', () => {
    onKursi({ snapToPauses: false })
    const { tap } = useAppStore.getState()
    tap({ kind: 'word', ref: { ayah: 255, word: 5 } })
    tap({ kind: 'word', ref: { ayah: 256, word: 4 } })
    expect(useAppStore.getState().selection).toEqual(sel(255, 5, 256, 4))
  })
})

describe('warning fixes', () => {
  it('«اختر الآيات كاملة» widens to whole ayahs', () => {
    onKursi({ selection: sel(255, 5, 256, 4) })
    useAppStore.getState().applyFix({ kind: 'whole-ayahs' })
    const s = useAppStore.getState().selection
    expect(s?.start).toEqual({ ayah: 255, word: 1 })
    expect(s?.end.ayah).toBe(256)
    expect(s?.end.word).toBe(fixtureAyahs(2)[1].words.at(-1)?.position)
  })

  it('the start fix moves a mid-sentence start back to where the sentence begins, and keeps the end', () => {
    onKursi({ selection: sel(255, 5, 256, 4) })
    useAppStore.getState().applyFix({ kind: 'snap-start' })
    expect(useAppStore.getState().selection).toEqual(sel(255, 1, 256, 4))
  })

  it('completing the meaning scrolls the new end into view', () => {
    onKursi({ selection: sel(255, 1, 255, 50), scrollRequest: null })
    useAppStore.getState().applyFix({ kind: 'extend-to', to: { ayah: 256, word: 6 } })
    const s = useAppStore.getState()
    expect(s.selection).toEqual(sel(255, 1, 256, 6))
    expect(s.scrollRequest).toMatchObject({ ayah: 256 })
  })

  it('switching to whole ayahs widens the current selection', () => {
    onKursi({ selection: sel(255, 5, 255, 9) })
    useAppStore.getState().setSelectionMode('ayahs')
    expect(useAppStore.getState().selection).toEqual(sel(255, 1, 255, 50))
  })
})

describe('keyboard cursor', () => {
  it('first shows the cursor at the start of the selection, then walks the words', () => {
    onKursi({ selection: sel(255, 1, 255, 50), cursor: null })
    const { moveCursor } = useAppStore.getState()
    moveCursor(1, false)
    expect(useAppStore.getState().cursor).toEqual({ ayah: 255, word: 1 })
    moveCursor(1, false)
    expect(useAppStore.getState().cursor).toEqual({ ayah: 255, word: 2 })
    expect(useAppStore.getState().selection).toEqual(sel(255, 1, 255, 50))
  })

  it('extends the selection from its start with Shift+arrow', () => {
    onKursi({ selection: sel(255, 49, 255, 49), cursor: { ayah: 255, word: 49 } })
    const { moveCursor } = useAppStore.getState()
    moveCursor(1, true)
    moveCursor(1, true)
    expect(useAppStore.getState().selection).toEqual(sel(255, 49, 256, 1))
    expect(useAppStore.getState().cursor).toEqual({ ayah: 256, word: 1 })
  })
})

describe('content switches', () => {
  it('turning tafsir off and on keeps the last source and the design flag in step', () => {
    const { setTafsir } = useAppStore.getState()
    setTafsir('muyassar')
    expect(useAppStore.getState()).toMatchObject({ tafsirId: 'muyassar', lastTafsirId: 'muyassar' })
    expect(useAppStore.getState().design.showTafsir).toBe(true)
    setTafsir(null)
    expect(useAppStore.getState()).toMatchObject({ tafsirId: null, lastTafsirId: 'muyassar' })
    expect(useAppStore.getState().design.showTafsir).toBe(false)
  })
})

describe('share links', () => {
  it('carries only what differs from the default design and never a photo', () => {
    onKursi({ selection: sel(255, 1, 255, 50) })
    const { setDesign } = useAppStore.getState()
    setDesign({ aspect: '1:1', overlay: 0.65 })
    let state = useAppStore.getState().shareState()
    expect(state?.design).toEqual({ aspect: '1:1', overlay: 0.65 })
    setDesign({ background: { kind: 'image', src: 'blob:x', focusX: 0.5, focusY: 0.5 } })
    state = useAppStore.getState().shareState()
    expect(state?.design.background).toBeUndefined()
    expect(state?.selection).toEqual(sel(255, 1, 255, 50))
  })

  it('carries the isti\u2019adha only for a reciter who recorded it in their own voice', () => {
    onKursi({ selection: sel(255, 1, 255, 50), reciterId: 'alafasy', istiadha: true })
    expect(useAppStore.getState().shareState()?.istiadha).toBe(true)
    onKursi({ selection: sel(255, 1, 255, 50), reciterId: 'shuraim', istiadha: true })
    expect(useAppStore.getState().shareState()?.istiadha).toBeUndefined()
    onKursi({ selection: sel(255, 1, 255, 50), reciterId: 'alafasy', istiadha: false })
    expect(useAppStore.getState().shareState()?.istiadha).toBeUndefined()
  })

  it('restores the isti\u2019adha from a link, and turns it off when the link has none', async () => {
    onKursi({ istiadha: true })
    useAppStore.getState().applyShareState({ selection: sel(255, 1, 255, 50), reciterId: 'alafasy', tafsirId: null, translationId: null, design: {}, istiadha: true })
    await flush()
    expect(useAppStore.getState().istiadha).toBe(true)
    useAppStore.getState().applyShareState({ selection: sel(255, 1, 255, 50), reciterId: 'alafasy', tafsirId: null, translationId: null, design: {} })
    await flush()
    expect(useAppStore.getState().istiadha).toBe(false)
  })

  it('opens a shared passage, clamped to the surah, with its reciter and design', async () => {
    useAppStore.getState().applyShareState({
      selection: sel(1, 2, 4, 999, 112),
      reciterId: '',
      tafsirId: null,
      translationId: 20,
      design: { aspect: '16:9' },
    })
    await flush()
    const s = useAppStore.getState()
    expect(s.surah).toBe(112)
    expect(s.ayahsStatus).toBe('ready')
    expect(s.selection?.end).toEqual({ ayah: 4, word: fixtureAyahs(112)[3].words.at(-1)?.position })
    expect(s.reciterId).toBe(initial.reciterId)
    expect(s.design.aspect).toBe('16:9')
    expect(s.design.showTranslation).toBe(true)
    expect(s.design.background).toEqual(defaultDesign().background)
  })
})
