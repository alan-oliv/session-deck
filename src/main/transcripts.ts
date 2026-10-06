import { appendFileSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Transcript } from '../shared/api'
import { tailLines } from './lines'
import { emptyTurnsAgg, finalizeTurns, reduceTurnLine, toolLines, type TurnsAgg } from './turns'

// ponytail: four parsed sessions in memory; a fifth evicts the least recently requested.
const KEEP = 4

interface Entry { path: string; size: number; offset: number; agg: TurnsAgg }

export interface TranscriptStore {
  get(id: string): Promise<Transcript>
  output(id: string, turn: number, item: number): Promise<string[]>
}

export function createTranscriptStore(pathFor: (id: string) => string | undefined, keep = KEEP): TranscriptStore {
  // Map order is recency: a hit is deleted and re-set.
  const cache = new Map<string, Entry>()
  const inflight = new Map<string, Promise<Entry>>()

  async function tail(id: string): Promise<Entry> {
    const path = pathFor(id)
    if (!path) throw new Error('Unknown session')
    const size = statSync(path).size
    let e = cache.get(id)
    // ponytail: assumes append-only; a same-size rewrite is served from memory until the app restarts.
    if (!e || e.path !== path || size < e.offset) e = { path, size: -1, offset: 0, agg: emptyTurnsAgg(id) }
    if (size !== e.size) {
      const entry = e
      entry.offset = await tailLines(path, entry.offset, (line, next) => {
        reduceTurnLine(entry.agg, line)
        entry.offset = next
      })
      entry.size = size
    }
    cache.delete(id)
    cache.set(id, e)
    while (cache.size > keep) cache.delete(cache.keys().next().value as string)
    return e
  }

  // Two requests for one session must not tail the same bytes twice.
  function load(id: string): Promise<Entry> {
    const pending = inflight.get(id)
    if (pending) return pending
    const p = tail(id).finally(() => inflight.delete(id))
    inflight.set(id, p)
    return p
  }

  return {
    get: async (id) => finalizeTurns((await load(id)).agg),
    output: async (id, turn, item) => {
      const lines = toolLines((await load(id)).agg, turn, item)
      if (!lines) throw new Error('Unknown tool call')
      return lines
    },
  }
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const a = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const b = '711a48a0-fc93-44b8-b71c-1c6e5b645970'
  const line = (o: object) => `${JSON.stringify({ sessionId: a, version: '2.1.283', timestamp: '2026-10-06T09:00:00.000Z', ...o })}\n`
  const prompt = (text: string) => line({ type: 'user', message: { content: text } })
  const call = (text: string) =>
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } }) +
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: text }] } })
  const fixture = () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-tx-'))
    const paths: Record<string, string> = { [a]: join(dir, `${a}.jsonl`), [b]: join(dir, `${b}.jsonl`) }
    writeFileSync(paths[a], prompt('first'))
    writeFileSync(paths[b], prompt('other'))
    return { paths, store: createTranscriptStore((id) => paths[id], 1) }
  }

  it('parses a session once and tails only appended lines afterwards', async () => {
    const { paths, store } = fixture()
    expect((await store.get(a)).turns.map((t) => t.prompt)).toEqual(['first'])
    appendFileSync(paths[a], prompt('second'))
    expect((await store.get(a)).turns.map((t) => t.prompt)).toEqual(['first', 'second'])
    expect((await store.get(a)).turns).toHaveLength(2)
  })
  it('starts over when the file shrinks', async () => {
    const { paths, store } = fixture()
    appendFileSync(paths[a], prompt('second'))
    await store.get(a)
    writeFileSync(paths[a], prompt('fresh'))
    expect((await store.get(a)).turns.map((t) => t.prompt)).toEqual(['fresh'])
  })
  it('serves concurrent requests from one parse', async () => {
    const { paths, store } = fixture()
    await store.get(a)
    appendFileSync(paths[a], call('one\ntwo\nthree\nfour'))
    const [x, y] = await Promise.all([store.get(a), store.get(a)])
    expect(x.turns[0].items).toHaveLength(1)
    expect(y.turns[0].items).toHaveLength(1)
  })
  it('returns full tool output and rejects indices that point at nothing', async () => {
    const { paths, store } = fixture()
    appendFileSync(paths[a], call('one\ntwo\nthree\nfour'))
    expect((await store.get(a)).turns[0].items[0]).toMatchObject({ out: ['one', 'two', 'three'], more: 1 })
    expect(await store.output(a, 0, 0)).toEqual(['one', 'two', 'three', 'four'])
    await expect(store.output(a, 0, 5)).rejects.toThrow('Unknown tool call')
    await expect(store.output(a, 9, 0)).rejects.toThrow('Unknown tool call')
  })
  it('still serves a session after others pushed it out of memory', async () => {
    const { paths, store } = fixture()
    await store.get(a)
    await store.get(b)
    appendFileSync(paths[a], prompt('second'))
    expect((await store.get(a)).turns.map((t) => t.prompt)).toEqual(['first', 'second'])
  })
  it('rejects a session the index does not know', async () => {
    const store = createTranscriptStore(() => undefined)
    await expect(store.get(a)).rejects.toThrow('Unknown session')
  })
}
