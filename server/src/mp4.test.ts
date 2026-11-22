import { describe, expect, it } from 'vitest'
import { hasEditLists, stripEditLists } from './mp4'

function box(type: string, ...children: Buffer[]): Buffer {
  const body = Buffer.concat(children)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + body.length, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body])
}

function stco(offsets: number[]): Buffer {
  const b = Buffer.alloc(8 + offsets.length * 4)
  b.writeUInt32BE(offsets.length, 4)
  offsets.forEach((o, i) => b.writeUInt32BE(o, 8 + i * 4))
  return box('stco', b)
}

/** ftyp + moov(trak(edts?, mdia(minf(stbl(stco))))) × 2 + mdat, with chunk offsets pointing into mdat */
function sample(withEdts: boolean): { file: Buffer; payload: Buffer[] } {
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isom'))
  const payload = [Buffer.from('VIDEO-CHUNK'), Buffer.from('AUDIO-CHUNK')]
  const build = (offsets: [number, number]) =>
    box(
      'moov',
      box('mvhd', Buffer.alloc(20)),
      box('trak', box('tkhd', Buffer.alloc(12)), box('mdia', box('minf', box('stbl', stco([offsets[0]]))))),
      box(
        'trak',
        box('tkhd', Buffer.alloc(12)),
        ...(withEdts ? [box('edts', box('elst', Buffer.alloc(16)))] : []),
        box('mdia', box('minf', box('stbl', stco([offsets[1]])))),
      ),
    )
  const moovSize = build([0, 0]).length
  const mdatStart = ftyp.length + moovSize
  const first = mdatStart + 8
  const moov = build([first, first + payload[0].length])
  const mdat = box('mdat', ...payload)
  return { file: Buffer.concat([ftyp, moov, mdat]), payload }
}

function chunkOffsets(buf: Buffer): number[] {
  const out: number[] = []
  for (let i = buf.indexOf('stco'); i >= 0; i = buf.indexOf('stco', i + 4)) out.push(buf.readUInt32BE(i + 12))
  return out
}

describe('stripEditLists', () => {
  it('removes the edts box and moves the chunk offsets with the media data', () => {
    const { file, payload } = sample(true)
    expect(hasEditLists(file)).toBe(true)
    const out = stripEditLists(file)
    expect(hasEditLists(out)).toBe(false)
    expect(out.length).toBe(file.length - 32)
    const [v, a] = chunkOffsets(out)
    expect(out.subarray(v, v + payload[0].length).toString()).toBe('VIDEO-CHUNK')
    expect(out.subarray(a, a + payload[1].length).toString()).toBe('AUDIO-CHUNK')
    // the sizes of the boxes on the way down were rewritten
    expect(out.readUInt32BE(out.indexOf('moov') - 4)).toBe(file.readUInt32BE(file.indexOf('moov') - 4) - 32)
  })

  it('leaves a file without edit lists alone', () => {
    const { file } = sample(false)
    expect(stripEditLists(file)).toBe(file)
  })
})
