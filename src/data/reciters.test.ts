// Reciter catalogue invariants (generated from research/fixtures/audio-timing/reciters.json) and the voice table
// (reciters.voice.ts) checked against the research evidence it was written from.
import { readTextIfPresent, repoFile } from './__fixtures__/load'
import { DEFAULT_RECITER_ID, RECITERS, getReciter } from './index'
import { RECITER_CATALOG } from './reciters.catalog'
import { everyAyahFile, everyAyahUrl, fillTemplate, getCatalogEntry } from './reciters'
import { RECITER_VOICE, voiceOf } from './reciters.voice'

const identityTxt = await readTextIfPresent(repoFile('research/fixtures/gaps/everyayah-istiadha-basmala-identity.txt'))
const headScan = await readTextIfPresent(repoFile('research/fixtures/gaps/everyayah-istiadha-basmala.jsonl'))

describe('reciter catalogue', () => {
  it('starts with the popular reciters, default first', () => {
    expect(DEFAULT_RECITER_ID).toBe('alafasy')
    expect(RECITERS[0].id).toBe('alafasy')
    expect(RECITERS.slice(0, 8).map((r) => r.id)).toEqual([
      'alafasy',
      'abdulbasit-murattal',
      'husary',
      'minshawi-murattal',
      'sudais',
      'maher-muaiqly',
      'yasser-dosari',
      'saad-ghamdi',
    ])
    expect(new Set(RECITERS.map((r) => r.id)).size).toBe(RECITERS.length)
    expect(getReciter('alafasy')).toMatchObject({ timingClass: 'A', wordTimings: true })
    expect(getReciter('nobody')).toBeUndefined()
  })

  it('gives every class the source it needs, with credits', () => {
    for (const e of RECITER_CATALOG) {
      expect(e.sourceName.length, e.id).toBeGreaterThan(0)
      if (e.timingClass === 'A') expect(e.everyayah && e.v4, e.id).toBeTruthy()
      if (e.timingClass === 'B') expect(e.qdc?.wordSegments, e.id).toBe(true)
      if (e.timingClass === 'C') expect(e.everyayah, e.id).toBeTruthy()
      if (e.timingClass === 'D') expect(e.mp3quran?.timingRead, e.id).toBeTruthy()
      for (const url of [e.everyayah?.urlTemplate, e.mp3quran?.urlTemplate]) {
        if (url) expect(url, e.id).toMatch(/^https:\/\/(everyayah\.com|cdn\.mp3quran\.net)\//)
      }
    }
    expect(RECITERS.filter((r) => r.wordTimings).every((r) => r.timingClass === 'A' || r.timingClass === 'B')).toBe(true)
  })

  it('uses the 26 ms offset only where the aligned encode differs (Husary, Abdul Basit murattal)', () => {
    const offsets = RECITER_CATALOG.filter((e) => e.v4 && e.v4.offsetMs !== 0).map((e) => [e.id, e.v4?.offsetMs])
    expect(offsets).toEqual([
      ['abdulbasit-murattal', 26],
      ['husary', 26],
    ])
  })

  it('fills {SSS}{AAA} templates', () => {
    expect(fillTemplate(getCatalogEntry('alafasy')!.everyayah!.urlTemplate, 2, 255)).toBe('https://everyayah.com/data/Alafasy_128kbps/002255.mp3')
    expect(fillTemplate('https://cdn.mp3quran.net/audio/x/r1/{SSS}.mp3', 9)).toBe('https://cdn.mp3quran.net/audio/x/r1/009.mp3')
  })
})

describe('voice table (research/00-gaps.md §2.8, §6.3, D7)', () => {
  const ids = (pred: (id: string) => boolean) => RECITER_CATALOG.map((e) => e.id).filter(pred).sort()
  const folderOf = (id: string) => getCatalogEntry(id)?.everyayah?.folder ?? null

  it('has one row per catalogue reciter', () => {
    expect(Object.keys(RECITER_VOICE).sort()).toEqual(RECITER_CATALOG.map((e) => e.id).sort())
    expect(voiceOf('nobody')).toEqual({ basmala: 'ayah-1:1', istiadha: 'none', foreign001001: false, vbrChapters: [] })
    expect(voiceOf('constructor').istiadha).toBe('none') // not Object.prototype
  })

  it("offers the isti'adha only where the file is the reciter's own voice", () => {
    expect(RECITERS.filter((r) => r.istiadha).map((r) => r.id).sort()).toEqual(['alafasy', 'ali-jaber', 'hudhaifi', 'husary', 'shatri'])
    expect(ids((id) => voiceOf(id).istiadha === 'foreign')).toEqual(['muhammad-ayyub', 'saad-ghamdi', 'shuraim'])
    expect(ids((id) => voiceOf(id).basmala === 'bismillah.mp3')).toEqual(['ali-jaber'])
    expect(ids((id) => voiceOf(id).foreign001001)).toEqual(['khalifa-tunaiji'])
    expect(voiceOf('khalifa-tunaiji').vbrChapters).toEqual([14, 72])
    expect(ids((id) => voiceOf(id).vbrChapters.length > 0)).toEqual(['khalifa-tunaiji'])
  })

  it('builds EveryAyah URLs, never the foreign 1:1 of Tunaiji', () => {
    const t = getCatalogEntry('khalifa-tunaiji')!
    expect(everyAyahUrl(t, 1, 1)).toBeNull()
    expect(everyAyahUrl(t, 1, 2)).toBe('https://everyayah.com/data/khalefa_al_tunaiji_64kbps/001002.mp3')
    expect(everyAyahUrl(t, 14, 1)).toBe('https://everyayah.com/data/khalefa_al_tunaiji_64kbps/014001.mp3')
    expect(everyAyahUrl(getCatalogEntry('minshawi-murattal')!, 1, 1)).toBe('https://everyayah.com/data/Minshawy_Murattal_128kbps/001001.mp3')
    expect(everyAyahUrl(getCatalogEntry('khalid-jalil')!, 1, 1)).toBeNull()
    // Ali Jaber's 001001.mp3 is isti'adha + basmala: 1:1 comes from his bismillah.mp3
    expect(everyAyahUrl(getCatalogEntry('ali-jaber')!, 1, 1)).toBe('https://everyayah.com/data/Ali_Jaber_64kbps/bismillah.mp3')
    expect(everyAyahUrl(getCatalogEntry('ali-jaber')!, 1, 2)).toBe('https://everyayah.com/data/Ali_Jaber_64kbps/001002.mp3')
    expect(everyAyahFile(getCatalogEntry('ali-jaber')!, 'bismillah.mp3')).toBe('https://everyayah.com/data/Ali_Jaber_64kbps/bismillah.mp3')
    expect(everyAyahFile(getCatalogEntry('idrees-abkar')!, 'audhubillah.mp3')).toBeNull()
  })

  it.skipIf(!identityTxt)('agrees with the decoded-PCM identity check (everyayah-istiadha-basmala-identity.txt)', () => {
    // "Folder/file.mp3 | sr ch duration bitrate | pcm16k | tags [<- whose recording]"
    const rows = new Map<string, { hash: string; copy: boolean }>()
    for (const line of (identityTxt ?? '').split('\n')) {
      const m = /^(\S+\/\S+\.mp3)\s*\|[^|]*\|\s*([0-9a-f]{16})\s*\|(.*)$/.exec(line)
      if (m) rows.set(m[1], { hash: m[2], copy: m[3].includes('<-') })
    }
    expect(rows.size).toBeGreaterThanOrEqual(18)
    const fileOf = (id: string, file: string) => {
      const folder = folderOf(id)
      return folder ? rows.get(`${folder}/${file}`) : undefined
    }
    const sharing = (file: string, hash: string) => [...rows].filter(([k, r]) => k.endsWith(`/${file}`) && r.hash === hash).length
    for (const e of RECITER_CATALOG) {
      const v = voiceOf(e.id)
      const audh = fileOf(e.id, 'audhubillah.mp3')
      if (v.istiadha === 'own') {
        expect(audh, e.id).toBeDefined()
        expect(audh?.copy, e.id).toBe(false)
        // no other reciter offered as "own" has the same recording
        expect(ids((o) => o !== e.id && voiceOf(o).istiadha === 'own' && fileOf(o, 'audhubillah.mp3')?.hash === audh?.hash), e.id).toEqual([])
      }
      if (v.istiadha === 'foreign') {
        expect(audh?.copy, e.id).toBe(true)
        expect(ids((o) => voiceOf(o).istiadha === 'own' && fileOf(o, 'audhubillah.mp3')?.hash === audh?.hash), e.id).toEqual(['alafasy'])
      }
      if (v.istiadha === 'none') expect(audh, e.id).toBeUndefined()
      const one = fileOf(e.id, '001001.mp3')
      if (v.foreign001001) {
        expect(one?.copy, e.id).toBe(true)
        expect(ids((o) => o !== e.id && fileOf(o, '001001.mp3')?.hash === one?.hash), e.id).toEqual(['minshawi-murattal'])
      } else if (one) expect(one.copy, e.id).toBe(false)
      const bism = fileOf(e.id, 'bismillah.mp3')
      if (v.basmala === 'bismillah.mp3') {
        expect(bism, e.id).toBeDefined()
        expect(sharing('bismillah.mp3', bism?.hash ?? ''), e.id).toBe(1) // never the shared Shuraim/Ayyoub recording
      }
      if (bism && sharing('bismillah.mp3', bism.hash) > 1) expect(v.basmala, e.id).toBe('ayah-1:1')
    }
  })

  it.skipIf(!headScan)('agrees with the HEAD scan of every EveryAyah folder (everyayah-istiadha-basmala.jsonl)', () => {
    type Row = { id: string; folder?: string; everyayah?: null } & Record<string, { status: number } | string | null | undefined>
    const scan = new Map(
      (headScan ?? '')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Row)
        .map((r) => [r.id, r]),
    )
    const status = (r: Row | undefined, file: string) => (r?.[file] as { status: number } | undefined)?.status
    expect([...scan.keys()].sort()).toEqual(RECITER_CATALOG.map((e) => e.id).sort())
    for (const e of RECITER_CATALOG) {
      const r = scan.get(e.id)
      const v = voiceOf(e.id)
      expect(r?.folder ?? null, e.id).toBe(e.everyayah?.folder ?? null)
      if (!e.everyayah) {
        expect(v.istiadha, e.id).toBe('none')
        expect(v.basmala, e.id).toBe('ayah-1:1')
        continue
      }
      expect(status(r, '001001.mp3'), e.id).toBe(200)
      expect(status(r, 'audhubillah.mp3'), e.id).toBe(v.istiadha === 'none' ? 404 : 200)
      if (v.basmala === 'bismillah.mp3') expect(status(r, 'bismillah.mp3'), e.id).toBe(200)
    }
  })
})
