import { clock } from '../shared/format'
import { toolLabel, type DiffLine, type Item, type ToolItem, type Transcript } from '../shared/api'
import { num, parseRecord, promptText, str, stripRecapSuffix, type Rec } from './transcript'

const OUT_LINES = 3
const DIFF_LINES = 400
const ARG_CHARS = 400
// ponytail: per-tool ceiling for lines kept in memory; the session file keeps the rest. Read the record back from the file by offset if full output beyond this matters.
const KEEP_LINES = 2000
const ARG_KEYS = ['command', 'file_path', 'pattern', 'skill', 'query', 'prompt', 'url', 'description'] as const
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write'])
const PR_URL_RE = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Entry { item: Item; lines: string[]; diff: DiffLine[] }
interface TurnAgg { prompt: string; entries: Entry[]; footer?: string; recap?: string }
export interface TurnsAgg { id: string; cli: string | null; turns: TurnAgg[]; open: Map<string, Entry> }

export const emptyTurnsAgg = (id: string): TurnsAgg => ({ id, cli: null, turns: [], open: new Map() })

// Items can arrive before any prompt (e.g. right after a compaction); they get a turn without a bubble.
function current(agg: TurnsAgg): TurnAgg {
  if (!agg.turns.length) agg.turns.push({ prompt: '', entries: [] })
  return agg.turns[agg.turns.length - 1]
}

