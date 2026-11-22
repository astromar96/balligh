// Instagram's and Threads' video specs ask for "MOV or MP4, no edit lists, moov atom at the front". The app's export
// (Mediabunny) puts moov first but writes the AAC priming (2112 samples, 44 ms) as an audio edit list, which keeps A/V
// at 0 samples (media N3). This copy drops every edit list instead: the priming is then played, so the audio starts
// 44 ms late — below what anyone notices on a recitation clip. Box sizes and chunk offsets are rewritten; the media
// data is not touched. Facebook, Telegram, YouTube and X get the original file.

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])

interface Box {
  type: string
  start: number
  /** header length: 8, or 16 with a 64-bit size */
  header: number
  size: number
}

function readBoxes(buf: Buffer, start: number, end: number): Box[] {
  const out: Box[] = []
  let off = start
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    let header = 8
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(off + 8))
      header = 16
    } else if (size === 0) size = end - off
    if (size < header || off + size > end) throw new Error(`bad MP4 box ${type} at ${off}`)
    out.push({ type, start: off, header, size })
    off += size
  }
  return out
}

/** the box rebuilt without its edts descendants; offsets fixed later */
function rebuild(buf: Buffer, box: Box): Buffer {
  if (!CONTAINERS.has(box.type)) return buf.subarray(box.start, box.start + box.size)
  const children = readBoxes(buf, box.start + box.header, box.start + box.size)
    .filter((c) => c.type !== 'edts')
    .map((c) => rebuild(buf, c))
  const body = Buffer.concat(children)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + body.length, 0)
  head.write(box.type, 4, 'latin1')
  return Buffer.concat([head, body])
}

/** adds `delta` to every stco/co64 chunk offset at or past `from`, in place */
function shiftChunkOffsets(moov: Buffer, delta: number, from: number): void {
  const walk = (start: number, end: number) => {
    for (const b of readBoxes(moov, start, end)) {
      const body = b.start + b.header
      if (CONTAINERS.has(b.type)) walk(body, b.start + b.size)
      else if (b.type === 'stco') {
        const n = moov.readUInt32BE(body + 4)
        for (let i = 0; i < n; i++) {
          const p = body + 8 + i * 4
          const v = moov.readUInt32BE(p)
          if (v >= from) moov.writeUInt32BE(v + delta, p)
        }
      } else if (b.type === 'co64') {
        const n = moov.readUInt32BE(body + 4)
        for (let i = 0; i < n; i++) {
          const p = body + 8 + i * 8
          const v = moov.readBigUInt64BE(p)
          if (v >= BigInt(from)) moov.writeBigUInt64BE(v + BigInt(delta), p)
        }
      }
    }
  }
  walk(0, moov.length)
}

/** true when the file has an edit list anywhere under moov */
export function hasEditLists(buf: Buffer): boolean {
  const find = (start: number, end: number): boolean =>
    readBoxes(buf, start, end).some((b) => b.type === 'edts' || (CONTAINERS.has(b.type) && find(b.start + b.header, b.start + b.size)))
  return find(0, buf.length)
}

/** The same MP4 without edit lists. Returns the input itself when there are none. */
export function stripEditLists(buf: Buffer): Buffer {
  if (!hasEditLists(buf)) return buf
  const top = readBoxes(buf, 0, buf.length)
  const moov = top.find((b) => b.type === 'moov')
  if (!moov) return buf
  const fresh = rebuild(buf, moov)
  const delta = fresh.length - moov.size
  // only data after the old moov moves; with moov at the front that is all of mdat
  shiftChunkOffsets(fresh, delta, moov.start + moov.size)
  return Buffer.concat([buf.subarray(0, moov.start), fresh, buf.subarray(moov.start + moov.size)])
}
