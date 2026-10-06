import { createReadStream, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Streams complete lines from `offset` and reports the byte offset just past each one, so a caller
// can save progress per line and a partial last line is re-read on the next call.
export async function tailLines(
  path: string,
  offset: number,
  onLine: (line: string, next: number) => void,
  highWaterMark = 64 * 1024,
): Promise<number> {
  let carry: Buffer = Buffer.alloc(0)
  let at = offset
  for await (const chunk of createReadStream(path, { start: offset, highWaterMark }) as AsyncIterable<Buffer>) {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
    let from = 0
    let nl: number
    while ((nl = buf.indexOf(10, from)) !== -1) {
      at += nl - from + 1
      onLine(buf.toString('utf8', from, nl), at)
      from = nl + 1
    }
    carry = buf.subarray(from)
  }
  return at
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const file = (text: string) => {
    const p = join(mkdtempSync(join(tmpdir(), 'deck-lines-')), 't.jsonl')
    writeFileSync(p, text)
    return p
  }
  const collect = async (p: string, offset = 0, hwm?: number) => {
    const lines: string[] = []
    const nexts: number[] = []
    const end = await tailLines(p, offset, (l, n) => {
      lines.push(l)
      nexts.push(n)
    }, hwm)
    return { lines, nexts, end }
  }

  it('yields complete lines with their end offsets and stops before a partial last line', async () => {
    const p = file('{"a":1}\n{"b":2}\n{"c"')
    expect(await collect(p)).toEqual({ lines: ['{"a":1}', '{"b":2}'], nexts: [8, 16], end: 16 })
  })
  it('continues from a saved offset', async () => {
    const p = file('{"a":1}\n{"b":2}\n')
    expect(await collect(p, 8)).toEqual({ lines: ['{"b":2}'], nexts: [16], end: 16 })
  })
  it('keeps a line and a multibyte character that straddle chunk boundaries', async () => {
    const p = file('ab\ncé\n')
    expect((await collect(p, 0, 1)).lines).toEqual(['ab', 'cé'])
    expect((await collect(p, 0, 4)).lines).toEqual(['ab', 'cé'])
  })
}