export function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`
}

function footerText(ms: number, ts: string | null): string {
  const when = ts ? new Date(ts) : null
  const done = when && !Number.isNaN(when.getTime()) ? ` · done ${WEEKDAYS[when.getDay()]} ${clock(when)}` : ''
  return `Worked for ${durationText(ms)}${done}`
}

function argOf(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  for (const k of ARG_KEYS) {
    const v = (input as Rec)[k]
    if (typeof v === 'string' && v.trim()) {
      const a = v.trim()
      return a.length > ARG_CHARS ? `${a.slice(0, ARG_CHARS - 1)}…` : a
    }
  }
  return ''
}

function resultText(c: unknown): string {
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c.map((x: Rec) => (typeof x?.text === 'string' ? x.text : '')).filter(Boolean).join('\n')
}

function diffLines(hunks: unknown[]): DiffLine[] {
  const out: DiffLine[] = []
  for (const h of hunks as Rec[]) {
    if (!Array.isArray(h?.lines)) continue
    let o = num(h.oldStart)
    let n = num(h.newStart)
    for (const raw of h.lines) {
      if (typeof raw !== 'string' || raw.startsWith('\\')) continue
      const text = raw.slice(1)
      if (raw[0] === '-') out.push([o++, '-', text])
      else if (raw[0] === '+') out.push([n++, '+', text])
      else {
        out.push([n, ' ', text])
        o++
        n++
      }
    }
  }
  return out
}

function reduceUser(agg: TurnsAgg, r: Rec): void {
  const c = r.message?.content
  const blocks: Rec[] = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : []
  for (const b of blocks) {
    if (b?.type === 'text' && typeof b.text === 'string') {
      if (r.isMeta || b.text.trimStart().startsWith('[Request interrupted')) continue
      const prompt = promptText(b.text)
      if (prompt) agg.turns.push({ prompt, entries: [] })
    } else if (b?.type === 'tool_result') {
      const e = agg.open.get(String(b.tool_use_id))
      if (!e || e.item.k !== 'tool') continue
      agg.open.delete(String(b.tool_use_id))
      fillResult(e, e.item, b, r.toolUseResult)
    }
  }
}

function fillResult(e: Entry, item: ToolItem, b: Rec, tur: unknown): void {
  const text = resultText(b.content)
  e.lines = text ? text.replace(/\n$/, '').split('\n').slice(0, KEEP_LINES) : []
  if (b.is_error === true) item.err = true
  const res: Rec | null = tur && typeof tur === 'object' ? tur : null
  if (EDIT_TOOLS.has(item.tool) && Array.isArray(res?.structuredPatch)) e.diff = diffLines(res.structuredPatch)
  // A Write that creates a file comes back with an empty patch and the whole text in `content`.
  const created = item.tool === 'Write' && !e.diff.length && res?.type === 'create' ? str(res.content) : null
  if (created) e.diff = created.replace(/\n$/, '').split('\n').map((text, i): DiffLine => [i + 1, '+', text])
  if (item.tool === 'Bash' && /\bgh pr create\b/.test(item.arg)) {
    const m = PR_URL_RE.exec(text)
    if (m) item.link = m[0]
  }
}

function reduceAssistant(agg: TurnsAgg, r: Rec): void {
  const content = r.message?.content
  if (!Array.isArray(content)) return
  for (const b of content as Rec[]) {
    if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      const turn = current(agg)
      const last = turn.entries[turn.entries.length - 1]?.item
      // A streamed message can repeat its text block; show it once.
      if (last?.k === 'text' && last.md === b.text.trim()) continue
      turn.entries.push({ item: { k: 'text', md: b.text.trim() }, lines: [], diff: [] })
    } else if (b?.type === 'tool_use' && typeof b.name === 'string') {
      const e: Entry = { item: { k: 'tool', tool: b.name, name: toolLabel(b.name), arg: argOf(b.input) }, lines: [], diff: [] }
      current(agg).entries.push(e)
      if (typeof b.id === 'string') agg.open.set(b.id, e)
    }
  }
}

export function reduceTurnLine(agg: TurnsAgg, line: string): void {
  const r = parseRecord(line)
  if (!r || r.isSidechain) return
  const v = str(r.version)
  if (v) agg.cli = `Claude Code v${v}`
  switch (r.type) {
    case 'user':
      return reduceUser(agg, r)
    case 'assistant':
      return reduceAssistant(agg, r)
    case 'system':
      if (r.subtype === 'turn_duration') current(agg).footer = footerText(num(r.durationMs), str(r.timestamp))
      else if (r.subtype === 'away_summary' && str(r.content)) current(agg).recap = stripRecapSuffix(r.content)
  }
}

function payload(e: Entry): Item {
  if (e.item.k === 'text') return e.item
  const item: ToolItem = { ...e.item }
  if (e.diff.length) {
    item.a = e.diff.filter((l) => l[1] === '+').length
    item.d = e.diff.filter((l) => l[1] === '-').length
    item.diff = e.diff.slice(0, DIFF_LINES)
    if (e.diff.length > DIFF_LINES) item.more = e.diff.length - DIFF_LINES
  } else if (e.lines.length) {
    item.out = e.lines.slice(0, OUT_LINES)
    if (e.lines.length > OUT_LINES) item.more = e.lines.length - OUT_LINES
  }
  return item
}

export function finalizeTurns(agg: TurnsAgg): Transcript {
  return {
    cli: agg.cli ?? 'Claude Code',
    turns: agg.turns.map((t) => ({
      prompt: t.prompt,
      items: t.entries.map(payload),
      ...(t.footer ? { footer: t.footer } : {}),
      ...(t.recap ? { recap: t.recap } : {}),
    })),
  }
}

export function toolLines(agg: TurnsAgg, turn: number, item: number): string[] | null {
  const e = agg.turns[turn]?.entries[item]
  return e && e.item.k === 'tool' && e.lines.length ? e.lines : null
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const base = { sessionId: id, cwd: '/Users/me/code/app', version: '2.1.283', timestamp: '2026-10-05T15:40:00.000Z' }
  const user = (content: unknown, extra: object = {}) => ({ type: 'user', ...base, message: { role: 'user', content }, ...extra })
  const assistant = (content: unknown[], extra: object = {}) => ({ type: 'assistant', ...base, message: { id: 'msg_1', model: 'claude-opus-5-5', content }, ...extra })
  const use = (tid: string, name: string, input: object) => ({ type: 'tool_use', id: tid, name, input })
  const result = (tid: string, content: unknown, extra: object = {}, tur?: unknown) =>
    user([{ type: 'tool_result', tool_use_id: tid, content, ...extra }], tur === undefined ? {} : { toolUseResult: tur })
  const run = (...recs: unknown[]) => {
    const agg = emptyTurnsAgg(id)
    for (const r of recs) reduceTurnLine(agg, typeof r === 'string' ? r : JSON.stringify(r))
    return { agg, t: finalizeTurns(agg) }
  }
  const tool = (t: Transcript, turn: number, i: number) => t.turns[turn].items[i] as ToolItem

  it('starts a turn per real prompt, keeping slash commands with arguments and skipping meta and interrupts', () => {
    const { t } = run(
      user('Caveat: injected', { isMeta: true }),
      user('<command-message>plan</command-message>\n<command-name>/team8:plan</command-name>\n<command-args>build it</command-args>'),
      user('<command-message>clear</command-message>\n<command-name>/clear</command-name>\n<command-args></command-args>'),
      user('[Request interrupted by user]'),
      user([{ type: 'text', text: 'second prompt' }]),
    )
    expect(t.turns.map((x) => x.prompt)).toEqual(['/team8:plan build it', 'second prompt'])
    expect(t.cli).toBe('Claude Code v2.1.283')
  })

  it('turns assistant text and tool calls into items with the CLI label and the first useful argument', () => {
    const { t } = run(
      user('go'),
      assistant([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: '  Looking.  ' }, use('t1', 'Grep', { pattern: 'splitFor', path: 'src' }), use('t2', 'Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' }), use('t3', 'Skill', { skill: 'tdd' })]),
    )
    expect(t.turns[0].items).toEqual([
      { k: 'text', md: 'Looking.' },
      { k: 'tool', tool: 'Grep', name: 'Search', arg: 'splitFor' },
      { k: 'tool', tool: 'Edit', name: 'Update', arg: '/a.ts' },
      { k: 'tool', tool: 'Skill', name: 'Skill', arg: 'tdd' },
    ])
  })

  it('attaches items before any prompt to a turn with an empty prompt', () => {
    const { t } = run(assistant([{ type: 'text', text: 'after compaction' }]), user('next'))
    expect(t.turns.map((x) => x.prompt)).toEqual(['', 'next'])
    expect(t.turns[0].items).toEqual([{ k: 'text', md: 'after compaction' }])
  })

  it('keeps the first three output lines, counts the rest, and serves the full lines on request', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`)
    const { agg, t } = run(user('go'), assistant([use('t1', 'Bash', { command: 'ls' })]), result('t1', lines.join('\n')))
    expect(tool(t, 0, 0)).toEqual({ k: 'tool', tool: 'Bash', name: 'Bash', arg: 'ls', out: ['line 1', 'line 2', 'line 3'], more: 7 })
    expect(toolLines(agg, 0, 0)).toEqual(lines)
    expect(toolLines(agg, 0, 1)).toBeNull()
    expect(toolLines(agg, 3, 0)).toBeNull()
  })

  it('reads block-array results, marks errors, and drops results with no matching call', () => {
    const { t } = run(
      user('go'),
      assistant([use('t1', 'Bash', { command: 'npm test' })]),
      result('t1', [{ type: 'text', text: 'Exit code 1' }, { type: 'text', text: 'boom' }], { is_error: true }),
      result('zzz', 'orphan'),
    )
    expect(tool(t, 0, 0)).toEqual({ k: 'tool', tool: 'Bash', name: 'Bash', arg: 'npm test', out: ['Exit code 1', 'boom'], err: true })
    expect(t.turns[0].items).toHaveLength(1)
  })

  it('builds the diff from structuredPatch hunks with old numbers for removals and new numbers otherwise', () => {
    const patch = [
      { oldStart: 23, oldLines: 2, newStart: 23, newLines: 2, lines: [' a', '-b', '+B'] },
      { oldStart: 40, oldLines: 1, newStart: 40, newLines: 2, lines: ['-c', '+C', '+D', '\\ No newline at end of file'] },
    ]
    const { t } = run(user('go'), assistant([use('t1', 'Edit', { file_path: '/a.ts', old_string: 'b', new_string: 'B' })]),
      result('t1', 'The file /a.ts has been updated successfully.', {}, { filePath: '/a.ts', structuredPatch: patch }))
    const it1 = tool(t, 0, 0)
    expect(it1.diff).toEqual<DiffLine[]>([[23, ' ', 'a'], [24, '-', 'b'], [24, '+', 'B'], [40, '-', 'c'], [40, '+', 'C'], [41, '+', 'D']])
    expect(it1).toMatchObject({ a: 3, d: 2 })
    expect(it1.out).toBeUndefined()
  })

  it('caps a diff at 400 lines and reports the overflow as more lines', () => {
    const lines = Array.from({ length: 450 }, (_, i) => `+l${i}`)
    const { t } = run(user('go'), assistant([use('t1', 'Write', { file_path: '/big.md', content: 'x' })]),
      result('t1', 'ok', {}, { structuredPatch: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 450, lines }] }))
    expect(tool(t, 0, 0).diff).toHaveLength(400)
    expect(tool(t, 0, 0)).toMatchObject({ a: 450, d: 0, more: 50 })
  })

  it('links a PR created with gh pr create, even behind a cd', () => {
    const { t } = run(user('go'), assistant([use('t1', 'Bash', { command: 'cd app && gh pr create --title x' })]),
      result('t1', 'Creating pull request\nhttps://github.com/alan-oliv/meetnotes/pull/28\n'))
    expect(tool(t, 0, 0).link).toBe('https://github.com/alan-oliv/meetnotes/pull/28')
  })

  it('writes the footer from turn_duration and the recap from away_summary', () => {
    const done = new Date(2026, 9, 5, 12, 42).toISOString()
    const { t } = run(
      user('go'),
      { type: 'system', subtype: 'turn_duration', durationMs: 1_842_000, ...base, timestamp: done },
      { type: 'system', subtype: 'away_summary', content: 'Fixed it. Next: ship. (disable recaps in /config)', ...base },
    )
    expect(t.turns[0].footer).toBe('Worked for 30m 42s · done Monday 12:42 PM')
    expect(t.turns[0].recap).toBe('Fixed it. Next: ship.')
    expect(durationText(12_000)).toBe('12s')
    expect(durationText(3_725_000)).toBe('1h 2m 5s')
  })

  it('ignores sidechain records, malformed lines and snapshots', () => {
    const { t } = run('{bad', '{"type":"file-history-snapshot","snapshot":{}}', user('side', { isSidechain: true }), assistant([{ type: 'text', text: 'side' }], { isSidechain: true }), user('go'))
    expect(t.turns).toEqual([{ prompt: 'go', items: [] }])
  })

  it('cuts a long argument to 400 characters', () => {
    const { t } = run(user('go'), assistant([use('t1', 'Bash', { command: 'x'.repeat(1000) })]))
    expect(tool(t, 0, 0).arg).toHaveLength(400)
    expect(tool(t, 0, 0).arg.endsWith('…')).toBe(true)
  })

  it('shows a created file as all added lines when the Write result has no patch', () => {
    const { t } = run(user('go'), assistant([use('t1', 'Write', { file_path: '/new.md', content: 'a\nb\n' })]),
      result('t1', 'File created successfully at: /new.md', {}, { type: 'create', filePath: '/new.md', content: 'a\nb\n', structuredPatch: [] }))
    expect(tool(t, 0, 0)).toMatchObject({ a: 2, d: 0, diff: [[1, '+', 'a'], [2, '+', 'b']] })
    expect(tool(t, 0, 0).out).toBeUndefined()
  })
}
